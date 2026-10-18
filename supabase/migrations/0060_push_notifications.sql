begin;

set local search_path = pg_catalog, public;

-- pg_net wakes the push dispatcher asynchronously after commit. It is installed
-- only where the provider offers it; local test clusters simply skip wakeups.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end;
$$;

-- Push is an opt-in integration. The existing tenant feature initializer is
-- extended below so every future tenant receives the flag disabled as well.
insert into public.feature_catalog (key, name, description, category, default_enabled)
values (
  'notifications.push',
  'Push-Benachrichtigungen',
  'iOS-Push-Benachrichtigungen für Ticketereignisse über den Apple Push Notification service.',
  'integrations',
  false
)
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      category = excluded.category,
      default_enabled = excluded.default_enabled;

alter table public.tenant_feature_flags
  add column if not exists configuration jsonb not null default '{}'::jsonb;

alter table public.tenant_feature_flags
  drop constraint if exists tenant_feature_flags_configuration_object;
alter table public.tenant_feature_flags
  add constraint tenant_feature_flags_configuration_object
  check (jsonb_typeof(configuration) = 'object');

alter table public.tenant_feature_flags
  drop constraint if exists tenant_feature_flags_push_configuration_valid;
alter table public.tenant_feature_flags
  add constraint tenant_feature_flags_push_configuration_valid
  check (
    feature_key <> 'notifications.push'
    or configuration in (
      '{"contentLevel":"minimal"}'::jsonb,
      '{"contentLevel":"subject"}'::jsonb
    )
  );

update public.tenant_feature_flags
set configuration = '{"contentLevel":"minimal"}'::jsonb
where feature_key = 'notifications.push';

insert into public.tenant_feature_flags (tenant_id, feature_key, enabled, configuration)
select
  tenant.id,
  catalog.key,
  false,
  '{"contentLevel":"minimal"}'::jsonb
from public.tenants tenant
join public.feature_catalog catalog on catalog.key = 'notifications.push'
on conflict (tenant_id, feature_key) do nothing;

create or replace function public.initialize_tenant_feature_flags()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  insert into public.tenant_feature_flags (tenant_id, feature_key, enabled, configuration)
  select
    new.id,
    catalog.key,
    catalog.default_enabled,
    case
      when catalog.key = 'notifications.push'
        then '{"contentLevel":"minimal"}'::jsonb
      else '{}'::jsonb
    end
  from public.feature_catalog catalog
  on conflict do nothing;

  insert into public.tenant_sso_configurations (tenant_id) values (new.id)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.initialize_tenant_feature_flags() from public, anon, authenticated;

-- This deliberately mirrors resolveTenantFeatureStates in _shared/tenant-features.ts:
-- missing, disabled, expired and malformed pilot values all resolve to false.
create or replace function public.push_tenant_feature_enabled(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce((
    select flag.enabled = true
      and (
        flag.pilot_ends_at is null
        or flag.pilot_ends_at > timezone('utc', now())
      )
    from public.tenant_feature_flags flag
    where flag.tenant_id = p_tenant_id
      and flag.feature_key = 'notifications.push'
  ), false);
$$;
revoke all on function public.push_tenant_feature_enabled(uuid) from public, anon, authenticated;

create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  platform text not null default 'ios' check (platform = 'ios'),
  apns_token text not null unique check (apns_token ~ '^[0-9a-f]{64,200}$'),
  apns_environment text not null check (apns_environment in ('production', 'development')),
  app_version text check (app_version is null or char_length(app_version) between 1 and 80),
  app_build text check (app_build is null or char_length(app_build) between 1 and 80),
  device_name text check (device_name is null or char_length(device_name) between 1 and 80),
  enabled boolean not null default true,
  disabled_reason text check (disabled_reason is null or char_length(disabled_reason) between 1 and 200),
  last_registered_at timestamptz not null default timezone('utc', now()),
  last_sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint push_devices_disabled_reason_valid check (
    (enabled and disabled_reason is null)
    or (not enabled and disabled_reason is not null)
  )
);
create index push_devices_tenant_user_registered_idx
  on public.push_devices (tenant_id, user_id, last_registered_at);
