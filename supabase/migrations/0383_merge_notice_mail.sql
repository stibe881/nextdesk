begin;

set local search_path = pg_catalog, public;

-- Zusammengeführte Tickets: statt der «gelöst»-Mail erhält die anfragende
-- Person eine eigene Mail. Darin steht, dass mehrere Tickets entstanden sind,
-- und unter welchem Ticket es weitergeht.

alter table public.mail_messages
  drop constraint if exists mail_messages_kind_check;
alter table public.mail_messages
  add constraint mail_messages_kind_check
  check (kind in (
    'new_ticket', 'reply', 'acknowledgement', 'agent_reply', 'resolution', 'test',
    'department_question', 'department_answer', 'ticket_copy', 'notification',
    'security_notice', 'status_confirmation', 'status_change', 'rating_reminder',
    'merge_notice'
  ));

-- Höchstens eine Zusammenführungs-Mail pro Ticket.
create unique index if not exists mail_messages_merge_notice_unique
  on public.mail_messages (ticket_id)
  where kind = 'merge_notice' and ticket_id is not null;

-- Keine «gelöst»-Mail für ein Ticket, das in ein anderes zusammengeführt wird.
do $migration$
declare
  v_definition text;
  v_next text;
begin
  v_definition := pg_get_functiondef('public.exchange_mail_enqueue_resolution()'::regprocedure);
  if position('merged_into_ticket_id' in v_definition) = 0 then
    v_next := replace(v_definition,
      E'  if new.status_id is not distinct from old.status_id then\n    return new;\n  end if;',
      E'  if new.status_id is not distinct from old.status_id then\n    return new;\n  end if;\n  -- Zusammengeführt: dafür gibt es die eigene Mail «merge_notice».\n  if new.merged_into_ticket_id is not null then\n    return new;\n  end if;');
    if v_next = v_definition then
      raise exception 'exchange_mail_enqueue_resolution: status check not found';
    end if;
    execute v_next;
  end if;
end;
$migration$;

create or replace function public.exchange_mail_enqueue_merge_notice()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_channel record;
  v_recipient text;
begin
  if new.merged_into_ticket_id is null or old.merged_into_ticket_id is not null then
    return new;
  end if;
  if not public.exchange_mail_feature_enabled(new.tenant_id) then
    return new;
  end if;
  -- Über das Postfach, über das das Ticket kam (wie die «gelöst»-Mail).
  select channel.id, channel.mailbox_address, channel.configuration_version into v_channel
  from public.exchange_mail_channels channel
  where channel.tenant_id = new.tenant_id
    and channel.status = 'active'
    and channel.access_mode = 'delegated'
    and channel.send_resolution
    and channel.id = new.exchange_mail_channel_id
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
    new.tenant_id, v_channel.id, v_channel.configuration_version, 'outbound', 'merge_notice', new.id,
    v_channel.mailbox_address, array[v_recipient], new.subject
  ) on conflict do nothing;
  return new;
exception when others then
  return new;
end;
$$;

revoke all on function public.exchange_mail_enqueue_merge_notice() from public, anon, authenticated;
drop trigger if exists exchange_mail_enqueue_merge_notice on public.tickets;
create trigger exchange_mail_enqueue_merge_notice
  after update of merged_into_ticket_id on public.tickets
  for each row execute function public.exchange_mail_enqueue_merge_notice();

commit;
