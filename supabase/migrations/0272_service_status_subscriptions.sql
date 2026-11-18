begin;
set local search_path = pg_catalog, public;

-- Systemstatus per E-Mail abonnieren.
--
-- Personen tragen auf der öffentlichen Statusseite ihre E-Mail-Adresse ein
-- und bestätigen sie über einen Link (Double-Opt-in). Danach erhalten sie bei
-- jeder Statusänderung eines öffentlichen Dienstes eine E-Mail mit
-- Abmeldelink. Versand über das aktive Exchange-Postfach des Mandanten.

create table if not exists public.service_status_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null,
  token uuid not null default gen_random_uuid(),
  confirmed_at timestamptz,
  confirmation_sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint service_status_subscriptions_email_valid check (
    char_length(email) between 3 and 320
    and email = lower(btrim(email))
    and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  constraint service_status_subscriptions_token_unique unique (token),
  constraint service_status_subscriptions_email_unique unique (tenant_id, email)
);

create index if not exists service_status_subscriptions_confirmed_idx
  on public.service_status_subscriptions (tenant_id)
  where confirmed_at is not null;

alter table public.service_status_subscriptions enable row level security;
revoke all on table public.service_status_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.service_status_subscriptions to service_role;

alter table public.mail_messages
  add column if not exists status_subscription_id uuid
    references public.service_status_subscriptions(id) on delete cascade,
  add column if not exists service_status_event_id uuid
    references public.service_status_events(id) on delete cascade;

create unique index if not exists mail_messages_status_change_unique
  on public.mail_messages (service_status_event_id, status_subscription_id)
  where kind = 'status_change';

alter table public.mail_messages drop constraint if exists mail_messages_kind_check;
alter table public.mail_messages add constraint mail_messages_kind_check check (
  kind = any (array[
    'new_ticket', 'reply', 'acknowledgement', 'agent_reply', 'resolution',
    'test', 'department_question', 'department_answer', 'ticket_copy',
    'notification', 'security_notice', 'status_confirmation', 'status_change'
  ]::text[])
);

-- Postfach, über das Statusmails gehen (das älteste aktive).
create or replace function public.service_status_mail_channel(p_tenant_id uuid)
returns table (id uuid, configuration_version integer, mailbox_address text)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select channel.id, channel.configuration_version, channel.mailbox_address
  from public.exchange_mail_channels channel
  where channel.tenant_id = p_tenant_id
    and channel.status = 'active'
    and channel.deleted_at is null
    and channel.access_mode = 'delegated'
    and public.exchange_mail_feature_enabled(p_tenant_id)
  order by channel.created_at
  limit 1;
$$;
revoke all on function public.service_status_mail_channel(uuid) from public, anon, authenticated;
grant execute on function public.service_status_mail_channel(uuid) to service_role;

-- Bestätigungsmail einreihen (von der Edge Function nach der Anmeldung).
create or replace function public.enqueue_service_status_confirmation(p_subscription_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_subscription public.service_status_subscriptions;
  v_channel record;
begin
  select * into v_subscription
  from public.service_status_subscriptions
  where id = p_subscription_id;
  if not found then
    return false;
  end if;
  select * into v_channel from public.service_status_mail_channel(v_subscription.tenant_id);
  if v_channel.id is null then
    return false;
  end if;
  insert into public.mail_messages (
    tenant_id, channel_id, exchange_configuration_version, direction, kind,
    status_subscription_id, from_address, to_addresses, subject
  ) values (
    v_subscription.tenant_id, v_channel.id, v_channel.configuration_version,
    'outbound', 'status_confirmation', v_subscription.id,
    v_channel.mailbox_address, array[v_subscription.email], null
  );
  update public.service_status_subscriptions
     set confirmation_sent_at = timezone('utc', now())
   where id = v_subscription.id;
  return true;
end;
$$;
revoke all on function public.enqueue_service_status_confirmation(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_service_status_confirmation(uuid) to service_role;

-- Bei einer Statusänderung eines öffentlichen Dienstes alle bestätigten
-- Abonnentinnen und Abonnenten benachrichtigen.
create or replace function public.service_status_notify_subscribers()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_channel record;
begin
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

create or replace trigger service_status_notify_subscribers
  after insert on public.service_status_events
  for each row execute function public.service_status_notify_subscribers();

commit;
