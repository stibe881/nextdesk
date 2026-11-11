begin;
set local search_path = pg_catalog, public;

-- Statusseite, Dienste und Wartung:
-- 1. Störungsmeldungen: service_incident_notices (Portal-Banner) werden zu
--    öffentlichen Störungsmeldungen mit Diensten, Zustand, Verlauf der
--    Updates und optionaler Monitoring-Störung. Jede neue Meldung und jedes
--    Update einer veröffentlichten Meldung geht an bestätigte Abonnenten.
-- 18. Wartungsfenster setzen ihre Dienste automatisch auf «Wartung» und
--    danach zurück (Cron alle 5 Minuten), mit je einer Mail bei Beginn/Ende.
-- 36. asset_services ist die Quelle der Dienst-Zuordnung von Geräten;
--    assets.service_id bleibt per Trigger der «erste Dienst».
-- 42. Verfügbarkeit pro Dienst aus service_status_events.
-- 16. Netzwerk-Abhängigkeiten eines Dienstes (Geräte, IPAM, Monitoring).
-- 45. Wartungsfenster ↔ Serviceaufgaben ↔ Wartungsprotokoll der Geräte.

-- ---------------------------------------------------------------------------
-- 1. Störungsmeldungen
-- ---------------------------------------------------------------------------
alter table public.service_incident_notices
  add column if not exists monitoring_incident_id uuid
    references public.monitoring_incidents(id) on delete set null,
  add column if not exists public_enabled boolean not null default false;

create index if not exists service_incident_notices_monitoring_idx
  on public.service_incident_notices (tenant_id, monitoring_incident_id)
  where monitoring_incident_id is not null;
create index if not exists service_incident_notices_public_idx
  on public.service_incident_notices (tenant_id, starts_at desc)
  where public_enabled;

create table if not exists public.service_incident_notice_services (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  notice_id uuid not null,
  service_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (notice_id, service_id),
  constraint service_incident_notice_services_notice_fk
    foreign key (notice_id, tenant_id)
    references public.service_incident_notices (id, tenant_id) on delete cascade,
  constraint service_incident_notice_services_service_fk
    foreign key (service_id, tenant_id)
    references public.services (id, tenant_id) on delete cascade
);
create index if not exists service_incident_notice_services_service_idx
  on public.service_incident_notice_services (tenant_id, service_id);

create table if not exists public.service_incident_notice_updates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  notice_id uuid not null,
  status text not null
    check (status in ('investigating', 'identified', 'monitoring', 'resolved')),
  title text not null check (char_length(btrim(title)) between 1 and 240),
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint service_incident_notice_updates_id_tenant_unique unique (id, tenant_id),
  constraint service_incident_notice_updates_notice_fk
    foreign key (notice_id, tenant_id)
    references public.service_incident_notices (id, tenant_id) on delete cascade
);
create index if not exists service_incident_notice_updates_notice_idx
  on public.service_incident_notice_updates (tenant_id, notice_id, created_at desc);

alter table public.service_incident_notice_services enable row level security;
alter table public.service_incident_notice_updates enable row level security;
revoke all on table public.service_incident_notice_services,
  public.service_incident_notice_updates from public, anon, authenticated;
grant select, insert, update, delete on table public.service_incident_notice_services,
  public.service_incident_notice_updates to service_role;

-- resolved_at folgt dem Zustand; die Monitoring-Störung muss zum Mandanten
-- gehören.
create or replace function public.service_incident_notice_normalize()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.status = 'resolved' then
    new.resolved_at := coalesce(new.resolved_at, timezone('utc', now()));
  else
    new.resolved_at := null;
  end if;
  if new.monitoring_incident_id is not null and not exists (
    select 1 from public.monitoring_incidents incident
    where incident.id = new.monitoring_incident_id
      and incident.tenant_id = new.tenant_id
  ) then
    raise exception 'Monitoring incident does not belong to the tenant'
      using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function public.service_incident_notice_normalize() from public, anon, authenticated;

create or replace trigger service_incident_notices_normalize
  before insert or update on public.service_incident_notices
  for each row execute function public.service_incident_notice_normalize();

-- Jede neue Meldung und jede Änderung von Zustand/Text ist ein Update im
-- Verlauf, egal über welchen Weg (Arbeitsplatz, Statusseite, Störung).
create or replace function public.service_incident_notice_record_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT'
     or new.status is distinct from old.status
     or new.description is distinct from old.description
     or new.title is distinct from old.title
     or (new.public_enabled and not old.public_enabled) then
    insert into public.service_incident_notice_updates (
      tenant_id, notice_id, status, title, body, created_by
    ) values (
      new.tenant_id, new.id, new.status, btrim(new.title), btrim(new.description),
      coalesce(new.updated_by, new.created_by)
    );
  end if;
  return null;
