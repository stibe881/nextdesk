begin;

set local search_path = pg_catalog, public;

-- «Störungen» (monitoring incidents) – workflow and performance:
--
-- * monitoring_incident_tickets: tickets that arrive during an active incident
--   for the affected device or service (linked asset/service or device name,
--   hostname or IP in the text) are linked automatically; agents add or
--   remove links by hand (removed links stay as tombstones so the automatic
--   matching does not add them again).
-- * problem_monitoring_incidents: cases (problems) opened from an incident.
-- * Lifecycle: «Up» sets an incident to resolved; only an agent closes it,
--   with a cause. The safety net (reconcile) follows the same rule.
-- * One SQL resolver for webhook and incidents function: device lookup by
--   PRTG object id / host / name, services and the uplink chain (depth 20),
--   downstream devices. No more loading whole tenant inventories per event.
-- * List (keyset pages, filters in SQL), tiles and report aggregated in SQL.
-- * Network context of the device from the IP address management.
-- * Realtime: monitoring_incidents in the realtime publication, readable for
--   the incident team only (can_work_incidents).

-- ---------------------------------------------------------------------------
-- Links incident ↔ ticket.

create table if not exists public.monitoring_incident_tickets (
  incident_id uuid not null references public.monitoring_incidents(id) on delete cascade,
  ticket_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null check (source in ('asset', 'service', 'text', 'manual')),
  linked_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  removed_at timestamptz,
  removed_by uuid references public.user_profiles(id) on delete set null,
  notified_at timestamptz,
  primary key (incident_id, ticket_id),
  constraint monitoring_incident_tickets_ticket_fk foreign key (ticket_id, tenant_id)
    references public.tickets (id, tenant_id) on delete cascade
);
create index if not exists monitoring_incident_tickets_ticket_idx
  on public.monitoring_incident_tickets (ticket_id)
  where removed_at is null;
create index if not exists monitoring_incident_tickets_tenant_idx
  on public.monitoring_incident_tickets (tenant_id, created_at desc);

