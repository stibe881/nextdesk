-- E-mail notifications next to push: one switch per category and channel.
--
-- * push_preferences.email_categories: categories the person also wants by
--   e-mail (off by default).
-- * Every ticket notification of such a category queues one outbound mail
--   (mail_messages.kind = 'notification') in the tenant's active Exchange
--   mailbox; the exchange mail worker sends it via Microsoft Graph.

alter table public.push_preferences
  add column if not exists email_categories text[] not null default array[]::text[];

alter table public.push_preferences
  drop constraint if exists push_preferences_email_categories_valid;
alter table public.push_preferences
  add constraint push_preferences_email_categories_valid check (
    email_categories <@ array[
      'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
      'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline',
      'inventory_low_stock', 'shop', 'service_task', 'infrastructure'
    ]::text[]
    and cardinality(email_categories) <= 20
  );

alter table public.mail_messages
  add column if not exists notification_id uuid
    references public.ticket_notifications(id) on delete cascade;

alter table public.mail_messages drop constraint if exists mail_messages_kind_check;
alter table public.mail_messages add constraint mail_messages_kind_check check (
  kind = any (array[
    'new_ticket', 'reply', 'acknowledgement', 'agent_reply', 'resolution',
    'test', 'department_question', 'department_answer', 'ticket_copy',
    'notification'
  ]::text[])
);

create unique index if not exists mail_messages_notification_unique
  on public.mail_messages (notification_id)
  where kind = 'notification' and notification_id is not null;

create or replace function public.notification_email_enqueue()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  v_category text;
  v_categories text[];
  v_channel record;
begin
  v_category := public.push_notification_category(new.kind);
  if v_category is null then
    return new;
  end if;

  select preference.email_categories
    into v_categories
    from public.push_preferences preference
   where preference.tenant_id = new.tenant_id
     and preference.user_id = new.user_id;
  if v_categories is null or not v_category = any(v_categories) then
    return new;
  end if;

  if not public.exchange_mail_feature_enabled(new.tenant_id)
     or not exists (
       select 1 from public.tenant_memberships membership
        where membership.tenant_id = new.tenant_id
          and membership.user_id = new.user_id
          and membership.status = 'active'
     ) then
    return new;
  end if;

  -- The ticket's own mailbox if it has one, otherwise the oldest active one.
  select channel.id, channel.mailbox_address, channel.configuration_version
    into v_channel
    from public.exchange_mail_channels channel
    left join public.tickets ticket
      on ticket.id = new.ticket_id and ticket.tenant_id = new.tenant_id
   where channel.tenant_id = new.tenant_id
     and channel.status = 'active'
     and channel.deleted_at is null
     and channel.access_mode = 'delegated'
   order by (channel.id = ticket.exchange_mail_channel_id) desc nulls last,
            channel.created_at
   limit 1;
  if not found then
    return new;
  end if;

  insert into public.mail_messages (
    tenant_id, channel_id, exchange_configuration_version, direction, kind,
    ticket_id, recipient_user_id, notification_id, from_address,
    to_addresses, subject
  ) values (
    new.tenant_id, v_channel.id, v_channel.configuration_version, 'outbound',
    'notification', new.ticket_id, new.user_id, new.id,
    v_channel.mailbox_address, array[]::text[], null
  ) on conflict do nothing;
  return new;
exception when others then
  -- E-mail is an extra channel: never block the notification itself.
  return new;
end;
$$;

revoke all on function public.notification_email_enqueue() from public, anon, authenticated;

drop trigger if exists notification_email_enqueue on public.ticket_notifications;
create trigger notification_email_enqueue
  after insert on public.ticket_notifications
  for each row execute function public.notification_email_enqueue();