end;
$$;
revoke all on function public.service_incident_notice_record_update() from public, anon, authenticated;

create or replace trigger service_incident_notices_record_update
  after insert or update on public.service_incident_notices
  for each row execute function public.service_incident_notice_record_update();

-- Mails an Abonnenten: Meldungs-Update bzw. Beginn/Ende eines Wartungsfensters.
alter table public.mail_messages
  add column if not exists service_incident_update_id uuid
    references public.service_incident_notice_updates(id) on delete cascade,
  add column if not exists service_status_maintenance_id uuid
    references public.service_status_maintenances(id) on delete cascade,
  add column if not exists maintenance_phase text
    check (maintenance_phase is null or maintenance_phase in ('start', 'end'));

create unique index if not exists mail_messages_status_incident_unique
  on public.mail_messages (service_incident_update_id, status_subscription_id)
  where service_incident_update_id is not null;
create unique index if not exists mail_messages_status_maintenance_unique
  on public.mail_messages (service_status_maintenance_id, maintenance_phase, status_subscription_id)
  where service_status_maintenance_id is not null;

create or replace function public.service_incident_update_notify_subscribers()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_channel record;
begin
  if not exists (
       select 1 from public.service_incident_notices notice
       where notice.id = new.notice_id
         and notice.tenant_id = new.tenant_id
         and notice.public_enabled
     )
     or not exists (
       select 1 from public.service_status_pages page
       where page.tenant_id = new.tenant_id and page.public_enabled
     ) then
    return null;
  end if;
  select * into v_channel from public.service_status_mail_channel(new.tenant_id);
  if v_channel.id is null then
    return null;
  end if;
  insert into public.mail_messages (
    tenant_id, channel_id, exchange_configuration_version, direction, kind,
    status_subscription_id, service_incident_update_id, from_address,
    to_addresses, subject
  )
  select
    new.tenant_id, v_channel.id, v_channel.configuration_version, 'outbound',
    'status_change', subscription.id, new.id, v_channel.mailbox_address,
    array[subscription.email], null
  from public.service_status_subscriptions subscription
  where subscription.tenant_id = new.tenant_id
    and subscription.confirmed_at is not null
  order by subscription.created_at
  limit 5000
  on conflict do nothing;
  return null;
exception when others then
  -- E-Mail ist ein Zusatz: die Meldung selbst nie blockieren.
  return null;
end;
$$;
revoke all on function public.service_incident_update_notify_subscribers() from public, anon, authenticated;

create or replace trigger service_incident_notice_updates_notify_subscribers
  after insert on public.service_incident_notice_updates
  for each row execute function public.service_incident_update_notify_subscribers();

