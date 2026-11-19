begin;

set local search_path = pg_catalog, public;

-- Entra-Verzeichnis: Abgleich jede Nacht automatisch (zusätzlich zum
-- manuellen) und eine Laufhistorie für die Einstellungen (letzte 20 Läufe,
-- automatisch oder von Hand). Zugriff nur über die Edge Functions
-- «entra-directory-sync» und «entra-directory-scheduled-sync» (service_role).

create table if not exists public.tenant_entra_directory_sync_runs (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  trigger text not null check (trigger in ('manual', 'scheduled')),
  actor_id uuid references public.user_profiles(id) on delete set null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  imported integer check (imported is null or imported >= 0),
  active integer check (active is null or active >= 0),
  skipped integer check (skipped is null or skipped >= 0),
  error_code text check (error_code is null or char_length(error_code) <= 120)
);

create index if not exists tenant_entra_directory_sync_runs_tenant_idx
  on public.tenant_entra_directory_sync_runs (tenant_id, started_at desc);

alter table public.tenant_entra_directory_sync_runs enable row level security;
revoke all on public.tenant_entra_directory_sync_runs from public, anon, authenticated;
grant select, insert, update, delete on public.tenant_entra_directory_sync_runs to service_role;

-- Mandanten mit aktivem, gespeichertem Connector und die Person, in deren
-- Namen der nächtliche Abgleich läuft (Recht «Mandanteneinstellungen»).
create or replace function public.entra_directory_scheduled_sync_targets()
returns table (tenant_id uuid, actor_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select configuration.tenant_id,
         (
           select membership.user_id
           from public.tenant_memberships membership
           where membership.tenant_id = configuration.tenant_id
             and membership.status = 'active'
             and public.user_has_tenant_permission(
               membership.user_id, configuration.tenant_id, 'tenant.settings.manage')
           order by membership.joined_at nulls last, membership.user_id
           limit 1
         ) as actor_id
  from public.tenant_entra_directory_sync_configurations configuration
  where configuration.enabled
    and configuration.entra_tenant_id is not null
  order by configuration.tenant_id
  limit 500;
$$;

revoke all on function public.entra_directory_scheduled_sync_targets() from public, anon, authenticated;
grant execute on function public.entra_directory_scheduled_sync_targets() to service_role;

create or replace function public.entra_directory_scheduled_sync_wake()
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
    select 1 from public.tenant_entra_directory_sync_configurations configuration
    where configuration.enabled and configuration.entra_tenant_id is not null
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
    using rtrim(v_base, '/') || '/entra-directory-scheduled-sync',
          jsonb_build_object('type', 'cron', 'job', 'entra-directory'),
          '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-nextdesk-dispatch-secret', v_secret),
          150000;
exception when others then
  return;
end;
$$;

revoke all on function public.entra_directory_scheduled_sync_wake() from public, anon, authenticated;

-- Jede Nacht um 01:41 UTC (vor dem Intune-Abgleich um 02:11 UTC).
select cron.schedule(
  'nextdesk-entra-directory-sync',
  '41 1 * * *',
  'select public.entra_directory_scheduled_sync_wake();'
);

commit;
