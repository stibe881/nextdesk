begin;

set local search_path = pg_catalog, public;

-- Zusammenführen von Tickets, ausgebaut:
--  * Protokoll jeder Zusammenführung (für «Aufheben» und Berichte)
--  * ticket_merge_into: führt zusammen und übernimmt ins Haupt-Ticket die
--    höchste Priorität und die früheste Frist, Zuweisung und Team (wenn leer),
--    Kategorie, Geräte und Zusatzfelder (wenn leer), Zeiterfassung und offene
--    Checklistenpunkte; schreibt eine interne Notiz
--  * ticket_unmerge: hebt eine Zusammenführung auf
--  * ticket_merge_preview: Vorschau und Vorschlag für das Haupt-Ticket
--  * ticket_merge_stats: Kennzahlen für die Berichte
--  * Automatik für eindeutige Duplikate (gleiche Person, gleicher Betreff,
--    kurz hintereinander)

create table if not exists public.ticket_merges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  primary_ticket_id uuid not null references public.tickets(id) on delete cascade,
  previous_status_id uuid references public.ticket_statuses(id) on delete set null,
  moved_time_entry_ids uuid[] not null default '{}',
  moved_checklist_item_ids uuid[] not null default '{}',
  primary_changes jsonb not null default '{}'::jsonb,
  source text not null default 'manual' check (source in ('manual', 'bulk', 'ai_triage', 'auto_exact')),
  merged_by uuid references public.user_profiles(id) on delete set null,
  merged_at timestamptz not null default timezone('utc', now()),
  unmerged_by uuid references public.user_profiles(id) on delete set null,
  unmerged_at timestamptz
);
create index if not exists ticket_merges_tenant_idx on public.ticket_merges (tenant_id, merged_at desc);
create index if not exists ticket_merges_ticket_idx on public.ticket_merges (ticket_id) where unmerged_at is null;
create index if not exists ticket_merges_primary_idx on public.ticket_merges (primary_ticket_id) where unmerged_at is null;
alter table public.ticket_merges enable row level security;
revoke all on public.ticket_merges from public, anon, authenticated;
grant select, insert, update, delete on public.ticket_merges to service_role;

alter table public.ticket_triage_settings
  add column if not exists auto_merge_exact_duplicates boolean not null default false;

-- Betreff ohne «AW:/RE:/WG:/FW:»-Präfixe, klein, Leerraum vereinheitlicht.
create or replace function public.ticket_subject_key(p_subject text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(
    regexp_replace(lower(coalesce(p_subject, '')), '^(\s*(aw|re|wg|fw|fwd|antw)\s*:\s*)+', ''),
    '\s+', ' ', 'g'));
$$;

