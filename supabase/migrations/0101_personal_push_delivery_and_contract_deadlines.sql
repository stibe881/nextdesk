begin;

set local search_path = pg_catalog, public;

-- Persönliche Zustellung bleibt von der Geräteeinschreibung getrennt. Kein
-- Browser kann diese Tabellen direkt beschreiben; alle Änderungen führen über
-- die authentisierte push-notifications-Function.
alter table public.push_preferences
  add column if not exists global_enabled boolean not null default true,
  add column if not exists category_modes jsonb not null default '{}'::jsonb,
  add column if not exists summary_hour smallint not null default 8
    check (summary_hour between 0 and 23);

create or replace function public.push_delivery_modes_valid(p_modes jsonb)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select jsonb_typeof(p_modes) = 'object'
    and not exists (
      select 1
      from jsonb_each_text(p_modes) as mode(category, delivery_mode)
      where category not in (
        'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
        'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline'
      )
      or delivery_mode not in ('immediate', 'summary', 'off')
    );
$$;
revoke all on function public.push_delivery_modes_valid(jsonb) from public, anon, authenticated;
grant execute on function public.push_delivery_modes_valid(jsonb) to service_role;
-- Der bestehende Categories-Constraint wird beim selben service-role-Upsert
-- ausgewertet; der Grant muss auch bei älteren Datenbankständen explizit sein.
grant execute on function public.push_categories_are_unique(text[]) to service_role;

alter table public.push_preferences
  drop constraint if exists push_preferences_delivery_modes_valid;
alter table public.push_preferences
  add constraint push_preferences_delivery_modes_valid
  check (public.push_delivery_modes_valid(category_modes));

alter table public.push_preferences
  alter column enabled_categories set default array[
    'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
    'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline'
  ]::text[];
alter table public.push_preferences
  drop constraint if exists push_preferences_categories_valid;
alter table public.push_preferences
  add constraint push_preferences_categories_valid
  check (
    enabled_categories <@ array[
      'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
      'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline'
    ]::text[]
    and public.push_categories_are_unique(enabled_categories)
  );

update public.push_preferences preference
set category_modes = coalesce(
  (
    select jsonb_object_agg(
      category,
      case when category = any(preference.enabled_categories) then 'immediate' else 'off' end
    )
    from unnest(array[
      'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
      'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline'
    ]::text[]) as category
  ),
  '{}'::jsonb
)
where preference.category_modes = '{}'::jsonb;

create or replace function public.push_delivery_mode(
  p_modes jsonb,
  p_enabled_categories text[],
  p_category text
)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select case
    when p_modes ? p_category
      and p_modes ->> p_category in ('immediate', 'summary', 'off')
      then p_modes ->> p_category
    when p_category = any(p_enabled_categories) then 'immediate'
    else 'off'
  end;
$$;
revoke all on function public.push_delivery_mode(jsonb, text[], text)
  from public, anon, authenticated;

-- Verträge liefern ausschliesslich eine opaque Frist-ID und einen neutralen
-- Grund. Namen, Gegenparteien, Notizen und Vertragsinhalte werden nie hier
-- gespeichert oder in APNs übertragen.
create table public.contract_deadline_push_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contract_id uuid not null,
  recipient_user_id uuid not null,
  milestone text not null check (
    milestone in ('days_90', 'days_60', 'days_30', 'days_14', 'days_7', 'days_1', 'overdue')
  ),
  event_date date not null,
  delivery_mode text not null check (delivery_mode in ('immediate', 'summary')),
  created_at timestamptz not null default timezone('utc', now()),
  constraint contract_deadline_push_events_contract_fk
    foreign key (contract_id, tenant_id)
    references public.contracts (id, tenant_id)
    on delete cascade,
  constraint contract_deadline_push_events_membership_fk
    foreign key (tenant_id, recipient_user_id)
    references public.tenant_memberships (tenant_id, user_id)
    on delete cascade,
  constraint contract_deadline_push_events_once
    unique (tenant_id, contract_id, recipient_user_id, milestone, event_date)
);
create index contract_deadline_push_events_pending_idx
  on public.contract_deadline_push_events (tenant_id, recipient_user_id, created_at desc);

