begin;

-- The project exposes has_tenant_permission(uuid, text) for auth.uid(), and
-- has_ticket_permission(uuid, uuid, text) for tenant/department-scoped RBAC.
-- Composite references enforce isolation even for service-role writes and
-- concurrent changes to referenced rows, independently of RLS.
create unique index if not exists tickets_id_tenant_unique
  on public.tickets (id, tenant_id);
create unique index if not exists customer_organizations_id_tenant_unique
  on public.customer_organizations (id, tenant_id);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 240),
  description text,
  criticality text not null default 'medium'
    check (criticality in ('low', 'medium', 'high', 'critical')),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint services_id_tenant_unique unique (id, tenant_id),
  constraint services_tenant_name_unique unique (tenant_id, name)
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 240),
  asset_tag text check (char_length(btrim(asset_tag)) between 1 and 160),
  kind text not null default 'other'
    check (char_length(btrim(kind)) between 1 and 64),
  status text not null default 'active'
    check (char_length(btrim(status)) between 1 and 64),
  customer_organization_id uuid,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint assets_id_tenant_unique unique (id, tenant_id),
  constraint assets_service_tenant_fk foreign key (service_id, tenant_id)
    references public.services (id, tenant_id) on delete set null (service_id),
  constraint assets_customer_organization_tenant_fk
    foreign key (customer_organization_id, tenant_id)
    references public.customer_organizations (id, tenant_id)
    on delete set null (customer_organization_id)
);

create table if not exists public.problems (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 240),
  description text not null default '',
  status text not null default 'open'
    check (status in ('open', 'investigating', 'known_error', 'resolved')),
  workaround text,
  root_cause text,
  owner_id uuid,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint problems_id_tenant_unique unique (id, tenant_id),
  constraint problems_owner_tenant_fk foreign key (tenant_id, owner_id)
    references public.tenant_memberships (tenant_id, user_id)
    on delete set null (owner_id),
  -- Memberships are normally soft-removed. Retain the original creator;
  -- NO ACTION also permits a tenant-wide cascading deletion to finish.
  constraint problems_creator_tenant_fk foreign key (tenant_id, created_by)
    references public.tenant_memberships (tenant_id, user_id)
);

-- tenant_id is filled from the ticket when omitted. Keeping it in each link
-- makes both endpoints and the attribution subject to real tenant FKs.
create table if not exists public.ticket_services (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null,
  service_id uuid not null,
  linked_by uuid default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (ticket_id, service_id),
  constraint ticket_services_ticket_tenant_fk foreign key (ticket_id, tenant_id)
    references public.tickets (id, tenant_id) on delete cascade,
  constraint ticket_services_service_tenant_fk foreign key (service_id, tenant_id)
    references public.services (id, tenant_id) on delete cascade,
  constraint ticket_services_linked_by_tenant_fk foreign key (tenant_id, linked_by)
    references public.tenant_memberships (tenant_id, user_id)
    on delete set null (linked_by)
);

create table if not exists public.ticket_assets (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null,
  asset_id uuid not null,
  linked_by uuid default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (ticket_id, asset_id),
  constraint ticket_assets_ticket_tenant_fk foreign key (ticket_id, tenant_id)
    references public.tickets (id, tenant_id) on delete cascade,
  constraint ticket_assets_asset_tenant_fk foreign key (asset_id, tenant_id)
    references public.assets (id, tenant_id) on delete cascade,
  constraint ticket_assets_linked_by_tenant_fk foreign key (tenant_id, linked_by)
    references public.tenant_memberships (tenant_id, user_id)
    on delete set null (linked_by)
);

create table if not exists public.problem_tickets (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  problem_id uuid not null,
  ticket_id uuid not null,
  linked_by uuid default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (problem_id, ticket_id),
  constraint problem_tickets_problem_tenant_fk foreign key (problem_id, tenant_id)
    references public.problems (id, tenant_id) on delete cascade,
  constraint problem_tickets_ticket_tenant_fk foreign key (ticket_id, tenant_id)
    references public.tickets (id, tenant_id) on delete cascade,
  constraint problem_tickets_linked_by_tenant_fk foreign key (tenant_id, linked_by)
    references public.tenant_memberships (tenant_id, user_id)
    on delete set null (linked_by)
);

