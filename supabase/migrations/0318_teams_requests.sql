begin;

set local search_path = pg_catalog, public;

-- Microsoft-Teams-Bestellung im Shop: ein Team wird im Wizard zusammengestellt,
-- direkt bestellt (ohne Genehmigung) und von nextDesk über Microsoft Graph
-- angelegt. Jede Bestellung hat ein Ende; vor Ablauf erinnert nextDesk die
-- Owner (14 / 7 / 1 Tage), danach wird das Team archiviert.
create table public.teams_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  requested_by uuid not null references public.user_profiles(id) on delete cascade,
  name text not null check (char_length(name) between 3 and 120),
  description text check (description is null or char_length(description) <= 1000),
  visibility text not null check (visibility in ('public', 'private')),
  allow_guests boolean not null default false,
  channels jsonb not null default '[]'::jsonb check (jsonb_typeof(channels) = 'array'),
  owner_ids uuid[] not null check (cardinality(owner_ids) between 1 and 10),
  member_ids uuid[] not null default '{}' check (cardinality(member_ids) <= 100),
  guest_emails text[] not null default '{}' check (cardinality(guest_emails) <= 20),
  start_date date not null,
  end_date date not null,
  status text not null default 'queued'
    check (status in ('queued', 'provisioning', 'ready', 'failed', 'archived')),
  graph_team_id text,
  graph_operation text,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default timezone('utc', now()),
  last_error text,
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  reminded_14_at timestamptz,
  reminded_7_at timestamptz,
  reminded_1_at timestamptz,
  ready_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint teams_requests_dates_check check (end_date > start_date),
  constraint teams_requests_requester_membership_fk
    foreign key (tenant_id, requested_by)
    references public.tenant_memberships (tenant_id, user_id)
    on delete cascade
);

create index teams_requests_tenant_idx
  on public.teams_requests (tenant_id, created_at desc);
create index teams_requests_requester_idx
  on public.teams_requests (requested_by);
create index teams_requests_work_idx
  on public.teams_requests (next_attempt_at)
  where status in ('queued', 'provisioning');
create index teams_requests_end_idx
  on public.teams_requests (end_date)
  where status = 'ready';
create unique index teams_requests_graph_team_idx
  on public.teams_requests (tenant_id, graph_team_id)
  where graph_team_id is not null;

create trigger teams_requests_updated_at
  before update on public.teams_requests
  for each row execute function public.set_updated_at();

alter table public.teams_requests enable row level security;
alter table public.teams_requests force row level security;
revoke all on table public.teams_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.teams_requests to service_role;
create policy teams_requests_service_role_only on public.teams_requests
  for all to service_role using (true) with check (true);

comment on table public.teams_requests is
  'Microsoft-Teams-Bestellungen aus dem Shop (Wizard, Laufzeit, Erinnerungen, Archivierung). Zugriff nur über die Edge Functions teams-provisioning und teams-lifecycle.';

-- Mitteilung an eine Person (Glocke, Push, E-Mail wie bei Shop-Bestellungen).
create or replace function public.teams_notify(
  p_tenant_id uuid,
  p_user_id uuid,
  p_kind text,
  p_request_id uuid,
  p_extra jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_user_id is null
    or p_kind not in (
      'shop.order.team_ready',
      'shop.order.team_failed',
      'shop.order.team_expiring',
      'shop.order.team_archived'
    ) then
    return;
  end if;
  if not exists (
    select 1 from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_user_id
      and membership.status = 'active'
  ) then
    return;
  end if;
  insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
  values (
    p_tenant_id, p_user_id, null, p_kind,
    jsonb_build_object('teamRequestId', p_request_id) || coalesce(p_extra, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.teams_notify(uuid, uuid, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.teams_notify(uuid, uuid, text, uuid, jsonb)
  to service_role;

-- Weckt die Edge Function teams-lifecycle (Warteschlange, Erinnerungen,
-- Archivierung). Läuft nur, wenn es Arbeit gibt.
create or replace function public.teams_lifecycle_wake()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_base text;
  v_secret text;
begin
  if not exists (
    select 1 from public.teams_requests request
    where (
      request.status in ('queued', 'provisioning')
      and request.next_attempt_at <= timezone('utc', now())
      and request.start_date <= (timezone('Europe/Zurich', now()))::date
    ) or (
      request.status = 'ready'
      and (
        request.end_date < (timezone('Europe/Zurich', now()))::date
        or (request.reminded_14_at is null
          and request.end_date <= (timezone('Europe/Zurich', now()))::date + 14)
        or (request.reminded_7_at is null
          and request.end_date <= (timezone('Europe/Zurich', now()))::date + 7)
        or (request.reminded_1_at is null
          and request.end_date <= (timezone('Europe/Zurich', now()))::date + 1)
      )
    )
  ) then
    return;
  end if;
  if to_regclass('monitoring_automation_private.dispatch_config') is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return;
  end if;
  execute 'select functions_base_url, dispatch_secret from monitoring_automation_private.dispatch_config where singleton'
    into v_base, v_secret;
  if v_base is null or v_secret is null then
    return;
  end if;
  execute 'select net.http_post($1, $2, $3, $4, $5)'
    using rtrim(v_base, '/') || '/teams-lifecycle',
          jsonb_build_object('type', 'cron'),
          '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-nextdesk-dispatch-secret', v_secret),
          30000;
exception when others then
  return;
end;
$$;

revoke all on function public.teams_lifecycle_wake() from public, anon, authenticated;

do $$
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  begin
    perform cron.unschedule('nextdesk-teams-lifecycle');
  exception when others then null;
  end;
  perform cron.schedule('nextdesk-teams-lifecycle', '*/5 * * * *',
    $cron$select public.teams_lifecycle_wake();$cron$);
exception when others then
  null;
end;
$$;

commit;
