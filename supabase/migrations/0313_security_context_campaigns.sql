begin;

set local search_path = pg_catalog, public;

-- Teil C «Sicherheit & Suche»:
--
-- * Kampagnen: Meldungen werden zusätzlich nach Absenderdomain, normalisiertem
--   Betreff und Link-Domains gruppiert (security_campaigns). Ab drei
--   meldenden Personen geht security.campaign an das Phishing-Team.
-- * IOC-Liste (security_iocs): Domains, URLs, sendende IPs und Absender aus
--   Fällen mit Urteil; neue Meldungen werden dagegen geprüft, Treffer stehen
--   im Fall (security_cases.ioc_hits). Einträge lassen sich als harmlos
--   markieren.
-- * «Ja, ich habe geklickt»: Priorität hoch, security.case_clicked an das
--   Team (security_case_mark_clicked). Massnahmen (Intune, Entra, Ersatzgerät)
--   werden in security_case_measures und im Ticketverlauf protokolliert.
-- * Eskalation (Cron alle 15 Min): Fälle über decision_due_at →
--   security.case_overdue an das Team, nach weiteren 24 Std an die
--   Vorgesetzten der Abteilung (team.supervise).
-- * Auffindbar: Störungen und Sicherheitsfälle in der globalen Suche, in
--   «Meine Prioritäten», in der Personenübersicht und für das MCP.
--
-- Benachrichtigungsarten: security.case_overdue, security.case_clicked,
-- security.campaign. Die Kategorie (security_report) und die Zustellung
-- ordnet die Push-/Mail-Logik zu; public.security_notification_forced sagt
-- ihr, wer sie immer erhält (Mitglieder des Phishing-Teams).

-- ---------------------------------------------------------------------------
-- Kampagnen

create table if not exists public.security_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sender_domain text check (sender_domain is null or char_length(sender_domain) between 1 and 253),
  subject_key text check (subject_key is null or char_length(subject_key) between 1 and 200),
  link_domains text[] not null default '{}'::text[] check (cardinality(link_domains) <= 30),
  report_count integer not null default 0 check (report_count >= 0),
  reporter_count integer not null default 0 check (reporter_count >= 0),
  case_count integer not null default 0 check (case_count >= 0),
  first_seen_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  notified_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists security_campaigns_tenant_seen_idx
  on public.security_campaigns (tenant_id, last_seen_at desc);
create index if not exists security_campaigns_sender_idx
  on public.security_campaigns (tenant_id, sender_domain, subject_key);
create index if not exists security_campaigns_links_idx
  on public.security_campaigns using gin (link_domains);

alter table public.phishing_reports
  add column if not exists campaign_id uuid references public.security_campaigns(id) on delete set null;
create index if not exists phishing_reports_campaign_idx
  on public.phishing_reports (campaign_id) where campaign_id is not null;

alter table public.security_cases
  add column if not exists campaign_id uuid references public.security_campaigns(id) on delete set null,
  add column if not exists clicked_at timestamptz,
  add column if not exists overdue_notified_at timestamptz,
  add column if not exists escalated_at timestamptz,
  add column if not exists ioc_hits jsonb not null default '[]'::jsonb;
create index if not exists security_cases_campaign_idx
  on public.security_cases (campaign_id) where campaign_id is not null;
create index if not exists security_cases_overdue_idx
  on public.security_cases (decision_due_at)
  where state = 'triage';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'security_cases_ioc_hits_array'
       and conrelid = 'public.security_cases'::regclass
  ) then
    alter table public.security_cases
      add constraint security_cases_ioc_hits_array
      check (jsonb_typeof(ioc_hits) = 'array' and jsonb_array_length(ioc_hits) <= 100);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- IOC-Liste

create table if not exists public.security_iocs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('domain', 'url', 'ip', 'sender')),
  value text not null check (char_length(value) between 1 and 500),
  verdict text not null check (verdict in ('spam', 'phishing', 'targeted')),
  status text not null default 'active' check (status in ('active', 'harmless')),
  source_ticket_id uuid references public.tickets(id) on delete set null,
  case_count integer not null default 1 check (case_count >= 0),
  hit_count integer not null default 0 check (hit_count >= 0),
  first_seen_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  last_hit_at timestamptz,
  status_changed_by uuid references public.user_profiles(id) on delete set null,
  status_changed_at timestamptz,
  constraint security_iocs_unique unique (tenant_id, kind, value)
);
create index if not exists security_iocs_tenant_status_idx
  on public.security_iocs (tenant_id, status, last_seen_at desc);

-- ---------------------------------------------------------------------------
-- Massnahmen-Protokoll

