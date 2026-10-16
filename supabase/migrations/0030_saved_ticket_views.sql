begin;
set local search_path = pg_catalog, public;

-- Shared saved views are tenant-level configuration. `ticket.manage` is
-- deliberately a tenant-scoped permission: department-scoped roles cannot
-- modify another member's tenant-wide view.
insert into public.permissions (code, description, is_sensitive)
values ('ticket.manage', 'Mandantenweite gespeicherte Ticketansichten verwalten', false)
on conflict (code) do update
  set description = excluded.description,
      is_sensitive = excluded.is_sensitive;

insert into public.role_permissions (role_id, permission_code)
select role.id, 'ticket.manage'
from public.roles role
where role.scope = 'tenant'
  and role.active
  and role.name = 'Tenant administrator'
on conflict do nothing;

create or replace function public.grant_ticket_manage_to_tenant_administrator()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.scope = 'tenant' and new.name = 'Tenant administrator' then
    insert into public.role_permissions (role_id, permission_code)
    values (new.id, 'ticket.manage')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger roles_grant_ticket_manage_to_tenant_administrator
  after insert on public.roles
  for each row execute function public.grant_ticket_manage_to_tenant_administrator();

create table public.saved_ticket_views (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  owner_id uuid not null references public.user_profiles(id) on delete cascade,
  name text collate "C" not null,
  visibility text collate "C" not null default 'private',
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint saved_ticket_views_name_valid check (
    char_length(name) between 1 and 80
    and name = btrim(name)
    and name !~ '[[:cntrl:]]'
  ),
  constraint saved_ticket_views_visibility_valid check (
    visibility in ('private', 'tenant')
  ),
  constraint saved_ticket_views_filters_object check (
    jsonb_typeof(filters) = 'object'
  )
);

-- A member may use the same personal name as a shared view, but duplicate
-- names within either ownership space are confusing in the view picker.
create unique index saved_ticket_views_owner_name_unique
  on public.saved_ticket_views (tenant_id, owner_id, lower(name));
create unique index saved_ticket_views_tenant_name_unique
  on public.saved_ticket_views (tenant_id, lower(name))
  where visibility = 'tenant';
create index saved_ticket_views_owner_updated_idx
  on public.saved_ticket_views (tenant_id, owner_id, updated_at desc);
create index saved_ticket_views_tenant_visibility_updated_idx
  on public.saved_ticket_views (tenant_id, visibility, updated_at desc);

create or replace function public.validate_saved_ticket_view_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'saved_ticket_views' then
    raise exception 'Invalid trigger target' using errcode = '22023';
  end if;

  new.name := btrim(new.name);
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.owner_id is distinct from old.owner_id
  ) then
    raise exception 'Saved ticket view identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger saved_ticket_views_validate_change
  before insert or update on public.saved_ticket_views
  for each row execute function public.validate_saved_ticket_view_change();
create trigger saved_ticket_views_updated_at
  before update on public.saved_ticket_views
  for each row execute function public.set_updated_at();

alter table public.saved_ticket_views enable row level security;

create policy saved_ticket_views_select_visible
  on public.saved_ticket_views
  for select to authenticated
  using (
    public.is_active_tenant_member(tenant_id)
    and (owner_id = auth.uid() or visibility = 'tenant')
  );
create policy saved_ticket_views_insert_owner
  on public.saved_ticket_views
  for insert to authenticated
  with check (
    public.is_active_tenant_member(tenant_id)
    and owner_id = auth.uid()
  );
create policy saved_ticket_views_update_owner_or_ticket_manager
  on public.saved_ticket_views
  for update to authenticated
  using (
    public.is_active_tenant_member(tenant_id)
    and (
      owner_id = auth.uid()
      or public.has_tenant_permission(tenant_id, 'ticket.manage')
    )
  )
  with check (
    public.is_active_tenant_member(tenant_id)
    and (
      owner_id = auth.uid()
      or public.has_tenant_permission(tenant_id, 'ticket.manage')
    )
  );
create policy saved_ticket_views_delete_owner_or_ticket_manager
  on public.saved_ticket_views
  for delete to authenticated
  using (
    public.is_active_tenant_member(tenant_id)
    and (
      owner_id = auth.uid()
      or public.has_tenant_permission(tenant_id, 'ticket.manage')
    )
  );

revoke all on table public.saved_ticket_views from public, anon;
grant select, insert, update, delete on table public.saved_ticket_views to authenticated;
grant select, insert, update, delete on table public.saved_ticket_views to service_role;

revoke all on function public.grant_ticket_manage_to_tenant_administrator() from public, anon, authenticated;
revoke all on function public.validate_saved_ticket_view_change() from public, anon, authenticated;

comment on table public.saved_ticket_views is
  'Tenant-isolated ticket list filters. Personal views are owner-only; tenant views are readable by active tenant members.';
comment on column public.saved_ticket_views.filters is
  'Validated UI filter snapshot. Search content is intentionally excluded from audit payloads.';

commit;
