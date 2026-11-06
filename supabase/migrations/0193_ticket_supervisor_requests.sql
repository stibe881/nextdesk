begin;

set local search_path = pg_catalog, public;

-- Anfrage an eine vorgesetzte Person (Agent) aus einem Ticket.
--
-- Ein Agent wählt eine Person mit Zugriff auf das Ticket (der Vorgesetzte aus
-- dem Verzeichnis ist vorausgewählt) und stellt eine Frage. Die Person erhält
-- eine Benachrichtigung und kann direkt dort antworten. Frage und Antwort
-- werden als interne Notizen im Ticket festgehalten.

create table if not exists public.ticket_supervisor_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  asked_by uuid not null references public.user_profiles(id) on delete cascade,
  recipient_id uuid not null references public.user_profiles(id) on delete cascade,
  question text not null
    check (char_length(btrim(question)) between 1 and 4000),
  answer text
    check (answer is null or char_length(btrim(answer)) between 1 and 4000),
  status text not null default 'open'
    check (status in ('open', 'answered')),
  created_at timestamptz not null default timezone('utc', now()),
  answered_at timestamptz,
  constraint ticket_supervisor_requests_answer_consistent check (
    (status = 'open' and answer is null and answered_at is null)
    or (status = 'answered' and answer is not null and answered_at is not null)
  )
);

create index if not exists ticket_supervisor_requests_ticket_idx
  on public.ticket_supervisor_requests (ticket_id, created_at desc);
create index if not exists ticket_supervisor_requests_recipient_open_idx
  on public.ticket_supervisor_requests (recipient_id, created_at desc)
  where status = 'open';

alter table public.ticket_supervisor_requests enable row level security;
revoke all on table public.ticket_supervisor_requests from public, anon, authenticated;
grant select on table public.ticket_supervisor_requests to authenticated;
grant all on table public.ticket_supervisor_requests to service_role;

create policy ticket_supervisor_requests_select_involved
  on public.ticket_supervisor_requests
  for select to authenticated
  using (
    recipient_id = auth.uid()
    or (public.can_read_ticket(ticket_id) and public.can_read_internal_note(ticket_id))
  );

-- Name for notes and notifications.
create or replace function public.ticket_supervisor_person_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    (select nullif(btrim(profile.display_name), '')
       from public.user_profiles profile where profile.id = p_user_id),
    'Unbekannte Person'
  );
$$;
revoke all on function public.ticket_supervisor_person_name(uuid) from public, anon, authenticated;

-- People the signed-in agent can ask about a ticket: active members of the
-- tenant who may read the ticket as agents (department read permission and
-- team access). The person's manager from the directory is marked.
create or replace function public.list_ticket_supervisor_candidates(p_ticket_id uuid)
returns table (user_id uuid, display_name text, is_manager boolean)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_ticket public.tickets;
  v_manager_id uuid;
begin
  if auth.uid() is null or not public.can_read_ticket(p_ticket_id)
    or not public.can_read_internal_note(p_ticket_id) then
    return;
  end if;
  select * into v_ticket from public.tickets where id = p_ticket_id;

  select coalesce(
    (select directory.manager_user_id
       from public.tenant_member_directory directory
      where directory.tenant_id = v_ticket.tenant_id
        and directory.user_id = auth.uid()),
    (select manager.local_user_id
       from public.tenant_entra_directory_people person
       join public.tenant_entra_directory_people manager
         on manager.tenant_id = person.tenant_id
        and manager.entra_object_id = person.manager_entra_object_id
      where person.tenant_id = v_ticket.tenant_id
        and person.local_user_id = auth.uid()
      limit 1)
  ) into v_manager_id;

  return query
  select
    membership.user_id,
    public.ticket_supervisor_person_name(membership.user_id),
    coalesce(membership.user_id = v_manager_id, false)
  from public.tenant_memberships membership
  where membership.tenant_id = v_ticket.tenant_id
    and membership.status = 'active'
    and membership.user_id <> auth.uid()
    and public.user_has_ticket_permission_for(
      membership.user_id, v_ticket.tenant_id, v_ticket.department_id,
      'ticket.read.department'
    )
    and public.can_user_access_ticket_team(v_ticket.id, membership.user_id)
  order by coalesce(membership.user_id = v_manager_id, false) desc,
    public.ticket_supervisor_person_name(membership.user_id);
end;
$$;
revoke all on function public.list_ticket_supervisor_candidates(uuid) from public, anon;
grant execute on function public.list_ticket_supervisor_candidates(uuid) to authenticated;