create table if not exists public.security_case_measures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null references public.security_cases(ticket_id) on delete cascade,
  measure text not null check (measure in (
    'intune_sync', 'intune_defender_scan', 'entra_revoke_sessions',
    'entra_force_password_change', 'replacement_order'
  )),
  target_label text check (target_label is null or char_length(target_label) <= 300),
  status text not null check (status in ('succeeded', 'failed')),
  message text check (message is null or char_length(message) <= 500),
  reference_id uuid,
  actor_id uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists security_case_measures_case_idx
  on public.security_case_measures (ticket_id, created_at desc);

alter table public.security_campaigns enable row level security;
alter table public.security_iocs enable row level security;
alter table public.security_case_measures enable row level security;
revoke all on public.security_campaigns, public.security_iocs, public.security_case_measures
  from public, anon, authenticated;
grant select, insert, update, delete on public.security_campaigns, public.security_iocs,
  public.security_case_measures to service_role;

-- ---------------------------------------------------------------------------
-- Benachrichtigungen

-- Phishing-Team: Mitglieder des Teams aus den Phishing-Einstellungen. Für
-- sie gelten Phishing-Meldungen und die security.*-Arten nicht als Opt-in:
-- die Zustell-Logik (Push/Mail) stellt sie immer zu.
create or replace function public.security_notification_forced(
  p_tenant_id uuid,
  p_user_id uuid,
  p_kind text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(p_kind = 'ticket.security_report' or p_kind like 'security.%', false)
    and exists (
      select 1
        from public.phishing_report_settings settings
        join public.team_memberships member on member.team_id = settings.notify_team_id
        join public.tenant_memberships membership
          on membership.tenant_id = settings.tenant_id
         and membership.user_id = member.user_id
         and membership.status = 'active'
       where settings.tenant_id = p_tenant_id
         and settings.notify_team_id is not null
         and member.user_id = p_user_id
    );
$$;
revoke all on function public.security_notification_forced(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.security_notification_forced(uuid, uuid, text) to service_role;

-- security.* an das Phishing-Team (audience 'team'; ohne Team an alle, die
-- die Abteilung des Falls lesen dürfen) oder an die Vorgesetzten der
-- Abteilung (audience 'supervisors', Berechtigung team.supervise).
create or replace function public.security_case_notify(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_kind text,
  p_payload jsonb,
  p_audience text default 'team'
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_department uuid;
  v_ticket_number text;
  v_team uuid;
  v_count integer := 0;
  v_payload jsonb;
begin
  if p_kind is null or p_kind not in ('security.case_overdue', 'security.case_clicked', 'security.campaign')
     or p_audience is null or p_audience not in ('team', 'supervisors') then
    raise exception 'Invalid security notification' using errcode = '22023';
  end if;
  select ticket.department_id, ticket.ticket_number into v_department, v_ticket_number
    from public.tickets ticket
    join public.security_cases security_case on security_case.ticket_id = ticket.id
   where ticket.id = p_ticket_id and ticket.tenant_id = p_tenant_id;
  if not found then
    raise exception 'Security case unavailable' using errcode = 'P0002';
  end if;
  v_payload := jsonb_build_object('ticketNumber', v_ticket_number, 'audience', p_audience)
    || coalesce(p_payload, '{}'::jsonb);

  if p_audience = 'supervisors' then
    insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
    select p_tenant_id, supervisor.user_id, p_ticket_id, p_kind, v_payload
      from unnest(public.department_supervisor_ids(p_tenant_id, v_department)) as supervisor(user_id);
    get diagnostics v_count = row_count;
    return v_count;
  end if;

  select settings.notify_team_id into v_team
    from public.phishing_report_settings settings
   where settings.tenant_id = p_tenant_id;
  if v_team is not null then
    insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
    select p_tenant_id, member.user_id, p_ticket_id, p_kind, v_payload
      from public.team_memberships member
      join public.teams team on team.id = member.team_id
       and team.tenant_id = p_tenant_id and team.active
      join public.tenant_memberships membership on membership.tenant_id = p_tenant_id
       and membership.user_id = member.user_id and membership.status = 'active'
     where member.team_id = v_team;
    get diagnostics v_count = row_count;
  end if;
  if v_count = 0 then
    insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
    select p_tenant_id, membership.user_id, p_ticket_id, p_kind, v_payload
      from public.tenant_memberships membership
     where membership.tenant_id = p_tenant_id
       and membership.status = 'active'
       and public.user_has_ticket_permission_for(
         membership.user_id, p_tenant_id, v_department, 'ticket.read.department');
    get diagnostics v_count = row_count;
  end if;
  return v_count;
end;
$$;
revoke all on function public.security_case_notify(uuid, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.security_case_notify(uuid, uuid, text, jsonb, text) to service_role;

-- «Ja, ich habe geklickt»: Fall-Priorität hoch, Team sofort benachrichtigen.
create or replace function public.security_case_mark_clicked(
  p_tenant_id uuid,
  p_ticket_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_priority_key text;
  v_high uuid;
  v_raised boolean := false;
  v_notified integer := 0;
begin
  update public.security_cases
     set clicked_at = coalesce(clicked_at, timezone('utc', now()))
   where ticket_id = p_ticket_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Security case unavailable' using errcode = 'P0002';
  end if;
  select priority.key into v_priority_key
    from public.tickets ticket
    left join public.ticket_priorities priority on priority.id = ticket.priority_id
   where ticket.id = p_ticket_id;
  if v_priority_key is distinct from 'high' and v_priority_key is distinct from 'urgent' then
    select priority.id into v_high
      from public.ticket_priorities priority
     where priority.tenant_id = p_tenant_id and priority.key = 'high'
     limit 1;
    if v_high is not null then
      update public.tickets set priority_id = v_high
       where id = p_ticket_id and tenant_id = p_tenant_id;
      v_raised := true;
    end if;
  end if;
  v_notified := public.security_case_notify(
    p_tenant_id, p_ticket_id, 'security.case_clicked',
    jsonb_build_object('riskLevel', 'high', 'riskLabel', 'Melder hat geklickt'),
    'team'
  );
  return jsonb_build_object('priorityRaised', v_raised, 'notified', v_notified);
end;
$$;
revoke all on function public.security_case_mark_clicked(uuid, uuid) from public, anon, authenticated;
grant execute on function public.security_case_mark_clicked(uuid, uuid) to service_role;

-- Eskalation (Cron): Urteil überfällig → Team, nach weiteren 24 Std →
-- Vorgesetzte. Jede Stufe einmal pro Fall.
create or replace function public.security_case_escalate()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_case record;
  v_count integer := 0;
  v_now timestamptz := timezone('utc', now());
begin
  for v_case in
    select security_case.ticket_id, security_case.tenant_id, security_case.decision_due_at,
           security_case.overdue_notified_at
      from public.security_cases security_case
     where security_case.state = 'triage'
       and security_case.decision_due_at < v_now
       and (
         security_case.overdue_notified_at is null
         or (security_case.escalated_at is null
             and security_case.overdue_notified_at <= v_now - interval '24 hours')
       )
     order by security_case.decision_due_at
     for update of security_case skip locked
     limit 200
  loop
    begin
      if v_case.overdue_notified_at is null then
        perform public.security_case_notify(
          v_case.tenant_id, v_case.ticket_id, 'security.case_overdue',
          jsonb_build_object('stage', 'team', 'decisionDueAt', v_case.decision_due_at),
          'team'
        );
        update public.security_cases set overdue_notified_at = v_now
         where ticket_id = v_case.ticket_id;
      else
        perform public.security_case_notify(
          v_case.tenant_id, v_case.ticket_id, 'security.case_overdue',
          jsonb_build_object('stage', 'supervisor', 'decisionDueAt', v_case.decision_due_at),
          'supervisors'
        );
        update public.security_cases set escalated_at = v_now
         where ticket_id = v_case.ticket_id;
      end if;
      v_count := v_count + 1;
    exception when others then
      -- One broken case must not block the others.
      null;
    end;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.security_case_escalate() from public, anon, authenticated;
grant execute on function public.security_case_escalate() to service_role;

-- ---------------------------------------------------------------------------
-- Kampagnen-Zuordnung einer Meldung

create or replace function public.security_campaign_assign(
  p_tenant_id uuid,
  p_report_id uuid,
  p_sender_domain text,
  p_subject_key text,
  p_link_domains text[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_report public.phishing_reports%rowtype;
  v_campaign public.security_campaigns%rowtype;
  v_sender text := nullif(lower(btrim(coalesce(p_sender_domain, ''))), '');
  v_subject text := nullif(btrim(coalesce(p_subject_key, '')), '');
  v_links text[];
  v_created boolean := false;
  v_case_linked boolean := false;
  v_reports integer;
  v_reporters integer;
  v_cases integer;
  v_notified integer := 0;
  v_now timestamptz := timezone('utc', now());
begin
  select * into v_report from public.phishing_reports report
   where report.id = p_report_id and report.tenant_id = p_tenant_id;
  if not found then
    raise exception 'Report unavailable' using errcode = 'P0002';
  end if;
  v_subject := left(v_subject, 200);
  select coalesce(array_agg(domain order by domain), '{}'::text[]) into v_links
    from (
      select distinct lower(btrim(entry)) as domain
        from unnest(coalesce(p_link_domains, '{}'::text[])) entry
       where btrim(entry) <> '' and char_length(btrim(entry)) <= 253
       limit 30
    ) cleaned;
  if v_sender is null and v_subject is null and cardinality(v_links) = 0 then
    return jsonb_build_object('campaignId', null);
  end if;

  -- Same sender domain and (same subject or a shared link domain), or the
  -- same subject with a shared link domain; active within 30 days.
  select * into v_campaign
    from public.security_campaigns campaign
   where campaign.tenant_id = p_tenant_id
     and campaign.last_seen_at >= v_now - interval '30 days'
     and (
       (v_sender is not null and campaign.sender_domain = v_sender
         and ((v_subject is not null and campaign.subject_key = v_subject)
              or campaign.link_domains && v_links))
       or (v_subject is not null and campaign.subject_key = v_subject
           and campaign.link_domains && v_links)
     )
   order by campaign.last_seen_at desc
   limit 1
   for update;
  if not found then
    insert into public.security_campaigns (tenant_id, sender_domain, subject_key, link_domains)
    values (p_tenant_id, v_sender, v_subject, v_links)
    returning * into v_campaign;
    v_created := true;
  else
    update public.security_campaigns campaign
       set last_seen_at = v_now,
           sender_domain = coalesce(campaign.sender_domain, v_sender),
           subject_key = coalesce(campaign.subject_key, v_subject),
           link_domains = (
             select coalesce(array_agg(domain order by domain), '{}'::text[])
               from (
                 select distinct domain
                   from unnest(campaign.link_domains || v_links) domain
                  limit 30
               ) merged
           )
     where campaign.id = v_campaign.id
     returning * into v_campaign;
  end if;

  update public.phishing_reports set campaign_id = v_campaign.id where id = p_report_id;
  if v_report.ticket_id is not null then
    update public.security_cases
       set campaign_id = v_campaign.id
     where ticket_id = v_report.ticket_id
       and tenant_id = p_tenant_id
       and campaign_id is null;
    v_case_linked := found;
  end if;

  select count(*)::integer,
         count(distinct coalesce(report.reporter_id::text, lower(report.reporter_email)))::integer,
         count(distinct report.ticket_id)::integer
    into v_reports, v_reporters, v_cases
    from public.phishing_reports report
   where report.campaign_id = v_campaign.id;
  update public.security_campaigns
     set report_count = v_reports, reporter_count = v_reporters, case_count = v_cases
   where id = v_campaign.id;

  if v_reporters >= 3 and v_campaign.notified_at is null and v_report.ticket_id is not null
     and exists (select 1 from public.security_cases where ticket_id = v_report.ticket_id) then
    v_notified := public.security_case_notify(
      p_tenant_id, v_report.ticket_id, 'security.campaign',
      jsonb_build_object('campaignId', v_campaign.id, 'reporters', v_reporters,
        'reports', v_reports, 'cases', v_cases, 'senderDomain', v_campaign.sender_domain),
      'team'
    );
    update public.security_campaigns set notified_at = v_now where id = v_campaign.id;
  end if;

  return jsonb_build_object(
    'campaignId', v_campaign.id,
    'created', v_created,
    'caseLinked', v_case_linked,
    'reports', v_reports,
    'reporters', v_reporters,
    'cases', v_cases,
    'notified', v_notified
  );
end;
$$;
revoke all on function public.security_campaign_assign(uuid, uuid, text, text, text[]) from public, anon, authenticated;
grant execute on function public.security_campaign_assign(uuid, uuid, text, text, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- IOC: erfassen (Urteil gesetzt) und prüfen (neue Meldung)

create or replace function public.security_iocs_record(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_verdict text,
  p_indicators jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer := 0;
  v_now timestamptz := timezone('utc', now());
begin
  if p_verdict not in ('spam', 'phishing', 'targeted') then
    return 0;
  end if;
  if jsonb_typeof(coalesce(p_indicators, '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid indicators' using errcode = '22023';
  end if;
  insert into public.security_iocs as ioc (
    tenant_id, kind, value, verdict, source_ticket_id, first_seen_at, last_seen_at
  )
  select distinct on (entry ->> 'kind', lower(btrim(entry ->> 'value')))
         p_tenant_id, entry ->> 'kind', lower(btrim(entry ->> 'value')), p_verdict, p_ticket_id, v_now, v_now
    from jsonb_array_elements(coalesce(p_indicators, '[]'::jsonb)) as entry
   where entry ->> 'kind' in ('domain', 'url', 'ip', 'sender')
     and char_length(btrim(coalesce(entry ->> 'value', ''))) between 1 and 500
   limit 200
  on conflict (tenant_id, kind, value) do update
    set last_seen_at = v_now,
        -- The strongest verdict wins.
        verdict = case
          when array_position(array['spam', 'phishing', 'targeted'], excluded.verdict)
             > array_position(array['spam', 'phishing', 'targeted'], ioc.verdict)
            then excluded.verdict
          else ioc.verdict
        end,
        case_count = ioc.case_count
          + case when ioc.source_ticket_id is distinct from excluded.source_ticket_id then 1 else 0 end,
        source_ticket_id = coalesce(excluded.source_ticket_id, ioc.source_ticket_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.security_iocs_record(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.security_iocs_record(uuid, uuid, text, jsonb) to service_role;

-- Treffer der Indikatoren einer Meldung gegen aktive IOCs (Domains auch als
-- Subdomain). Treffer werden am Fall gespeichert und gezählt.
create or replace function public.security_ioc_match(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_indicators jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_hits jsonb;
  v_now timestamptz := timezone('utc', now());
begin
  if jsonb_typeof(coalesce(p_indicators, '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid indicators' using errcode = '22023';
  end if;
  with indicator as (
    select distinct entry ->> 'kind' as kind, lower(btrim(entry ->> 'value')) as value
      from jsonb_array_elements(coalesce(p_indicators, '[]'::jsonb)) as entry
     where entry ->> 'kind' in ('domain', 'url', 'ip', 'sender')
       and char_length(btrim(coalesce(entry ->> 'value', ''))) between 1 and 500
     limit 200
  ), matched as (
    select distinct ioc.id, ioc.kind, ioc.value, ioc.verdict, ioc.case_count, ioc.source_ticket_id
      from public.security_iocs ioc
      join indicator on indicator.kind = ioc.kind
       and (indicator.value = ioc.value
            or (ioc.kind = 'domain' and right(indicator.value, char_length(ioc.value) + 1) = '.' || ioc.value))
     where ioc.tenant_id = p_tenant_id
       and ioc.status = 'active'
       and ioc.source_ticket_id is distinct from p_ticket_id
  ), counted as (
    update public.security_iocs ioc
       set hit_count = ioc.hit_count + 1, last_hit_at = v_now
      from matched
     where ioc.id = matched.id
    returning ioc.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', matched.id, 'kind', matched.kind, 'value', matched.value,
           'verdict', matched.verdict, 'caseCount', matched.case_count,
           'sourceTicketId', matched.source_ticket_id, 'matchedAt', v_now
         ) order by matched.kind, matched.value), '[]'::jsonb)
    into v_hits
    from matched
   where matched.id in (select id from counted);

  if p_ticket_id is not null and jsonb_array_length(v_hits) > 0 then
    update public.security_cases security_case
       set ioc_hits = (
         select coalesce(jsonb_agg(hit order by hit ->> 'kind', hit ->> 'value'), '[]'::jsonb)
           from (
             select distinct on (hit ->> 'id') hit
               from jsonb_array_elements(security_case.ioc_hits || v_hits) as hit
              order by hit ->> 'id'
              limit 100
           ) unique_hits
       )
     where security_case.ticket_id = p_ticket_id
       and security_case.tenant_id = p_tenant_id;
  end if;
  return v_hits;
end;
$$;
revoke all on function public.security_ioc_match(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.security_ioc_match(uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Netzwerk-Kontext (IPAM)

-- Sendende IPs und Hosts der Mail gegen die IP-Verwaltung: bekannte Adresse
-- oder Hostname, sonst das kleinste Subnetz, das die IP enthält.
create or replace function public.security_ipam_matches(
  p_tenant_id uuid,
  p_ips text[],
  p_hosts text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_result jsonb := '[]'::jsonb;
  v_value text;
  v_ip inet;
  v_match jsonb;
begin
  foreach v_value in array coalesce(p_ips, '{}'::text[]) loop
    exit when jsonb_array_length(v_result) >= 40;
    begin
      v_ip := btrim(v_value)::inet;
    exception when others then
      continue;
    end;
    select jsonb_build_object(
             'value', host(v_ip), 'kind', 'ip', 'match', 'address',
             'hostname', coalesce(address.hostname, address.dns_name),
             'assetId', address.asset_id,
             'assetName', asset.name,
             'status', address.status
           )
      into v_match
      from public.ipam_addresses address
      left join public.assets asset on asset.id = address.asset_id and asset.tenant_id = address.tenant_id
     where address.tenant_id = p_tenant_id and address.address = host(v_ip)::inet
     limit 1;
    if v_match is null then
      select jsonb_build_object(
               'value', host(v_ip), 'kind', 'ip', 'match', 'prefix',
               'prefix', prefix.prefix::text,
               'vlan', case when vlan.id is not null then vlan.vlan_number || ' ' || vlan.name end,
               'site', site.name,
               'description', prefix.description
             )
        into v_match
        from public.ipam_prefixes prefix
        left join public.ipam_vlans vlan on vlan.id = prefix.vlan_id
        left join public.ipam_sites site on site.id = prefix.site_id
       where prefix.tenant_id = p_tenant_id and prefix.prefix >>= v_ip
       order by masklen(prefix.prefix) desc
       limit 1;
    end if;
    if v_match is not null then
      v_result := v_result || jsonb_build_array(v_match);
    end if;
    v_match := null;
  end loop;

  foreach v_value in array coalesce(p_hosts, '{}'::text[]) loop
    exit when jsonb_array_length(v_result) >= 60;
    v_value := lower(btrim(v_value));
    continue when v_value = '' or char_length(v_value) > 253;
    select jsonb_build_object(
             'value', v_value, 'kind', 'host', 'match', 'address',
             'address', host(address.address),
             'hostname', coalesce(address.hostname, address.dns_name),
             'assetId', address.asset_id,
             'assetName', asset.name,
             'status', address.status
           )
      into v_match
      from public.ipam_addresses address
      left join public.assets asset on asset.id = address.asset_id and asset.tenant_id = address.tenant_id
     where address.tenant_id = p_tenant_id
       and (lower(address.hostname) = v_value or lower(address.dns_name) = v_value)
     limit 1;
    if v_match is not null then
      v_result := v_result || jsonb_build_array(v_match);
    end if;
    v_match := null;
  end loop;
  return v_result;
end;
$$;
revoke all on function public.security_ipam_matches(uuid, text[], text[]) from public, anon, authenticated;
grant execute on function public.security_ipam_matches(uuid, text[], text[]) to service_role;

-- IP-Adressen (mit Subnetz, VLAN, Standort, Switch-Port) von Geräten.
create or replace function public.security_asset_network(
  p_tenant_id uuid,
  p_asset_ids uuid[]
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'assetId', address.asset_id,
           'address', host(address.address),
           'hostname', coalesce(address.hostname, address.dns_name),
           'macAddress', address.mac_address::text,
           'prefix', prefix.prefix::text,
           'vlan', case when vlan.id is not null then vlan.vlan_number || ' ' || vlan.name end,
           'site', site.name,
           'switchName', address.switch_name,
           'switchPort', address.switch_port,
           'lastSeenAt', address.last_seen_at
         ) order by address.asset_id, address.address), '[]'::jsonb)
    from (
      select *
        from public.ipam_addresses candidate
       where candidate.tenant_id = p_tenant_id
         and candidate.asset_id = any(coalesce(p_asset_ids, '{}'::uuid[]))
       order by candidate.last_seen_at desc nulls last
       limit 100
    ) address
    left join public.ipam_prefixes prefix on prefix.id = address.prefix_id
    left join public.ipam_vlans vlan on vlan.id = prefix.vlan_id
    left join public.ipam_sites site on site.id = prefix.site_id;
$$;
revoke all on function public.security_asset_network(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.security_asset_network(uuid, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- Auffindbar: Suche, Meine Prioritäten, Personenübersicht, MCP

-- Störungen (Team aus den Monitoring-Einstellungen) und Sicherheitsfälle
-- (Phishing-Team) für die globale Suche; nur für Berechtigte.
create or replace function public.search_operations(
  p_tenant_id uuid,
  p_query text,
  p_limit integer default 10
)
returns table (
  result_type text,
  entity_id uuid,
  title text,
  detail text,
  section text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 25);
begin
  if auth.uid() is null or char_length(v_query) < 2 or char_length(v_query) > 120 then
    return;
  end if;
  if public.can_work_incidents(p_tenant_id) then
    return query
    select 'incident'::text, incident.id,
           incident.number || ' · ' || incident.title,
           concat_ws(' · ',
             case incident.state when 'active' then 'Aktiv' when 'resolved' then 'Behoben' else 'Geschlossen' end,
             incident.device_name,
             to_char(timezone('Europe/Zurich', incident.opened_at), 'DD.MM.YYYY HH24:MI')),
           'Störungen'::text
      from public.monitoring_incidents incident
     where incident.tenant_id = p_tenant_id
       and (
         position(v_query in lower(incident.number)) > 0
         or position(v_query in lower(incident.title)) > 0
         or position(v_query in lower(coalesce(incident.device_name, ''))) > 0
       )
     order by (incident.state = 'closed'), incident.opened_at desc
     limit v_limit;
  end if;
  if public.can_work_security_cases(p_tenant_id) then
    return query
    select 'security_case'::text, security_case.ticket_id,
           ticket.ticket_number || ' · ' || coalesce(report.original_subject, ticket.subject),
           concat_ws(' · ',
             case security_case.state when 'triage' then 'Zu beurteilen'
               when 'actions' then 'Massnahmen' else 'Abgeschlossen' end,
             report.original_from,
             to_char(timezone('Europe/Zurich', security_case.created_at), 'DD.MM.YYYY')),
           'Sicherheitsfälle'::text
      from public.security_cases security_case
      join public.tickets ticket on ticket.id = security_case.ticket_id
      left join lateral (
        select candidate.original_subject, candidate.original_from
          from public.phishing_reports candidate
         where candidate.ticket_id = security_case.ticket_id
         order by candidate.created_at
         limit 1
      ) report on true
     where security_case.tenant_id = p_tenant_id
       and (
         position(v_query in lower(ticket.ticket_number)) > 0
         or position(v_query in lower(ticket.subject)) > 0
         or exists (
           select 1 from public.phishing_reports match
            where match.ticket_id = security_case.ticket_id
              and (position(v_query in lower(coalesce(match.original_subject, ''))) > 0
                   or position(v_query in lower(coalesce(match.original_from, ''))) > 0
                   or position(v_query in lower(coalesce(match.reporter_email, ''))) > 0)
         )
       )
       and public.can_read_ticket(security_case.ticket_id)
     order by (security_case.state = 'closed'), security_case.created_at desc
     limit v_limit;
  end if;
end;
$$;
revoke all on function public.search_operations(uuid, text, integer) from public, anon;
grant execute on function public.search_operations(uuid, text, integer) to authenticated, service_role;

-- Mir zugewiesene offene Störungen und Sicherheitsfälle.
create or replace function public.my_operation_priorities(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_incidents jsonb := '[]'::jsonb;
  v_cases jsonb := '[]'::jsonb;
begin
  if v_user is null or not public.is_tenant_ticket_agent(p_tenant_id) then
    return jsonb_build_object('incidents', v_incidents, 'securityCases', v_cases);
  end if;
  if public.can_work_incidents(p_tenant_id) then
    select coalesce(jsonb_agg(item order by (item ->> 'severity') = 'warning', item ->> 'openedAt'), '[]'::jsonb)
      into v_incidents
      from (
        select jsonb_build_object(
                 'id', incident.id,
                 'number', incident.number,
                 'title', incident.title,
                 'state', incident.state,
                 'severity', incident.severity,
                 'deviceName', incident.device_name,
                 'acknowledged', incident.acknowledged_at is not null,
                 'openedAt', incident.opened_at
               ) as item
          from public.monitoring_incidents incident
         where incident.tenant_id = p_tenant_id
           and incident.assigned_agent_id = v_user
           and incident.state <> 'closed'
         order by incident.opened_at
         limit 30
      ) rows;
  end if;
  if public.can_work_security_cases(p_tenant_id) then
    select coalesce(jsonb_agg(item order by (item ->> 'overdue')::boolean desc, item ->> 'createdAt'), '[]'::jsonb)
      into v_cases
      from (
        select jsonb_build_object(
                 'id', security_case.ticket_id,
                 'number', ticket.ticket_number,
                 'title', coalesce(
                   (select report.original_subject from public.phishing_reports report
                     where report.ticket_id = security_case.ticket_id
                     order by report.created_at limit 1),
                   ticket.subject),
                 'state', security_case.state,
                 'verdict', security_case.verdict,
                 'clicked', security_case.clicked_at is not null,
                 'decisionDueAt', security_case.decision_due_at,
                 'overdue', security_case.state = 'triage' and security_case.decision_due_at < v_now,
                 'createdAt', security_case.created_at
               ) as item
          from public.security_cases security_case
          join public.tickets ticket on ticket.id = security_case.ticket_id
         where security_case.tenant_id = p_tenant_id
           and security_case.state <> 'closed'
           and ticket.assigned_agent_id = v_user
           and public.can_read_ticket(security_case.ticket_id)
         order by security_case.created_at
         limit 30
      ) rows;
  end if;
  return jsonb_build_object('incidents', v_incidents, 'securityCases', v_cases);
end;
$$;
revoke all on function public.my_operation_priorities(uuid) from public, anon;
grant execute on function public.my_operation_priorities(uuid) to authenticated, service_role;

-- Personenübersicht: Sicherheitsfälle, die die Person gemeldet hat, und
-- Störungen ihrer Geräte (letzte 12 Monate). Leere Liste ohne Berechtigung
-- (null = Bereich nicht sichtbar).
create or replace function public.person_overview_operations(
  p_tenant_id uuid,
  p_user_id uuid,
  p_email text,
  p_asset_ids uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_cases jsonb;
  v_incidents jsonb;
begin
  if auth.uid() is null or not public.is_tenant_ticket_agent(p_tenant_id) then
    raise exception 'Ticket agent required' using errcode = '42501';
  end if;
  if public.can_work_security_cases(p_tenant_id) and (p_user_id is not null or v_email is not null) then
    select coalesce(jsonb_agg(item order by item ->> 'reportedAt' desc), '[]'::jsonb)
      into v_cases
      from (
        select jsonb_build_object(
                 'id', security_case.ticket_id,
                 'number', ticket.ticket_number,
                 'title', coalesce(report.original_subject, ticket.subject),
                 'state', security_case.state,
                 'verdict', security_case.verdict,
                 'clicked', exists (
                   select 1 from public.security_click_questions question
                    where question.ticket_id = security_case.ticket_id
                      and question.answer = 'yes'
                      and v_email is not null and lower(question.email) = v_email
                 ),
                 'reportedAt', report.created_at
               ) as item
          from (
            select distinct on (candidate.ticket_id) candidate.*
              from public.phishing_reports candidate
             where candidate.tenant_id = p_tenant_id
               and candidate.ticket_id is not null
               and ((p_user_id is not null and candidate.reporter_id = p_user_id)
                    or (v_email is not null and lower(candidate.reporter_email) = v_email))
             order by candidate.ticket_id, candidate.created_at
          ) report
          join public.security_cases security_case on security_case.ticket_id = report.ticket_id
          join public.tickets ticket on ticket.id = security_case.ticket_id
         where public.can_read_ticket(security_case.ticket_id)
         order by report.created_at desc
         limit 30
      ) rows;
  end if;
  if public.can_work_incidents(p_tenant_id) and cardinality(coalesce(p_asset_ids, '{}'::uuid[])) > 0 then
    select coalesce(jsonb_agg(item order by item ->> 'openedAt' desc), '[]'::jsonb)
      into v_incidents
      from (
        select jsonb_build_object(
                 'id', incident.id,
                 'number', incident.number,
                 'title', incident.title,
                 'state', incident.state,
                 'severity', incident.severity,
                 'deviceName', coalesce(asset.name, incident.device_name),
                 'openedAt', incident.opened_at,
                 'resolvedAt', incident.resolved_at
               ) as item
          from public.monitoring_incidents incident
          left join public.assets asset on asset.id = incident.asset_id
         where incident.tenant_id = p_tenant_id
           and incident.asset_id = any(p_asset_ids)
           and incident.opened_at >= timezone('utc', now()) - interval '365 days'
         order by incident.opened_at desc
         limit 30
      ) rows;
  end if;
  return jsonb_build_object('securityCases', v_cases, 'incidents', v_incidents);
end;
$$;
revoke all on function public.person_overview_operations(uuid, uuid, text, uuid[]) from public, anon;
grant execute on function public.person_overview_operations(uuid, uuid, text, uuid[]) to authenticated, service_role;

-- MCP: Störungen lesen (nur für Berechtigte).
create or replace function public.list_operations_incidents(
  p_tenant_id uuid,
  p_only_open boolean default true,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.can_work_incidents(p_tenant_id) then
    raise exception 'Incident access required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(item order by item ->> 'openedAt' desc), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
               'id', incident.id,
               'number', incident.number,
               'title', incident.title,
               'state', incident.state,
               'severity', incident.severity,
               'deviceName', incident.device_name,
               'acknowledged', incident.acknowledged_at is not null,
               'assignedAgentName', agent.display_name,
               'cause', incident.cause,
               'openedAt', incident.opened_at,
               'resolvedAt', incident.resolved_at,
               'closedAt', incident.closed_at
             ) as item
        from public.monitoring_incidents incident
        left join public.user_profiles agent on agent.id = incident.assigned_agent_id
       where incident.tenant_id = p_tenant_id
         and (not coalesce(p_only_open, true) or incident.state <> 'closed')
       order by incident.opened_at desc
       limit least(greatest(coalesce(p_limit, 20), 1), 50)
    ) rows;
  return v_result;
end;
$$;
revoke all on function public.list_operations_incidents(uuid, boolean, integer) from public, anon;
grant execute on function public.list_operations_incidents(uuid, boolean, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Cron: Eskalation alle 15 Minuten

do $$
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  begin
    perform cron.unschedule('nextdesk-security-case-escalation');
  exception when others then
    null;
  end;
  perform cron.schedule(
    'nextdesk-security-case-escalation',
    '*/15 * * * *',
    'select public.security_case_escalate();'
  );
exception when others then
  null;
end;
$$;

commit;