create index if not exists services_tenant_active_name_idx
  on public.services (tenant_id, active, name);
create index if not exists assets_tenant_active_name_idx
  on public.assets (tenant_id, active, name);
create unique index if not exists assets_tenant_asset_tag_unique
  on public.assets (tenant_id, asset_tag) where asset_tag is not null;
create index if not exists assets_service_tenant_idx
  on public.assets (service_id, tenant_id) where service_id is not null;
create index if not exists assets_customer_organization_tenant_idx
  on public.assets (customer_organization_id, tenant_id)
  where customer_organization_id is not null;
create index if not exists problems_tenant_status_updated_idx
  on public.problems (tenant_id, status, updated_at desc);
create index if not exists problems_owner_tenant_idx
  on public.problems (owner_id, tenant_id) where owner_id is not null;
create index if not exists problems_creator_tenant_idx
  on public.problems (created_by, tenant_id);
create index if not exists ticket_services_tenant_ticket_idx
  on public.ticket_services (tenant_id, ticket_id);
create index if not exists ticket_services_service_ticket_idx
  on public.ticket_services (service_id, tenant_id, ticket_id);
create index if not exists ticket_services_linked_by_tenant_idx
  on public.ticket_services (linked_by, tenant_id) where linked_by is not null;
create index if not exists ticket_assets_tenant_ticket_idx
  on public.ticket_assets (tenant_id, ticket_id);
create index if not exists ticket_assets_asset_ticket_idx
  on public.ticket_assets (asset_id, tenant_id, ticket_id);
create index if not exists ticket_assets_linked_by_tenant_idx
  on public.ticket_assets (linked_by, tenant_id) where linked_by is not null;
create index if not exists problem_tickets_tenant_problem_idx
  on public.problem_tickets (tenant_id, problem_id);
create index if not exists problem_tickets_ticket_problem_idx
  on public.problem_tickets (ticket_id, tenant_id, problem_id);
create index if not exists problem_tickets_linked_by_tenant_idx
  on public.problem_tickets (linked_by, tenant_id) where linked_by is not null;

create or replace function public.validate_service_asset_problem_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ticket_tenant_id uuid;
begin
  if tg_table_schema <> 'public' or tg_table_name not in (
    'services', 'assets', 'problems', 'ticket_services', 'ticket_assets', 'problem_tickets'
  ) then
    raise exception 'Unsupported service/asset/problem trigger target'
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT' and tg_table_name in (
    'ticket_services', 'ticket_assets', 'problem_tickets'
  ) then
    select ticket.tenant_id into ticket_tenant_id
    from public.tickets ticket where ticket.id = new.ticket_id;
    if ticket_tenant_id is null then
      raise exception 'Ticket does not exist' using errcode = '23503';
    end if;
    if new.tenant_id is null then
      new.tenant_id := ticket_tenant_id;
    elsif new.tenant_id <> ticket_tenant_id then
      raise exception 'Ticket link must belong to the ticket tenant'
        using errcode = '23503';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'Service/asset/problem tenant is immutable'
        using errcode = '23514';
    end if;
    if tg_table_name in ('services', 'assets', 'problems') then
      if new.id is distinct from old.id then
        raise exception 'Service/asset/problem identity is immutable'
          using errcode = '23514';
      end if;
      if tg_table_name = 'problems' then
        if new.created_by is distinct from old.created_by then
          raise exception 'Problem creator is immutable' using errcode = '23514';
        end if;
      end if;
    else
      -- A changed relationship is an unlink followed by a separately
      -- authorized link, not an update which could bypass either endpoint.
      if (to_jsonb(new) - 'linked_by' - 'created_at')
        is distinct from (to_jsonb(old) - 'linked_by' - 'created_at') then
        raise exception 'Ticket link endpoints are immutable'
          using errcode = '23514';
      end if;
      -- Only FK-driven clearing of a deleted membership may change the actor.
      if new.linked_by is distinct from old.linked_by then
        if new.linked_by is not null or exists (
          select 1 from public.tenant_memberships membership
          where membership.tenant_id = old.tenant_id
            and membership.user_id = old.linked_by
        ) then
          raise exception 'Ticket link actor is immutable' using errcode = '23514';
        end if;
      end if;
    end if;
    if new.created_at is distinct from old.created_at then
      raise exception 'Creation timestamp is immutable' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- Existing audited RPCs write public.audit_logs. Client CRUD below follows