create index push_devices_enabled_tenant_user_idx
  on public.push_devices (tenant_id, user_id) where enabled;

create or replace function public.push_categories_are_unique(p_categories text[])
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select cardinality(p_categories) = cardinality(array(
    select distinct category
    from unnest(p_categories) as category
  ));
$$;
revoke all on function public.push_categories_are_unique(text[]) from public, anon, authenticated;

create table public.push_preferences (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  enabled_categories text[] not null default array[
    'assigned', 'requester_reply', 'support_reply', 'mention',
    'resolved', 'sla', 'escalation', 'approval'
  ]::text[],
  quiet_hours_enabled boolean not null default false,
  quiet_start smallint not null default 22 check (quiet_start between 0 and 23),
  quiet_end smallint not null default 7 check (quiet_end between 0 and 23),
  timezone text not null default 'Europe/Zurich' check (char_length(timezone) between 1 and 80),
  last_test_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, user_id),
  constraint push_preferences_categories_valid check (
    enabled_categories <@ array[
      'assigned', 'requester_reply', 'support_reply', 'mention',
      'resolved', 'sla', 'escalation', 'approval'
    ]::text[]
    and public.push_categories_are_unique(enabled_categories)
  )
);

create table public.push_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  notification_id uuid not null unique references public.ticket_notifications(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts smallint not null default 0 check (attempts between 0 and 3),
  last_error text check (last_error is null or char_length(last_error) between 1 and 200),
  created_at timestamptz not null default timezone('utc', now()),
  claimed_at timestamptz,
  sent_at timestamptz
);
create index push_outbox_dispatch_idx
  on public.push_outbox (status, created_at)
  where status in ('pending', 'sending');
create index push_outbox_tenant_user_idx
  on public.push_outbox (tenant_id, user_id, created_at desc);

create schema if not exists push_private;
revoke all on schema push_private from public, anon, authenticated;
grant usage on schema push_private to service_role;

create table push_private.dispatch_config (
  singleton boolean primary key default true check (singleton),
  dispatch_secret text not null check (char_length(dispatch_secret) = 64),
  function_url text not null check (function_url ~ '^https://'),
  created_at timestamptz not null default timezone('utc', now())
);
insert into push_private.dispatch_config (singleton, dispatch_secret, function_url)
values (
  true,
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  'https://ewizsylzrwogsztsthbl.supabase.co/functions/v1/push-dispatch'
)
on conflict (singleton) do nothing;

alter table public.push_devices enable row level security;
alter table public.push_devices force row level security;
alter table public.push_preferences enable row level security;
alter table public.push_preferences force row level security;
alter table public.push_outbox enable row level security;
alter table public.push_outbox force row level security;
alter table push_private.dispatch_config enable row level security;
alter table push_private.dispatch_config force row level security;

revoke all on table public.push_devices, public.push_preferences, public.push_outbox from public, anon, authenticated;
revoke all on table push_private.dispatch_config from public, anon, authenticated;
grant select on table public.push_devices, public.push_preferences to authenticated;
grant select, insert, update, delete on table public.push_devices, public.push_preferences, public.push_outbox to service_role;
grant select on table push_private.dispatch_config to service_role;

create policy push_devices_select_own on public.push_devices
  for select to authenticated
  using (user_id = auth.uid() and public.is_active_tenant_member(tenant_id));
create policy push_preferences_select_own on public.push_preferences
  for select to authenticated
  using (user_id = auth.uid() and public.is_active_tenant_member(tenant_id));
create policy push_devices_service_role_only on public.push_devices
  for all to service_role using (true) with check (true);
create policy push_preferences_service_role_only on public.push_preferences
  for all to service_role using (true) with check (true);
create policy push_outbox_service_role_only on public.push_outbox
  for all to service_role using (true) with check (true);
