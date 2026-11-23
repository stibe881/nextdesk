begin;

-- Tickets weiterleiten: Agenten leiten die ursprüngliche Mail oder eine
-- Nachricht des Tickets an beliebige Adressen weiter (z. B. Lieferant). Die
-- anfragende Person erhält nichts; in der Unterhaltung steht eine interne
-- Notiz «Weitergeleitet an …» (mail_messages.comment_id). Was weitergeleitet
-- wird, steht in forward_source_comment_id (leer = ursprüngliche Mail), die
-- begleitende Nachricht in forward_note.
alter table public.mail_messages
  add column if not exists forward_source_comment_id uuid
    references public.ticket_comments(id) on delete set null,
  add column if not exists forward_note text
    check (forward_note is null or char_length(forward_note) <= 10000);

alter table public.mail_messages
  drop constraint if exists mail_messages_kind_check;
alter table public.mail_messages
  add constraint mail_messages_kind_check
  check (kind in (
    'new_ticket', 'reply', 'acknowledgement', 'agent_reply', 'resolution',
    'test', 'department_question', 'department_answer', 'ticket_copy',
    'notification', 'security_notice', 'status_confirmation', 'status_change',
    'rating_reminder', 'merge_notice', 'ticket_forward'
  ));

create unique index if not exists mail_messages_ticket_forward_unique
  on public.mail_messages (comment_id, (to_addresses[1]))
  where kind = 'ticket_forward' and comment_id is not null;

create or replace function public.enqueue_ticket_forward(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_note_comment_id uuid,
  p_source_comment_id uuid,
  p_actor_id uuid,
  p_emails text[],
  p_note text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket record;
  v_channel record;
  v_email text;
  v_count integer := 0;
begin
  if p_emails is null or coalesce(array_length(p_emails, 1), 0) < 1
     or array_length(p_emails, 1) > 10 then
    raise exception 'Invalid forward recipients' using errcode = '22023';
  end if;

  select ticket.id, ticket.subject, ticket.exchange_mail_channel_id
    into v_ticket
    from public.tickets ticket
   where ticket.id = p_ticket_id
     and ticket.tenant_id = p_tenant_id
     and ticket.deleted_at is null;
  if not found then
    raise exception 'Ticket unavailable' using errcode = 'P0002';
  end if;

  -- Die Notiz in der Unterhaltung stammt von der weiterleitenden Person.
  if not exists (
    select 1 from public.ticket_comments comment
     where comment.id = p_note_comment_id
       and comment.ticket_id = p_ticket_id
       and comment.author_id = p_actor_id
       and comment.visibility = 'internal'
  ) then
    raise exception 'Internal forward note required' using errcode = '22023';
  end if;
  if p_source_comment_id is not null and not exists (
    select 1 from public.ticket_comments comment
     where comment.id = p_source_comment_id
       and comment.ticket_id = p_ticket_id
  ) then
    raise exception 'Forward source unavailable' using errcode = '22023';
  end if;

  if not public.exchange_mail_feature_enabled(p_tenant_id) then
    return 0;
  end if;

  -- Über das Postfach des Tickets, sonst über ein aktives Postfach des
  -- Mandanten, das Antworten senden darf (z. B. bei Portal-Tickets).
  select channel.id, channel.mailbox_address, channel.configuration_version
    into v_channel
    from public.exchange_mail_channels channel
   where channel.tenant_id = p_tenant_id
     and channel.status = 'active'
     and channel.deleted_at is null
     and channel.access_mode = 'delegated'
     and channel.send_agent_replies
   order by (channel.id = v_ticket.exchange_mail_channel_id) desc, channel.created_at
   limit 1;
  if not found then
    return 0;
  end if;

  for v_email in
    select distinct lower(btrim(entry)) from unnest(p_emails) as entry
  loop
    continue when v_email !~* '^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$'
      or char_length(v_email) > 254
      or v_email = lower(v_channel.mailbox_address);
    insert into public.mail_messages (
      tenant_id, channel_id, exchange_configuration_version, direction, kind,
      ticket_id, comment_id, from_address, to_addresses, subject,
      forward_source_comment_id, forward_note
    ) values (
      p_tenant_id, v_channel.id, v_channel.configuration_version, 'outbound',
      'ticket_forward', p_ticket_id, p_note_comment_id, v_channel.mailbox_address,
      array[v_email], v_ticket.subject, p_source_comment_id,
      nullif(btrim(coalesce(p_note, '')), '')
    ) on conflict do nothing;
    if found then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.enqueue_ticket_forward(uuid, uuid, uuid, uuid, uuid, text[], text)
  from public, anon, authenticated;
grant execute on function public.enqueue_ticket_forward(uuid, uuid, uuid, uuid, uuid, text[], text)
  to service_role;

commit;
