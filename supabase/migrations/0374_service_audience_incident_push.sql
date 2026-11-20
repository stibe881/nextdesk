-- Dienste: intern oder extern, und Push für Mitarbeitende bei Störungsmeldungen.
--
-- Ein interner Dienst betrifft nur die IT: Mitarbeitende sehen zu einer
-- Störungsmeldung, die ausschliesslich interne Dienste betrifft, weder Banner
-- noch Push. Für externe Dienste können sich alle Mitglieder in ihren
-- Benachrichtigungseinstellungen eine Push-Mitteilung bestellen (iPhone und
-- Android) und optional auf einzelne Dienste einschränken.

alter table public.services
  add column if not exists audience text not null default 'external'
    check (audience in ('internal', 'external'));

comment on column public.services.audience is
  'internal: only IT is informed about incidents; external: employees see banner and push.';

-- Bestellung pro Person. service_ids null = alle externen Dienste.
create table if not exists public.service_incident_push_subscriptions (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  enabled boolean not null default false,
  service_ids uuid[] check (service_ids is null or cardinality(service_ids) <= 500),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, user_id),
  constraint service_incident_push_subscriptions_membership_fk
    foreign key (tenant_id, user_id)
    references public.tenant_memberships (tenant_id, user_id)
    on delete cascade
);
create index if not exists service_incident_push_subscriptions_enabled_idx
  on public.service_incident_push_subscriptions (tenant_id)
  where enabled;

alter table public.service_incident_push_subscriptions enable row level security;
revoke all on public.service_incident_push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.service_incident_push_subscriptions to service_role;

-- Warteschlange: eine Zeile pro neuer Störungsmeldung. Der Minuten-Job holt
-- sie ab, sobald die betroffenen Dienste gespeichert sind.
create table if not exists public.service_incident_push_queue (
  notice_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  recipient_count integer,
  constraint service_incident_push_queue_notice_fk
    foreign key (notice_id, tenant_id)
    references public.service_incident_notices (id, tenant_id) on delete cascade
);
create index if not exists service_incident_push_queue_pending_idx
  on public.service_incident_push_queue (created_at)
  where processed_at is null;

alter table public.service_incident_push_queue enable row level security;
revoke all on public.service_incident_push_queue from public, anon, authenticated;
grant select, insert, update, delete on public.service_incident_push_queue to service_role;