create policy push_dispatch_config_service_role_only on push_private.dispatch_config
  for select to service_role using (true);

create or replace function public.push_insert_ticket_notification(
  p_tenant_id uuid,
  p_user_id uuid,
  p_ticket_id uuid,
  p_kind text,
  p_payload jsonb,
  p_actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_user_id is null or p_user_id = p_actor_id then
    return;
  end if;
  if not exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_user_id
      and membership.status = 'active'
  ) then
    return;
  end if;

  insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
  values (p_tenant_id, p_user_id, p_ticket_id, p_kind, p_payload);
exception when others then
  -- Notification generation is strictly best-effort and must never abort ticket work.
  return;
end;
$$;
revoke all on function public.push_insert_ticket_notification(uuid, uuid, uuid, text, jsonb, uuid) from public, anon, authenticated;

create or replace function public.push_notify_ticket_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor_id uuid;
  v_header_actor text;
  v_role text;
begin
  -- Direct user requests carry the user JWT. Edge functions write with the
  -- service role and pass the already authenticated actor as a header; that
  -- header is trusted only for service-role requests.
  v_actor_id := auth.uid();
  if v_actor_id is null then
    v_role := coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      nullif(current_setting('role', true), '')
    );
    if v_role = 'service_role' then
      v_header_actor := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-nextdesk-actor-id';
      if v_header_actor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_actor_id := v_header_actor::uuid;
      end if;
    end if;
  end if;

  if (tg_op = 'INSERT' and new.assigned_agent_id is not null)
     or (tg_op = 'UPDATE' and new.assigned_agent_id is not null and new.assigned_agent_id is distinct from old.assigned_agent_id) then
    perform public.push_insert_ticket_notification(
      new.tenant_id,
      new.assigned_agent_id,
      new.id,
      'ticket.assigned',
      jsonb_build_object('ticketNumber', new.ticket_number),
      v_actor_id
    );
  end if;

  if tg_op = 'UPDATE'
     and old.resolved_at is null
     and new.resolved_at is not null then
    perform public.push_insert_ticket_notification(
      new.tenant_id,
      new.requester_id,
      new.id,
      'ticket.resolved',
      jsonb_build_object('ticketNumber', new.ticket_number),
      v_actor_id
    );
  end if;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.push_notify_ticket_change() from public, anon, authenticated;
drop trigger if exists push_notify_ticket_change on public.tickets;
create trigger push_notify_ticket_change
  after insert or update of assigned_agent_id, resolved_at on public.tickets
  for each row execute function public.push_notify_ticket_change();

create or replace function public.push_notify_ticket_comment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket record;
begin
  if new.visibility <> 'external' then
    return new;
  end if;

  select ticket.tenant_id, ticket.id, ticket.ticket_number, ticket.requester_id,
         ticket.affected_user_id, ticket.assigned_agent_id
  into v_ticket
  from public.tickets ticket
  where ticket.id = new.ticket_id;
  if not found then
    return new;
  end if;

  if new.author_id is null
     or new.author_id = v_ticket.requester_id
     or new.author_id is not distinct from v_ticket.affected_user_id then
    perform public.push_insert_ticket_notification(
      v_ticket.tenant_id,
      v_ticket.assigned_agent_id,
      v_ticket.id,
      'ticket.requester_reply',
      jsonb_build_object('ticketNumber', v_ticket.ticket_number, 'commentId', new.id),
      new.author_id
    );
  elsif new.author_id is not null then
    perform public.push_insert_ticket_notification(
      v_ticket.tenant_id,
      v_ticket.requester_id,
      v_ticket.id,
      'ticket.support_reply',
      jsonb_build_object('ticketNumber', v_ticket.ticket_number, 'commentId', new.id),
      new.author_id
    );
  end if;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.push_notify_ticket_comment() from public, anon, authenticated;
drop trigger if exists push_notify_ticket_comment on public.ticket_comments;
create trigger push_notify_ticket_comment
  after insert on public.ticket_comments
  for each row execute function public.push_notify_ticket_comment();

