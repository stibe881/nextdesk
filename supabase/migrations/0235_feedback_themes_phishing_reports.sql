begin;

set local search_path = pg_catalog, public;

-- ===========================================================================
-- 1. Feedback-Auswertung mit KI
--    Free-text comments of the satisfaction survey (ticket_satisfaction) are
--    assigned to a fixed set of themes plus sentiment by the edge function
--    feedback-insights (nightly and on demand). The theme is stored per
--    feedback; monthly aggregates per department/team feed the report.
-- ===========================================================================

create table if not exists public.feedback_comment_themes (
  ticket_id uuid primary key references public.tickets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- sha256 of the analysed comment; a changed comment is analysed again.
  comment_hash text not null check (comment_hash ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('analyzed', 'failed')),
  themes text[] not null default '{}'::text[],
  sentiment text check (sentiment is null or sentiment in ('positive', 'neutral', 'negative', 'mixed')),
  -- Anonymised excerpt (names, contact data and numbers removed).
  quote text check (quote is null or char_length(quote) <= 400),
  error_code text check (error_code is null or char_length(error_code) <= 80),
  attempts integer not null default 0 check (attempts between 0 and 100),
  analyzed_at timestamptz not null default timezone('utc', now())
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'feedback_comment_themes_shape'
      and conrelid = 'public.feedback_comment_themes'::regclass
  ) then
    alter table public.feedback_comment_themes
      add constraint feedback_comment_themes_shape check (
        cardinality(themes) <= 3
        and themes <@ array['long_wait', 'unclear_answer', 'friendly_competent', 'fast_resolution',
          'not_resolved', 'repeated_contact', 'communication', 'process_tooling', 'other']::text[]
        and (state <> 'analyzed' or (cardinality(themes) >= 1 and sentiment is not null))
      );
  end if;
end;
$$;

create index if not exists feedback_comment_themes_tenant_idx
  on public.feedback_comment_themes (tenant_id, analyzed_at desc);
alter table public.feedback_comment_themes enable row level security;
revoke all on table public.feedback_comment_themes from public, anon, authenticated;
grant all on table public.feedback_comment_themes to service_role;

-- Department/team without value use the zero UUID so they can be part of the key.
create table if not exists public.feedback_theme_monthly (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  department_id uuid not null default '00000000-0000-0000-0000-000000000000',
  team_id uuid not null default '00000000-0000-0000-0000-000000000000',
  theme_key text not null check (theme_key in ('long_wait', 'unclear_answer', 'friendly_competent',
    'fast_resolution', 'not_resolved', 'repeated_contact', 'communication', 'process_tooling', 'other')),
  sentiment text not null check (sentiment in ('positive', 'neutral', 'negative', 'mixed')),
  comment_count integer not null default 0 check (comment_count >= 0),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, month, department_id, team_id, theme_key, sentiment)
);
alter table public.feedback_theme_monthly enable row level security;
revoke all on table public.feedback_theme_monthly from public, anon, authenticated;
grant all on table public.feedback_theme_monthly to service_role;