-- Cases opened from (or linked to) an incident.
create table if not exists public.problem_monitoring_incidents (
  problem_id uuid not null,
  incident_id uuid not null references public.monitoring_incidents(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  linked_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (problem_id, incident_id),
  constraint problem_monitoring_incidents_problem_fk foreign key (problem_id, tenant_id)
    references public.problems (id, tenant_id) on delete cascade
);
create index if not exists problem_monitoring_incidents_incident_idx
  on public.problem_monitoring_incidents (incident_id);

alter table public.monitoring_incident_tickets enable row level security;
alter table public.problem_monitoring_incidents enable row level security;
revoke all on public.monitoring_incident_tickets, public.problem_monitoring_incidents
  from public, anon, authenticated;
grant select, insert, update, delete on public.monitoring_incident_tickets,
  public.problem_monitoring_incidents to service_role;

comment on table public.monitoring_incident_tickets is
  'Tickets belonging to a monitoring incident (automatic or manual link; removed_at = removed by an agent). Service role only.';
comment on table public.problem_monitoring_incidents is
  'Cases (problems) opened from or linked to a monitoring incident. Service role only.';

create index if not exists monitoring_incidents_key_recent_idx
  on public.monitoring_incidents (tenant_id, incident_key, opened_at desc);
create index if not exists monitoring_incidents_parent_idx
  on public.monitoring_incidents (parent_incident_id)
  where parent_incident_id is not null;

-- ---------------------------------------------------------------------------
-- Text helpers.

-- Text → inet, null for anything that is not a single address.
create or replace function public.monitoring_try_inet(p_value text)
returns inet
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_value text := btrim(coalesce(p_value, ''));
  v_inet inet;
begin
  if v_value = '' or char_length(v_value) > 64 or v_value !~ '^[0-9a-fA-F:.]+$' then
    return null;
  end if;
  v_inet := v_value::inet;
  if masklen(v_inet) <> (case when family(v_inet) = 4 then 32 else 128 end) then
    return null;
  end if;
  return v_inet;
exception when others then
  return null;
end;
$$;

-- True when the text mentions one of the terms: as a whole token (hostnames,
-- IP addresses, «SW-CORE-01»; «srv01» also matches «srv01.corp.local»), or a
-- multi-word name as a phrase. Case-insensitive.
create or replace function public.monitoring_text_mentions(p_text text, p_terms text[])
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  with source as (
    select lower(left(coalesce(p_text, ''), 20000)) as body
  ),
  tokens as (
    select distinct match[1] as token
    from source,
      regexp_matches(source.body, '([[:alnum:]](?:[[:alnum:]._:-]*[[:alnum:]])?)', 'g') as match
  ),
  terms as (
    select distinct regexp_replace(lower(btrim(term)), '\s+', ' ', 'g') as term
    from unnest(coalesce(p_terms, '{}'::text[])) as term
    where term is not null and char_length(btrim(term)) >= 3
  )
  select exists (
    select 1
    from terms, source
    where (
        terms.term ~ '\s'
        and char_length(terms.term) >= 6
        and position(terms.term in regexp_replace(source.body, '\s+', ' ', 'g')) > 0
      )
      or (
        terms.term !~ '\s'
        and exists (
          select 1 from tokens
          where tokens.token = terms.term
             or (
               terms.term !~ '[.:]'
               and terms.term !~ '^[0-9]+$'
               and tokens.token !~ '^[0-9.]+$'
               and split_part(tokens.token, '.', 1) = terms.term
             )
        )
      )
  );
$$;

-- Words that identify the device of an incident in a ticket text: hostname
-- (and its short form), IP addresses, and device names that look like an
-- identifier (with a digit, «-», «_», «.») or have several words.
create or replace function public.monitoring_incident_terms(p_incident_id uuid)
returns text[]
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with incident as (
    select id, tenant_id, asset_id, device_name
    from public.monitoring_incidents
    where id = p_incident_id
  ),
  raw as (
    select infra.hostname as term, true as identifier
    from incident
    join public.asset_infrastructure infra
      on infra.asset_id = incident.asset_id and infra.tenant_id = incident.tenant_id
    union all
    select split_part(infra.hostname, '.', 1), true
    from incident
    join public.asset_infrastructure infra
      on infra.asset_id = incident.asset_id and infra.tenant_id = incident.tenant_id
    where infra.hostname like '%.%' and split_part(infra.hostname, '.', 1) !~ '^[0-9]+$'
    union all
    select infra.ip_address, true
    from incident
    join public.asset_infrastructure infra
      on infra.asset_id = incident.asset_id and infra.tenant_id = incident.tenant_id
    union all
    select host(address.address), true
    from incident
    join public.ipam_addresses address
      on address.tenant_id = incident.tenant_id and address.asset_id = incident.asset_id
    union all
    select address.hostname, true
    from incident
    join public.ipam_addresses address
      on address.tenant_id = incident.tenant_id and address.asset_id = incident.asset_id
    union all
    select asset.name, false
    from incident
    join public.assets asset on asset.id = incident.asset_id and asset.tenant_id = incident.tenant_id
    union all
    select incident.device_name, false from incident
  )
  select coalesce(array_agg(distinct btrim(term)), '{}'::text[])
  from raw
  where term is not null
    and char_length(btrim(term)) between 3 and 253
    and (
      identifier
      or (char_length(btrim(term)) >= 5 and btrim(term) ~ '([0-9]|[-_.]|\s)')
    );
$$;

-- ---------------------------------------------------------------------------
-- Automatic links.

-- Links one open ticket to the active incidents it belongs to (by linked
-- asset, linked service or text), or only to p_incident_id. Tickets older
-- than 30 minutes before the incident opened are not considered. Returns the
-- number of new links.
create or replace function public.monitoring_link_ticket(
  p_ticket_id uuid,
  p_incident_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ticket record;
  v_incident record;
  v_source text;
  v_rows integer;
  v_count integer := 0;
  v_text text;
begin
  select ticket.id, ticket.tenant_id, ticket.ticket_number, ticket.subject,
         ticket.description, ticket.created_at
    into v_ticket
    from public.tickets ticket
    join public.ticket_statuses status on status.id = ticket.status_id
   where ticket.id = p_ticket_id
     and ticket.deleted_at is null
     and ticket.merged_into_ticket_id is null
     and not status.is_closed;
  if not found then
    return 0;
  end if;
  if not exists (
    select 1 from public.monitoring_incidents
    where tenant_id = v_ticket.tenant_id and state = 'active'
  ) then
    return 0;
  end if;
  v_text := coalesce(v_ticket.subject, '') || E'\n' || coalesce(v_ticket.description, '');

  for v_incident in
    select incident.id,
           coalesce(incident.parent_incident_id, incident.id) as root_id,
           incident.asset_id,
           incident.service_ids
      from public.monitoring_incidents incident
     where incident.tenant_id = v_ticket.tenant_id
       and incident.state = 'active'
       and (p_incident_id is null or incident.id = p_incident_id)
       and v_ticket.created_at >= incident.opened_at - interval '30 minutes'
     order by incident.parent_incident_id nulls first, incident.opened_at
     limit 50
  loop
    v_source := null;
    if v_incident.asset_id is not null and exists (
      select 1 from public.ticket_assets link
      where link.ticket_id = v_ticket.id and link.asset_id = v_incident.asset_id
    ) then
      v_source := 'asset';
    elsif cardinality(v_incident.service_ids) > 0 and exists (
      select 1 from public.ticket_services link
      where link.ticket_id = v_ticket.id and link.service_id = any(v_incident.service_ids)
    ) then
      v_source := 'service';
    elsif public.monitoring_text_mentions(v_text, public.monitoring_incident_terms(v_incident.id)) then
      v_source := 'text';
    end if;
    if v_source is null then
      continue;
    end if;
    insert into public.monitoring_incident_tickets (incident_id, ticket_id, tenant_id, source)
    values (v_incident.root_id, v_ticket.id, v_ticket.tenant_id, v_source)
    on conflict (incident_id, ticket_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      v_count := v_count + 1;
      insert into public.monitoring_incident_events (tenant_id, incident_id, kind, message)
      values (
        v_ticket.tenant_id, v_incident.root_id, 'note',
        left('Ticket ' || v_ticket.ticket_number || ' automatisch zugeordnet ('
          || case v_source
               when 'asset' then 'verknüpftes Gerät'
               when 'service' then 'verknüpfter Dienst'
               else 'Gerät im Text erwähnt'
             end || ').', 4000)
      );
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.monitoring_link_ticket(uuid, uuid) from public, anon, authenticated;
grant execute on function public.monitoring_link_ticket(uuid, uuid) to service_role;

-- New incident: open tickets of the last 30 minutes that belong to it.
create or replace function public.monitoring_incident_link_recent_tickets(p_incident_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_incident record;
  v_ticket record;
  v_count integer := 0;
begin
  select id, tenant_id, opened_at, state into v_incident
  from public.monitoring_incidents where id = p_incident_id;
  if not found or v_incident.state <> 'active' then
    return 0;
  end if;
  for v_ticket in
    select ticket.id
      from public.tickets ticket
      join public.ticket_statuses status on status.id = ticket.status_id and not status.is_closed
     where ticket.tenant_id = v_incident.tenant_id
       and ticket.deleted_at is null
       and ticket.created_at >= v_incident.opened_at - interval '30 minutes'
     order by ticket.created_at desc
     limit 200
  loop
    v_count := v_count + public.monitoring_link_ticket(v_ticket.id, v_incident.id);
  end loop;
  return v_count;
end;
$$;
revoke all on function public.monitoring_incident_link_recent_tickets(uuid) from public, anon, authenticated;
grant execute on function public.monitoring_incident_link_recent_tickets(uuid) to service_role;

-- Triggers never block the ticket or incident write.
create or replace function public.monitoring_ticket_link_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  begin
    if tg_table_name = 'tickets' then
      perform public.monitoring_link_ticket(new.id);
    else
      perform public.monitoring_link_ticket(new.ticket_id);
    end if;
  exception when others then
    null;
  end;
  return null;
end;
$$;
revoke all on function public.monitoring_ticket_link_trigger() from public, anon, authenticated;

create or replace function public.monitoring_incident_link_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  begin
    perform public.monitoring_incident_link_recent_tickets(new.id);
  exception when others then
    null;
  end;
  return null;
end;
$$;
revoke all on function public.monitoring_incident_link_trigger() from public, anon, authenticated;

create or replace trigger monitoring_link_new_ticket
  after insert on public.tickets
  for each row execute function public.monitoring_ticket_link_trigger();
create or replace trigger monitoring_link_ticket_asset
  after insert on public.ticket_assets
  for each row execute function public.monitoring_ticket_link_trigger();
create or replace trigger monitoring_link_ticket_service
  after insert on public.ticket_services
  for each row execute function public.monitoring_ticket_link_trigger();
create or replace trigger monitoring_incident_link_tickets
  after insert on public.monitoring_incidents
  for each row execute function public.monitoring_incident_link_trigger();

-- ---------------------------------------------------------------------------
-- Device resolver (webhook and incidents function).

-- Uplink chain of a device, nearest first, at most 20 levels, cycle-safe.
create or replace function public.monitoring_uplink_chain(
  p_tenant_id uuid,
  p_asset_id uuid,
  p_max_depth integer default 20
)
returns uuid[]
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with recursive chain (asset_id, depth, path) as (
    select infra.uplink_asset_id, 1, array[p_asset_id, infra.uplink_asset_id]
      from public.asset_infrastructure infra
     where infra.tenant_id = p_tenant_id
       and infra.asset_id = p_asset_id
       and infra.uplink_asset_id is not null
       and infra.uplink_asset_id <> p_asset_id
    union all
    select infra.uplink_asset_id, chain.depth + 1, chain.path || infra.uplink_asset_id
      from chain
      join public.asset_infrastructure infra
        on infra.tenant_id = p_tenant_id and infra.asset_id = chain.asset_id
     where infra.uplink_asset_id is not null
       and not infra.uplink_asset_id = any(chain.path)
       and chain.depth < least(greatest(coalesce(p_max_depth, 20), 1), 20)
  )
  select coalesce(array_agg(asset_id order by depth), '{}'::uuid[]) from chain;
$$;

-- Devices behind a device (whose uplink chain contains it), at most 20 levels.
create or replace function public.monitoring_downstream_assets(
  p_tenant_id uuid,
  p_asset_id uuid,
  p_max_depth integer default 20
)
returns uuid[]
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with recursive below (asset_id, depth, path) as (
    select infra.asset_id, 1, array[p_asset_id, infra.asset_id]
      from public.asset_infrastructure infra
     where infra.tenant_id = p_tenant_id
       and infra.uplink_asset_id = p_asset_id
       and infra.asset_id <> p_asset_id
    union all
    select infra.asset_id, below.depth + 1, below.path || infra.asset_id
      from below
      join public.asset_infrastructure infra
        on infra.tenant_id = p_tenant_id and infra.uplink_asset_id = below.asset_id
     where not infra.asset_id = any(below.path)
       and below.depth < least(greatest(coalesce(p_max_depth, 20), 1), 20)
  )
  select coalesce(array_agg(distinct asset_id), '{}'::uuid[]) from below;
$$;

-- Services of a device: the primary one and every additional one.
create or replace function public.monitoring_asset_service_ids(p_tenant_id uuid, p_asset_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(array_agg(distinct service_id), '{}'::uuid[])
  from (
    select asset.service_id
      from public.assets asset
     where asset.tenant_id = p_tenant_id and asset.id = p_asset_id and asset.service_id is not null
    union all
    select link.service_id
      from public.asset_services link
     where link.tenant_id = p_tenant_id and link.asset_id = p_asset_id
  ) services;
$$;

-- The device of a PRTG message: PRTG object/sensor/device id first (in the
-- given order), then hostname or IP = host (also «srv01» vs
-- «srv01.example.local»), then the device name, finally an IP address of the
-- IP address management with a device. Ambiguous matches on a level map to
-- nothing (same rules as before in the webhook). Returns null or
-- {assetId, name, hostname, ipAddress, prtgObjectId, serviceIds, uplinks}.
create or replace function public.monitoring_resolve_device(
  p_tenant_id uuid,
  p_object_ids text[],
  p_host text,
  p_name text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id text;
  v_candidates uuid[];
  v_asset uuid;
  v_decided boolean := false;
  v_host text := nullif(lower(btrim(coalesce(p_host, ''))), '');
  v_short text;
  v_name text := nullif(lower(btrim(coalesce(p_name, ''))), '');
  v_inet inet;
begin
  foreach v_id in array coalesce(p_object_ids, '{}'::text[]) loop
    if v_id is null or v_id !~ '^[0-9]{1,12}$' then
      continue;
    end if;
    select array_agg(distinct infra.asset_id) into v_candidates
      from public.asset_infrastructure infra
      join public.assets asset on asset.id = infra.asset_id and asset.tenant_id = infra.tenant_id
     where infra.tenant_id = p_tenant_id and infra.prtg_object_id = v_id;
    if coalesce(cardinality(v_candidates), 0) > 0 then
      v_decided := true;
      if cardinality(v_candidates) = 1 then v_asset := v_candidates[1]; end if;
      exit;
    end if;
  end loop;

  if not v_decided and v_host is not null then
    v_short := split_part(v_host, '.', 1);
    select array_agg(distinct infra.asset_id) into v_candidates
      from public.asset_infrastructure infra
      join public.assets asset on asset.id = infra.asset_id and asset.tenant_id = infra.tenant_id
     where infra.tenant_id = p_tenant_id
       and (
         lower(btrim(infra.hostname)) = v_host
         or lower(btrim(infra.ip_address)) = v_host
         or (
           infra.hostname is not null
           and v_short !~ '^[0-9]+$'
           and v_short = split_part(lower(btrim(infra.hostname)), '.', 1)
         )
       );
    if coalesce(cardinality(v_candidates), 0) > 0 then
      v_decided := true;
      if cardinality(v_candidates) = 1 then v_asset := v_candidates[1]; end if;
    end if;
  end if;

  if not v_decided and v_name is not null then
    select array_agg(distinct infra.asset_id) into v_candidates
      from public.asset_infrastructure infra
      join public.assets asset on asset.id = infra.asset_id and asset.tenant_id = infra.tenant_id
     where infra.tenant_id = p_tenant_id
       and lower(btrim(asset.name)) = v_name;
    if coalesce(cardinality(v_candidates), 0) > 0 then
      v_decided := true;
      if cardinality(v_candidates) = 1 then v_asset := v_candidates[1]; end if;
    end if;
  end if;

  -- IP address management: address or hostname with a linked device.
  if not v_decided and v_host is not null then
    v_inet := public.monitoring_try_inet(v_host);
    select array_agg(distinct address.asset_id) into v_candidates
      from public.ipam_addresses address
     where address.tenant_id = p_tenant_id
       and address.asset_id is not null
       and (
         (v_inet is not null and address.address = v_inet)
         or lower(address.hostname) = v_host
       );
    if coalesce(cardinality(v_candidates), 0) = 1 then
      v_asset := v_candidates[1];
    end if;
  end if;

  if v_asset is null then
    return null;
  end if;
  return (
    select jsonb_build_object(
      'assetId', asset.id,
      'name', asset.name,
      'hostname', infra.hostname,
      'ipAddress', infra.ip_address,
      'prtgObjectId', infra.prtg_object_id,
      'serviceIds', to_jsonb(public.monitoring_asset_service_ids(p_tenant_id, asset.id)),
      'uplinks', to_jsonb(public.monitoring_uplink_chain(p_tenant_id, asset.id, 20))
    )
    from public.assets asset
    left join public.asset_infrastructure infra
      on infra.asset_id = asset.id and infra.tenant_id = asset.tenant_id
    where asset.id = v_asset and asset.tenant_id = p_tenant_id
  );
end;
$$;

revoke all on function public.monitoring_uplink_chain(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.monitoring_downstream_assets(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.monitoring_asset_service_ids(uuid, uuid) from public, anon, authenticated;
revoke all on function public.monitoring_resolve_device(uuid, text[], text, text) from public, anon, authenticated;
revoke all on function public.monitoring_incident_terms(uuid) from public, anon, authenticated;
grant execute on function public.monitoring_uplink_chain(uuid, uuid, integer) to service_role;
grant execute on function public.monitoring_downstream_assets(uuid, uuid, integer) to service_role;
grant execute on function public.monitoring_asset_service_ids(uuid, uuid) to service_role;
grant execute on function public.monitoring_resolve_device(uuid, text[], text, text) to service_role;
grant execute on function public.monitoring_incident_terms(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Lifecycle: back to OK → resolved; only an agent closes (with a cause).

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
       set state = 'resolved',
           resolved_at = coalesce(resolved_at, timezone('utc', now()))
     where id = v_incident.id and state = 'active';
    insert into public.monitoring_incident_events (tenant_id, incident_id, kind, message)
    values (v_incident.tenant_id, v_incident.id, 'resolved',
            'Alle Sensoren sind wieder OK. Störung behoben – bitte mit Ursache abschliessen.');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.monitoring_reconcile_incidents() from public, anon, authenticated;

create or replace function public.monitoring_realert_due()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_incident record;
  v_count integer := 0;
begin
  perform public.monitoring_reconcile_incidents();
  for v_incident in
    select incident.id, incident.tenant_id
    from public.monitoring_incidents incident
    join public.monitoring_integrations integration
      on integration.tenant_id = incident.tenant_id
    where incident.state = 'active'
      and incident.parent_incident_id is null
      and incident.acknowledged_at is null
      and not incident.maintenance
      and integration.enabled
      and integration.realert_minutes > 0
      and coalesce(incident.last_alerted_at, incident.opened_at)
          < timezone('utc', now()) - make_interval(mins => integration.realert_minutes)
    limit 100
  loop
    perform public.monitoring_incident_notify(v_incident.id, 'realert');
    update public.monitoring_incidents
       set realert_count = realert_count + 1
     where id = v_incident.id;
    insert into public.monitoring_incident_events (tenant_id, incident_id, kind, message)
    values (v_incident.tenant_id, v_incident.id, 'realert',
            'Noch nicht bestätigt: erneut alarmiert.');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.monitoring_realert_due() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- List, tiles and report in SQL.

create or replace function public.monitoring_incident_matches(
  p_state text,
  p_acknowledged_at timestamptz,
  p_service_ids uuid[],
  p_resolved_at timestamptz,
  p_filter text
)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(case p_filter
    when 'active' then p_state = 'active'
    when 'unacknowledged' then p_state = 'active' and p_acknowledged_at is null
    when 'services' then p_state = 'active' and cardinality(coalesce(p_service_ids, '{}'::uuid[])) > 0
    when 'recent' then p_resolved_at >= timezone('utc', now()) - interval '30 days'
    when 'resolved' then p_state = 'resolved'
    when 'closed' then p_state = 'closed'
    else true
  end, false);
$$;

-- One page of incidents (newest first; keyset cursor opened_at/id). Listed
-- are root incidents and follow-ups whose cause is not listed itself.
create or replace function public.monitoring_incident_page(
  p_tenant_id uuid,
  p_filter text,
  p_search text default null,
  p_before_opened_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns setof public.monitoring_incidents
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with params as (
    select '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
    where nullif(btrim(coalesce(p_search, '')), '') is not null
  )
  select incident.*
  from public.monitoring_incidents incident
  where incident.tenant_id = p_tenant_id
    and public.monitoring_incident_matches(
      incident.state, incident.acknowledged_at, incident.service_ids, incident.resolved_at, p_filter)
    and (
      incident.parent_incident_id is null
      or not exists (
        select 1 from public.monitoring_incidents parent
        where parent.id = incident.parent_incident_id
          and public.monitoring_incident_matches(
            parent.state, parent.acknowledged_at, parent.service_ids, parent.resolved_at, p_filter)
      )
    )
    and (
      not exists (select 1 from params)
      or incident.number ilike (select pattern from params)
      or incident.title ilike (select pattern from params)
      or coalesce(incident.device_name, '') ilike (select pattern from params)
    )
    and (
      p_before_opened_at is null
      or (incident.opened_at, incident.id) < (p_before_opened_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
    )
  order by incident.opened_at desc, incident.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- Tiles: active incidents, unacknowledged, affected services, median time to
-- resolve and availability (30 days, devices monitored by PRTG).
create or replace function public.monitoring_incident_stats(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with bounds as (
    select timezone('utc', now()) as now_at,
           timezone('utc', now()) - interval '30 days' as since
  ),
  active_roots as (
    select incident.*
    from public.monitoring_incidents incident
    where incident.tenant_id = p_tenant_id
      and incident.state = 'active'
      and incident.parent_incident_id is null
  ),
  resolved as (
    select extract(epoch from (incident.resolved_at - incident.opened_at)) / 60 as minutes
    from public.monitoring_incidents incident, bounds
    where incident.tenant_id = p_tenant_id
      and incident.parent_incident_id is null
      and incident.resolved_at >= bounds.since
  ),
  monitored as (
    select count(*)::integer as devices
    from public.asset_infrastructure infra
    where infra.tenant_id = p_tenant_id and infra.prtg_object_id is not null
  ),
  seen as (
    select count(distinct incident.asset_id)::integer as devices
    from public.monitoring_incidents incident, bounds
    where incident.tenant_id = p_tenant_id
      and incident.asset_id is not null
      and (incident.state = 'active' or incident.opened_at >= bounds.since or incident.resolved_at >= bounds.since)
  ),
  down as (
    select coalesce(sum(extract(epoch from (
             coalesce(incident.resolved_at, bounds.now_at) - greatest(incident.opened_at, bounds.since)
           ))), 0) as seconds
    from public.monitoring_incidents incident, bounds
    where incident.tenant_id = p_tenant_id
      and incident.severity = 'down'
      and coalesce(incident.resolved_at, bounds.now_at) > greatest(incident.opened_at, bounds.since)
  ),
  services as (
    select distinct service.name
    from public.monitoring_incidents incident
    cross join lateral unnest(incident.service_ids) as service_id
    join public.services service on service.id = service_id and service.tenant_id = p_tenant_id
    where incident.tenant_id = p_tenant_id and incident.state = 'active'
  ),
  devices as (
    select case when monitored.devices > 0 then monitored.devices else seen.devices end as count
    from monitored, seen
  )
  select jsonb_build_object(
    'active', (select count(*) from active_roots),
    'activeDown', (select count(*) from active_roots where severity = 'down'),
    'activeWarning', (select count(*) from active_roots where severity = 'warning'),
    'unacknowledged', (select count(*) from active_roots where acknowledged_at is null and not maintenance),
    'oldestUnacknowledgedAt', (select min(opened_at) from active_roots where acknowledged_at is null),
    'affectedServices', coalesce((select jsonb_agg(name order by name) from services), '[]'::jsonb),
    'medianResolveMinutes', (select percentile_cont(0.5) within group (order by minutes) from resolved),
    'monitoredDevices', (select count from devices),
    'availability', (
      select case when devices.count > 0
        then greatest(0, 1 - down.seconds / (devices.count * extract(epoch from (bounds.now_at - bounds.since))))
      end
      from devices, down, bounds
    )
  );
$$;

-- Report over 30 or 90 days: total (without follow-ups), median time to
-- resolve, availability, causes and the devices with most incidents.
create or replace function public.monitoring_incident_report(p_tenant_id uuid, p_days integer)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with bounds as (
    select timezone('utc', now()) as now_at,
           timezone('utc', now()) - make_interval(days => case when p_days = 90 then 90 else 30 end) as since,
           case when p_days = 90 then 90 else 30 end as days
  ),
  incidents as (
    select incident.*
    from public.monitoring_incidents incident, bounds
    where incident.tenant_id = p_tenant_id
      and (incident.state = 'active' or incident.opened_at >= bounds.since or incident.resolved_at >= bounds.since)
  ),
  roots as (
    select * from incidents where parent_incident_id is null
  ),
  monitored as (
    select count(*)::integer as devices
    from public.asset_infrastructure infra
    where infra.tenant_id = p_tenant_id and infra.prtg_object_id is not null
  ),
  devices as (
    select case when monitored.devices > 0 then monitored.devices
                else (select count(distinct asset_id)::integer from roots where asset_id is not null) end as count
    from monitored
  ),
  down as (
    select coalesce(sum(extract(epoch from (
             coalesce(incident.resolved_at, bounds.now_at) - greatest(incident.opened_at, bounds.since)
           ))), 0) as seconds
    from incidents incident, bounds
    where incident.severity = 'down'
      and coalesce(incident.resolved_at, bounds.now_at) > greatest(incident.opened_at, bounds.since)
  ),
  causes as (
    select coalesce(cause, 'open') as cause, count(*)::integer as count
    from roots group by coalesce(cause, 'open')
  ),
  per_device as (
    select coalesce(asset_id::text, device_name, title) as key,
           min(coalesce(device_name, title)) as name,
           count(*)::integer as count,
           round(sum(extract(epoch from (coalesce(resolved_at, bounds.now_at) - opened_at)) / 60))::integer as minutes
    from roots, bounds
    group by coalesce(asset_id::text, device_name, title)
    order by count(*) desc, sum(extract(epoch from (coalesce(resolved_at, bounds.now_at) - opened_at))) desc
    limit 10
  )
  select jsonb_build_object(
    'days', (select days from bounds),
    'total', (select count(*) from roots),
    'medianResolveMinutes', (
      select percentile_cont(0.5) within group (
        order by extract(epoch from (resolved_at - opened_at)) / 60)
      from roots where resolved_at is not null
    ),
    'availability', (
      select case when devices.count > 0
        then greatest(0, 1 - down.seconds / (devices.count * extract(epoch from (bounds.now_at - bounds.since))))
      end
      from devices, down, bounds
    ),
    'causes', coalesce((select jsonb_agg(jsonb_build_object('cause', cause, 'count', count)
                                         order by count desc, cause) from causes), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', count, 'minutes', minutes)
                                          order by count desc, minutes desc) from per_device), '[]'::jsonb)
  );
$$;

-- How often the same device / the same cause on this device failed in the
-- last 30 days (incidents without follow-ups). ≥ 3 → suggest a case.
create or replace function public.monitoring_incident_recurrence(p_incident_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with incident as (
    select * from public.monitoring_incidents where id = p_incident_id
  ),
  same_device as (
    select other.*
    from public.monitoring_incidents other, incident
    where other.tenant_id = incident.tenant_id
      and other.incident_key = incident.incident_key
      and other.parent_incident_id is null
      and other.opened_at >= timezone('utc', now()) - interval '30 days'
  )
  select jsonb_build_object(
    'sameDevice30d', (select count(*) from same_device),
    'sameCause30d', (
      select count(*) from same_device, incident
      where incident.cause is not null and same_device.cause = incident.cause
    ),
    'incidentIds', coalesce((select jsonb_agg(id order by opened_at desc) from same_device), '[]'::jsonb)
  )
  from incident;
$$;

-- Network context of a device from the IP address management: addresses with
-- subnet, VLAN, site and switch port; further devices in the same subnet and
-- at the same switch with their current monitoring state.
create or replace function public.monitoring_incident_network(p_tenant_id uuid, p_asset_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_infra record;
  v_ip inet;
  v_mac macaddr;
  v_addresses jsonb;
  v_prefix_ids uuid[];
  v_switches text[];
  v_subnet jsonb;
  v_switch jsonb;
begin
  if p_asset_id is null then
    return jsonb_build_object('addresses', '[]'::jsonb, 'subnetNeighbours', '[]'::jsonb,
                              'switchNeighbours', '[]'::jsonb);
  end if;
  select ip_address, mac_address into v_infra
  from public.asset_infrastructure where tenant_id = p_tenant_id and asset_id = p_asset_id;
  v_ip := public.monitoring_try_inet(v_infra.ip_address);
  begin
    v_mac := nullif(btrim(coalesce(v_infra.mac_address, '')), '')::macaddr;
  exception when others then
    v_mac := null;
  end;

  with own as (
    select address.*
    from public.ipam_addresses address
    where address.tenant_id = p_tenant_id
      and (address.asset_id = p_asset_id or (v_ip is not null and address.address = v_ip))
    order by (address.asset_id = p_asset_id) desc nulls last, address.address
    limit 5
  ),
  enriched as (
    select own.id, own.address, own.hostname, own.status, own.last_seen_at,
           own.mac_address,
           prefix.id as prefix_id, prefix.prefix, prefix.gateway,
           vlan.vlan_number, vlan.name as vlan_name,
           site.name as site_name,
           coalesce(own.switch_name, location.switch_name) as switch_name,
           coalesce(own.switch_port, location.switch_port) as switch_port,
           case when own.switch_name is not null then 'ipam' else location.source end as port_source,
           location.vlan as port_vlan,
           location.seen_at as port_seen_at
    from own
    left join lateral (
      select candidate.*
      from public.ipam_prefixes candidate
      where candidate.tenant_id = p_tenant_id
        and (candidate.id = own.prefix_id or (own.prefix_id is null and candidate.prefix >>= own.address))
      order by (candidate.id = own.prefix_id) desc, masklen(candidate.prefix) desc
      limit 1
    ) prefix on true
    left join public.ipam_vlans vlan on vlan.id = prefix.vlan_id and vlan.tenant_id = p_tenant_id
    left join public.ipam_sites site
      on site.id = coalesce(prefix.site_id, vlan.site_id) and site.tenant_id = p_tenant_id
    left join public.ipam_mac_locations location
      on location.tenant_id = p_tenant_id and location.mac = coalesce(own.mac_address, v_mac)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'address', host(address),
           'hostname', hostname,
           'status', status,
           'lastSeenAt', last_seen_at,
           'prefixId', prefix_id,
           'prefix', prefix::text,
           'gateway', host(gateway),
           'vlanNumber', coalesce(vlan_number, port_vlan),
           'vlanName', vlan_name,
           'site', site_name,
           'switchName', switch_name,
           'switchPort', switch_port,
           'portSource', port_source,
           'portSeenAt', port_seen_at
         ) order by address), '[]'::jsonb),
         coalesce(array_agg(distinct prefix_id) filter (where prefix_id is not null), '{}'::uuid[]),
         coalesce(array_agg(distinct switch_name) filter (where switch_name is not null), '{}'::text[])
    into v_addresses, v_prefix_ids, v_switches
  from enriched;

  -- Devices without IPAM entry: the switch port from the MAC table.
  if cardinality(v_switches) = 0 and v_mac is not null then
    select coalesce(array_agg(location.switch_name), '{}'::text[]) into v_switches
    from public.ipam_mac_locations location
    where location.tenant_id = p_tenant_id and location.mac = v_mac;
    if cardinality(v_switches) > 0 and jsonb_array_length(v_addresses) = 0 then
      select jsonb_build_array(jsonb_build_object(
               'address', v_infra.ip_address, 'hostname', null, 'status', null,
               'lastSeenAt', null, 'prefixId', null, 'prefix', null, 'gateway', null,
               'vlanNumber', location.vlan, 'vlanName', null, 'site', null,
               'switchName', location.switch_name, 'switchPort', location.switch_port,
               'portSource', location.source, 'portSeenAt', location.seen_at))
        into v_addresses
      from public.ipam_mac_locations location
      where location.tenant_id = p_tenant_id and location.mac = v_mac;
    end if;
  end if;

  with neighbours as (
    select distinct on (coalesce(address.asset_id::text, host(address.address)))
           address.address, address.hostname, address.asset_id
    from public.ipam_addresses address
    join public.ipam_prefixes prefix on prefix.id = any(v_prefix_ids) and prefix.tenant_id = p_tenant_id
    where address.tenant_id = p_tenant_id
      and (address.prefix_id = prefix.id or (address.prefix_id is null and address.address << prefix.prefix))
      and address.asset_id is distinct from p_asset_id
      and (address.asset_id is not null or address.hostname is not null)
      and address.status <> 'deprecated'
    order by coalesce(address.asset_id::text, host(address.address)), address.address
  )
  select coalesce(jsonb_agg(entry order by (entry ->> 'rank')::integer, entry ->> 'name'), '[]'::jsonb)
    into v_subnet
  from (
    select jsonb_build_object(
             'assetId', neighbours.asset_id,
             'name', coalesce(asset.name, neighbours.hostname, host(neighbours.address)),
             'address', host(neighbours.address),
             'state', case
               when active.severity is not null then active.severity
               when infra.prtg_object_id is not null then 'ok'
               else 'unknown' end,
             'incidentId', active.id,
             'rank', case when active.severity = 'down' then 0 when active.severity = 'warning' then 1 else 2 end
           ) as entry
    from neighbours
    left join public.assets asset on asset.id = neighbours.asset_id and asset.tenant_id = p_tenant_id
    left join public.asset_infrastructure infra
      on infra.asset_id = neighbours.asset_id and infra.tenant_id = p_tenant_id
    left join lateral (
      select incident.id, incident.severity
      from public.monitoring_incidents incident
      where incident.tenant_id = p_tenant_id and incident.state = 'active'
        and incident.asset_id = neighbours.asset_id
      order by (incident.severity = 'down') desc, incident.opened_at
      limit 1
    ) active on true
    order by case when active.severity = 'down' then 0 when active.severity = 'warning' then 1 else 2 end,
             coalesce(asset.name, neighbours.hostname, host(neighbours.address))
    limit 30
  ) rows;

  with at_switch as (
    select distinct on (coalesce(address.asset_id::text, location.mac::text))
           location.switch_name, location.switch_port, location.mac,
           address.address, address.hostname, address.asset_id
    from public.ipam_mac_locations location
    left join public.ipam_addresses address
      on address.tenant_id = p_tenant_id and address.mac_address = location.mac
    where location.tenant_id = p_tenant_id
      and location.switch_name = any(v_switches)
      and location.mac is distinct from v_mac
      and address.asset_id is distinct from p_asset_id
    order by coalesce(address.asset_id::text, location.mac::text), address.last_seen_at desc nulls last
  )
  select coalesce(jsonb_agg(entry order by (entry ->> 'rank')::integer, entry ->> 'port'), '[]'::jsonb)
    into v_switch
  from (
    select jsonb_build_object(
             'assetId', at_switch.asset_id,
             'name', coalesce(asset.name, at_switch.hostname, host(at_switch.address), at_switch.mac::text),
             'address', host(at_switch.address),
             'switchName', at_switch.switch_name,
             'port', at_switch.switch_port,
             'state', case
               when active.severity is not null then active.severity
               when infra.prtg_object_id is not null then 'ok'
               else 'unknown' end,
             'incidentId', active.id,
             'rank', case when active.severity = 'down' then 0 when active.severity = 'warning' then 1 else 2 end
           ) as entry
    from at_switch
    left join public.assets asset on asset.id = at_switch.asset_id and asset.tenant_id = p_tenant_id
    left join public.asset_infrastructure infra
      on infra.asset_id = at_switch.asset_id and infra.tenant_id = p_tenant_id
    left join lateral (
      select incident.id, incident.severity
      from public.monitoring_incidents incident
      where incident.tenant_id = p_tenant_id and incident.state = 'active'
        and incident.asset_id = at_switch.asset_id
      order by (incident.severity = 'down') desc, incident.opened_at
      limit 1
    ) active on true
    order by case when active.severity = 'down' then 0 when active.severity = 'warning' then 1 else 2 end,
             at_switch.switch_port
    limit 30
  ) rows;

  return jsonb_build_object(
    'addresses', coalesce(v_addresses, '[]'::jsonb),
    'subnetNeighbours', coalesce(v_subnet, '[]'::jsonb),
    'switchNeighbours', coalesce(v_switch, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.monitoring_incident_matches(text, timestamptz, uuid[], timestamptz, text) from public, anon;
revoke all on function public.monitoring_incident_page(uuid, text, text, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.monitoring_incident_stats(uuid) from public, anon, authenticated;
revoke all on function public.monitoring_incident_report(uuid, integer) from public, anon, authenticated;
revoke all on function public.monitoring_incident_recurrence(uuid) from public, anon, authenticated;
revoke all on function public.monitoring_incident_network(uuid, uuid) from public, anon, authenticated;
grant execute on function public.monitoring_incident_matches(text, timestamptz, uuid[], timestamptz, text) to authenticated, service_role;
grant execute on function public.monitoring_incident_page(uuid, text, text, timestamptz, uuid, integer) to service_role;
grant execute on function public.monitoring_incident_stats(uuid) to service_role;
grant execute on function public.monitoring_incident_report(uuid, integer) to service_role;
grant execute on function public.monitoring_incident_recurrence(uuid) to service_role;
grant execute on function public.monitoring_incident_network(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Realtime: the incident list updates without polling for the incident team.

grant select on public.monitoring_incidents to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'monitoring_incidents'
      and policyname = 'monitoring_incidents_select_incident_team'
  ) then
    create policy monitoring_incidents_select_incident_team
      on public.monitoring_incidents
      for select to authenticated
      using (public.can_work_incidents(tenant_id));
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'monitoring_incidents'
     ) then
    alter publication supabase_realtime add table public.monitoring_incidents;
  end if;
end;
$$;

commit;
