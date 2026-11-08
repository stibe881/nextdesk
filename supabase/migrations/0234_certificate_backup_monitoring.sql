begin;

set local search_path = pg_catalog, public;

-- Monitoring automations next to PRTG (0220):
--
-- 1. Expiry monitoring: TLS certificates (host:port) and domain registrations
--    (RDAP) are checked by the expiry-monitoring Edge Function. Before expiry a
--    ticket is opened once (warn_days), raised at reminder_days, and resolved
--    automatically when a renewal is detected.
-- 2. Backup monitoring: job reports arrive by e-mail (sender/subject rules in
--    the Exchange and e-mail ingress) or by token webhook. Failed reports open
--    a ticket, missing reports open «Backup-Meldung ausgeblieben», the next
--    success comments and resolves.
--
-- All tables are service-role only; the Edge Functions check
-- tenant.settings.manage before reading or writing on behalf of a person.

-- Expiry monitoring ---------------------------------------------------------

create table if not exists public.monitoring_expiry_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  department_id uuid references public.departments(id) on delete set null,
  priority_key text check (priority_key is null or char_length(priority_key) between 1 and 64),
  reminder_priority_key text
    check (reminder_priority_key is null or char_length(reminder_priority_key) between 1 and 64),
  warn_days integer not null default 30 check (warn_days between 1 and 180),
  reminder_days integer not null default 7 check (reminder_days between 0 and 90),
  auto_resolve boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint monitoring_expiry_settings_reminder_before_warn check (reminder_days < warn_days)
);

create table if not exists public.monitoring_expiry_targets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('certificate', 'domain')),
  host text not null check (
    char_length(host) between 1 and 253
    and host = lower(host)
    and host ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'
  ),
  port integer check (port is null or port between 1 and 65535),
  label text check (label is null or char_length(label) between 1 and 200),
  department_id uuid references public.departments(id) on delete set null,
  asset_id uuid references public.assets(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  warn_days integer check (warn_days is null or warn_days between 1 and 180),
  active boolean not null default true,
  status text not null default 'pending'
    check (status in ('pending', 'valid', 'expiring', 'expired', 'error')),
  expires_at timestamptz,
  issuer text check (issuer is null or char_length(issuer) <= 500),
  subject text check (subject is null or char_length(subject) <= 500),
  san text[] not null default '{}'::text[] check (cardinality(san) <= 200),
  serial text check (serial is null or char_length(serial) <= 200),
  registrar text check (registrar is null or char_length(registrar) <= 300),
  check_method text check (check_method is null or check_method in ('tls', 'ct', 'rdap')),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  consecutive_errors integer not null default 0 check (consecutive_errors >= 0),
  last_checked_at timestamptz,
  next_check_at timestamptz not null default timezone('utc', now()),
  ticket_id uuid references public.tickets(id) on delete set null,
  ticket_stage text check (ticket_stage is null or ticket_stage in ('warned', 'reminded')),
  ticket_expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint monitoring_expiry_targets_port_kind check (
    (kind = 'certificate' and port is not null) or (kind = 'domain' and port is null)
  )
);
create unique index if not exists monitoring_expiry_targets_unique_idx
  on public.monitoring_expiry_targets (tenant_id, kind, host, coalesce(port, 0));
create index if not exists monitoring_expiry_targets_due_idx
  on public.monitoring_expiry_targets (next_check_at)
  where active;

-- Backup monitoring ---------------------------------------------------------

create table if not exists public.monitoring_backup_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  department_id uuid references public.departments(id) on delete set null,
  priority_key text check (priority_key is null or char_length(priority_key) between 1 and 64),
  warning_action text not null default 'ignore' check (warning_action in ('ignore', 'ticket')),
  auto_resolve boolean not null default true,
  default_interval_hours integer not null default 24
    check (default_interval_hours between 1 and 2160),
  default_grace_hours integer not null default 6 check (default_grace_hours between 0 and 336),
  sender_patterns text[] not null default '{}'::text[] check (cardinality(sender_patterns) <= 20),
  subject_patterns text[] not null default '{}'::text[] check (cardinality(subject_patterns) <= 20),
  token_hash text check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  token_rotated_at timestamptz,
  last_received_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create unique index if not exists monitoring_backup_settings_token_hash_idx
  on public.monitoring_backup_settings (token_hash)
  where token_hash is not null;