-- the same audit record shape, using auth.uid(), never a supplied actor ID.
create or replace function public.audit_service_asset_problem_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_row jsonb;
  after_row jsonb;
  affected_row jsonb;
  affected_tenant_id uuid;
  affected_entity_id uuid;
begin
  if tg_table_schema <> 'public' or tg_table_name not in (
    'services', 'assets', 'problems', 'ticket_services', 'ticket_assets', 'problem_tickets'
  ) then
    raise exception 'Unsupported service/asset/problem audit target'
      using errcode = '22023';
  end if;
  if tg_op <> 'INSERT' then
    before_row := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    after_row := to_jsonb(new);
  end if;
  affected_row := coalesce(after_row, before_row);
  affected_tenant_id := (affected_row ->> 'tenant_id')::uuid;
  affected_entity_id := coalesce(
    affected_row ->> 'id', affected_row ->> 'problem_id',
    affected_row ->> 'service_id', affected_row ->> 'asset_id'
  )::uuid;

  -- audit_logs itself cascades with the tenant. Do not try to recreate a
  -- tenant-bound audit row after the parent tenant has been deleted.
  if exists (select 1 from public.tenants where id = affected_tenant_id) then
    insert into public.audit_logs (
      tenant_id, actor_id, action, entity_type, entity_id,
      severity, before_data, after_data, metadata
    ) values (
      affected_tenant_id, auth.uid(), tg_table_name || '.' || lower(tg_op),
      tg_table_name, affected_entity_id, 'info', before_row, after_row,
      jsonb_build_object('table', tg_table_name, 'operation', tg_op,
        'ticket_id', affected_row -> 'ticket_id')
    );
  end if;
  return null;
end;
$$;

revoke all on function public.validate_service_asset_problem_identity()
  from public, anon, authenticated;
revoke all on function public.audit_service_asset_problem_changes()
  from public, anon, authenticated;

-- Recreate named triggers/policies to make reapplication safe.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'services', 'assets', 'problems', 'ticket_services', 'ticket_assets', 'problem_tickets'
  ] loop
    execute format('drop trigger if exists %I on public.%I',
      table_name || '_validate_identity', table_name);
    execute format('create trigger %I before insert or update on public.%I '
      || 'for each row execute function public.validate_service_asset_problem_identity()',
      table_name || '_validate_identity', table_name);
    execute format('drop trigger if exists %I on public.%I',
      table_name || '_audit_changes', table_name);
    execute format('create trigger %I after insert or update or delete on public.%I '
      || 'for each row execute function public.audit_service_asset_problem_changes()',
      table_name || '_audit_changes', table_name);
    if table_name in ('services', 'assets', 'problems') then
      execute format('drop trigger if exists %I on public.%I',
        table_name || '_updated_at', table_name);
      execute format('create trigger %I before update on public.%I '
        || 'for each row execute function public.set_updated_at()',
        table_name || '_updated_at', table_name);
    end if;
  end loop;
end;
$$;

alter table public.services enable row level security;
alter table public.assets enable row level security;
alter table public.problems enable row level security;
alter table public.ticket_services enable row level security;
alter table public.ticket_assets enable row level security;
alter table public.problem_tickets enable row level security;

revoke all on table public.services, public.assets, public.problems,
  public.ticket_services, public.ticket_assets, public.problem_tickets
  from public, anon, authenticated;
grant select, insert, update, delete on table public.services, public.assets,
  public.problems, public.ticket_services, public.ticket_assets, public.problem_tickets
  to authenticated, service_role;