create or replace function public.ticket_merge_into(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_primary_id uuid,
  p_actor_id uuid,
  p_source text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket public.tickets%rowtype;
  v_primary public.tickets%rowtype;
  v_resolved uuid;
  v_now timestamptz := timezone('utc', now());
  v_changes jsonb := '{}'::jsonb;
  v_time uuid[] := '{}';
  v_checklist uuid[] := '{}';
  v_position integer;
  v_ticket_rank integer;
  v_primary_rank integer;
  v_requester text;
  v_cursor uuid;
  v_depth integer := 0;
begin
  if p_ticket_id = p_primary_id then
    raise exception 'ticket_relation_self_reference' using errcode = '22023';
  end if;
  select * into v_ticket from public.tickets
   where id = p_ticket_id and tenant_id = p_tenant_id and deleted_at is null for update;
  select * into v_primary from public.tickets
   where id = p_primary_id and tenant_id = p_tenant_id and deleted_at is null for update;
  if v_ticket.id is null or v_primary.id is null then
    raise exception 'ticket_not_found' using errcode = 'P0002';
  end if;
  if v_ticket.merged_into_ticket_id is not null or v_primary.merged_into_ticket_id is not null then
    raise exception 'ticket_merge_already_set' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.ticket_statuses status
     where status.id = v_primary.status_id and status.is_closed
  ) then
    raise exception 'merge_primary_ticket_closed' using errcode = '22023';
  end if;
  -- Kein Kreis: das Haupt-Ticket darf nicht (indirekt) in dieses münden.
  v_cursor := v_primary.merged_into_ticket_id;
  while v_cursor is not null and v_depth < 20 loop
    if v_cursor = v_ticket.id then
      raise exception 'ticket_merge_cycle' using errcode = '22023';
    end if;
    select merged_into_ticket_id into v_cursor from public.tickets where id = v_cursor;
    v_depth := v_depth + 1;
  end loop;

  -- 1. Das zusammengeführte Ticket: Verweis und gelöst.
  select id into v_resolved from public.ticket_statuses
   where tenant_id = p_tenant_id and key = 'resolved' and is_closed;
  update public.tickets
     set merged_into_ticket_id = v_primary.id,
         status_id = coalesce(v_resolved, status_id),
         closed_at = case when v_resolved is not null then v_now else closed_at end,
         resolved_at = case when v_resolved is not null then v_now else resolved_at end,
         waiting_since = case when v_resolved is not null then null else waiting_since end
   where id = v_ticket.id;

  -- 2. Priorität: die höhere gilt.
  select sort_order into v_ticket_rank from public.ticket_priorities where id = v_ticket.priority_id;
  select sort_order into v_primary_rank from public.ticket_priorities where id = v_primary.priority_id;
  if coalesce(v_ticket_rank, -1) > coalesce(v_primary_rank, -1) then
    v_changes := v_changes || jsonb_build_object('priorityId', v_primary.priority_id);
    v_primary.priority_id := v_ticket.priority_id;
  end if;
  -- Fristen: die frühere gilt (nur offene Fristen).
  if v_ticket.resolution_due_at is not null
     and (v_primary.resolution_due_at is null or v_ticket.resolution_due_at < v_primary.resolution_due_at) then
    v_changes := v_changes || jsonb_build_object('resolutionDueAt', v_primary.resolution_due_at);
    v_primary.resolution_due_at := v_ticket.resolution_due_at;
  end if;
  if v_primary.first_responded_at is null and v_ticket.first_responded_at is null
     and v_ticket.response_due_at is not null
     and (v_primary.response_due_at is null or v_ticket.response_due_at < v_primary.response_due_at) then
    v_changes := v_changes || jsonb_build_object('responseDueAt', v_primary.response_due_at);
    v_primary.response_due_at := v_ticket.response_due_at;
  end if;
  -- Zuweisung und Team: übernehmen, wenn im Haupt-Ticket leer.
  if v_primary.assigned_team_id is null and v_ticket.assigned_team_id is not null
     and exists (
       select 1 from public.teams team
        where team.id = v_ticket.assigned_team_id and team.active
          and team.department_id = v_primary.department_id
     ) then
    v_changes := v_changes || jsonb_build_object('assignedTeamId', null);
    v_primary.assigned_team_id := v_ticket.assigned_team_id;
  end if;
  if v_primary.assigned_agent_id is null and v_ticket.assigned_agent_id is not null
     and v_primary.department_id = v_ticket.department_id then
    v_changes := v_changes || jsonb_build_object('assignedAgentId', null);
    v_primary.assigned_agent_id := v_ticket.assigned_agent_id;
  end if;
  -- Kategorie: übernehmen, wenn im Haupt-Ticket leer.
  if v_primary.category_id is null and v_ticket.category_id is not null then
    v_changes := v_changes || jsonb_build_object('categoryId', null);
    v_primary.category_id := v_ticket.category_id;
    v_primary.subcategory_id := v_ticket.subcategory_id;
  end if;
  update public.tickets
     set priority_id = v_primary.priority_id,
         resolution_due_at = v_primary.resolution_due_at,
         response_due_at = v_primary.response_due_at,
         assigned_team_id = v_primary.assigned_team_id,
         assigned_agent_id = v_primary.assigned_agent_id,
         category_id = v_primary.category_id,
         subcategory_id = v_primary.subcategory_id
   where id = v_primary.id;

  -- Geräte und Zusatzfelder ergänzen (Vorhandenes bleibt).
  insert into public.ticket_assets (tenant_id, ticket_id, asset_id, linked_by)
  select tenant_id, v_primary.id, asset_id, p_actor_id
    from public.ticket_assets where ticket_id = v_ticket.id
  on conflict do nothing;
  insert into public.ticket_custom_field_values (
    ticket_id, tenant_id, definition_id, text_value, number_value, date_value, boolean_value, select_value, updated_at)
  select v_primary.id, value.tenant_id, value.definition_id, value.text_value, value.number_value,
         value.date_value, value.boolean_value, value.select_value, v_now
    from public.ticket_custom_field_values value
   where value.ticket_id = v_ticket.id
     and not exists (
       select 1 from public.ticket_custom_field_values existing
        where existing.ticket_id = v_primary.id and existing.definition_id = value.definition_id)
  on conflict do nothing;

  -- Zeiterfassung und offene Checklistenpunkte wandern mit.
  with moved as (
    update public.ticket_time_entries set ticket_id = v_primary.id
     where ticket_id = v_ticket.id returning id
  ) select coalesce(array_agg(id), '{}') into v_time from moved;
  select coalesce(max(position), 0) into v_position
    from public.ticket_checklist_items where ticket_id = v_primary.id;
  with candidates as (
    select id, row_number() over (order by position, created_at) as rn
      from public.ticket_checklist_items
     where ticket_id = v_ticket.id and completed_at is null
  ), moved as (
    update public.ticket_checklist_items item
       set ticket_id = v_primary.id, position = v_position + candidates.rn
      from candidates where item.id = candidates.id
    returning item.id
  ) select coalesce(array_agg(id), '{}') into v_checklist from moved;

  -- Interne Notiz im Haupt-Ticket.
  select coalesce(nullif(btrim(requester.display_name), ''), requester.email)
    into v_requester
    from public.ticket_requesters requester
   where requester.id = v_ticket.requester_contact_id;
  if p_actor_id is not null then
    insert into public.ticket_comments (ticket_id, author_id, visibility, body)
    values (
      v_primary.id, p_actor_id, 'internal',
      format('Zusammengeführt aus %s «%s»%s.', v_ticket.ticket_number, v_ticket.subject,
        case when v_requester is not null then format(' (gemeldet von %s)', v_requester) else '' end)
    );
  end if;

  insert into public.ticket_merges (
    tenant_id, ticket_id, primary_ticket_id, previous_status_id, moved_time_entry_ids,
    moved_checklist_item_ids, primary_changes, source, merged_by)
  values (
    p_tenant_id, v_ticket.id, v_primary.id, v_ticket.status_id, v_time, v_checklist,
    v_changes, coalesce(p_source, 'manual'), p_actor_id);

  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values
    (v_ticket.id, p_actor_id, 'ticket.merged',
     jsonb_build_object('primaryTicketId', v_primary.id, 'statusAutomaticallyUpdated', v_resolved is not null, 'source', p_source)),
    (v_primary.id, p_actor_id, 'ticket.merge_received',
     jsonb_build_object('mergedTicketId', v_ticket.id, 'statusAutomaticallyUpdated', v_resolved is not null,
       'source', p_source, 'adopted', v_changes,
       'movedTimeEntries', coalesce(array_length(v_time, 1), 0),
       'movedChecklistItems', coalesce(array_length(v_checklist, 1), 0)));

  return jsonb_build_object(
    'merged', true,
    'statusAutomaticallyUpdated', v_resolved is not null,
    'adopted', v_changes,
    'movedTimeEntries', coalesce(array_length(v_time, 1), 0),
    'movedChecklistItems', coalesce(array_length(v_checklist, 1), 0));
