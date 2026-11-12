-- External status sources («externe Störungen»): official status feeds of
-- cloud services and providers (Microsoft 365, GitHub, Claude, Gemini, App
-- Store, Google Play, Init7). The edge function external-status polls the
-- enabled sources every 5 minutes and keeps one incident per provider issue:
-- opened (and the incident team alarmed once) while the provider reports it,
-- closed automatically when the provider reports it resolved.

alter table public.monitoring_incidents
  add column if not exists source text not null default 'prtg'
    check (source in ('prtg', 'external')),
  add column if not exists external_provider text
    check (external_provider is null or char_length(external_provider) <= 80),
  add column if not exists external_url text
    check (external_url is null or char_length(external_url) <= 1000);

alter table public.monitoring_incident_events
  drop constraint if exists monitoring_incident_events_kind_check;
alter table public.monitoring_incident_events
  add constraint monitoring_incident_events_kind_check check (kind = any (array[
    'prtg', 'opened', 'reopened', 'resolved', 'closed', 'acknowledged',
    'assigned', 'note', 'realert', 'child', 'maintenance', 'external'
  ]));

create table if not exists public.monitoring_external_sources (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_key text not null check (source_key ~ '^[a-z0-9_]{2,40}$'),
  enabled boolean not null default true,
  last_checked_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, source_key)
);
alter table public.monitoring_external_sources enable row level security;
revoke all on public.monitoring_external_sources from public, anon, authenticated;
grant select, insert, update, delete on public.monitoring_external_sources to service_role;

-- Safety net and re-alerting are for PRTG incidents only: an external issue
-- has no PRTG sensors and nothing on site to acknowledge.
create or replace function public.monitoring_reconcile_incidents()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_incident record;
  v_count integer := 0;
begin
  for v_incident in
    select incident.id, incident.tenant_id
    from public.monitoring_incidents incident
    where incident.state = 'active'
      and incident.source = 'prtg'
      and incident.last_event_at < timezone('utc', now()) - interval '2 minutes'
      and not exists (
        select 1 from public.monitoring_alerts alert
        where alert.incident_id = incident.id and alert.state = 'open'
      )
      and not exists (
        select 1 from public.monitoring_incidents child
        where child.parent_incident_id = incident.id and child.state = 'active'
      )
    limit 200
  loop
    update public.monitoring_incidents
       set state = 'closed',
           resolved_at = coalesce(resolved_at, timezone('utc', now())),
           closed_at = timezone('utc', now()),
           closing_note = 'Automatisch abgeschlossen: PRTG meldet wieder OK.'
     where id = v_incident.id and state = 'active';
    insert into public.monitoring_incident_events (tenant_id, incident_id, kind, message)
    values (v_incident.tenant_id, v_incident.id, 'resolved',
            'Alle Sensoren sind wieder OK. Störung automatisch abgeschlossen.');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.monitoring_reconcile_incidents() from public, anon, authenticated;

do $$
declare
  v_def text;
  v_old text := E'      and not incident.maintenance\n';
begin
  select pg_get_functiondef('public.monitoring_realert_due()'::regprocedure) into v_def;
  if position('incident.source' in v_def) > 0 then
    return;
  end if;
  if position(v_old in v_def) = 0 then
    raise exception 'monitoring_realert_due: anchor not found';
  end if;
  execute replace(v_def, v_old, v_old || E'      and incident.source = ''prtg''\n');
end;
$$;

-- Wake the poller only when some tenant has an enabled source.
do $$
declare
  v_def text;
  v_old text := E'  else\n    return;\n  end if;';
begin
  select pg_get_functiondef('public.monitoring_automation_wake(text)'::regprocedure) into v_def;
  if position('external-status' in v_def) > 0 then
    return;
  end if;
  if position(v_old in v_def) = 0 then
    raise exception 'monitoring_automation_wake: anchor not found';
  end if;
  execute replace(v_def, v_old,
    E'  elsif p_function = ''external-status'' then\n'
    || E'    if not exists (select 1 from public.monitoring_external_sources source where source.enabled) then\n'
    || E'      return;\n'
    || E'    end if;\n'
    || v_old);
end;
$$;

select cron.schedule(
  'nextdesk-external-status',
  '*/5 * * * *',
  $cron$select public.monitoring_automation_wake('external-status');$cron$
)
where not exists (select 1 from cron.job where jobname = 'nextdesk-external-status');

-- Notifications name the source, so mail and push can say «Externe Störung».
do $$
declare
  v_def text;
  v_old text := E'    ''reason'', p_reason\n  );';
begin
  select pg_get_functiondef('public.monitoring_incident_notify(uuid,text)'::regprocedure) into v_def;
  if position('''provider''' in v_def) > 0 then
    return;
  end if;
  if position(v_old in v_def) = 0 then
    raise exception 'monitoring_incident_notify: anchor not found';
  end if;
  execute replace(v_def, v_old,
    E'    ''reason'', p_reason,\n    ''source'', v_incident.source,\n    ''provider'', v_incident.external_provider\n  );');
end;
$$;
