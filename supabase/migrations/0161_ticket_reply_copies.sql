begin;

-- Antworten an die anfragende Person können zusätzlich als Kopie an weitere
-- Personen gehen (Entra-Mitarbeitende oder beliebige E-Mail-Adressen).
alter table public.mail_messages
  drop constraint if exists mail_messages_kind_check;
alter table public.mail_messages
  add constraint mail_messages_kind_check
  check (kind in (
    'new_ticket', 'reply', 'acknowledgement', 'agent_reply', 'resolution',
    'test', 'department_question', 'department_answer', 'ticket_copy'
  ));

create unique index if not exists mail_messages_ticket_copy_unique
  on public.mail_messages (comment_id, (to_addresses[1]))
  where kind = 'ticket_copy' and comment_id is not null;

create or replace function public.enqueue_ticket_comment_copies(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_comment_id uuid,
  p_actor_id uuid,
  p_emails text[]
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket record;
  v_channel record;
  v_requester text;
  v_email text;
  v_count integer := 0;
begin
  if p_emails is null or coalesce(array_length(p_emails, 1), 0) < 1
     or array_length(p_emails, 1) > 10 then
    raise exception 'Invalid copy recipients' using errcode = '22023';
  end if;

  select ticket.id, ticket.tenant_id, ticket.subject, ticket.requester_contact_id,
         ticket.exchange_mail_channel_id
  into v_ticket
  from public.tickets ticket
  where ticket.id = p_ticket_id and ticket.tenant_id = p_tenant_id;
  if not found then
    raise exception 'Ticket unavailable' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.ticket_comments comment
    where comment.id = p_comment_id
      and comment.ticket_id = p_ticket_id
      and comment.author_id = p_actor_id
      and comment.visibility = 'external'
  ) then
    raise exception 'External comment required' using errcode = '22023';
  end if;

  if not public.exchange_mail_feature_enabled(p_tenant_id) then
    return 0;
  end if;

  -- Wie die Antwort selbst: über den Postfachkanal, über den das Ticket läuft.
  select channel.id, channel.mailbox_address, channel.configuration_version
  into v_channel
  from public.exchange_mail_channels channel
  where channel.tenant_id = p_tenant_id
    and channel.status = 'active'
    and channel.deleted_at is null
    and channel.access_mode = 'delegated'
    and channel.send_agent_replies
    and channel.id = v_ticket.exchange_mail_channel_id
  limit 1;
  if not found then
    return 0;
  end if;

  select lower(requester.email) into v_requester
  from public.ticket_requesters requester
  where requester.id = v_ticket.requester_contact_id
    and requester.tenant_id = p_tenant_id;

  for v_email in
    select distinct lower(btrim(entry))
    from unnest(p_emails) as entry
  loop
    continue when v_email !~* '^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$'
      or char_length(v_email) > 254
      or v_email = v_requester
      or v_email = lower(v_channel.mailbox_address);
    insert into public.mail_messages (
      tenant_id, channel_id, exchange_configuration_version, direction, kind,
      ticket_id, comment_id, from_address, to_addresses, subject
    ) values (
      p_tenant_id, v_channel.id, v_channel.configuration_version, 'outbound', 'ticket_copy', p_ticket_id,
      p_comment_id, v_channel.mailbox_address, array[v_email], v_ticket.subject
    ) on conflict do nothing;
    if found then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.enqueue_ticket_comment_copies(uuid, uuid, uuid, uuid, text[])
  from public, anon, authenticated;
grant execute on function public.enqueue_ticket_comment_copies(uuid, uuid, uuid, uuid, text[])
  to service_role;

commit;
