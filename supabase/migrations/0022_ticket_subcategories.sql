begin;
set local search_path = pg_catalog, public;

-- ticket_categories already models the hierarchy. A root row (parent_id IS NULL)
-- is a category; one direct child is a subcategory. Do not create a parallel
-- entity: keeping both levels in this table preserves the existing tenant and
-- department composite foreign-key boundary.
--
-- Names are unique within their direct parent. NULLS NOT DISTINCT also makes
-- root-category names unique within a tenant department.
alter table public.ticket_categories
  drop constraint if exists ticket_categories_department_id_name_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ticket_categories'::regclass
      and conname = 'ticket_categories_parent_name_unique'
  ) then
    alter table public.ticket_categories
      add constraint ticket_categories_parent_name_unique
      unique nulls not distinct (tenant_id, department_id, parent_id, name);
  end if;
end;
$$;

-- A category may have exactly one subcategory level. The pre-existing composite
-- parent FK enforces tenant/department equality; this trigger additionally
-- prevents a grandchild, cycles, and reparenting rows already used on tickets.
create or replace function public.validate_ticket_category_parent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_parent_parent_id uuid;
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'ticket_categories' then
    raise exception 'Invalid trigger target' using errcode = '22023';
  end if;

  if new.parent_id = new.id then
    raise exception 'A ticket category cannot be its own parent' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE'
    and new.parent_id is distinct from old.parent_id
    and exists (
      select 1
      from public.tickets as ticket
      where ticket.category_id = new.id
         or ticket.subcategory_id = new.id
    ) then
    raise exception 'A ticket category used by tickets cannot be reparented' using errcode = '23514';
  end if;

  if new.parent_id is null then
    return new;
  end if;

  -- FOR SHARE serializes this check with parent reparenting/deletion.
  select parent.parent_id
    into v_parent_parent_id
    from public.ticket_categories as parent
   where parent.id = new.parent_id
     and parent.tenant_id = new.tenant_id
     and parent.department_id = new.department_id
   for share;

  if not found then
    raise exception 'Category parent must belong to the same tenant and department'
      using errcode = '23503';
  end if;

  if v_parent_parent_id is not null then
    raise exception 'Ticket categories support only one subcategory level'
      using errcode = '23514';
  end if;

  -- Reparenting a category that has children would make those children a third
  -- level, even if no ticket has used the category yet.
  if tg_op = 'UPDATE'
    and new.parent_id is distinct from old.parent_id
    and exists (
      select 1
      from public.ticket_categories as child
      where child.parent_id = new.id
    ) then
    raise exception 'A category with subcategories cannot itself be a subcategory'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Store the chosen direct child separately on the ticket. Both category fields
-- use the existing (id, tenant_id, department_id) key, so a service-role write
-- cannot cross a tenant or department boundary.
alter table public.tickets
  add column if not exists subcategory_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tickets'::regclass
      and conname = 'tickets_subcategory_department_tenant_fk'
  ) then
    alter table public.tickets
      add constraint tickets_subcategory_department_tenant_fk
      foreign key (subcategory_id, tenant_id, department_id)
      references public.ticket_categories (id, tenant_id, department_id)
      on delete restrict;
  end if;
end;
$$;

-- A ticket category is always a root category. When a subcategory is selected,
-- it must be a direct child of that exact root category; neither field may be
-- substituted with a same-tenant, unrelated row.
create or replace function public.validate_ticket_category_selection()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_category_parent_id uuid;
  v_subcategory_parent_id uuid;
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'tickets' then
    raise exception 'Invalid trigger target' using errcode = '22023';
  end if;

  if new.subcategory_id is not null and new.category_id is null then
    raise exception 'A ticket subcategory requires a category' using errcode = '23514';
  end if;

  if new.category_id is null then
    return new;
  end if;

  -- FOR SHARE keeps category parentage stable until the ticket FK checks and
  -- write complete. The composite FK remains the database backstop.
  select category.parent_id
    into v_category_parent_id
    from public.ticket_categories as category
   where category.id = new.category_id
     and category.tenant_id = new.tenant_id
     and category.department_id = new.department_id
   for share;

  if not found then
    raise exception 'Ticket category must belong to the ticket tenant and department'
      using errcode = '23503';
  end if;

  if v_category_parent_id is not null then
    raise exception 'Ticket category must be a top-level category'
      using errcode = '23514';
  end if;

  if new.subcategory_id is null then
    return new;
  end if;

  select subcategory.parent_id
    into v_subcategory_parent_id
    from public.ticket_categories as subcategory
   where subcategory.id = new.subcategory_id
     and subcategory.tenant_id = new.tenant_id
     and subcategory.department_id = new.department_id
   for share;

  if not found then
    raise exception 'Ticket subcategory must belong to the ticket tenant and department'
      using errcode = '23503';
  end if;

  if v_subcategory_parent_id is distinct from new.category_id then
    raise exception 'Ticket subcategory must belong to the selected category'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- All category hierarchy changes are retained in the tenant audit log. Only
