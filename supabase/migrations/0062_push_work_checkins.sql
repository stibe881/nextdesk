begin;

set local search_path = pg_catalog, public;

-- Die bestehende Push-Konfiguration bleibt erweiterbar, damit Arbeitszeitwerte
-- neben dem bereits verwendeten Inhaltsniveau gespeichert werden können.
alter table public.tenant_feature_flags
  drop constraint if exists tenant_feature_flags_push_configuration_valid;
alter table public.tenant_feature_flags
  add constraint tenant_feature_flags_push_configuration_valid
  check (
    feature_key <> 'notifications.push'
    or (
      configuration ? 'contentLevel'
      and configuration ->> 'contentLevel' in ('minimal', 'subject')
      and (
        configuration - 'contentLevel' - 'checkInRequired' - 'workStartHour' - 'workEndHour'
      ) = '{}'::jsonb
    )
  );

-- Ein Datensatz hält den Check-in-Zustand einer Person für genau einen lokalen
-- Arbeitstag. Das zusammengesetzte Fremdschlüsselpaar bindet ihn an die
-- Mitgliedschaft im selben Mandanten.
create table public.push_work_checkins (
  tenant_id uuid not null,
  user_id uuid not null,
  work_date date not null,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  declined_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, user_id, work_date),
  constraint push_work_checkins_membership_fk
    foreign key (tenant_id, user_id)
    references public.tenant_memberships (tenant_id, user_id)
    on delete cascade
);

alter table public.push_work_checkins enable row level security;
alter table public.push_work_checkins force row level security;

revoke all on table public.push_work_checkins from public, anon, authenticated;
grant select on table public.push_work_checkins to authenticated;
grant select, insert, update, delete on table public.push_work_checkins to service_role;

create policy push_work_checkins_select_own on public.push_work_checkins
  for select to authenticated
  using (user_id = auth.uid());
create policy push_work_checkins_service_role_only on public.push_work_checkins
  for all to service_role using (true) with check (true);

create trigger push_work_checkins_updated_at before update on public.push_work_checkins
  for each row execute function public.set_updated_at();

-- Ungültige oder unvollständige gespeicherte Werte werden bewusst auf die
-- Vertragsstandards zurückgeführt, damit die Auslieferung fail-closed bleibt.
create or replace function public.push_work_state(p_tenant_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_configuration jsonb;
  v_required boolean := true;
  v_start_hour integer := 6;
  v_end_hour integer := 17;
  v_timezone text := 'Europe/Zurich';
  v_local_timestamp timestamp without time zone;
  v_local_date date;
  v_local_hour integer;
  v_within_window boolean;
  v_checked_in_at timestamptz;
  v_checked_out_at timestamptz;
  v_declined_at timestamptz;
  v_checked_in boolean;
  v_active boolean;
begin
  select flag.configuration
  into v_configuration
  from public.tenant_feature_flags flag
  where flag.tenant_id = p_tenant_id
    and flag.feature_key = 'notifications.push';
  v_configuration := coalesce(v_configuration, '{}'::jsonb);

  if jsonb_typeof(v_configuration -> 'checkInRequired') = 'boolean' then
    v_required := (v_configuration ->> 'checkInRequired')::boolean;
  end if;
  if jsonb_typeof(v_configuration -> 'workStartHour') = 'number'
     and v_configuration ->> 'workStartHour' ~ '^(0|1[0-9]|2[0-3])$' then
    v_start_hour := (v_configuration ->> 'workStartHour')::integer;
  end if;
  if jsonb_typeof(v_configuration -> 'workEndHour') = 'number'
     and v_configuration ->> 'workEndHour' ~ '^([1-9]|1[0-9]|2[0-4])$' then
    v_end_hour := (v_configuration ->> 'workEndHour')::integer;
  end if;
  if v_end_hour <= v_start_hour then
    v_start_hour := 6;
    v_end_hour := 17;
  end if;

  select preference.timezone
  into v_timezone
  from public.push_preferences preference
  where preference.tenant_id = p_tenant_id
    and preference.user_id = p_user_id;
  v_timezone := coalesce(v_timezone, 'Europe/Zurich');
  begin
    v_local_timestamp := timezone(v_timezone, now());
  exception when others then
    v_timezone := 'Europe/Zurich';
    v_local_timestamp := timezone(v_timezone, now());
  end;

  v_local_date := v_local_timestamp::date;
  v_local_hour := extract(hour from v_local_timestamp)::integer;
  v_within_window := v_local_hour >= v_start_hour and v_local_hour < v_end_hour;

  select checkin.checked_in_at, checkin.checked_out_at, checkin.declined_at
  into v_checked_in_at, v_checked_out_at, v_declined_at
  from public.push_work_checkins checkin
  where checkin.tenant_id = p_tenant_id
    and checkin.user_id = p_user_id
    and checkin.work_date = v_local_date;

  v_checked_in := v_checked_in_at is not null and v_checked_out_at is null;
  v_active := not v_required or (v_within_window and v_checked_in);

  return jsonb_build_object(
    'required', v_required,
    'startHour', v_start_hour,
    'endHour', v_end_hour,
    'timezone', v_timezone,
    'localDate', to_char(v_local_date, 'YYYY-MM-DD'),
    'localHour', v_local_hour,
    'withinWindow', v_within_window,
    'checkedInAt', v_checked_in_at,
    'checkedOutAt', v_checked_out_at,
    'declinedAt', v_declined_at,
    'checkedIn', v_checked_in,
    'active', v_active
  );
end;
$$;
revoke all on function public.push_work_state(uuid, uuid) from public, anon, authenticated;
grant execute on function public.push_work_state(uuid, uuid) to service_role;

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

    begin
      if not coalesce(
        (public.push_work_state(v_row.tenant_id, v_row.user_id) ->> 'active')::boolean,
        false
      ) then
        update public.push_outbox
        set status = 'skipped', last_error = 'off_shift'
        where id = v_row.id;
        continue;
      end if;
    exception when others then
      update public.push_outbox
      set status = 'skipped', last_error = 'off_shift'
      where id = v_row.id;
      continue;
    end;

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

comment on table public.push_work_checkins is
  'Tagesbezogener Push-Check-in je Mandant und Person; Browserrollen dürfen nur eigene Zeilen lesen.';
comment on function public.push_work_state(uuid, uuid) is
  'Ermittelt Arbeitsfenster, lokalen Tageszustand und Push-Aktivität ausschliesslich für service_role.';
comment on function public.push_claim_outbox(integer) is
  'Ausschliesslich service_role: reserviert auslieferbare Push-Outbox-Einträge mit SKIP LOCKED und prüft Mitgliedschaft sowie Feature erneut.';

commit;