-- Comments that are new, changed, or failed earlier (max. 3 attempts, 1 h apart).
create or replace function public.feedback_theme_pending(p_tenant_id uuid, p_limit integer default 40)
returns table (
  ticket_id uuid,
  comment text,
  comment_hash text,
  actor_id uuid,
  names text[]
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    satisfaction.ticket_id,
    satisfaction.comment,
    hashed.hash,
    coalesce(
      (select membership.user_id from public.tenant_memberships membership
       where membership.tenant_id = ticket.tenant_id
         and membership.user_id = satisfaction.submitted_by
         and membership.status = 'active'),
      (select membership.user_id from public.tenant_memberships membership
       where membership.tenant_id = ticket.tenant_id and membership.status = 'active'
       order by membership.created_at limit 1)
    ),
    array_remove(array[
      requester.display_name, affected.display_name, agent.display_name,
      submitter.display_name, contact.display_name
    ], null)
  from public.ticket_satisfaction satisfaction
  join public.tickets ticket on ticket.id = satisfaction.ticket_id
  cross join lateral (
    select encode(sha256(convert_to(satisfaction.comment, 'UTF8')), 'hex') as hash
  ) hashed
  left join public.feedback_comment_themes theme on theme.ticket_id = satisfaction.ticket_id
  left join public.user_profiles requester on requester.id = ticket.requester_id
  left join public.user_profiles affected on affected.id = ticket.affected_user_id
  left join public.user_profiles agent on agent.id = ticket.assigned_agent_id
  left join public.user_profiles submitter on submitter.id = satisfaction.submitted_by
  left join public.ticket_requesters contact on contact.id = ticket.requester_contact_id
  where ticket.tenant_id = p_tenant_id
    and satisfaction.comment is not null
    and btrim(satisfaction.comment) <> ''
    and (
      theme.ticket_id is null
      or theme.comment_hash <> hashed.hash
      or (theme.state = 'failed' and theme.attempts < 3
          and theme.analyzed_at < timezone('utc', now()) - interval '1 hour')
    )
  order by satisfaction.submitted_at
  limit least(greatest(coalesce(p_limit, 40), 1), 200);
$$;
revoke all on function public.feedback_theme_pending(uuid, integer) from public, anon, authenticated;
grant execute on function public.feedback_theme_pending(uuid, integer) to service_role;

create or replace function public.feedback_theme_pending_tenants(p_limit integer default 50)
returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select distinct ticket.tenant_id
  from public.ticket_satisfaction satisfaction
  join public.tickets ticket on ticket.id = satisfaction.ticket_id
  join public.tenants tenant on tenant.id = ticket.tenant_id and tenant.status = 'active'
  left join public.feedback_comment_themes theme on theme.ticket_id = satisfaction.ticket_id
  where satisfaction.comment is not null
    and btrim(satisfaction.comment) <> ''
    and (
      theme.ticket_id is null
      or theme.comment_hash <> encode(sha256(convert_to(satisfaction.comment, 'UTF8')), 'hex')
      or (theme.state = 'failed' and theme.attempts < 3
          and theme.analyzed_at < timezone('utc', now()) - interval '1 hour')
    )
  limit least(greatest(coalesce(p_limit, 50), 1), 500);
$$;
revoke all on function public.feedback_theme_pending_tenants(integer) from public, anon, authenticated;
grant execute on function public.feedback_theme_pending_tenants(integer) to service_role;

-- Rebuilds the monthly aggregates of one tenant. Rows are zeroed rather than
-- removed; the report ignores zero counts.
create or replace function public.feedback_theme_refresh_monthly(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  if p_tenant_id is null then
    raise exception 'Tenant required' using errcode = '22023';
  end if;
  update public.feedback_theme_monthly
  set comment_count = 0, updated_at = timezone('utc', now())
  where tenant_id = p_tenant_id and comment_count <> 0;

  insert into public.feedback_theme_monthly (
    tenant_id, month, department_id, team_id, theme_key, sentiment, comment_count, updated_at
  )
  select
    theme.tenant_id,
    date_trunc('month', satisfaction.submitted_at at time zone 'Europe/Zurich')::date,
    coalesce(ticket.department_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(ticket.assigned_team_id, '00000000-0000-0000-0000-000000000000'::uuid),
    theme_key.key,
    theme.sentiment,
    count(*)::integer,
    timezone('utc', now())
  from public.feedback_comment_themes theme
  join public.ticket_satisfaction satisfaction on satisfaction.ticket_id = theme.ticket_id
  join public.tickets ticket on ticket.id = theme.ticket_id and ticket.tenant_id = theme.tenant_id
  cross join lateral unnest(theme.themes) as theme_key(key)
  where theme.tenant_id = p_tenant_id
    and theme.state = 'analyzed'
    and satisfaction.comment is not null
    and theme.comment_hash = encode(sha256(convert_to(satisfaction.comment, 'UTF8')), 'hex')
  group by 1, 2, 3, 4, 5, 6
  on conflict (tenant_id, month, department_id, team_id, theme_key, sentiment)
  do update set comment_count = excluded.comment_count, updated_at = excluded.updated_at;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.feedback_theme_refresh_monthly(uuid) from public, anon, authenticated;
grant execute on function public.feedback_theme_refresh_monthly(uuid) to service_role;

-- Nightly wake-up of feedback-insights (same pattern as ticket-triage).
create schema if not exists feedback_insights_private;
revoke all on schema feedback_insights_private from public, anon, authenticated;

create table if not exists feedback_insights_private.dispatch_config (
  singleton boolean primary key default true check (singleton),
  function_url text not null,
  dispatch_secret text not null check (char_length(dispatch_secret) >= 32)
);
revoke all on feedback_insights_private.dispatch_config from public, anon, authenticated;

insert into feedback_insights_private.dispatch_config (singleton, function_url, dispatch_secret)
values (
  true,
  'https://ewizsylzrwogsztsthbl.supabase.co/functions/v1/feedback-insights',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
on conflict (singleton) do nothing;

create or replace function public.feedback_insights_verify_dispatch_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, feedback_insights_private, pg_temp
as $$
  select exists (
    select 1 from feedback_insights_private.dispatch_config config
    where config.singleton and p_secret is not null and config.dispatch_secret = p_secret
  );
$$;
revoke all on function public.feedback_insights_verify_dispatch_secret(text) from public, anon, authenticated;
grant execute on function public.feedback_insights_verify_dispatch_secret(text) to service_role;

create or replace function public.feedback_insights_wake()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, feedback_insights_private, pg_temp
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from public.feedback_theme_pending_tenants(1)) then
    return;
  end if;
  select config.function_url, config.dispatch_secret into v_url, v_secret
  from feedback_insights_private.dispatch_config config where config.singleton;
  if v_url is null or v_secret is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return;
  end if;
  execute 'select net.http_post($1, $2, $3, $4, $5)'
    using v_url,
          jsonb_build_object('type', 'cron'),
          '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-nextdesk-dispatch-secret', v_secret),
          120000;
exception when others then
  return;
end;
$$;
revoke all on function public.feedback_insights_wake() from public, anon, authenticated;

-- ===========================================================================
-- 2. Phishing-Meldeknopf
--    Reports arrive by forwarding to a configured address (Exchange channel)
--    or via the «Phishing melden» button (edge function phishing-reports).
--    The analysis never opens links or attachments.
-- ===========================================================================

create table if not exists public.phishing_report_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  report_address text check (
    report_address is null
    or (report_address = lower(report_address)
        and report_address ~ '^[^@\s]+@[a-z0-9.-]+\.[a-z0-9-]{2,}$'
        and char_length(report_address) <= 320)
  ),
  department_id uuid references public.departments(id) on delete set null,
  category_id uuid references public.ticket_categories(id) on delete set null,
  priority_key text not null default 'high' check (priority_key in ('low', 'normal', 'high', 'urgent')),
  notify_team_id uuid references public.teams(id) on delete set null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);
alter table public.phishing_report_settings enable row level security;
revoke all on table public.phishing_report_settings from public, anon, authenticated;
grant all on table public.phishing_report_settings to service_role;

create table if not exists public.phishing_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid unique references public.tickets(id) on delete cascade,
  reporter_id uuid references public.user_profiles(id) on delete set null,
  reporter_email text check (reporter_email is null or char_length(reporter_email) <= 320),
  channel text not null check (channel in ('email', 'portal', 'mobile')),
  source text not null check (source in ('eml', 'msg', 'headers', 'inline_forward', 'text')),
  risk_score smallint not null check (risk_score between 0 and 100),
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  original_subject text check (original_subject is null or char_length(original_subject) <= 300),
  original_from text check (original_from is null or char_length(original_from) <= 320),
  sending_ip text check (sending_ip is null or char_length(sending_ip) <= 64),
  -- sha256 of the original's Message-ID (or content) to spot repeated reports.
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  analysis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists phishing_reports_tenant_created_idx
  on public.phishing_reports (tenant_id, created_at desc);
create index if not exists phishing_reports_fingerprint_idx
  on public.phishing_reports (tenant_id, fingerprint, created_at desc);
alter table public.phishing_reports enable row level security;
revoke all on table public.phishing_reports from public, anon, authenticated;
grant all on table public.phishing_reports to service_role;

-- Notifies the security team (configured team) about a new report; without a
-- team, the people who may read the security department's tickets. The
-- notification trigger filters recipients without access to the ticket.
create or replace function public.phishing_report_notify(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_payload jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_team uuid;
  v_department uuid;
  v_count integer := 0;
begin
  select ticket.department_id into v_department
  from public.tickets ticket
  where ticket.id = p_ticket_id and ticket.tenant_id = p_tenant_id;
  if not found then
    raise exception 'Ticket unavailable' using errcode = 'P0002';
  end if;
  select settings.notify_team_id into v_team
  from public.phishing_report_settings settings
  where settings.tenant_id = p_tenant_id;

  if v_team is not null then
    insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
    select p_tenant_id, member.user_id, p_ticket_id, 'ticket.security_report',
      coalesce(p_payload, '{}'::jsonb)
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
    select p_tenant_id, membership.user_id, p_ticket_id, 'ticket.security_report',
      coalesce(p_payload, '{}'::jsonb)
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
revoke all on function public.phishing_report_notify(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.phishing_report_notify(uuid, uuid, jsonb) to service_role;

-- Push category for the new notification kind (all existing rows kept).
create or replace function public.push_notification_category(p_kind text)
returns text
language sql
immutable strict
set search_path = pg_catalog
as $function$
  select case
    when p_kind = 'ticket.assigned' then 'assigned'
    when p_kind = 'ticket.requester_reply' then 'requester_reply'
    when p_kind = 'ticket.support_reply' then 'support_reply'
    when p_kind = 'ticket.requester_reminder' then 'support_reply'
    when p_kind = 'ticket.mention' then 'mention'
    when p_kind in ('ticket.supervisor_request', 'ticket.supervisor_answer') then 'mention'
    when p_kind like 'ticket.watch.%' then 'mention'
    when p_kind = 'ticket.resolved' then 'resolved'
    when p_kind = 'ticket.kudos' then 'resolved'
    when p_kind = 'ticket.approval.requested' then 'approval'
    when p_kind = 'ticket.follow_up_due' then 'follow_up'
    when p_kind = 'ticket.rule_reminder' then 'follow_up'
    when p_kind in ('ticket.vendor_reminder', 'ticket.children_done') then 'follow_up'
    when p_kind = 'ticket.escalation_opened' then 'escalation'
    when p_kind = 'ticket.security_report' then 'escalation'
    when p_kind like 'ticket.sla.%' then 'sla'
    when p_kind = 'contract.deadline' then 'contract_deadline'
    when p_kind = 'inventory.low_stock' then 'inventory_low_stock'
    when p_kind like 'shop.order.%' then 'shop'
    when p_kind like 'service_task.%' then 'service_task'
    when p_kind = 'infrastructure.due' then 'infrastructure'
    else null
  end;
$function$;

-- Schedules ------------------------------------------------------------------

do $$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  for v_job_id in select jobid from cron.job where jobname = 'nextdesk-feedback-themes'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule('nextdesk-feedback-themes', '17 2 * * *',
    'select public.feedback_insights_wake();');
exception when others then
  null;
end;
$$;

comment on table public.feedback_comment_themes is
  'KI-Thema und Stimmung pro Feedback-Kommentar (anonymisiertes Zitat). Nur Service-Rolle; Zugriff über feedback-insights.';
comment on table public.feedback_theme_monthly is
  'Monatsaggregate der Feedback-Themen pro Abteilung/Team. Nur Service-Rolle.';
comment on table public.phishing_report_settings is
  'Phishing-Meldeadresse, Zielabteilung/-kategorie und Sicherheitsteam pro Mandant. Nur Service-Rolle; Verwaltung über phishing-reports.';
comment on table public.phishing_reports is
  'Gemeldete verdächtige E-Mails mit serverseitiger Analyse (ohne Öffnen von Links/Anhängen). Nur Service-Rolle.';

commit;