-- metadata in the category row is recorded; no ticket descriptions or users
-- are copied into the audit event.
create or replace function public.audit_ticket_category_changes()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_before_data jsonb;
  v_after_data jsonb;
  v_tenant_id uuid;
  v_category_id uuid;
  v_department_id uuid;
  v_parent_id uuid;
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'ticket_categories' then
    raise exception 'Invalid trigger target' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    v_after_data := to_jsonb(new);
    v_tenant_id := new.tenant_id;
    v_category_id := new.id;
    v_department_id := new.department_id;
    v_parent_id := new.parent_id;
  elsif tg_op = 'UPDATE' then
    v_before_data := to_jsonb(old);
    v_after_data := to_jsonb(new);
    v_tenant_id := new.tenant_id;
    v_category_id := new.id;
    v_department_id := new.department_id;
    v_parent_id := new.parent_id;
  else
    v_before_data := to_jsonb(old);
    v_tenant_id := old.tenant_id;
    v_category_id := old.id;
    v_department_id := old.department_id;
    v_parent_id := old.parent_id;
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity,
    before_data, after_data, metadata
  ) values (
    v_tenant_id, auth.uid(), 'ticket.category.' || lower(tg_op),
    'ticket_category', v_category_id, 'info', v_before_data, v_after_data,
    jsonb_build_object('department_id', v_department_id, 'parent_id', v_parent_id,
                       'operation', tg_op)
  );

  return null;
end;
$$;

drop trigger if exists ticket_categories_validate_parent on public.ticket_categories;
create trigger ticket_categories_validate_parent
  before insert or update of tenant_id, department_id, parent_id on public.ticket_categories
  for each row execute function public.validate_ticket_category_parent();

drop trigger if exists tickets_validate_category_selection on public.tickets;
create trigger tickets_validate_category_selection
  before insert or update of tenant_id, department_id, category_id, subcategory_id on public.tickets
  for each row execute function public.validate_ticket_category_selection();

drop trigger if exists ticket_categories_audit_changes on public.ticket_categories;
create trigger ticket_categories_audit_changes
  after insert or update or delete on public.ticket_categories
  for each row execute function public.audit_ticket_category_changes();

create index if not exists ticket_categories_tenant_department_parent_active_idx
  on public.ticket_categories (tenant_id, department_id, parent_id, name)
  where active;
create index if not exists tickets_subcategory_tenant_department_idx
  on public.tickets (subcategory_id, tenant_id, department_id)
  where subcategory_id is not null;
create index if not exists tickets_category_subcategory_lookup_idx
  on public.tickets (tenant_id, department_id, category_id, subcategory_id)
  where category_id is not null;

alter table public.ticket_categories enable row level security;

-- Read access remains tenant-membership scoped. Mutations are available to
-- staff who may update tickets in that department, or to department managers
-- (at department or tenant scope). Both sides of UPDATE are authorized so a
-- category cannot be moved into a department the actor cannot manage.
drop policy if exists ticket_categories_select_member on public.ticket_categories;
create policy ticket_categories_select_member on public.ticket_categories
  for select to authenticated
  using (public.is_active_tenant_member(tenant_id));

drop policy if exists ticket_categories_insert_authorized on public.ticket_categories;
create policy ticket_categories_insert_authorized on public.ticket_categories
  for insert to authenticated
  with check (
    public.is_active_tenant_member(tenant_id)
    and (
      public.has_ticket_permission(tenant_id, department_id, 'ticket.update')
      or public.has_ticket_permission(tenant_id, department_id, 'department.manage')
      or public.has_tenant_permission(tenant_id, 'department.manage')
    )
  );

drop policy if exists ticket_categories_update_authorized on public.ticket_categories;
create policy ticket_categories_update_authorized on public.ticket_categories
  for update to authenticated
  using (
    public.is_active_tenant_member(tenant_id)
    and (
      public.has_ticket_permission(tenant_id, department_id, 'ticket.update')
      or public.has_ticket_permission(tenant_id, department_id, 'department.manage')
      or public.has_tenant_permission(tenant_id, 'department.manage')
    )
  )
  with check (
    public.is_active_tenant_member(tenant_id)
    and (
      public.has_ticket_permission(tenant_id, department_id, 'ticket.update')
      or public.has_ticket_permission(tenant_id, department_id, 'department.manage')
      or public.has_tenant_permission(tenant_id, 'department.manage')
    )
  );

drop policy if exists ticket_categories_delete_authorized on public.ticket_categories;
create policy ticket_categories_delete_authorized on public.ticket_categories
  for delete to authenticated
  using (
    public.is_active_tenant_member(tenant_id)
    and (
      public.has_ticket_permission(tenant_id, department_id, 'ticket.update')
      or public.has_ticket_permission(tenant_id, department_id, 'department.manage')
      or public.has_tenant_permission(tenant_id, 'department.manage')
    )
  );

revoke all on table public.ticket_categories from public, anon, authenticated;
grant select, insert, update, delete on table public.ticket_categories to authenticated;
grant select, insert, update, delete on table public.ticket_categories to service_role;

revoke all on function public.validate_ticket_category_parent() from public, anon, authenticated;
revoke all on function public.validate_ticket_category_selection() from public, anon, authenticated;
revoke all on function public.audit_ticket_category_changes() from public, anon, authenticated;

commit;