create table if not exists public.monitoring_backup_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 300),
  name_key text not null check (char_length(name_key) between 1 and 300 and name_key = lower(name_key)),
  last_source text check (last_source is null or last_source in ('email', 'webhook')),
  expected_interval_hours integer check (
    expected_interval_hours is null or expected_interval_hours between 1 and 2160
  ),
  grace_hours integer check (grace_hours is null or grace_hours between 0 and 336),
  department_id uuid references public.departments(id) on delete set null,
  asset_id uuid references public.assets(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  active boolean not null default true,
  last_result text check (last_result is null or last_result in ('success', 'warning', 'failed')),
  last_report_at timestamptz,
  last_success_at timestamptz,
  last_message text check (last_message is null or char_length(last_message) <= 2000),
  report_count integer not null default 0 check (report_count >= 0),
  ticket_id uuid references public.tickets(id) on delete set null,
  ticket_reason text check (ticket_reason is null or ticket_reason in ('failed', 'warning', 'missing')),
  missing_alerted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint monitoring_backup_jobs_name_unique unique (tenant_id, name_key)
);
create index if not exists monitoring_backup_jobs_watch_idx
  on public.monitoring_backup_jobs (tenant_id, last_report_at)
  where active and expected_interval_hours is not null;

create table if not exists public.monitoring_backup_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid not null references public.monitoring_backup_jobs(id) on delete cascade,
  result text not null check (result in ('success', 'warning', 'failed')),
  source text not null check (source in ('email', 'webhook')),
  subject text check (subject is null or char_length(subject) <= 500),
  summary text check (summary is null or char_length(summary) <= 2000),
  object_count integer check (object_count is null or object_count >= 0),
  dedupe_key text check (dedupe_key is null or char_length(dedupe_key) between 1 and 600),
  action text check (action is null or char_length(action) <= 40),
  reported_at timestamptz not null default timezone('utc', now()),
  received_at timestamptz not null default timezone('utc', now())
);
create unique index if not exists monitoring_backup_reports_dedupe_idx
  on public.monitoring_backup_reports (tenant_id, dedupe_key)
  where dedupe_key is not null;
create index if not exists monitoring_backup_reports_job_recent_idx
  on public.monitoring_backup_reports (job_id, received_at desc);

-- Access ---------------------------------------------------------------------

alter table public.monitoring_expiry_settings enable row level security;
alter table public.monitoring_expiry_targets enable row level security;
alter table public.monitoring_backup_settings enable row level security;
alter table public.monitoring_backup_jobs enable row level security;
alter table public.monitoring_backup_reports enable row level security;
revoke all on table public.monitoring_expiry_settings, public.monitoring_expiry_targets,
  public.monitoring_backup_settings, public.monitoring_backup_jobs,
  public.monitoring_backup_reports
  from public, anon, authenticated;
grant all on table public.monitoring_expiry_settings, public.monitoring_expiry_targets,
  public.monitoring_backup_settings, public.monitoring_backup_jobs,
  public.monitoring_backup_reports
  to service_role;

create or replace trigger monitoring_expiry_settings_updated_at
  before update on public.monitoring_expiry_settings
  for each row execute function public.set_updated_at();
create or replace trigger monitoring_expiry_targets_updated_at
  before update on public.monitoring_expiry_targets
  for each row execute function public.set_updated_at();
create or replace trigger monitoring_backup_settings_updated_at
  before update on public.monitoring_backup_settings
  for each row execute function public.set_updated_at();
