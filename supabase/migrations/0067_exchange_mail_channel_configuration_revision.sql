begin;

alter table public.exchange_mail_channels
  add column if not exists configuration_version bigint not null default 1;

alter table public.exchange_mail_channels
  drop constraint if exists exchange_mail_channels_configuration_version_valid;
alter table public.exchange_mail_channels
  add constraint exchange_mail_channels_configuration_version_valid
  check (configuration_version >= 1);

alter table public.exchange_mail_subscriptions
  add column if not exists configuration_version bigint;
alter table public.exchange_mail_subscriptions
  add column if not exists source_entra_tenant_id uuid;
alter table public.exchange_mail_subscriptions
  drop constraint if exists exchange_mail_subscriptions_configuration_version_valid;
alter table public.exchange_mail_subscriptions
  add constraint exchange_mail_subscriptions_configuration_version_valid
  check (configuration_version is null or configuration_version >= 1);

alter table public.mail_messages
  add column if not exists exchange_configuration_version bigint;
alter table public.mail_messages
  drop constraint if exists mail_messages_exchange_configuration_version_valid;
alter table public.mail_messages
  add constraint mail_messages_exchange_configuration_version_valid
  check (
    exchange_configuration_version is null
    or exchange_configuration_version >= 1
  );

alter table public.exchange_mail_subscriptions
  drop constraint if exists exchange_mail_subscriptions_status_check;
alter table public.exchange_mail_subscriptions
  add constraint exchange_mail_subscriptions_status_check
  check (status in ('active', 'removal_pending', 'removed', 'expired', 'quarantined'));

update public.exchange_mail_subscriptions
set status = 'quarantined'
where status in ('active', 'removal_pending')
  and (configuration_version is null or source_entra_tenant_id is null);

create or replace function public.exchange_mail_kick_maintenance()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, mail_private, pg_temp
as $$
begin
  if exists (
    select 1 from public.exchange_mail_channels channel where channel.status = 'active'
  ) or exists (
    select 1
    from public.exchange_mail_subscriptions subscription
    where subscription.status = 'removal_pending'
  ) or exists (
    select 1
    from public.mail_messages message
    where message.processing_status in ('pending', 'failed')
      and message.next_attempt_at <= timezone('utc', now())
  ) then
    perform public.exchange_mail_wake_worker(jsonb_build_object('action', 'maintenance'));
  end if;
exception when others then
  return;
end;
$$;
revoke all on function public.exchange_mail_kick_maintenance() from public, anon, authenticated;
grant execute on function public.exchange_mail_kick_maintenance() to service_role;