create or replace function public.push_notify_ticket_mention()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket record;
begin
  select ticket.tenant_id, ticket.id, ticket.ticket_number
  into v_ticket
  from public.tickets ticket
  where ticket.id = new.ticket_id
    and ticket.tenant_id = new.tenant_id;
  if found then
    perform public.push_insert_ticket_notification(
      v_ticket.tenant_id,
      new.mentioned_user_id,
      v_ticket.id,
      'ticket.mention',
      jsonb_build_object(
        'ticketNumber', v_ticket.ticket_number,
        'commentId', new.comment_id,
        'mentionId', new.id
      ),
      new.author_id
    );
  end if;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.push_notify_ticket_mention() from public, anon, authenticated;
drop trigger if exists push_notify_ticket_mention on public.ticket_mentions;
create trigger push_notify_ticket_mention
  after insert on public.ticket_mentions
  for each row execute function public.push_notify_ticket_mention();

create or replace function public.push_notify_approval_requested()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket record;
  v_recipient record;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  select ticket.tenant_id, ticket.id, ticket.ticket_number, ticket.department_id
  into v_ticket
  from public.tickets ticket
  where ticket.id = new.ticket_id
    and ticket.tenant_id = new.tenant_id;
  if not found then
    return new;
  end if;

  for v_recipient in
    select membership.user_id
    from public.tenant_memberships membership
    where membership.tenant_id = new.tenant_id
      and membership.status = 'active'
      and membership.user_id <> new.requested_by
      and public.user_has_ticket_permission_for(
        membership.user_id,
        new.tenant_id,
        v_ticket.department_id,
        'ticket.approval.decide'
      )
    order by membership.user_id
    limit 25
  loop
    perform public.push_insert_ticket_notification(
      v_ticket.tenant_id,
      v_recipient.user_id,
      v_ticket.id,
      'ticket.approval.requested',
      jsonb_build_object('ticketNumber', v_ticket.ticket_number, 'approvalId', new.id),
      new.requested_by
    );
  end loop;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.push_notify_approval_requested() from public, anon, authenticated;
drop trigger if exists push_notify_approval_requested on public.ticket_approval_requests;
create trigger push_notify_approval_requested
  after insert on public.ticket_approval_requests
  for each row execute function public.push_notify_approval_requested();

create or replace function public.push_notification_category(p_kind text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select case
    when p_kind = 'ticket.assigned' then 'assigned'
    when p_kind = 'ticket.requester_reply' then 'requester_reply'
    when p_kind = 'ticket.support_reply' then 'support_reply'
    when p_kind = 'ticket.mention' then 'mention'
    when p_kind = 'ticket.resolved' then 'resolved'
    when p_kind = 'ticket.approval.requested' then 'approval'
    when p_kind = 'ticket.escalation_opened' then 'escalation'
    when p_kind like 'ticket.sla.%' then 'sla'
    else null
  end;
$$;
revoke all on function public.push_notification_category(text) from public, anon, authenticated;

create or replace function public.push_enqueue_ticket_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_category text;
  v_categories text[];
begin
  v_category := public.push_notification_category(new.kind);
  if v_category is null
     or not public.push_tenant_feature_enabled(new.tenant_id)
     or not exists (
       select 1 from public.tenant_memberships membership
       where membership.tenant_id = new.tenant_id
         and membership.user_id = new.user_id
         and membership.status = 'active'
     )
     or not exists (
       select 1 from public.push_devices device
       where device.tenant_id = new.tenant_id
         and device.user_id = new.user_id
         and device.enabled
     ) then
    return new;
  end if;

  select preference.enabled_categories
  into v_categories
  from public.push_preferences preference
  where preference.tenant_id = new.tenant_id
    and preference.user_id = new.user_id;
  v_categories := coalesce(v_categories, array[
    'assigned', 'requester_reply', 'support_reply', 'mention',
    'resolved', 'sla', 'escalation', 'approval'
  ]::text[]);
  if not v_category = any(v_categories) then
    return new;
  end if;

  insert into public.push_outbox (tenant_id, user_id, notification_id)
  values (new.tenant_id, new.user_id, new.id)
  on conflict (notification_id) do nothing;
  return new;
exception when others then
  -- A deferred provider must not change the outcome of the in-app notification.
  return new;
end;
$$;
revoke all on function public.push_enqueue_ticket_notification() from public, anon, authenticated;
drop trigger if exists push_enqueue_ticket_notification on public.ticket_notifications;
create trigger push_enqueue_ticket_notification
  after insert on public.ticket_notifications
  for each row execute function public.push_enqueue_ticket_notification();

create or replace function public.push_dispatch_outbox_statement()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, push_private, pg_temp
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from new_push_rows) then
    return null;
  end if;
  select config.function_url, config.dispatch_secret
  into v_url, v_secret
  from push_private.dispatch_config config
  where config.singleton;

  if v_url is null or v_secret is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return null;
  end if;

  execute 'select net.http_post($1, $2, $3, $4, $5)'
    using v_url,
          '{}'::jsonb,
          '{}'::jsonb,
          jsonb_build_object(
            'Content-Type', 'application/json',
            'x-nextdesk-push-secret', v_secret
          ),
          15000;
  return null;