create or replace trigger monitoring_backup_jobs_updated_at
  before update on public.monitoring_backup_jobs
  for each row execute function public.set_updated_at();

comment on table public.monitoring_expiry_targets is
  'TLS certificates and domains whose expiry is watched; one ticket per expiry date. Service role only.';
comment on table public.monitoring_backup_jobs is
  'Backup jobs known from e-mail or webhook reports, with expected interval and open ticket. Service role only.';
comment on table public.monitoring_backup_reports is
  'History of backup job reports (deduplicated by message id). Service role only.';

-- Scheduled wake-up ----------------------------------------------------------
-- Both functions are woken with a shared secret that never leaves the
-- database (same pattern as service-tasks and ticket-triage).

create schema if not exists monitoring_automation_private;
revoke all on schema monitoring_automation_private from public, anon, authenticated;

create table if not exists monitoring_automation_private.dispatch_config (
  singleton boolean primary key default true check (singleton),
  functions_base_url text not null,
  dispatch_secret text not null check (char_length(dispatch_secret) >= 32)
);
revoke all on monitoring_automation_private.dispatch_config from public, anon, authenticated;

insert into monitoring_automation_private.dispatch_config (singleton, functions_base_url, dispatch_secret)
values (
  true,
  'https://ewizsylzrwogsztsthbl.supabase.co/functions/v1',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
on conflict (singleton) do nothing;

create or replace function public.monitoring_automation_verify_dispatch_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, monitoring_automation_private, pg_temp
as $$
  select exists (
    select 1 from monitoring_automation_private.dispatch_config config
    where config.singleton and p_secret is not null and config.dispatch_secret = p_secret
  );
$$;
revoke all on function public.monitoring_automation_verify_dispatch_secret(text)
  from public, anon, authenticated;
grant execute on function public.monitoring_automation_verify_dispatch_secret(text) to service_role;

-- p_function: 'expiry-monitoring' or 'backup-monitoring'. Only calls out when
-- an enabled tenant has work for the function.
create or replace function public.monitoring_automation_wake(p_function text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, monitoring_automation_private, pg_temp
as $$
declare
  v_base text;
  v_secret text;
begin
  if p_function = 'expiry-monitoring' then
    if not exists (
      select 1
      from public.monitoring_expiry_targets target
      join public.monitoring_expiry_settings settings
        on settings.tenant_id = target.tenant_id and settings.enabled
      where target.active and target.next_check_at <= timezone('utc', now())
    ) then
      return;
    end if;
  elsif p_function = 'backup-monitoring' then
    if not exists (
      select 1
      from public.monitoring_backup_jobs job
      join public.monitoring_backup_settings settings
        on settings.tenant_id = job.tenant_id and settings.enabled
      where job.active and job.expected_interval_hours is not null
    ) then
      return;
    end if;
  else
    return;
  end if;
  select config.functions_base_url, config.dispatch_secret into v_base, v_secret
  from monitoring_automation_private.dispatch_config config where config.singleton;
  if v_base is null or v_secret is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return;
  end if;
  execute 'select net.http_post($1, $2, $3, $4, $5)'
    using rtrim(v_base, '/') || '/' || p_function,
          jsonb_build_object('type', 'cron'),
          '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-nextdesk-dispatch-secret', v_secret),
          30000;
exception when others then
  return;
end;
$$;
revoke all on function public.monitoring_automation_wake(text) from public, anon, authenticated;

do $$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  for v_job_id in
    select jobid from cron.job
    where jobname in ('nextdesk-expiry-monitoring', 'nextdesk-backup-monitoring')
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule('nextdesk-expiry-monitoring', '17 * * * *',
    $cron$select public.monitoring_automation_wake('expiry-monitoring');$cron$);
  perform cron.schedule('nextdesk-backup-monitoring', '*/15 * * * *',
    $cron$select public.monitoring_automation_wake('backup-monitoring');$cron$);
exception when others then
  null;
end;
$$;

commit;
