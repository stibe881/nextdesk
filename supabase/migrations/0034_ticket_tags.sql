begin;
set local search_path = pg_catalog, public;

-- Tags are tenant-defined labels for operational classification. Ticket assignments
-- retain both tenant foreign keys so cross-tenant linking is rejected by PostgreSQL.
create table public.ticket_tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text collate "C" not null,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ticket_tags_name_valid check (
    char_length(name) between 1 and 48
    and name = btrim(name)
    and name !~ '[[:cntrl:]]'
  ),
  unique (id, tenant_id)
);

create unique index ticket_tags_tenant_name_unique
  on public.ticket_tags (tenant_id, lower(name));
create index ticket_tags_tenant_name_idx
  on public.ticket_tags (tenant_id, name);

create table public.ticket_tag_assignments (
  ticket_id uuid not null,
  tag_id uuid not null,
  tenant_id uuid not null,
  added_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (ticket_id, tag_id),
  foreign key (ticket_id, tenant_id)
    references public.tickets(id, tenant_id)
    on delete cascade,
  foreign key (tag_id, tenant_id)
    references public.ticket_tags(id, tenant_id)
    on delete cascade
);

create index ticket_tag_assignments_ticket_created_idx
  on public.ticket_tag_assignments (ticket_id, created_at, tag_id);
create index ticket_tag_assignments_tag_idx
  on public.ticket_tag_assignments (tenant_id, tag_id, ticket_id);

create or replace function public.validate_ticket_tag_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'ticket_tags' then
    raise exception 'Invalid trigger target' using errcode = '22023';
  end if;

  new.name := btrim(new.name);
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.created_by is distinct from old.created_by
  ) then
    raise exception 'Ticket tag identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger ticket_tags_validate_change
  before insert or update on public.ticket_tags
  for each row execute function public.validate_ticket_tag_change();
create trigger ticket_tags_updated_at
  before update on public.ticket_tags
  for each row execute function public.set_updated_at();

alter table public.ticket_tags enable row level security;
alter table public.ticket_tag_assignments enable row level security;

-- Tag labels can be suggested to any active member of their tenant. Assignment
-- visibility still follows the stricter ticket read policy.
create policy ticket_tags_select_member
  on public.ticket_tags
  for select to authenticated
  using (public.is_active_tenant_member(tenant_id));
create policy ticket_tag_assignments_select_readable_ticket
  on public.ticket_tag_assignments
  for select to authenticated
  using (
    public.is_active_tenant_member(tenant_id)
    and public.can_read_ticket(ticket_id)
  );

revoke all on table public.ticket_tags from public, anon, authenticated;
revoke all on table public.ticket_tag_assignments from public, anon, authenticated;
grant select on table public.ticket_tags to authenticated;
grant select on table public.ticket_tag_assignments to authenticated;
grant select, insert, update, delete on table public.ticket_tags to service_role;
grant select, insert, update, delete on table public.ticket_tag_assignments to service_role;

revoke all on function public.validate_ticket_tag_change() from public, anon, authenticated;

comment on table public.ticket_tags is
  'Tenant-defined operational labels. Mutation is exclusively mediated through audited ticket operations.';
comment on table public.ticket_tag_assignments is
  'Tags assigned to a ticket. Reads follow the ticket visibility policy; writes are audited by the ticket operations API.';

commit;