exception when others then
  -- pg_net is intentionally optional in local tests and provider wakeups are best-effort.
  return null;
end;
$$;
revoke all on function public.push_dispatch_outbox_statement() from public, anon, authenticated;
drop trigger if exists push_dispatch_outbox_statement on public.push_outbox;
create trigger push_dispatch_outbox_statement
  after insert on public.push_outbox
  referencing new table as new_push_rows
  for each statement execute function public.push_dispatch_outbox_statement();

create or replace function public.push_verify_dispatch_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, push_private, pg_temp
as $$
  select p_secret is not null
    and exists (
      select 1
      from push_private.dispatch_config config
      where config.singleton
        and config.dispatch_secret = p_secret
    );
$$;
revoke all on function public.push_verify_dispatch_secret(text) from public, anon, authenticated;
grant execute on function public.push_verify_dispatch_secret(text) to service_role;

create or replace function public.push_claim_outbox(p_limit integer default 50)
returns table (
  outbox_id uuid,
  tenant_id uuid,
  user_id uuid,
  notification_id uuid,
  ticket_id uuid,
  kind text,
  ticket_number text,
  subject text,
  devices jsonb,
  quiet_hours boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row record;
  v_ticket record;
  v_content_level text;
  v_devices jsonb;
  v_quiet_enabled boolean;
  v_quiet_start smallint;
  v_quiet_end smallint;
  v_timezone text;
  v_local_hour integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'invalid_push_claim_limit' using errcode = '22023';
  end if;

  update public.push_outbox
  set status = 'failed',
      last_error = 'attempt_limit'
  where status in ('pending', 'sending')
    and attempts >= 3;

  for v_row in
    select outbox.*
    from public.push_outbox outbox
    where outbox.attempts < 3
      and (
        outbox.status = 'pending'
        or (outbox.status = 'sending' and outbox.claimed_at < timezone('utc', now()) - interval '5 minutes')
      )
    order by outbox.created_at, outbox.id
    for update skip locked
    limit p_limit
  loop
    if not public.push_tenant_feature_enabled(v_row.tenant_id) then
      update public.push_outbox
      set status = 'skipped', last_error = 'feature_disabled'
      where id = v_row.id;
      continue;
    end if;

    if not exists (
      select 1 from public.tenant_memberships membership
      where membership.tenant_id = v_row.tenant_id
        and membership.user_id = v_row.user_id
        and membership.status = 'active'
    ) then
      update public.push_outbox
      set status = 'skipped', last_error = 'membership_inactive'
      where id = v_row.id;
      continue;
    end if;

    select notification.ticket_id, notification.kind, ticket.ticket_number, ticket.subject,
           feature.configuration ->> 'contentLevel' as content_level
    into v_ticket
    from public.ticket_notifications notification
    left join public.tickets ticket on ticket.id = notification.ticket_id
    join public.tenant_feature_flags feature
      on feature.tenant_id = notification.tenant_id
      and feature.feature_key = 'notifications.push'
    where notification.id = v_row.notification_id
      and notification.tenant_id = v_row.tenant_id;
    if not found or v_ticket.ticket_id is null then
      update public.push_outbox
      set status = 'skipped', last_error = 'ticket_unavailable'
      where id = v_row.id;
      continue;
    end if;

    v_content_level := coalesce(v_ticket.content_level, 'minimal');
    select jsonb_agg(
      jsonb_build_object(
        'id', device.id,
        'token', device.apns_token,
        'environment', device.apns_environment
      ) order by device.created_at
    )
    into v_devices
    from public.push_devices device
    where device.tenant_id = v_row.tenant_id
      and device.user_id = v_row.user_id
      and device.enabled;
    if v_devices is null then
      update public.push_outbox
      set status = 'skipped', last_error = 'no_active_devices'
      where id = v_row.id;
      continue;
    end if;

    v_quiet_enabled := false;
    v_quiet_start := 22;
    v_quiet_end := 7;
    v_timezone := 'Europe/Zurich';
    select preference.quiet_hours_enabled, preference.quiet_start, preference.quiet_end, preference.timezone
    into v_quiet_enabled, v_quiet_start, v_quiet_end, v_timezone
    from public.push_preferences preference
    where preference.tenant_id = v_row.tenant_id
      and preference.user_id = v_row.user_id;
    if not found then
      v_quiet_enabled := false;
      v_quiet_start := 22;
      v_quiet_end := 7;
      v_timezone := 'Europe/Zurich';
    end if;

    begin
      v_local_hour := extract(hour from timezone(v_timezone, now()))::integer;
      quiet_hours := v_quiet_enabled
        and v_quiet_start <> v_quiet_end
        and case
          when v_quiet_start < v_quiet_end then v_local_hour >= v_quiet_start and v_local_hour < v_quiet_end
          else v_local_hour >= v_quiet_start or v_local_hour < v_quiet_end
        end;
    exception when others then
      quiet_hours := false;
    end;

    update public.push_outbox
    set status = 'sending',
        attempts = attempts + 1,
        claimed_at = timezone('utc', now()),
        last_error = null
    where id = v_row.id;

    outbox_id := v_row.id;
    tenant_id := v_row.tenant_id;
    user_id := v_row.user_id;
    notification_id := v_row.notification_id;
    ticket_id := v_ticket.ticket_id;
    kind := v_ticket.kind;
    ticket_number := v_ticket.ticket_number;
    subject := case when v_content_level = 'subject' then v_ticket.subject else null end;
    devices := v_devices;
    return next;
  end loop;
end;
$$;
revoke all on function public.push_claim_outbox(integer) from public, anon, authenticated;
grant execute on function public.push_claim_outbox(integer) to service_role;

create trigger push_devices_updated_at before update on public.push_devices
  for each row execute function public.set_updated_at();
create trigger push_preferences_updated_at before update on public.push_preferences
  for each row execute function public.set_updated_at();

comment on table public.push_devices is
  'Registrierte iOS-APNs-Geräte. Browserrollen dürfen nur ihre eigenen Zeilen lesen; Änderungen erfolgen ausschliesslich über push-notifications.';
comment on table public.push_preferences is
  'Persönliche Push-Kategorien und Ruhezeiten, geschrieben ausschliesslich über push-notifications.';
comment on table public.push_outbox is
  'Ereignisgetriebene APNs-Auslieferungswarteschlange; jeder Eintrag referenziert genau eine In-App-Benachrichtigung.';
comment on function public.push_claim_outbox(integer) is
  'Ausschliesslich service_role: reserviert auslieferbare Push-Outbox-Einträge mit SKIP LOCKED und prüft Mitgliedschaft sowie Feature erneut.';

commit;