-- FOR ALL is safe alongside the member SELECT policy: the management
-- predicate itself requires active tenant membership. USING protects old
-- rows and WITH CHECK protects inserted/updated rows.
drop policy if exists services_select_member on public.services;
create policy services_select_member on public.services
  for select to authenticated using (public.is_active_tenant_member(tenant_id));
drop policy if exists services_manage_authorized on public.services;
create policy services_manage_authorized on public.services
  for all to authenticated
  using (public.has_tenant_permission(tenant_id, 'asset.manage'))
  with check (public.has_tenant_permission(tenant_id, 'asset.manage'));

drop policy if exists assets_select_member on public.assets;
create policy assets_select_member on public.assets
  for select to authenticated using (public.is_active_tenant_member(tenant_id));
drop policy if exists assets_manage_authorized on public.assets;
create policy assets_manage_authorized on public.assets
  for all to authenticated
  using (public.has_tenant_permission(tenant_id, 'asset.manage'))
  with check (public.has_tenant_permission(tenant_id, 'asset.manage'));

drop policy if exists problems_select_member on public.problems;
create policy problems_select_member on public.problems
  for select to authenticated using (public.is_active_tenant_member(tenant_id));
drop policy if exists problems_insert_authorized on public.problems;
create policy problems_insert_authorized on public.problems
  for insert to authenticated
  with check (public.has_tenant_permission(tenant_id, 'asset.manage')
    and created_by = auth.uid());
drop policy if exists problems_update_authorized on public.problems;
create policy problems_update_authorized on public.problems
  for update to authenticated
  using (public.has_tenant_permission(tenant_id, 'asset.manage'))
  with check (public.has_tenant_permission(tenant_id, 'asset.manage'));
drop policy if exists problems_delete_authorized on public.problems;
create policy problems_delete_authorized on public.problems
  for delete to authenticated
  using (public.has_tenant_permission(tenant_id, 'asset.manage'));

-- Link visibility also respects existing ticket read rules. A department
-- permission may mutate links only for a readable ticket in that department;
-- asset.manage alone does not permit linking or unlinking tickets.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['ticket_services', 'ticket_assets', 'problem_tickets'] loop
    execute format('drop policy if exists %I on public.%I',
      table_name || '_select_member', table_name);
    execute format('create policy %I on public.%I for select to authenticated '
      || 'using (public.is_active_tenant_member(tenant_id) and public.can_read_ticket(ticket_id))',
      table_name || '_select_member', table_name);

    execute format('drop policy if exists %I on public.%I',
      table_name || '_insert_authorized', table_name);
    execute format('create policy %I on public.%I for insert to authenticated '
      || 'with check (linked_by = auth.uid() and exists ('
      || 'select 1 from public.tickets ticket '
      || 'where ticket.id = %I.ticket_id and ticket.tenant_id = %I.tenant_id '
      || 'and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, ''ticket.update'')))',
      table_name || '_insert_authorized', table_name, table_name, table_name);

    execute format('drop policy if exists %I on public.%I',
      table_name || '_update_authorized', table_name);
    execute format('create policy %I on public.%I for update to authenticated '
      || 'using (exists (select 1 from public.tickets ticket '
      || 'where ticket.id = %I.ticket_id and ticket.tenant_id = %I.tenant_id '
      || 'and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, ''ticket.update''))) '
      || 'with check (exists (select 1 from public.tickets ticket '
      || 'where ticket.id = %I.ticket_id and ticket.tenant_id = %I.tenant_id '
      || 'and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, ''ticket.update'')))',
      table_name || '_update_authorized', table_name,
      table_name, table_name, table_name, table_name);

    execute format('drop policy if exists %I on public.%I',
      table_name || '_delete_authorized', table_name);
    execute format('create policy %I on public.%I for delete to authenticated '
      || 'using (exists (select 1 from public.tickets ticket '
      || 'where ticket.id = %I.ticket_id and ticket.tenant_id = %I.tenant_id '
      || 'and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, ''ticket.update'')))',
      table_name || '_delete_authorized', table_name, table_name, table_name);
  end loop;
end;
$$;

commit;