end;
$$;

revoke all on function public.ticket_merge_into(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ticket_merge_into(uuid, uuid, uuid, uuid, text) to service_role;

create or replace function public.ticket_unmerge(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_merge public.ticket_merges%rowtype;
  v_ticket public.tickets%rowtype;
  v_primary_number text;
  v_status uuid;
  v_closed boolean;
begin
  select * into v_ticket from public.tickets
   where id = p_ticket_id and tenant_id = p_tenant_id and deleted_at is null for update;
  if v_ticket.id is null or v_ticket.merged_into_ticket_id is null then
    raise exception 'ticket_not_merged' using errcode = 'P0002';
  end if;
  select * into v_merge from public.ticket_merges
   where ticket_id = p_ticket_id and tenant_id = p_tenant_id and unmerged_at is null
   order by merged_at desc limit 1;

  -- Status vor dem Zusammenführen; «Neu» geht nicht zurück (Statusregel),
  -- dann wie geschlossene Status «In Bearbeitung».
  v_status := v_merge.previous_status_id;
  select is_closed or key = 'new' into v_closed from public.ticket_statuses where id = v_status;
  if v_status is null or coalesce(v_closed, true) then
    select id into v_status from public.ticket_statuses
     where tenant_id = p_tenant_id and key = 'in_progress' and not is_closed limit 1;
  end if;
  update public.tickets
     set merged_into_ticket_id = null,
         status_id = coalesce(v_status, status_id),
         closed_at = null,
         resolved_at = null
   where id = v_ticket.id;

  if v_merge.id is not null then
    update public.ticket_time_entries set ticket_id = v_ticket.id
     where id = any(v_merge.moved_time_entry_ids) and ticket_id = v_merge.primary_ticket_id;
    update public.ticket_checklist_items set ticket_id = v_ticket.id
     where id = any(v_merge.moved_checklist_item_ids) and ticket_id = v_merge.primary_ticket_id;
    update public.ticket_merges set unmerged_at = timezone('utc', now()), unmerged_by = p_actor_id
     where id = v_merge.id;
  end if;

  select ticket_number into v_primary_number from public.tickets where id = v_ticket.merged_into_ticket_id;
  if p_actor_id is not null then
    insert into public.ticket_comments (ticket_id, author_id, visibility, body)
    values (v_ticket.merged_into_ticket_id, p_actor_id, 'internal',
      format('Zusammenführung mit %s «%s» aufgehoben.', v_ticket.ticket_number, v_ticket.subject));
  end if;
  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values
    (v_ticket.id, p_actor_id, 'ticket.unmerged', jsonb_build_object('primaryTicketId', v_ticket.merged_into_ticket_id)),
    (v_ticket.merged_into_ticket_id, p_actor_id, 'ticket.unmerge_received', jsonb_build_object('mergedTicketId', v_ticket.id));
  return jsonb_build_object('unmerged', true, 'primaryTicketNumber', v_primary_number);
end;
$$;

revoke all on function public.ticket_unmerge(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ticket_unmerge(uuid, uuid, uuid) to service_role;

-- Vorschau: was beim Zusammenführen passiert, und welches Ticket sich als
-- Haupt-Ticket anbietet (meiste Antworten, dann zugewiesen, dann ältestes).
create or replace function public.ticket_merge_preview(
  p_tenant_id uuid,
  p_ticket_ids uuid[],
  p_primary_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_suggested uuid;
  v_primary uuid;
  v_result jsonb;
begin
  select ticket.id into v_suggested
    from public.tickets ticket
    join public.ticket_statuses status on status.id = ticket.status_id
   where ticket.tenant_id = p_tenant_id and ticket.id = any(p_ticket_ids)
     and ticket.deleted_at is null and ticket.merged_into_ticket_id is null and not status.is_closed
   order by (select count(*) from public.ticket_comments comment where comment.ticket_id = ticket.id) desc,
            (ticket.assigned_agent_id is not null) desc,
            ticket.created_at
   limit 1;
  v_primary := coalesce(p_primary_id, v_suggested);

  select jsonb_build_object(
    'suggestedPrimaryId', v_suggested,
    'primaryId', v_primary,
    'tickets', coalesce(jsonb_agg(jsonb_build_object(
        'id', ticket.id,
        'ticketNumber', ticket.ticket_number,
        'subject', ticket.subject,
        'isClosed', status.is_closed,
        'mergedInto', ticket.merged_into_ticket_id,
        'comments', (select count(*) from public.ticket_comments comment where comment.ticket_id = ticket.id),
        'requesterName', coalesce(nullif(btrim(requester.display_name), ''), requester.email),
        'requesterEmail', lower(requester.email),
        'priorityLabel', priority.label,
        'prioritySort', priority.sort_order,
        'resolutionDueAt', ticket.resolution_due_at,
        'assignedAgentName', agent.display_name,
        'teamName', team.name,
        'timeMinutes', (select coalesce(sum(minutes), 0) from public.ticket_time_entries entry where entry.ticket_id = ticket.id),
        'openChecklistItems', (select count(*) from public.ticket_checklist_items item where item.ticket_id = ticket.id and item.completed_at is null),
        'mailChannel', ticket.exchange_mail_channel_id is not null
      ) order by ticket.created_at), '[]'::jsonb)
  ) into v_result
    from public.tickets ticket
    join public.ticket_statuses status on status.id = ticket.status_id
    left join public.ticket_priorities priority on priority.id = ticket.priority_id
    left join public.ticket_requesters requester on requester.id = ticket.requester_contact_id
    left join public.user_profiles agent on agent.id = ticket.assigned_agent_id
    left join public.teams team on team.id = ticket.assigned_team_id
   where ticket.tenant_id = p_tenant_id and ticket.id = any(p_ticket_ids) and ticket.deleted_at is null;
  return v_result;
end;
$$;

revoke all on function public.ticket_merge_preview(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.ticket_merge_preview(uuid, uuid[], uuid) to service_role;

-- Berichte: wie oft zusammengeführt wurde, woher die Duplikate kamen und wer
-- häufig doppelt meldet.
create or replace function public.ticket_merge_stats(p_tenant_id uuid, p_days integer default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_since timestamptz := timezone('utc', now()) - make_interval(days => greatest(1, least(coalesce(p_days, 90), 730)));
begin
  if not public.is_tenant_ticket_agent(p_tenant_id) then
    raise exception 'Ticket agent required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'days', greatest(1, least(coalesce(p_days, 90), 730)),
    'total', (select count(*) from public.ticket_merges m
               where m.tenant_id = p_tenant_id and m.merged_at >= v_since and m.unmerged_at is null),
    'unmerged', (select count(*) from public.ticket_merges m
               where m.tenant_id = p_tenant_id and m.merged_at >= v_since and m.unmerged_at is not null),
    'bySource', coalesce((
      select jsonb_agg(jsonb_build_object('source', source, 'count', total) order by total desc)
      from (
        select coalesce(ticket.source, 'unbekannt') as source, count(*) as total
          from public.ticket_merges m join public.tickets ticket on ticket.id = m.ticket_id
         where m.tenant_id = p_tenant_id and m.merged_at >= v_since and m.unmerged_at is null
         group by 1) s), '[]'::jsonb),
    'byMethod', coalesce((
      select jsonb_agg(jsonb_build_object('method', source, 'count', total) order by total desc)
      from (
        select m.source, count(*) as total from public.ticket_merges m
         where m.tenant_id = p_tenant_id and m.merged_at >= v_since and m.unmerged_at is null
         group by 1) s), '[]'::jsonb),
    'topRequesters', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'email', email, 'count', total) order by total desc)
      from (
        select coalesce(nullif(btrim(requester.display_name), ''), requester.email) as name,
               lower(requester.email) as email, count(*) as total
          from public.ticket_merges m
          join public.tickets ticket on ticket.id = m.ticket_id
          join public.ticket_requesters requester on requester.id = ticket.requester_contact_id
         where m.tenant_id = p_tenant_id and m.merged_at >= v_since and m.unmerged_at is null
         group by 1, 2 order by count(*) desc limit 8) s), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.ticket_merge_stats(uuid, integer) from public, anon;
grant execute on function public.ticket_merge_stats(uuid, integer) to authenticated, service_role;

-- Automatik: ein neues Ticket ist ein eindeutiges Duplikat, wenn dieselbe
-- Person innerhalb von 10 Minuten ein offenes Ticket mit gleichem Betreff
-- erstellt hat. Dann wird es in jenes zusammengeführt (Einstellung
-- «Eindeutige Duplikate automatisch zusammenführen»).
create or replace function public.ticket_auto_merge_exact_duplicate(p_ticket_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket public.tickets%rowtype;
  v_primary uuid;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id and deleted_at is null;
  if v_ticket.id is null or v_ticket.merged_into_ticket_id is not null
     or v_ticket.requester_contact_id is null or v_ticket.is_security_case then
    return null;
  end if;
  if not exists (
    select 1 from public.ticket_triage_settings settings
     where settings.tenant_id = v_ticket.tenant_id and settings.auto_merge_exact_duplicates
  ) then
    return null;
  end if;
  select other.id into v_primary
    from public.tickets other
    join public.ticket_statuses status on status.id = other.status_id
   where other.tenant_id = v_ticket.tenant_id
     and other.id <> v_ticket.id
     and other.requester_contact_id = v_ticket.requester_contact_id
     and other.deleted_at is null
     and other.merged_into_ticket_id is null
     and other.spam_at is null
     and not status.is_closed
     and other.created_at <= v_ticket.created_at
     and other.created_at >= v_ticket.created_at - interval '10 minutes'
     and public.ticket_subject_key(other.subject) = public.ticket_subject_key(v_ticket.subject)
     and public.ticket_subject_key(v_ticket.subject) <> ''
   order by other.created_at
   limit 1;
  if v_primary is null then
    return null;
  end if;
  perform public.ticket_merge_into(v_ticket.tenant_id, v_ticket.id, v_primary, null, 'auto_exact');
  return v_primary;
exception when others then
  return null;
end;
$$;

revoke all on function public.ticket_auto_merge_exact_duplicate(uuid) from public, anon, authenticated;
grant execute on function public.ticket_auto_merge_exact_duplicate(uuid) to service_role;


-- Mögliche Duplikate eines Tickets: offen und nicht zusammengeführt; von
-- derselben Person innerhalb von 3 Tagen oder mit gleichem Betreff innerhalb
-- von 14 Tagen.
create or replace function public.ticket_duplicate_candidates(p_ticket_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with base as (
    select * from public.tickets
     where id = p_ticket_id and deleted_at is null and merged_into_ticket_id is null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', candidate.id,
      'ticketNumber', candidate.ticket_number,
      'subject', candidate.subject,
      'createdAt', candidate.created_at,
      'sameRequester', candidate.same_requester,
      'sameSubject', candidate.same_subject
    ) order by candidate.created_at), '[]'::jsonb)
  from (
    select other.id, other.ticket_number, other.subject, other.created_at,
           (base.requester_contact_id is not null
             and other.requester_contact_id = base.requester_contact_id) as same_requester,
           (public.ticket_subject_key(other.subject) = public.ticket_subject_key(base.subject)) as same_subject
      from base
      join public.tickets other on other.tenant_id = base.tenant_id
      join public.ticket_statuses status on status.id = other.status_id
     where other.id <> base.id
       and other.deleted_at is null
       and other.spam_at is null
       and other.merged_into_ticket_id is null
       and not status.is_closed
       and (
         (base.requester_contact_id is not null
           and other.requester_contact_id = base.requester_contact_id
           and other.created_at between base.created_at - interval '3 days' and base.created_at + interval '3 days')
         or (char_length(public.ticket_subject_key(base.subject)) >= 8
           and public.ticket_subject_key(other.subject) = public.ticket_subject_key(base.subject)
           and other.created_at between base.created_at - interval '14 days' and base.created_at + interval '14 days')
       )
     order by other.created_at
     limit 5
  ) candidate;
$$;

revoke all on function public.ticket_duplicate_candidates(uuid) from public, anon, authenticated;
grant execute on function public.ticket_duplicate_candidates(uuid) to service_role;

commit;