create or replace function public.create_ticket_supervisor_request(
  p_ticket_id uuid,
  p_recipient_id uuid,
  p_question text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_ticket public.tickets;
  v_request_id uuid;
  v_question text := btrim(coalesce(p_question, ''));
  v_asker_name text;
  v_recipient_name text;
begin
  if auth.uid() is null or not public.can_read_ticket(p_ticket_id)
    or not public.can_read_internal_note(p_ticket_id) then
    raise exception 'Ticket access denied' using errcode = '42501';
  end if;
  if char_length(v_question) not between 1 and 4000 then
    raise exception 'Invalid question' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.list_ticket_supervisor_candidates(p_ticket_id) candidate
    where candidate.user_id = p_recipient_id
  ) then
    raise exception 'Recipient cannot be asked' using errcode = '23514';
  end if;

  select * into v_ticket from public.tickets where id = p_ticket_id;
  v_asker_name := public.ticket_supervisor_person_name(auth.uid());
  v_recipient_name := public.ticket_supervisor_person_name(p_recipient_id);

  insert into public.ticket_supervisor_requests (
    tenant_id, ticket_id, asked_by, recipient_id, question
  ) values (
    v_ticket.tenant_id, v_ticket.id, auth.uid(), p_recipient_id, v_question
  ) returning id into v_request_id;

  insert into public.ticket_comments (ticket_id, author_id, visibility, body)
  values (
    v_ticket.id, auth.uid(), 'internal',
    'Anfrage an ' || v_recipient_name || E':\n\n' || v_question
  );

  perform public.push_insert_ticket_notification(
    v_ticket.tenant_id, p_recipient_id, v_ticket.id,
    'ticket.supervisor_request',
    jsonb_build_object(
      'requestId', v_request_id,
      'question', left(v_question, 1000),
      'askedByName', v_asker_name
    ),
    auth.uid()
  );

  return v_request_id;
end;
$$;
revoke all on function public.create_ticket_supervisor_request(uuid, uuid, text) from public, anon;
grant execute on function public.create_ticket_supervisor_request(uuid, uuid, text) to authenticated;

create or replace function public.answer_ticket_supervisor_request(
  p_request_id uuid,
  p_answer text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_request public.ticket_supervisor_requests;
  v_answer text := btrim(coalesce(p_answer, ''));
  v_recipient_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if char_length(v_answer) not between 1 and 4000 then
    raise exception 'Invalid answer' using errcode = '22023';
  end if;

  select * into v_request
  from public.ticket_supervisor_requests
  where id = p_request_id
  for update;
  if not found or v_request.recipient_id <> auth.uid() then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'open' then
    raise exception 'Request already answered' using errcode = '23505';
  end if;
  if not public.ticket_notification_recipient_authorized(
    v_request.tenant_id, v_request.ticket_id, auth.uid()
  ) then
    raise exception 'Ticket access denied' using errcode = '42501';
  end if;

  update public.ticket_supervisor_requests
  set status = 'answered',
      answer = v_answer,
      answered_at = timezone('utc', now())
  where id = v_request.id;

  v_recipient_name := public.ticket_supervisor_person_name(auth.uid());

  insert into public.ticket_comments (ticket_id, author_id, visibility, body)
  values (
    v_request.ticket_id, auth.uid(), 'internal',
    'Antwort auf die Anfrage von '
      || public.ticket_supervisor_person_name(v_request.asked_by)
      || E':\n\n' || v_answer
  );

  perform public.push_insert_ticket_notification(
    v_request.tenant_id, v_request.asked_by, v_request.ticket_id,
    'ticket.supervisor_answer',
    jsonb_build_object(
      'requestId', v_request.id,
      'answer', left(v_answer, 1000),
      'answeredByName', v_recipient_name
    ),
    auth.uid()
  );

  -- The request notification is done once it is answered.
  update public.ticket_notifications
  set read_at = coalesce(read_at, timezone('utc', now()))
  where user_id = auth.uid()
    and kind = 'ticket.supervisor_request'
    and payload ->> 'requestId' = v_request.id::text;

  return v_request.id;
end;
$$;
revoke all on function public.answer_ticket_supervisor_request(uuid, text) from public, anon;
grant execute on function public.answer_ticket_supervisor_request(uuid, text) to authenticated;

-- Push: both kinds use the "mention" category (a person is addressed directly).
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
    when p_kind = 'ticket.mention' then 'mention'
    when p_kind in ('ticket.supervisor_request', 'ticket.supervisor_answer') then 'mention'
    when p_kind = 'ticket.resolved' then 'resolved'
    when p_kind = 'ticket.approval.requested' then 'approval'
    when p_kind = 'ticket.follow_up_due' then 'follow_up'
    when p_kind = 'ticket.escalation_opened' then 'escalation'
    when p_kind like 'ticket.sla.%' then 'sla'
    when p_kind = 'contract.deadline' then 'contract_deadline'
    when p_kind = 'inventory.low_stock' then 'inventory_low_stock'
    when p_kind like 'shop.order.%' then 'shop'
    when p_kind like 'service_task.%' then 'service_task'
    else null
  end;
$function$;

commit;
