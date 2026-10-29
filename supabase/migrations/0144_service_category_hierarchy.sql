begin;

-- Servicekategorien sind ein eigener, mandantenlokaler Baum. Eine Kategorie
-- kann höchstens zwei Vorfahren haben: Kategorie → Unterkategorie →
-- Unterunterkategorie. Die zusammengesetzten Schlüssel binden auch
-- service-role-Schreibvorgänge an denselben Mandanten.
create table if not exists public.service_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  parent_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint service_categories_id_tenant_unique unique (id, tenant_id),
  constraint service_categories_parent_not_self check (
    parent_id is null or parent_id <> id
  ),
  constraint service_categories_parent_tenant_fk
    foreign key (parent_id, tenant_id)
    references public.service_categories (id, tenant_id)
    on delete restrict
);

create unique index if not exists service_categories_tenant_parent_name_unique
  on public.service_categories (tenant_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
create index if not exists service_categories_tenant_parent_active_name_idx
  on public.service_categories (tenant_id, parent_id, active, name);

alter table public.services
  add column if not exists service_category_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'services_service_category_tenant_fk'
      and conrelid = 'public.services'::regclass
  ) then
    alter table public.services
      add constraint services_service_category_tenant_fk
      foreign key (service_category_id, tenant_id)
      references public.service_categories (id, tenant_id)
      on delete restrict;
  end if;
end;
$$;

create index if not exists services_tenant_service_category_active_idx
  on public.services (tenant_id, service_category_id, active)
  where service_category_id is not null;

create or replace function public.validate_service_category_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ancestor_id uuid;
  ancestor_active boolean;
  level_count integer := 0;
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'service_categories' then
    raise exception 'Unsupported service category trigger target'
      using errcode = '22023';
  end if;

  -- A single transaction lock per tenant closes MVCC races between two valid
  -- moves/inserts and between a category deactivation and service assignment.
  perform pg_advisory_xact_lock(
    hashtextextended(new.tenant_id::text || ':service-category-tree', 0)
  );

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id then
      raise exception 'Service category identity is immutable' using errcode = '23514';
    end if;
    if new.created_at is distinct from old.created_at then
      raise exception 'Service category creation timestamp is immutable'
        using errcode = '23514';
    end if;
    if old.active and not new.active and exists (
      select 1
      from public.service_categories child
      where child.tenant_id = new.tenant_id
        and child.parent_id = new.id
        and child.active
    ) then
      raise exception 'A category with active children cannot be deactivated'
        using errcode = '23514';
    end if;
    if old.active and not new.active and exists (
      select 1
      from public.services service
      where service.tenant_id = new.tenant_id
        and service.service_category_id = new.id
        and service.active
    ) then
      raise exception 'A category assigned to active services cannot be deactivated'
        using errcode = '23514';
    end if;
  end if;

  ancestor_id := new.parent_id;
  while ancestor_id is not null loop
    level_count := level_count + 1;
    if ancestor_id = new.id then
      raise exception 'A service category cannot be its own ancestor'
        using errcode = '23514';
    end if;
    if level_count > 2 then
      raise exception 'Service categories support at most three levels'
        using errcode = '23514';
    end if;
    select category.parent_id, category.active
      into ancestor_id, ancestor_active
    from public.service_categories category
    where category.tenant_id = new.tenant_id
      and category.id = ancestor_id;
    if not found then
      raise exception 'Service category parent is unavailable' using errcode = '23503';
    end if;
    if not ancestor_active then
      raise exception 'Service category parent is inactive' using errcode = '23514';
    end if;
  end loop;

  if exists (
    with recursive descendants as (
      select child.id, 1 as depth
      from public.service_categories child
      where child.tenant_id = new.tenant_id
        and child.parent_id = new.id
      union all
      select child.id, descendants.depth + 1
      from public.service_categories child
      join descendants
        on descendants.id = child.parent_id
      where child.tenant_id = new.tenant_id
    )
    select 1
    from descendants
    where level_count + depth > 2
  ) then
    raise exception 'Service category move would exceed three levels'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.validate_service_category_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'services' then
    raise exception 'Unsupported service category assignment target'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(new.tenant_id::text || ':service-category-tree', 0)
  );
  if new.service_category_id is not null and not exists (
    select 1
    from public.service_categories category
    where category.id = new.service_category_id
      and category.tenant_id = new.tenant_id
      and category.active
  ) then
    raise exception 'Service category is unavailable for this tenant'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

create or replace function public.audit_service_category_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_row jsonb;
  after_row jsonb;
  category_row jsonb;
  category_tenant_id uuid;
  category_id uuid;
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'service_categories' then
    raise exception 'Unsupported service category audit target'
      using errcode = '22023';
  end if;
  if tg_op <> 'INSERT' then
    before_row := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    after_row := to_jsonb(new);
  end if;
  category_row := coalesce(after_row, before_row);
  category_tenant_id := (category_row ->> 'tenant_id')::uuid;
  category_id := (category_row ->> 'id')::uuid;

  if exists (select 1 from public.tenants where id = category_tenant_id) then
    insert into public.audit_logs (
      tenant_id, actor_id, action, entity_type, entity_id,
      severity, before_data, after_data, metadata
    ) values (
      category_tenant_id, auth.uid(), 'service_categories.' || lower(tg_op),
      'service_category', category_id, 'info', before_row, after_row,
      jsonb_build_object('table', 'service_categories', 'operation', tg_op)
    );
  end if;
  return null;
end;
$$;

revoke all on function public.validate_service_category_hierarchy()
  from public, anon, authenticated;
revoke all on function public.validate_service_category_assignment()
  from public, anon, authenticated;
revoke all on function public.audit_service_category_changes()
  from public, anon, authenticated;

drop trigger if exists service_categories_validate_hierarchy
  on public.service_categories;
create trigger service_categories_validate_hierarchy
  before insert or update on public.service_categories
  for each row execute function public.validate_service_category_hierarchy();
drop trigger if exists service_categories_updated_at on public.service_categories;
create trigger service_categories_updated_at
  before update on public.service_categories
  for each row execute function public.set_updated_at();
drop trigger if exists service_categories_audit_changes on public.service_categories;
create trigger service_categories_audit_changes
  after insert or update or delete on public.service_categories
  for each row execute function public.audit_service_category_changes();
drop trigger if exists services_validate_category_assignment on public.services;
create trigger services_validate_category_assignment
  before insert or update of tenant_id, service_category_id on public.services
  for each row execute function public.validate_service_category_assignment();

alter table public.service_categories enable row level security;
revoke all on table public.service_categories from public, anon, authenticated;
grant select, insert, update, delete on table public.service_categories
  to authenticated, service_role;

drop policy if exists service_categories_select_member on public.service_categories;
create policy service_categories_select_member on public.service_categories
  for select to authenticated using (
    public.is_active_tenant_member(tenant_id)
    and public.is_asset_management_client_enabled(tenant_id)
    and (active or public.has_tenant_permission(tenant_id, 'asset.manage'))
  );
drop policy if exists service_categories_manage_authorized on public.service_categories;
create policy service_categories_manage_authorized on public.service_categories
  for all to authenticated
  using (
    public.is_active_tenant_member(tenant_id)
    and public.is_asset_management_client_enabled(tenant_id)
    and public.has_tenant_permission(tenant_id, 'asset.manage')
  )
  with check (
    public.is_active_tenant_member(tenant_id)
    and public.is_asset_management_client_enabled(tenant_id)
    and public.has_tenant_permission(tenant_id, 'asset.manage')
  );

commit;
