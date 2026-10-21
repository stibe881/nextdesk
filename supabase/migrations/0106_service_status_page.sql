begin;

-- Service availability is deliberately maintained by authorized staff. It is
-- not inferred from tickets, assets or monitoring data.
alter table public.services
  add column if not exists status text not null default 'operational',
  add column if not exists status_public boolean not null default false;

alter table public.services
  drop constraint if exists services_status_check;
alter table public.services
  add constraint services_status_check
  check (status in (
    'operational',
    'degraded',
    'partial_outage',
    'major_outage',
    'maintenance'
  ));

create index if not exists services_tenant_status_public_idx
  on public.services (tenant_id, active, status_public, name)
  where active and status_public;

-- The event table contains no descriptions, ticket references, asset data or
-- personal data. It is used solely to build a tenant-local availability line.
create table if not exists public.service_status_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_id uuid not null,
  status text not null check (status in (
    'operational',
    'degraded',
    'partial_outage',
    'major_outage',
    'maintenance'
  )),
  changed_at timestamptz not null default timezone('utc', now()),
  changed_by uuid references auth.users(id) on delete set null,
  constraint service_status_events_service_tenant_fk
    foreign key (service_id, tenant_id)
    references public.services (id, tenant_id) on delete cascade
);

create index if not exists service_status_events_tenant_service_changed_idx
  on public.service_status_events (tenant_id, service_id, changed_at desc, id desc);

-- One event immediately before the reporting window is enough to derive the
-- correct state at the window start without exposing full historical data.
create or replace function public.service_status_history_baselines(
  p_tenant_id uuid,
  p_service_ids uuid[],
  p_before timestamptz
)
returns table (service_id uuid, status text, changed_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct on (event.service_id)
    event.service_id,
    event.status,
    event.changed_at
  from public.service_status_events as event
  where event.tenant_id = p_tenant_id
    and event.service_id = any(coalesce(p_service_ids, array[]::uuid[]))
    and event.changed_at < p_before
  order by event.service_id, event.changed_at desc, event.id desc;
$$;

revoke all on function public.service_status_history_baselines(uuid, uuid[], timestamptz)
  from public, anon, authenticated;
grant execute on function public.service_status_history_baselines(uuid, uuid[], timestamptz)
  to service_role;

-- A tenant controls its public status page explicitly. The random public ID is
-- an opaque identifier, not a tenant identifier or an authorization token.
create table if not exists public.service_status_pages (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  public_id uuid not null default gen_random_uuid(),
  title text not null default 'Systemstatus'
    check (char_length(btrim(title)) between 2 and 120),
  public_enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint service_status_pages_public_id_unique unique (public_id)
);

create index if not exists service_status_pages_public_lookup_idx
  on public.service_status_pages (public_id)
  where public_enabled;

create or replace function public.record_service_status_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'services' then
    raise exception 'Unsupported service status event target'
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.service_status_events (
      tenant_id, service_id, status, changed_at, changed_by
    ) values (
      new.tenant_id,
      new.id,
      new.status,
      timezone('utc', now()),
      auth.uid()
    );
  end if;
  return null;
end;
$$;

revoke all on function public.record_service_status_event()
  from public, anon, authenticated;

drop trigger if exists services_status_history on public.services;
create trigger services_status_history
  after insert or update of status on public.services
  for each row execute function public.record_service_status_event();

-- Existing records become explicitly operational, but remain non-public until
-- a person chooses the per-service and page-level publication controls.
insert into public.service_status_events (tenant_id, service_id, status, changed_at)
select
  service.tenant_id,
  service.id,
  service.status,
  coalesce(service.created_at, timezone('utc', now()))
from public.services as service
where not exists (
  select 1
  from public.service_status_events as event
  where event.tenant_id = service.tenant_id
    and event.service_id = service.id
);

alter table public.service_status_events enable row level security;
alter table public.service_status_events force row level security;
alter table public.service_status_pages enable row level security;
alter table public.service_status_pages force row level security;

revoke all on table public.service_status_events, public.service_status_pages
  from public, anon, authenticated;
grant select, insert, update, delete on table public.service_status_events,
  public.service_status_pages to service_role;

-- No browser role receives a direct policy for public status configuration or
-- history. Edge Functions enforce active membership, feature state and role.
drop policy if exists service_status_events_no_direct_browser_access
  on public.service_status_events;
drop policy if exists service_status_pages_no_direct_browser_access
  on public.service_status_pages;

create trigger service_status_pages_updated_at
  before update on public.service_status_pages
  for each row execute function public.set_updated_at();

commit;