-- Meldung anlegen oder aktualisieren, mit Diensten, als eine Transaktion.
-- p_title/p_public_enabled/p_service_ids = null behalten beim Update den Wert.
create or replace function public.save_service_incident_notice(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_notice_id uuid,
  p_title text,
  p_body text,
  p_status text,
  p_public_enabled boolean,
  p_service_ids uuid[],
  p_monitoring_incident_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_id uuid;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_body text := btrim(coalesce(p_body, ''));
begin
  if p_actor_id is null or p_tenant_id is null then
    raise exception 'Actor and tenant are required' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('investigating', 'identified', 'monitoring', 'resolved') then
    raise exception 'Invalid incident state' using errcode = '22023';
  end if;
  if char_length(v_body) not between 3 and 10000 then
    raise exception 'Incident text must contain between 3 and 10000 characters' using errcode = '22023';
  end if;
  if v_title is not null and char_length(v_title) not between 3 and 240 then
    raise exception 'Incident title must contain between 3 and 240 characters' using errcode = '22023';
  end if;
  if p_service_ids is not null then
    if array_position(p_service_ids, null) is not null
       or cardinality(p_service_ids) > 100
       or (select count(distinct id) from unnest(p_service_ids) id) <> cardinality(p_service_ids) then
      raise exception 'Invalid service list' using errcode = '22023';
    end if;
    if (
      select count(*) from public.services service
      where service.tenant_id = p_tenant_id and service.id = any(p_service_ids)
    ) <> cardinality(p_service_ids) then
      raise exception 'Service does not exist for this tenant' using errcode = '23503';
    end if;
  end if;

  if p_notice_id is null then
    if v_title is null then
      raise exception 'Incident title is required' using errcode = '22023';
    end if;
    insert into public.service_incident_notices (
      tenant_id, title, description, status, created_by, updated_by,
      monitoring_incident_id, public_enabled
    ) values (
      p_tenant_id, v_title, v_body, p_status, p_actor_id, p_actor_id,
      p_monitoring_incident_id, coalesce(p_public_enabled, true)
    )
    returning id into v_id;
  else
    update public.service_incident_notices notice
       set title = coalesce(v_title, notice.title),
           description = v_body,
           status = p_status,
           public_enabled = coalesce(p_public_enabled, notice.public_enabled),
           updated_by = p_actor_id
     where notice.id = p_notice_id and notice.tenant_id = p_tenant_id
    returning notice.id into v_id;
    if v_id is null then
      raise exception 'Incident message does not exist for this tenant' using errcode = 'P0002';
    end if;
  end if;

  if p_service_ids is not null then
    delete from public.service_incident_notice_services
     where notice_id = v_id and not (service_id = any(p_service_ids));
    insert into public.service_incident_notice_services (tenant_id, notice_id, service_id)
    select p_tenant_id, v_id, requested.id
    from unnest(p_service_ids) requested(id)
    on conflict (notice_id, service_id) do nothing;
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_service_incident_notice(uuid, uuid, uuid, text, text, text, boolean, uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.save_service_incident_notice(uuid, uuid, uuid, text, text, text, boolean, uuid[], uuid)
  to service_role;

-- Statusänderungen durch die Wartungsautomatik lösen keine Einzelmails pro
-- Dienst aus (nextdesk.suppress_status_mail); dafür gibt es je Fenster eine
-- Mail bei Beginn und Ende. Sonst unverändert gegenüber 0272.
create or replace function public.service_status_notify_subscribers()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_channel record;
begin
  if coalesce(current_setting('nextdesk.suppress_status_mail', true), '') = 'on' then
    return null;
  end if;
  if not exists (
       select 1 from public.services service
       where service.id = new.service_id
         and service.tenant_id = new.tenant_id
         and service.active
         and service.status_public
     )
     or not exists (
       select 1 from public.service_status_pages page
       where page.tenant_id = new.tenant_id and page.public_enabled
     )
     -- Erste Erfassung eines Dienstes ist keine Änderung.
     or not exists (
       select 1 from public.service_status_events previous
       where previous.service_id = new.service_id
         and previous.tenant_id = new.tenant_id
         and previous.id <> new.id
         and previous.changed_at <= new.changed_at
     ) then
    return null;
  end if;

  select * into v_channel from public.service_status_mail_channel(new.tenant_id);
  if v_channel.id is null then
    return null;
  end if;

  insert into public.mail_messages (
    tenant_id, channel_id, exchange_configuration_version, direction, kind,
    status_subscription_id, service_status_event_id, from_address,
    to_addresses, subject
  )
  select
    new.tenant_id, v_channel.id, v_channel.configuration_version, 'outbound',
    'status_change', subscription.id, new.id, v_channel.mailbox_address,
    array[subscription.email], null
  from public.service_status_subscriptions subscription
  where subscription.tenant_id = new.tenant_id
    and subscription.confirmed_at is not null
  order by subscription.created_at
  limit 5000
  on conflict do nothing;
  return null;
exception when others then
  -- E-Mail ist ein Zusatz: die Statusänderung selbst nie blockieren.
  return null;
end;
$$;
revoke all on function public.service_status_notify_subscribers() from public, anon, authenticated;

create or replace function public.service_status_enqueue_maintenance_mail(
  p_tenant_id uuid,
  p_maintenance_id uuid,
  p_phase text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_channel record;
  v_count integer := 0;
begin
  if p_phase not in ('start', 'end') or not exists (
       select 1 from public.service_status_pages page
       where page.tenant_id = p_tenant_id and page.public_enabled
     ) or not exists (
       select 1 from public.service_status_maintenances maintenance
       where maintenance.id = p_maintenance_id
         and maintenance.tenant_id = p_tenant_id
         and maintenance.public_enabled
     ) then
    return 0;
  end if;
  select * into v_channel from public.service_status_mail_channel(p_tenant_id);
  if v_channel.id is null then
    return 0;
  end if;
  insert into public.mail_messages (
    tenant_id, channel_id, exchange_configuration_version, direction, kind,
    status_subscription_id, service_status_maintenance_id, maintenance_phase,
    from_address, to_addresses, subject
  )
  select
    p_tenant_id, v_channel.id, v_channel.configuration_version, 'outbound',
    'status_change', subscription.id, p_maintenance_id, p_phase,
    v_channel.mailbox_address, array[subscription.email], null
  from public.service_status_subscriptions subscription
  where subscription.tenant_id = p_tenant_id
    and subscription.confirmed_at is not null
  order by subscription.created_at
  limit 5000
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
exception when others then
  return 0;
end;
$$;
revoke all on function public.service_status_enqueue_maintenance_mail(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.service_status_enqueue_maintenance_mail(uuid, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 18. / 45. Wartungsfenster automatisch, Verknüpfungen
-- ---------------------------------------------------------------------------
alter table public.service_status_maintenances
  add column if not exists auto_started_at timestamptz,
  add column if not exists auto_ended_at timestamptz,
  add column if not exists maintenance_logged_at timestamptz,
  add column if not exists service_task_occurrence_id uuid
    references public.service_task_occurrences(id) on delete set null;

create index if not exists service_status_maintenances_auto_start_idx
  on public.service_status_maintenances (starts_at)
  where auto_started_at is null and state in ('scheduled', 'active');
create index if not exists service_status_maintenances_auto_end_idx
  on public.service_status_maintenances (ends_at)
  where auto_started_at is not null and auto_ended_at is null;
create index if not exists service_status_maintenances_occurrence_idx
  on public.service_status_maintenances (tenant_id, service_task_occurrence_id)
  where service_task_occurrence_id is not null;

alter table public.service_status_maintenance_services
  add column if not exists previous_status text
    check (previous_status is null or previous_status in (
      'operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'
    )),
  add column if not exists applied_at timestamptz,
  add column if not exists restored_at timestamptz;

create index if not exists service_status_maintenance_services_applied_idx
  on public.service_status_maintenance_services (tenant_id, service_id)
  where applied_at is not null and restored_at is null;

alter table public.asset_maintenance_log
  add column if not exists maintenance_id uuid
    references public.service_status_maintenances(id) on delete set null;

-- Beginn: Dienste auf «maintenance» (vorherigen Status merken). Ende (Zeit
-- abgelaufen oder Fenster abgeschlossen/abgesagt): nur zurücksetzen, wenn der
-- Dienst noch «maintenance» ist und kein anderes laufendes Fenster ihn hält.
-- Danach Eintrag im Wartungsprotokoll der verknüpften Geräte (sofern das
-- Fenster nicht aus einer Serviceaufgabe stammt – deren Abschluss protokolliert
-- bereits) und je eine Mail an Abonnenten bei Beginn und Ende.
create or replace function public.service_status_maintenance_run(
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_window record;
  v_link record;
  v_started integer := 0;
  v_ended integer := 0;
  v_logged integer := 0;
  v_rows integer;
  v_actor uuid;
begin
  perform set_config('nextdesk.suppress_status_mail', 'on', true);

  for v_window in
    select maintenance.*
    from public.service_status_maintenances maintenance
    where maintenance.auto_started_at is null
      and maintenance.state in ('scheduled', 'active')
      and maintenance.starts_at <= v_now
      and maintenance.ends_at > v_now
    order by maintenance.starts_at, maintenance.id
    limit 200
    for update skip locked
  loop
    for v_link in
      select link.service_id, service.status
      from public.service_status_maintenance_services link
      join public.services service
        on service.id = link.service_id and service.tenant_id = link.tenant_id
      where link.maintenance_id = v_window.id
      order by link.service_id
      for update of service
    loop
      update public.service_status_maintenance_services
         set previous_status = case when v_link.status = 'maintenance' then null else v_link.status end,
             applied_at = v_now,
             restored_at = null
       where maintenance_id = v_window.id and service_id = v_link.service_id;
      if v_link.status <> 'maintenance' then
        update public.services
           set status = 'maintenance'
         where id = v_link.service_id and tenant_id = v_window.tenant_id;
      end if;
    end loop;
    update public.service_status_maintenances
       set state = 'active', auto_started_at = v_now
     where id = v_window.id;
    if v_window.public_enabled then
      perform public.service_status_enqueue_maintenance_mail(v_window.tenant_id, v_window.id, 'start');
    end if;
    v_started := v_started + 1;
  end loop;

  for v_window in
    select maintenance.*
    from public.service_status_maintenances maintenance
    where maintenance.auto_started_at is not null
      and maintenance.auto_ended_at is null
      and (maintenance.ends_at <= v_now or maintenance.state in ('completed', 'cancelled'))
    order by maintenance.ends_at, maintenance.id
    limit 200
    for update skip locked
  loop
    for v_link in
      select link.service_id, link.previous_status
      from public.service_status_maintenance_services link
      where link.maintenance_id = v_window.id
        and link.applied_at is not null
        and link.restored_at is null
      order by link.service_id
    loop
      -- Ein anderes, weiterhin laufendes Fenster hält den Dienst: es übernimmt
      -- den gemerkten Status und setzt ihn an seinem Ende zurück.
      update public.service_status_maintenance_services other
         set previous_status = coalesce(other.previous_status, v_link.previous_status)
        from public.service_status_maintenances other_window
       where other.service_id = v_link.service_id
         and other.maintenance_id <> v_window.id
         and other.applied_at is not null
         and other.restored_at is null
         and other_window.id = other.maintenance_id
         and other_window.auto_ended_at is null
         and other_window.ends_at > v_now
         and other_window.state in ('scheduled', 'active');
      get diagnostics v_rows = row_count;
      if v_rows = 0 and v_link.previous_status is not null then
        update public.services
           set status = v_link.previous_status
         where id = v_link.service_id
           and tenant_id = v_window.tenant_id
           and status = 'maintenance';
      end if;
      update public.service_status_maintenance_services
         set restored_at = v_now
       where maintenance_id = v_window.id and service_id = v_link.service_id;
    end loop;

    update public.service_status_maintenances
       set auto_ended_at = v_now,
           state = case when state in ('scheduled', 'active') then 'completed' else state end
     where id = v_window.id;
    if v_window.public_enabled then
      perform public.service_status_enqueue_maintenance_mail(v_window.tenant_id, v_window.id, 'end');
    end if;
    v_ended := v_ended + 1;

    if v_window.state <> 'cancelled'
       and v_window.service_task_occurrence_id is null
       and v_window.maintenance_logged_at is null then
      select profile.id into v_actor
      from public.user_profiles profile
      where profile.id = coalesce(v_window.updated_by, v_window.created_by);
      insert into public.asset_maintenance_log (
        tenant_id, asset_id, performed_on, kind, note, actor_id, maintenance_id
      )
      select
        link.tenant_id,
        link.asset_id,
        (least(v_window.ends_at, v_now) at time zone 'Europe/Zurich')::date,
        'maintenance',
        left('Wartungsfenster «' || btrim(v_window.title) || '» abgeschlossen', 2000),
        v_actor,
        v_window.id
      from public.service_status_maintenance_assets link
      where link.maintenance_id = v_window.id
        and link.tenant_id = v_window.tenant_id;
      get diagnostics v_rows = row_count;
      v_logged := v_logged + v_rows;
      update public.asset_infrastructure infra
         set last_maintenance_on = greatest(
               coalesce(infra.last_maintenance_on, date '2000-01-01'),
               (least(v_window.ends_at, v_now) at time zone 'Europe/Zurich')::date
             ),
             updated_at = timezone('utc', now())
        from public.service_status_maintenance_assets link
       where link.maintenance_id = v_window.id
         and infra.asset_id = link.asset_id;
      update public.service_status_maintenances
         set maintenance_logged_at = v_now
       where id = v_window.id;
    end if;
  end loop;

  perform set_config('nextdesk.suppress_status_mail', 'off', true);
  return jsonb_build_object('started', v_started, 'ended', v_ended, 'logged', v_logged);
end;
$$;
revoke all on function public.service_status_maintenance_run(timestamptz) from public, anon, authenticated;
grant execute on function public.service_status_maintenance_run(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 36. Dienst-Zuordnung: asset_services ist die Quelle
-- ---------------------------------------------------------------------------
alter table public.asset_services
  add column if not exists position integer not null default 0;
create index if not exists asset_services_asset_position_idx
  on public.asset_services (asset_id, position, created_at, service_id);

insert into public.asset_services (tenant_id, asset_id, service_id, position)
select asset.tenant_id, asset.id, asset.service_id, -1
from public.assets asset
where asset.service_id is not null
on conflict (asset_id, service_id) do nothing;

update public.asset_services link
   set position = -1
  from public.assets asset
 where asset.id = link.asset_id
   and asset.service_id = link.service_id
   and link.position >= 0;

-- Lesen nur für Mitglieder und nur für Assets, die die Person ohnehin lesen
-- darf (die Assets-RLS samt Abteilungsbereich greift in der Unterabfrage).
-- Damit filtert der Katalog seitenweise nach Dienst in SQL. Schreiben bleibt
-- service_role vorbehalten.
grant select on table public.asset_services to authenticated;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'asset_services'
      and policyname = 'asset_services_select_readable_asset'
  ) then
    create policy asset_services_select_readable_asset
      on public.asset_services for select to authenticated
      using (
        public.is_active_tenant_member(tenant_id)
        and exists (
          select 1 from public.assets asset
          where asset.id = asset_services.asset_id
            and asset.tenant_id = asset_services.tenant_id
        )
      );
  end if;
end;
$$;

comment on table public.asset_services is
  'Source of truth for the services of a device (ordered by position). assets.service_id mirrors the first service via trigger for legacy readers.';

-- asset_services → assets.service_id (erster Dienst).
create or replace function public.asset_services_sync_primary()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_asset_id uuid;
  v_first uuid;
begin
  for v_asset_id in
    select distinct affected.asset_id
    from (
      select case when tg_op = 'DELETE' then old.asset_id else new.asset_id end as asset_id
      union all
      select case when tg_op = 'UPDATE' then old.asset_id end
    ) affected
    where affected.asset_id is not null
  loop
    select link.service_id into v_first
    from public.asset_services link
    where link.asset_id = v_asset_id
    order by link.position, link.created_at, link.service_id
    limit 1;
    perform set_config('nextdesk.asset_service_sync', 'on', true);
    update public.assets
       set service_id = v_first
     where id = v_asset_id
       and service_id is distinct from v_first;
    perform set_config('nextdesk.asset_service_sync', 'off', true);
  end loop;
  return null;
end;
$$;
revoke all on function public.asset_services_sync_primary() from public, anon, authenticated;

create or replace trigger asset_services_sync_primary
  after insert or update or delete on public.asset_services
  for each row execute function public.asset_services_sync_primary();

-- Altlesende/-schreibende: wer assets.service_id direkt setzt, ersetzt den
-- bisherigen ersten Dienst in asset_services; weitere Dienste bleiben.
create or replace function public.assets_sync_service_links()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if coalesce(current_setting('nextdesk.asset_service_sync', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.service_id is not distinct from old.service_id then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.service_id is not null then
    delete from public.asset_services
     where asset_id = new.id and service_id = old.service_id;
  end if;
  if new.service_id is not null then
    insert into public.asset_services (tenant_id, asset_id, service_id, position)
    values (
      new.tenant_id,
      new.id,
      new.service_id,
      coalesce((select min(link.position) from public.asset_services link where link.asset_id = new.id), 0) - 1
    )
    on conflict (asset_id, service_id) do update set position = excluded.position;
  end if;
  return null;
end;
$$;
revoke all on function public.assets_sync_service_links() from public, anon, authenticated;

create or replace trigger assets_sync_service_links
  after insert or update of service_id on public.assets
  for each row execute function public.assets_sync_service_links();

-- Schreibweg für alle Funktionen: vollständige, geordnete Dienstliste setzen.
create or replace function public.set_asset_services(
  p_tenant_id uuid,
  p_asset_id uuid,
  p_service_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ids uuid[] := coalesce(p_service_ids, array[]::uuid[]);
begin
  if array_position(v_ids, null) is not null
     or cardinality(v_ids) > 100
     or (select count(distinct id) from unnest(v_ids) id) <> cardinality(v_ids) then
    raise exception 'Invalid service list' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.assets asset
    where asset.id = p_asset_id and asset.tenant_id = p_tenant_id
  ) then
    raise exception 'Asset does not exist for this tenant' using errcode = 'P0002';
  end if;
  if (
    select count(*) from public.services service
    where service.tenant_id = p_tenant_id and service.id = any(v_ids)
  ) <> cardinality(v_ids) then
    raise exception 'Service does not exist for this tenant' using errcode = '23503';
  end if;
  delete from public.asset_services
   where asset_id = p_asset_id
     and not (service_id = any(v_ids));
  insert into public.asset_services (tenant_id, asset_id, service_id, position)
  select p_tenant_id, p_asset_id, requested.id, requested.ordinality::integer - 1
  from unnest(v_ids) with ordinality as requested(id, ordinality)
  on conflict (asset_id, service_id) do update set position = excluded.position;
end;
$$;
revoke all on function public.set_asset_services(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.set_asset_services(uuid, uuid, uuid[]) to service_role;

-- Serviceaufgabe → Wartungsfenster: Geräte der Aufgabe und deren Dienste.
create or replace function public.service_task_maintenance_targets(
  p_tenant_id uuid,
  p_occurrence_id uuid
)
returns table (asset_id uuid, service_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select infra.asset_id, link.service_id
  from public.service_task_occurrences occurrence
  join public.asset_infrastructure infra
    on infra.service_task_template_id = occurrence.template_id
   and infra.tenant_id = occurrence.tenant_id
  left join public.asset_services link
    on link.asset_id = infra.asset_id and link.tenant_id = infra.tenant_id
  where occurrence.tenant_id = p_tenant_id
    and occurrence.id = p_occurrence_id
  order by infra.asset_id, link.position, link.service_id;
$$;
revoke all on function public.service_task_maintenance_targets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.service_task_maintenance_targets(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 42. Verfügbarkeit pro Dienst
-- ---------------------------------------------------------------------------
alter table public.service_status_pages
  add column if not exists show_availability boolean not null default false;

-- operational und maintenance gelten als verfügbar; Wartung wird separat
-- ausgewiesen. Gezählt wird ab dem ersten bekannten Status (Basis vor dem
-- Zeitraum bzw. erstes Ereignis im Zeitraum).
create or replace function public.service_status_availability(
  p_tenant_id uuid,
  p_service_ids uuid[],
  p_since timestamptz,
  p_until timestamptz default null
)
returns table (
  service_id uuid,
  observed_seconds numeric,
  available_seconds numeric,
  maintenance_seconds numeric,
  outage_seconds numeric,
  availability_percent numeric,
  availability_without_maintenance_percent numeric
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with bounds as (
    select p_since as since, least(coalesce(p_until, timezone('utc', now())), timezone('utc', now())) as until
  ),
  requested as (
    select service.id
    from public.services service
    where service.tenant_id = p_tenant_id
      and service.id = any(coalesce(p_service_ids, array[]::uuid[]))
  ),
  baseline as (
    select distinct on (event.service_id)
      event.service_id, event.status, bounds.since as changed_at, 0 as ordinal, event.id
    from public.service_status_events event, bounds
    where event.tenant_id = p_tenant_id
      and event.service_id in (select id from requested)
      and event.changed_at < bounds.since
    order by event.service_id, event.changed_at desc, event.id desc
  ),
  in_range as (
    select event.service_id, event.status, event.changed_at, 1 as ordinal, event.id
    from public.service_status_events event, bounds
    where event.tenant_id = p_tenant_id
      and event.service_id in (select id from requested)
      and event.changed_at >= bounds.since
      and event.changed_at < bounds.until
  ),
  segments as (
    select
      combined.service_id,
      combined.status,
      greatest(
        extract(epoch from (
          coalesce(
            lead(combined.changed_at) over (
              partition by combined.service_id
              order by combined.changed_at, combined.ordinal, combined.id
            ),
            (select until from bounds)
          ) - combined.changed_at
        )),
        0
      )::numeric as seconds
    from (select * from baseline union all select * from in_range) combined
  ),
  totals as (
    select
      requested.id as service_id,
      coalesce(sum(segments.seconds), 0) as observed,
      coalesce(sum(segments.seconds) filter (where segments.status in ('operational', 'maintenance')), 0) as available,
      coalesce(sum(segments.seconds) filter (where segments.status = 'maintenance'), 0) as maintenance,
      coalesce(sum(segments.seconds) filter (where segments.status in ('partial_outage', 'major_outage')), 0) as outage
    from requested
    left join segments on segments.service_id = requested.id
    group by requested.id
  )
  select
    totals.service_id,
    round(totals.observed, 0),
    round(totals.available, 0),
    round(totals.maintenance, 0),
    round(totals.outage, 0),
    case when totals.observed > 0
      then round(100 * totals.available / totals.observed, 3) end,
    case when totals.observed - totals.maintenance > 0
      then round(100 * (totals.available - totals.maintenance) / (totals.observed - totals.maintenance), 3) end
  from totals;
$$;
revoke all on function public.service_status_availability(uuid, uuid[], timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.service_status_availability(uuid, uuid[], timestamptz, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 16. Netzwerk-Abhängigkeiten eines Dienstes
-- ---------------------------------------------------------------------------
create or replace function public.service_network_dependencies(
  p_tenant_id uuid,
  p_service_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with devices as (
    select asset.id, asset.name, asset.active, link.position,
      infra.hostname, infra.ip_address::text as infra_ip, infra.category
    from public.asset_services link
    join public.assets asset on asset.id = link.asset_id and asset.tenant_id = p_tenant_id
    left join public.asset_infrastructure infra on infra.asset_id = asset.id
    where link.tenant_id = p_tenant_id and link.service_id = p_service_id
  ),
  device_addresses as (
    select distinct on (device.id)
      device.id as asset_id,
      host(address.address) as address,
      prefix.prefix::text as prefix,
      vlan.vlan_number,
      vlan.name as vlan_name,
      address.switch_name,
      address.switch_port
    from devices device
    join public.ipam_addresses address
      on address.tenant_id = p_tenant_id
     and (address.asset_id = device.id or host(address.address) = device.infra_ip)
    left join public.ipam_prefixes prefix
      on prefix.id = address.prefix_id and prefix.tenant_id = p_tenant_id
    left join public.ipam_vlans vlan
      on vlan.id = prefix.vlan_id and vlan.tenant_id = p_tenant_id
    order by device.id, (address.asset_id = device.id) desc, address.address
  ),
  device_incidents as (
    select distinct on (incident.asset_id)
      incident.asset_id, incident.id, incident.number, incident.severity, incident.opened_at
    from public.monitoring_incidents incident
    where incident.tenant_id = p_tenant_id
      and incident.state = 'active'
      and incident.asset_id in (select id from devices)
    order by incident.asset_id, incident.opened_at desc
  ),
  device_alerts as (
    select alert.asset_id, count(*) as open_alerts, max(alert.last_status) as last_status
    from public.monitoring_alerts alert
    where alert.tenant_id = p_tenant_id
      and alert.state = 'open'
      and alert.asset_id in (select id from devices)
    group by alert.asset_id
  ),
  service_subnets as (
    select prefix.id, prefix.prefix::text as prefix, prefix.description,
      vlan.vlan_number, vlan.name as vlan_name, count(address.id) as address_count
    from public.ipam_addresses address
    join public.ipam_prefixes prefix
      on prefix.id = address.prefix_id and prefix.tenant_id = p_tenant_id
    left join public.ipam_vlans vlan
      on vlan.id = prefix.vlan_id and vlan.tenant_id = p_tenant_id
    where address.tenant_id = p_tenant_id
      and address.service_id = p_service_id
    group by prefix.id, prefix.prefix, prefix.description, vlan.vlan_number, vlan.name
  ),
  incidents as (
    select incident.id, incident.number, incident.title, incident.severity,
      incident.opened_at, incident.device_name, incident.asset_id
    from public.monitoring_incidents incident
    where incident.tenant_id = p_tenant_id
      and incident.state = 'active'
      and (
        p_service_id = any(incident.service_ids)
        or incident.asset_id in (select id from devices)
      )
    order by incident.opened_at desc
    limit 20
  )
  select jsonb_build_object(
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assetId', device.id,
        'name', device.name,
        'active', device.active,
        'category', device.category,
        'hostname', device.hostname,
        'ipAddress', coalesce(address.address, device.infra_ip),
        'subnet', address.prefix,
        'vlanNumber', address.vlan_number,
        'vlanName', address.vlan_name,
        'switchName', address.switch_name,
        'switchPort', address.switch_port,
        'incidentId', incident.id,
        'incidentNumber', incident.number,
        'incidentSeverity', incident.severity,
        'openAlerts', coalesce(alert.open_alerts, 0),
        'monitoringStatus', alert.last_status
      ) order by device.position, device.name)
      from (select * from devices limit 200) device
      left join device_addresses address on address.asset_id = device.id
      left join device_incidents incident on incident.asset_id = device.id
      left join device_alerts alert on alert.asset_id = device.id
    ), '[]'::jsonb),
    'subnets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'prefixId', subnet.id,
        'prefix', subnet.prefix,
        'description', subnet.description,
        'vlanNumber', subnet.vlan_number,
        'vlanName', subnet.vlan_name,
        'addressCount', subnet.address_count
      ) order by subnet.prefix)
      from (select * from service_subnets limit 100) subnet
    ), '[]'::jsonb),
    'incidents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', incident.id,
        'number', incident.number,
        'title', incident.title,
        'severity', incident.severity,
        'openedAt', incident.opened_at,
        'deviceName', incident.device_name,
        'assetId', incident.asset_id
      ) order by incident.opened_at desc)
      from incidents incident
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.service_network_dependencies(uuid, uuid) from public, anon, authenticated;
grant execute on function public.service_network_dependencies(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Cron: Wartungsfenster alle 5 Minuten
-- ---------------------------------------------------------------------------
do $$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  for v_job_id in select jobid from cron.job where jobname = 'nextdesk-service-maintenance'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'nextdesk-service-maintenance',
    '*/5 * * * *',
    'select public.service_status_maintenance_run();'
  );
exception when others then
  null;
end;
$$;

commit;