alter table public.contract_deadline_push_events enable row level security;
alter table public.contract_deadline_push_events force row level security;
revoke all on table public.contract_deadline_push_events from public, anon, authenticated;
grant select, insert, update, delete on table public.contract_deadline_push_events to service_role;
create policy contract_deadline_push_events_service_role_only
  on public.contract_deadline_push_events
  for all to service_role using (true) with check (true);

alter table public.push_outbox
  alter column notification_id drop not null,
  add column if not exists source_type text not null default 'ticket'
    check (source_type in ('ticket', 'contract')),
  add column if not exists contract_event_id uuid
    references public.contract_deadline_push_events(id) on delete cascade,
  add column if not exists available_at timestamptz not null default timezone('utc', now());

alter table public.push_outbox
  drop constraint if exists push_outbox_source_shape;
alter table public.push_outbox
  add constraint push_outbox_source_shape check (
    (source_type = 'ticket' and notification_id is not null and contract_event_id is null)
    or (source_type = 'contract' and notification_id is null and contract_event_id is not null)
  );
create unique index if not exists push_outbox_contract_event_unique
  on public.push_outbox (contract_event_id)
  where contract_event_id is not null;
create index if not exists push_outbox_available_dispatch_idx
  on public.push_outbox (status, available_at, created_at)
  where status in ('pending', 'sending');

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
    when p_kind = 'ticket.follow_up_due' then 'follow_up'
    when p_kind = 'ticket.escalation_opened' then 'escalation'
    when p_kind like 'ticket.sla.%' then 'sla'
    when p_kind = 'contract.deadline' then 'contract_deadline'
    else null
  end;
$$;
revoke all on function public.push_notification_category(text) from public, anon, authenticated;