create or replace function public.service_incident_push_enqueue()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status <> 'resolved' then
    insert into public.service_incident_push_queue (notice_id, tenant_id)
    values (new.id, new.tenant_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.service_incident_push_enqueue() from public, anon, authenticated;

drop trigger if exists service_incident_notices_push_enqueue on public.service_incident_notices;
create trigger service_incident_notices_push_enqueue
  after insert on public.service_incident_notices
  for each row execute function public.service_incident_push_enqueue();

-- Eine Meldung ist für Mitarbeitende unsichtbar, wenn sie Dienste nennt und
-- keiner davon extern (und aktiv) ist. Ohne Dienste bleibt sie sichtbar.
create or replace function public.service_incident_notice_internal_only(p_notice_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.service_incident_notice_services link
    where link.notice_id = p_notice_id
  ) and not exists (
    select 1
    from public.service_incident_notice_services link
    join public.services service on service.id = link.service_id
    where link.notice_id = p_notice_id
      and service.active
      and service.audience = 'external'
  );
$$;
revoke all on function public.service_incident_notice_internal_only(uuid) from public, anon, authenticated;
grant execute on function public.service_incident_notice_internal_only(uuid) to service_role;

-- Wer eine Push-Mitteilung zu dieser Meldung bekommt.
create or replace function public.service_incident_push_recipients(p_notice_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select subscription.user_id
  from public.service_incident_notices notice
  join public.service_incident_push_subscriptions subscription
    on subscription.tenant_id = notice.tenant_id and subscription.enabled
  join public.tenant_memberships membership
    on membership.tenant_id = subscription.tenant_id
   and membership.user_id = subscription.user_id
   and membership.status = 'active'
  where notice.id = p_notice_id
    and notice.status <> 'resolved'
    and not public.service_incident_notice_internal_only(notice.id)
    and (
      subscription.service_ids is null
      or not exists (
        select 1 from public.service_incident_notice_services link
        where link.notice_id = notice.id
      )
      or exists (
        select 1
        from public.service_incident_notice_services link
        join public.services service on service.id = link.service_id
        where link.notice_id = notice.id
          and service.active
          and service.audience = 'external'
          and service.id = any (subscription.service_ids)
      )
    );
$$;
revoke all on function public.service_incident_push_recipients(uuid) from public, anon, authenticated;
grant execute on function public.service_incident_push_recipients(uuid) to service_role;

create or replace function public.service_incident_push_due()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.service_incident_push_queue queue
    where queue.processed_at is null
      and queue.created_at <= timezone('utc', now()) - interval '15 seconds'
  );
$$;
revoke all on function public.service_incident_push_due() from public, anon, authenticated;
grant execute on function public.service_incident_push_due() to service_role;

-- Holt fällige Meldungen ab und markiert sie (höchstens einmal senden).
-- Meldungen, die älter als 30 Minuten sind, werden nur noch abgehakt.
create or replace function public.service_incident_push_claim(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row record;
  v_users uuid[];
  v_result jsonb := '[]'::jsonb;
begin
  for v_row in
    select queue.notice_id, queue.tenant_id, queue.created_at, notice.title
    from public.service_incident_push_queue queue
    join public.service_incident_notices notice on notice.id = queue.notice_id
    where queue.processed_at is null
      and queue.created_at <= timezone('utc', now()) - interval '15 seconds'
    order by queue.created_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update of queue skip locked
  loop
    v_users := '{}';
    if v_row.created_at > timezone('utc', now()) - interval '30 minutes' then
      select coalesce(array_agg(recipient), '{}') into v_users
      from public.service_incident_push_recipients(v_row.notice_id) recipient;
    end if;
    update public.service_incident_push_queue
       set processed_at = timezone('utc', now()),
           recipient_count = cardinality(v_users)
     where notice_id = v_row.notice_id;
    if cardinality(v_users) > 0 then
      v_result := v_result || jsonb_build_object(
        'noticeId', v_row.notice_id,
        'tenantId', v_row.tenant_id,
        'title', v_row.title,
        'userIds', to_jsonb(v_users),
        'services', coalesce((
          select jsonb_agg(service.name order by service.name)
          from public.service_incident_notice_services link
          join public.services service on service.id = link.service_id
          where link.notice_id = v_row.notice_id
            and service.active
            and service.audience = 'external'
        ), '[]'::jsonb)
      );
    end if;
  end loop;
  return v_result;
end;
$$;
revoke all on function public.service_incident_push_claim(integer) from public, anon, authenticated;
grant execute on function public.service_incident_push_claim(integer) to service_role;

-- Der Minuten-Job weckt «ipam-agent» auch, wenn Push-Mitteilungen anstehen.
do $migration$
declare
  v_definition text;
  v_old text := 'and not public.monitoring_maintenance_pauses_due() then';
  v_new text := 'and not public.monitoring_maintenance_pauses_due()
     and not public.service_incident_push_due() then';
begin
  if to_regprocedure('public.monitoring_probe_watchdog_wake()') is null then
    return;
  end if;
  v_definition := pg_get_functiondef('public.monitoring_probe_watchdog_wake()'::regprocedure);
  if position(v_old in v_definition) > 0 then
    execute replace(v_definition, v_old, v_new);
  end if;
end;
$migration$;

comment on table public.service_incident_push_subscriptions is
  'Opt-in of members for push messages about incident notices. Service role only.';
comment on table public.service_incident_push_queue is
  'New incident notices waiting for their push messages. Service role only.';