drop function if exists public.exchange_mail_enqueue_inbound(uuid, uuid, text);
create function public.exchange_mail_enqueue_inbound(
  p_tenant_id uuid,
  p_channel_id uuid,
  p_configuration_version bigint,
  p_graph_message_id text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_message_id uuid;
begin
  if p_tenant_id is null
     or p_channel_id is null
     or p_configuration_version is null
     or p_configuration_version < 1
     or p_graph_message_id is null
     or char_length(p_graph_message_id) not between 1 and 1024 then
    raise exception 'Invalid Exchange inbound message reference' using errcode = '22023';
  end if;

  insert into public.mail_messages (
    tenant_id, channel_id, exchange_configuration_version, direction, graph_message_id
  )
  select p_tenant_id, p_channel_id, p_configuration_version, 'inbound', p_graph_message_id
  from public.exchange_mail_channels channel
  where channel.id = p_channel_id
    and channel.tenant_id = p_tenant_id
    and channel.configuration_version = p_configuration_version
    and channel.status = 'active'
  on conflict do nothing
  returning id into v_message_id;
  return v_message_id;
end;
$$;
revoke all on function public.exchange_mail_enqueue_inbound(uuid, uuid, bigint, text)
  from public, anon, authenticated;
grant execute on function public.exchange_mail_enqueue_inbound(uuid, uuid, bigint, text)
  to service_role;

create or replace function public.exchange_mail_enqueue_agent_reply()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, mail_private, pg_temp
as $$
declare
  v_ticket record;
  v_channel record;
  v_recipient text;
  v_service_identity uuid;
begin
  if new.visibility <> 'external'
     or new.channel <> 'portal'
     or new.requester_contact_id is not null then
    return new;
  end if;
  select identity.user_id into v_service_identity
  from mail_private.service_identity identity
  where identity.singleton;
  if v_service_identity is not null and new.author_id = v_service_identity then
    return new;
  end if;
  select ticket.id, ticket.tenant_id, ticket.requester_id, ticket.requester_contact_id, ticket.subject
  into v_ticket
  from public.tickets ticket
  where ticket.id = new.ticket_id;
  if not found or new.author_id = v_ticket.requester_id then
    return new;
  end if;
  if not public.exchange_mail_feature_enabled(v_ticket.tenant_id)
     or not exists (
       select 1
       from public.tenant_memberships membership
       join public.user_role_assignments assignment
         on assignment.tenant_id = membership.tenant_id
        and assignment.user_id = membership.user_id
        and assignment.starts_at <= timezone('utc', now())
        and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
       join public.roles role
         on role.id = assignment.role_id
        and role.tenant_id = assignment.tenant_id
        and role.active
        and role.scope in ('tenant', 'department')
       join public.role_permissions permission on permission.role_id = role.id
       where membership.tenant_id = v_ticket.tenant_id
         and membership.user_id = new.author_id
         and membership.status = 'active'
         and permission.permission_code in (
           'ticket.read.department', 'ticket.read.assigned', 'ticket.update', 'ticket.internal_notes.read'
         )
     ) then
    return new;
  end if;
  select channel.id, channel.mailbox_address, channel.configuration_version
  into v_channel
  from public.exchange_mail_channels channel
  where channel.tenant_id = v_ticket.tenant_id
    and channel.status = 'active'
    and channel.send_agent_replies
  limit 1;
  if not found then
    return new;
  end if;
  select requester.email into v_recipient
  from public.ticket_requesters requester
  where requester.id = v_ticket.requester_contact_id
    and requester.tenant_id = v_ticket.tenant_id
    and requester.email is not null;
  if v_recipient is null then
    return new;
  end if;
  insert into public.mail_messages (
    tenant_id, channel_id, exchange_configuration_version, direction, kind, ticket_id, comment_id,
    from_address, to_addresses, subject
  ) values (
    v_ticket.tenant_id, v_channel.id, v_channel.configuration_version, 'outbound', 'agent_reply', v_ticket.id, new.id,
    v_channel.mailbox_address, array[v_recipient], v_ticket.subject
  ) on conflict do nothing;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.exchange_mail_enqueue_agent_reply() from public, anon, authenticated;

create or replace function public.exchange_mail_enqueue_resolution()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_channel record;
  v_recipient text;
begin
  if new.status_id is not distinct from old.status_id then
    return new;
  end if;
  if not exists (
    select 1 from public.ticket_statuses status
    where status.id = new.status_id
      and status.tenant_id = new.tenant_id
      and status.key = 'resolved'
  ) or not public.exchange_mail_feature_enabled(new.tenant_id) then
    return new;
  end if;
  select channel.id, channel.mailbox_address, channel.configuration_version into v_channel
  from public.exchange_mail_channels channel
  where channel.tenant_id = new.tenant_id
    and channel.status = 'active'
    and channel.send_resolution
  limit 1;
  if not found then
    return new;
  end if;
  select requester.email into v_recipient
  from public.ticket_requesters requester
  where requester.id = new.requester_contact_id
    and requester.tenant_id = new.tenant_id
    and requester.email is not null;
  if v_recipient is null then
    return new;
  end if;
  insert into public.mail_messages (
    tenant_id, channel_id, exchange_configuration_version, direction, kind, ticket_id, from_address, to_addresses, subject
  ) values (
    new.tenant_id, v_channel.id, v_channel.configuration_version, 'outbound', 'resolution', new.id,
    v_channel.mailbox_address, array[v_recipient], new.subject
  ) on conflict do nothing;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.exchange_mail_enqueue_resolution() from public, anon, authenticated;

create or replace function public.exchange_mail_commit_inbound(
  p_tenant_id uuid,
  p_channel_id uuid,
  p_configuration_version bigint,
  p_message_id uuid,
  p_candidate_ticket_id uuid,
  p_reply_authorized boolean,
  p_requester_contact_id uuid,
  p_sender text,
  p_subject text,
  p_body text,
  p_internet_message_id text,
  p_conversation_id text,
  p_to_addresses text[],
  p_cc_addresses text[]
)
returns table (
  outcome text,
  kind text,
  ticket_id uuid,
  ticket_number text,
  comment_id uuid,
  requester_contact_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, mail_private, pg_temp
as $$
declare
  v_channel public.exchange_mail_channels%rowtype;
  v_message public.mail_messages%rowtype;
  v_contact public.ticket_requesters%rowtype;
  v_ticket public.tickets%rowtype;
  v_department record;
  v_status uuid;
  v_priority uuid;
  v_service_identity uuid;
  v_number text;
  v_comment_id uuid;
  v_kind text;
begin
  if p_tenant_id is null or p_channel_id is null or p_message_id is null
     or p_configuration_version is null or p_configuration_version < 1
     or p_requester_contact_id is null or p_sender is null
     or char_length(p_sender) not between 3 and 254 then
    raise exception 'Invalid Exchange inbound commit' using errcode = '22023';
  end if;

  select * into v_channel
  from public.exchange_mail_channels channel
  where channel.id = p_channel_id and channel.tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'Exchange channel not found' using errcode = 'P0002';
  end if;
  select * into v_message
  from public.mail_messages message
  where message.id = p_message_id
    and message.tenant_id = p_tenant_id
    and message.channel_id = p_channel_id
    and message.direction = 'inbound'
  for update;
  if not found then
    raise exception 'Exchange message not found' using errcode = 'P0002';
  end if;
  if v_message.processing_status = 'processed' then
    return query select 'already_processed', v_message.kind, v_message.ticket_id,
      ticket.ticket_number, v_message.comment_id, null::uuid
    from public.tickets ticket where ticket.id = v_message.ticket_id;
    return;
  end if;
  if v_message.processing_status <> 'processing'
     or v_message.exchange_configuration_version is distinct from p_configuration_version
     or v_channel.status <> 'active'
     or v_channel.configuration_version <> p_configuration_version then
    update public.mail_messages
    set processing_status = 'ignored', ignore_reason = 'channel_reconfigured'
    where id = v_message.id and processing_status in ('pending', 'processing', 'failed');
    return query select 'ignored', null::text, null::uuid, null::text, null::uuid, null::uuid;
    return;
  end if;
  select * into v_contact
  from public.ticket_requesters requester
  where requester.id = p_requester_contact_id
    and requester.tenant_id = p_tenant_id
    and lower(requester.email) = lower(p_sender)
  for key share;
  if not found then
    raise exception 'Exchange requester contact unavailable' using errcode = 'P0002';
  end if;
  select identity.user_id into v_service_identity
  from mail_private.service_identity identity where identity.singleton;
  if v_service_identity is null then
    raise exception 'Exchange service identity unavailable' using errcode = 'P0002';
  end if;

  if p_candidate_ticket_id is not null and coalesce(p_reply_authorized, false) then
    select * into v_ticket
    from public.tickets ticket
    where ticket.id = p_candidate_ticket_id and ticket.tenant_id = p_tenant_id
    for key share;
  end if;
  if v_ticket.id is not null then
    insert into public.ticket_comments (
      ticket_id, author_id, visibility, channel, requester_contact_id, body
    ) values (
      v_ticket.id, v_service_identity, 'external', 'email', v_contact.id, left(coalesce(p_body, ''), 48000)
    ) returning id into v_comment_id;
    insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
    values (v_ticket.id, v_service_identity, 'comment.external_added', '{"source":"exchange_online","channel":"email"}'::jsonb);
    v_kind := 'reply';
  else
    if v_channel.default_department_id is not null then
      select department.id, department.key into v_department
      from public.departments department
      where department.id = v_channel.default_department_id
        and department.tenant_id = p_tenant_id and department.active;
    else
      select department.id, department.key into v_department
      from public.departments department
      where department.tenant_id = p_tenant_id and department.active
      order by department.key limit 1;
    end if;
    select status.id into v_status from public.ticket_statuses status
    where status.tenant_id = p_tenant_id and status.key = 'new';
    select priority.id into v_priority from public.ticket_priorities priority
    where priority.tenant_id = p_tenant_id and priority.key = 'normal';
    if v_department.id is null or v_status is null or v_priority is null then
      raise exception 'Exchange ticket defaults unavailable' using errcode = 'P0002';
    end if;
    select public.reserve_ticket_number(p_tenant_id, v_department.id, left(v_department.key, 8)) into v_number;
    insert into public.tickets (
      tenant_id, department_id, ticket_number, subject, description,
      status_id, priority_id, requester_id, requester_contact_id, source
    ) values (
      p_tenant_id, v_department.id, v_number, left(coalesce(nullif(btrim(p_subject), ''), 'E-Mail-Anfrage'), 240),
      left(coalesce(p_body, ''), 48000), v_status, v_priority, v_service_identity, v_contact.id, 'email'
    ) returning * into v_ticket;
    insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
    values (v_ticket.id, v_service_identity, 'ticket.created', '{"source":"exchange_online"}'::jsonb);
    if p_candidate_ticket_id is not null then
      insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
      values (v_ticket.id, v_service_identity, 'email.reply_reference_not_authorized', '{"source":"exchange_online"}'::jsonb);
    end if;
    if v_channel.send_acknowledgement and v_contact.email is not null then
      insert into public.mail_messages (
        tenant_id, channel_id, exchange_configuration_version, direction, kind,
        ticket_id, from_address, to_addresses, subject
      ) values (
        p_tenant_id, v_channel.id, p_configuration_version, 'outbound', 'acknowledgement',
        v_ticket.id, v_channel.mailbox_address, array[v_contact.email], 'Bestätigung ' || v_ticket.ticket_number
      ) on conflict do nothing;
    end if;
    v_kind := 'new_ticket';
  end if;
  update public.mail_messages
  set processing_status = 'processed', kind = v_kind, ticket_id = v_ticket.id,
      comment_id = v_comment_id, internet_message_id = p_internet_message_id,
      conversation_id = p_conversation_id, from_address = lower(p_sender),
      to_addresses = coalesce(p_to_addresses, '{}'::text[]), cc_addresses = coalesce(p_cc_addresses, '{}'::text[]),
      subject = left(coalesce(p_subject, ''), 500), occurred_at = timezone('utc', now()), last_error_code = null
  where id = v_message.id and processing_status = 'processing';
  update public.exchange_mail_channels
  set last_inbound_at = timezone('utc', now())
  where id = v_channel.id and tenant_id = p_tenant_id and configuration_version = p_configuration_version;
  return query select 'processed', v_kind, v_ticket.id, v_ticket.ticket_number, v_comment_id, v_contact.id;
end;
$$;
revoke all on function public.exchange_mail_commit_inbound(uuid, uuid, bigint, uuid, uuid, boolean, uuid, text, text, text, text, text, text[], text[]) from public, anon, authenticated;
grant execute on function public.exchange_mail_commit_inbound(uuid, uuid, bigint, uuid, uuid, boolean, uuid, text, text, text, text, text, text[], text[]) to service_role;

comment on column public.exchange_mail_channels.configuration_version is
  'Optimistische Sperre für Änderungen der Exchange-Kanalkonfiguration; bindet Prüfung, Aktivierung und Abos an exakt ein Postfachziel.';

commit;