-- Die Vertragszustellung bleibt selbst nach dem Einreihen gebunden: Feature,
-- Mitgliedschaft, Systemrolle, aktuelle Verantwortlichkeit und Vertragsstatus
-- werden vor dem Claim erneut geprüft.
create or replace function public.push_contract_delivery_authorized(
  p_tenant_id uuid,
  p_user_id uuid,
  p_contract_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select public.push_tenant_feature_enabled(p_tenant_id)
    and public.has_contracts_management_permission(p_tenant_id, p_user_id)
    and exists (
      select 1
      from public.tenant_feature_flags feature
      where feature.tenant_id = p_tenant_id
        and feature.feature_key = 'contracts.management'
        and feature.enabled
        and (feature.pilot_ends_at is null or feature.pilot_ends_at > timezone('utc', now()))
    )
    and exists (
      select 1
      from public.contracts contract
      join public.tenant_memberships membership
        on membership.tenant_id = contract.tenant_id
        and membership.user_id = p_user_id
        and membership.status = 'active'
      where contract.id = p_contract_id
        and contract.tenant_id = p_tenant_id
        and contract.status = 'active'
        and contract.archived_at is null
        and contract.responsible_user_id = p_user_id
    );
$$;
revoke all on function public.push_contract_delivery_authorized(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.push_contract_delivery_authorized(uuid, uuid, uuid)
  to service_role;

create or replace function public.materialize_contract_deadline_push_events()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_contract record;
  v_local_date date;
  v_days_remaining integer;
  v_milestone text;
  v_event_mode text;
  v_event_id uuid;
  v_created integer := 0;
begin
  for v_contract in
    select contract.id, contract.tenant_id, contract.responsible_user_id, contract.ends_on,
           coalesce(preference.timezone, 'Europe/Zurich') as timezone
    from public.contracts contract
    join public.tenant_memberships membership
      on membership.tenant_id = contract.tenant_id
      and membership.user_id = contract.responsible_user_id
      and membership.status = 'active'
    left join public.push_preferences preference
      on preference.tenant_id = contract.tenant_id
      and preference.user_id = contract.responsible_user_id
    where contract.status = 'active'
      and contract.archived_at is null
      and contract.ends_on is not null
      and contract.responsible_user_id is not null
      and contract.ends_on <= (timezone(coalesce(preference.timezone, 'Europe/Zurich'), now())::date + 90)
    order by contract.ends_on, contract.id
    for update of contract skip locked
  loop
    begin
      v_local_date := timezone(v_contract.timezone, now())::date;
    exception when others then
      v_local_date := timezone('Europe/Zurich', now())::date;
    end;
    v_days_remaining := v_contract.ends_on - v_local_date;
    if v_days_remaining = 90 then
      v_milestone := 'days_90'; v_event_mode := 'summary';
    elsif v_days_remaining = 60 then
      v_milestone := 'days_60'; v_event_mode := 'summary';
    elsif v_days_remaining = 30 then
      v_milestone := 'days_30'; v_event_mode := 'immediate';
    elsif v_days_remaining = 14 then
      v_milestone := 'days_14'; v_event_mode := 'immediate';
    elsif v_days_remaining = 7 then
      v_milestone := 'days_7'; v_event_mode := 'immediate';
    elsif v_days_remaining = 1 then
      v_milestone := 'days_1'; v_event_mode := 'immediate';
    elsif v_days_remaining < 0 then
      v_milestone := 'overdue'; v_event_mode := 'summary';
    else
      continue;
    end if;

    if not public.push_contract_delivery_authorized(
      v_contract.tenant_id,
      v_contract.responsible_user_id,
      v_contract.id
    ) then
      continue;
    end if;

    insert into public.contract_deadline_push_events (
      tenant_id, contract_id, recipient_user_id, milestone, event_date, delivery_mode
    ) values (
      v_contract.tenant_id, v_contract.id, v_contract.responsible_user_id,
      v_milestone,
      case when v_milestone = 'overdue' then v_local_date else v_contract.ends_on end,
      v_event_mode
    ) on conflict (tenant_id, contract_id, recipient_user_id, milestone, event_date)
      do nothing
    returning id into v_event_id;

    if v_event_id is not null then
      insert into public.push_outbox (tenant_id, user_id, source_type, contract_event_id)
      values (v_contract.tenant_id, v_contract.responsible_user_id, 'contract', v_event_id)
      on conflict (contract_event_id) where contract_event_id is not null do nothing;
      v_created := v_created + 1;
    end if;
  end loop;
  return v_created;
end;
$$;
revoke all on function public.materialize_contract_deadline_push_events()
  from public, anon, authenticated;
grant execute on function public.materialize_contract_deadline_push_events() to service_role;

-- V1 wird nach der Schemaerweiterung bewusst zu einer sicheren No-op-Fence.
-- Ein noch laufender alter Dispatcher kann somit weder Contract-Zeilen als
-- Ticket verwerfen noch persönliche Pause/Modi umgehen. Pendente Einträge
-- bleiben bis zum V2-Dispatcher erhalten.
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
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'invalid_push_claim_limit' using errcode = '22023';
  end if;
  return;
end;
$$;
revoke all on function public.push_claim_outbox(integer) from public, anon, authenticated;
grant execute on function public.push_claim_outbox(integer) to service_role;

-- V2 is additive so rolling deploys cannot leave an older dispatcher without a
-- claim path. It unifies tickets and neutral contract events but never exposes
-- contract attributes to the provider.
create or replace function public.push_claim_outbox_v2(p_limit integer default 50)
returns table (
  outbox_id uuid,
  tenant_id uuid,
  user_id uuid,
  notification_id uuid,
  source_type text,
  ticket_id uuid,
  contract_id uuid,
  kind text,
  ticket_number text,
  subject text,
  delivery_mode text,
  devices jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row record;
  v_kind text;
  v_ticket_id uuid;
  v_contract_id uuid;
  v_ticket_number text;
  v_subject text;
  v_category text;
  v_mode text;
  v_global_enabled boolean;
  v_modes jsonb;
  v_enabled_categories text[];
  v_summary_hour smallint;
  v_timezone text;
  v_local_hour integer;
  v_quiet_enabled boolean;
  v_quiet_start smallint;
  v_quiet_end smallint;
  v_quiet boolean;
  v_devices jsonb;
  v_content_level text;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'invalid_push_claim_limit' using errcode = '22023';
  end if;

  update public.push_outbox
  set status = 'failed', last_error = 'attempt_limit'
  where status in ('pending', 'sending') and attempts >= 3;

  for v_row in
    select outbox.*
    from public.push_outbox outbox
    where outbox.attempts < 3
      and outbox.available_at <= timezone('utc', now())
      and (outbox.status = 'pending' or (
        outbox.status = 'sending'
        and outbox.claimed_at < timezone('utc', now()) - interval '5 minutes'
      ))
    order by outbox.available_at, outbox.created_at, outbox.id
    for update skip locked
    limit p_limit
  loop
    if not public.push_tenant_feature_enabled(v_row.tenant_id) then
      update public.push_outbox set status = 'skipped', last_error = 'feature_disabled'
      where id = v_row.id;
      continue;
    end if;
    if not exists (
      select 1 from public.tenant_memberships membership
      where membership.tenant_id = v_row.tenant_id
        and membership.user_id = v_row.user_id
        and membership.status = 'active'
    ) then
      update public.push_outbox set status = 'skipped', last_error = 'membership_inactive'
      where id = v_row.id;
      continue;
    end if;

    v_kind := null; v_ticket_id := null; v_contract_id := null;
    v_ticket_number := null; v_subject := null; v_content_level := 'minimal';
    if v_row.source_type = 'ticket' then
      select notification.kind, notification.ticket_id, ticket.ticket_number,
             case when feature.configuration ->> 'contentLevel' = 'subject' then ticket.subject else null end
      into v_kind, v_ticket_id, v_ticket_number, v_subject
      from public.ticket_notifications notification
      join public.tickets ticket on ticket.id = notification.ticket_id
      join public.tenant_feature_flags feature
        on feature.tenant_id = notification.tenant_id
        and feature.feature_key = 'notifications.push'
      where notification.id = v_row.notification_id
        and notification.tenant_id = v_row.tenant_id;
      if not found then
        update public.push_outbox set status = 'skipped', last_error = 'ticket_unavailable'
        where id = v_row.id;
        continue;
      end if;
    else
      select event.contract_id, 'contract.deadline'::text
      into v_contract_id, v_kind
      from public.contract_deadline_push_events event
      where event.id = v_row.contract_event_id
        and event.tenant_id = v_row.tenant_id
        and event.recipient_user_id = v_row.user_id;
      if not found or not public.push_contract_delivery_authorized(v_row.tenant_id, v_row.user_id, v_contract_id) then
        update public.push_outbox set status = 'skipped', last_error = 'recipient_not_authorized'
        where id = v_row.id;
        continue;
      end if;
    end if;

    v_category := public.push_notification_category(v_kind);
    if v_category is null then
      update public.push_outbox set status = 'skipped', last_error = 'unsupported_kind'
      where id = v_row.id;
      continue;
    end if;

    select preference.global_enabled, preference.category_modes, preference.enabled_categories,
           preference.summary_hour, preference.quiet_hours_enabled, preference.quiet_start,
           preference.quiet_end, preference.timezone
    into v_global_enabled, v_modes, v_enabled_categories, v_summary_hour,
         v_quiet_enabled, v_quiet_start, v_quiet_end, v_timezone
    from public.push_preferences preference
    where preference.tenant_id = v_row.tenant_id and preference.user_id = v_row.user_id;
    v_global_enabled := coalesce(v_global_enabled, true);
    v_modes := coalesce(v_modes, '{}'::jsonb);
    v_enabled_categories := coalesce(v_enabled_categories, array[
      'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
      'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline'
    ]::text[]);
    v_summary_hour := coalesce(v_summary_hour, 8);
    v_quiet_enabled := coalesce(v_quiet_enabled, false);
    v_quiet_start := coalesce(v_quiet_start, 22);
    v_quiet_end := coalesce(v_quiet_end, 7);
    v_timezone := coalesce(v_timezone, 'Europe/Zurich');
    if not v_global_enabled then
      update public.push_outbox set status = 'skipped', last_error = 'global_disabled'
      where id = v_row.id;
      continue;
    end if;
    v_mode := public.push_delivery_mode(v_modes, v_enabled_categories, v_category);
    if v_mode = 'off' then
      update public.push_outbox set status = 'skipped', last_error = 'preference_disabled'
      where id = v_row.id;
      continue;
    end if;
    -- Milestones bestimmen nur, wann ein neutrales Ereignis entsteht. Die
    -- bewusste persönliche Kategorieauswahl bestimmt ausnahmslos, ob es
    -- sofort, zusammengefasst oder gar nicht zugestellt wird.

    begin
      v_local_hour := extract(hour from timezone(v_timezone, now()))::integer;
    exception when others then
      v_timezone := 'Europe/Zurich';
      v_local_hour := extract(hour from timezone(v_timezone, now()))::integer;
    end;
    v_quiet := v_quiet_enabled and v_quiet_start <> v_quiet_end and case
      when v_quiet_start < v_quiet_end then v_local_hour >= v_quiet_start and v_local_hour < v_quiet_end
      else v_local_hour >= v_quiet_start or v_local_hour < v_quiet_end
    end;
    if v_quiet or not coalesce((public.push_work_state(v_row.tenant_id, v_row.user_id) ->> 'active')::boolean, false) then
      update public.push_outbox
      set status = 'pending', claimed_at = null, available_at = timezone('utc', now()) + interval '15 minutes',
          last_error = case when v_quiet then 'deferred_quiet_hours' else 'deferred_off_shift' end
      where id = v_row.id;
      continue;
    end if;
    if v_mode = 'summary' and v_local_hour <> v_summary_hour then
      update public.push_outbox
      set status = 'pending', claimed_at = null, available_at = timezone('utc', now()) + interval '15 minutes',
          last_error = 'deferred_summary'
      where id = v_row.id;
      continue;
    end if;

    select jsonb_agg(jsonb_build_object(
      'id', device.id, 'token', device.apns_token, 'environment', device.apns_environment
    ) order by device.created_at)
    into v_devices
    from public.push_devices device
    where device.tenant_id = v_row.tenant_id and device.user_id = v_row.user_id and device.enabled;
    if v_devices is null then
      update public.push_outbox set status = 'skipped', last_error = 'no_active_devices'
      where id = v_row.id;
      continue;
    end if;

    update public.push_outbox
    set status = 'sending', attempts = attempts + 1, claimed_at = timezone('utc', now()), last_error = null
    where id = v_row.id;
    outbox_id := v_row.id; tenant_id := v_row.tenant_id; user_id := v_row.user_id;
    notification_id := v_row.notification_id; source_type := v_row.source_type;
    ticket_id := v_ticket_id; contract_id := v_contract_id; kind := v_kind;
    ticket_number := v_ticket_number; subject := v_subject; delivery_mode := v_mode; devices := v_devices;
    return next;
  end loop;
end;
$$;
revoke all on function public.push_claim_outbox_v2(integer) from public, anon, authenticated;
grant execute on function public.push_claim_outbox_v2(integer) to service_role;

-- Alte Dispatcher können während eines Rolling Deployments weiterlaufen. Die
-- kompatible V1 beansprucht deshalb ausschliesslich sofort zustellbare Ticket-
-- Hinweise, wendet aber bereits globale Pause und Kategorien an. Zusammenfass-
-- ungen, Ruhezeit und Arbeitsfenster bleiben pendent für V2; Contract-Zeilen
-- bleiben vollständig unberührt.
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
  v_devices jsonb;
  v_category text;
  v_mode text;
  v_global_enabled boolean;
  v_modes jsonb;
  v_enabled_categories text[];
  v_quiet_enabled boolean;
  v_quiet_start smallint;
  v_quiet_end smallint;
  v_timezone text;
  v_local_hour integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'invalid_push_claim_limit' using errcode = '22023';
  end if;
  for v_row in
    select outbox.*
    from public.push_outbox outbox
    where outbox.source_type = 'ticket'
      and outbox.available_at <= timezone('utc', now())
      and outbox.attempts < 3
      and (outbox.status = 'pending' or (
        outbox.status = 'sending'
        and outbox.claimed_at < timezone('utc', now()) - interval '5 minutes'
      ))
    order by outbox.available_at, outbox.created_at, outbox.id
    for update skip locked
    limit p_limit
  loop
    if not public.push_tenant_feature_enabled(v_row.tenant_id)
      or not exists (
        select 1 from public.tenant_memberships membership
        where membership.tenant_id = v_row.tenant_id
          and membership.user_id = v_row.user_id
          and membership.status = 'active'
      ) then
      update public.push_outbox set status = 'skipped', last_error = 'authorization_unavailable'
      where id = v_row.id;
      continue;
    end if;
    select notification.ticket_id, notification.kind, ticket.ticket_number, ticket.subject,
           feature.configuration ->> 'contentLevel' as content_level
    into v_ticket
    from public.ticket_notifications notification
    join public.tickets ticket on ticket.id = notification.ticket_id
    join public.tenant_feature_flags feature
      on feature.tenant_id = notification.tenant_id
      and feature.feature_key = 'notifications.push'
    where notification.id = v_row.notification_id
      and notification.tenant_id = v_row.tenant_id;
    if not found then
      update public.push_outbox set status = 'skipped', last_error = 'ticket_unavailable'
      where id = v_row.id;
      continue;
    end if;
    v_category := public.push_notification_category(v_ticket.kind);
    if v_category is null then
      update public.push_outbox set status = 'skipped', last_error = 'unsupported_kind'
      where id = v_row.id;
      continue;
    end if;
    select preference.global_enabled, preference.category_modes, preference.enabled_categories,
           preference.quiet_hours_enabled, preference.quiet_start, preference.quiet_end,
           preference.timezone
    into v_global_enabled, v_modes, v_enabled_categories, v_quiet_enabled,
         v_quiet_start, v_quiet_end, v_timezone
    from public.push_preferences preference
    where preference.tenant_id = v_row.tenant_id and preference.user_id = v_row.user_id;
    v_global_enabled := coalesce(v_global_enabled, true);
    v_modes := coalesce(v_modes, '{}'::jsonb);
    v_enabled_categories := coalesce(v_enabled_categories, array[
      'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
      'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline'
    ]::text[]);
    v_mode := public.push_delivery_mode(v_modes, v_enabled_categories, v_category);
    if not v_global_enabled or v_mode = 'off' then
      update public.push_outbox
      set status = 'skipped', last_error = case when v_global_enabled then 'preference_disabled' else 'global_disabled' end
      where id = v_row.id;
      continue;
    end if;
    if v_mode = 'summary' then
      update public.push_outbox
      set available_at = timezone('utc', now()) + interval '15 minutes', last_error = 'deferred_summary'
      where id = v_row.id;
      continue;
    end if;
    begin
      if not coalesce((public.push_work_state(v_row.tenant_id, v_row.user_id) ->> 'active')::boolean, false) then
        update public.push_outbox
        set available_at = timezone('utc', now()) + interval '15 minutes', last_error = 'deferred_off_shift'
        where id = v_row.id;
        continue;
      end if;
    exception when others then
      update public.push_outbox
      set available_at = timezone('utc', now()) + interval '15 minutes', last_error = 'deferred_off_shift'
      where id = v_row.id;
      continue;
    end;
    v_quiet_enabled := coalesce(v_quiet_enabled, false);
    v_quiet_start := coalesce(v_quiet_start, 22);
    v_quiet_end := coalesce(v_quiet_end, 7);
    v_timezone := coalesce(v_timezone, 'Europe/Zurich');
    begin
      v_local_hour := extract(hour from timezone(v_timezone, now()))::integer;
      if v_quiet_enabled and v_quiet_start <> v_quiet_end and (case
        when v_quiet_start < v_quiet_end then v_local_hour >= v_quiet_start and v_local_hour < v_quiet_end
        else v_local_hour >= v_quiet_start or v_local_hour < v_quiet_end
      end) then
        update public.push_outbox
        set available_at = timezone('utc', now()) + interval '15 minutes', last_error = 'deferred_quiet_hours'
        where id = v_row.id;
        continue;
      end if;
    exception when others then
      null;
    end;
    select jsonb_agg(jsonb_build_object(
      'id', device.id, 'token', device.apns_token, 'environment', device.apns_environment
    ) order by device.created_at)
    into v_devices
    from public.push_devices device
    where device.tenant_id = v_row.tenant_id and device.user_id = v_row.user_id and device.enabled;
    if v_devices is null then
      update public.push_outbox set status = 'skipped', last_error = 'no_active_devices'
      where id = v_row.id;
      continue;
    end if;
    update public.push_outbox
    set status = 'sending', attempts = attempts + 1, claimed_at = timezone('utc', now()), last_error = null
    where id = v_row.id;
    outbox_id := v_row.id; tenant_id := v_row.tenant_id; user_id := v_row.user_id;
    notification_id := v_row.notification_id; ticket_id := v_ticket.ticket_id;
    kind := v_ticket.kind; ticket_number := v_ticket.ticket_number;
    subject := case when coalesce(v_ticket.content_level, 'minimal') = 'subject' then v_ticket.subject else null end;
    devices := v_devices; quiet_hours := false;
    return next;
  end loop;
end;
$$;
revoke all on function public.push_claim_outbox(integer) from public, anon, authenticated;
grant execute on function public.push_claim_outbox(integer) to service_role;

-- Ein periodischer Weckruf stellt sicher, dass zurückgestellte und nach einem
-- transienten APNs-Fehler pendente Hinweise auch ohne neues Ereignis erneut
-- beansprucht werden. Das Geheimnis bleibt ausschliesslich im privaten Schema.
create or replace function push_private.wake_push_dispatch()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, push_private, pg_temp
as $$
declare
  v_url text;
  v_secret text;
begin
  select config.function_url, config.dispatch_secret
  into v_url, v_secret
  from push_private.dispatch_config config where config.singleton;
  if v_url is null or v_secret is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return;
  end if;
  execute 'select net.http_post($1, $2, $3, $4, $5)'
    using v_url, '{}'::jsonb, '{}'::jsonb,
      jsonb_build_object('Content-Type', 'application/json', 'x-nextdesk-push-secret', v_secret), 15000;
exception when others then
  return;
end;
$$;
revoke all on function push_private.wake_push_dispatch() from public, anon, authenticated;
grant execute on function push_private.wake_push_dispatch() to service_role;

-- Der Datenbankplan ist application-native, idempotent und wird erst mit der
-- bewussten Produktivmigration wirksam. Ohne pg_cron bleibt der Code verfügbar,
-- startet jedoch keinen stillen Ersatzscheduler.
do $$
declare v_job bigint;
begin
  if to_regnamespace('cron') is null then return; end if;
  for v_job in select jobid from cron.job where jobname in (
    'nextdesk-contract-deadline-notifications-v1', 'nextdesk-push-dispatch-reconciler-v1'
  ) loop perform cron.unschedule(v_job); end loop;
  perform cron.schedule(
    'nextdesk-contract-deadline-notifications-v1',
    '15 6 * * *',
    'select public.materialize_contract_deadline_push_events(); select push_private.wake_push_dispatch();'
  );
  perform cron.schedule(
    'nextdesk-push-dispatch-reconciler-v1',
    '*/5 * * * *',
    'select push_private.wake_push_dispatch();'
  );
exception when others then
  null;
end;
$$;

comment on table public.contract_deadline_push_events is
  'Private, idempotente und neutrale Vertragsfrist-Events; weder Vertragsdetails noch Browserzugriff.';
comment on function public.materialize_contract_deadline_push_events() is
  'Materialisiert ausschliesslich neutrale, idempotente Vertragsfristhinweise ohne Vertrags- oder Ticketmutation.';

commit;
