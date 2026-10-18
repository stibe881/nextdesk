begin;

set local search_path = pg_catalog, public;

-- Provider extensions are optional in local PostgreSQL test clusters. Production
-- installs both extensions when they are available from the Supabase provider.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
end;
$$;

-- The existing generic email feature becomes the explicit Exchange Online channel.
insert into public.feature_catalog (key, name, description, category, default_enabled)
values (
  'integrations.email',
  'E-Mail-Kanal (Exchange Online)',
  'Eingehende E-Mails werden zu Tickets, Agentenantworten gehen per E-Mail an Anfragende.',
  'integrations',
  false
)
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      category = excluded.category,
      default_enabled = excluded.default_enabled;

insert into public.tenant_feature_flags (tenant_id, feature_key, enabled)
select tenant.id, catalog.key, catalog.default_enabled
from public.tenants tenant
join public.feature_catalog catalog on catalog.key = 'integrations.email'
on conflict (tenant_id, feature_key) do nothing;

alter table public.ticket_comments
  add column if not exists channel text not null default 'portal',
  add column if not exists requester_contact_id uuid;
alter table public.ticket_comments
  drop constraint if exists ticket_comments_channel_valid;
alter table public.ticket_comments
  add constraint ticket_comments_channel_valid
  check (channel in ('portal', 'email'));
alter table public.ticket_comments
  drop constraint if exists ticket_comments_requester_contact_fk;
alter table public.ticket_comments
  add constraint ticket_comments_requester_contact_fk
  foreign key (requester_contact_id)
  references public.ticket_requesters(id) on delete set null;
create index if not exists ticket_comments_requester_contact_idx
  on public.ticket_comments (requester_contact_id) where requester_contact_id is not null;

create table if not exists public.exchange_mail_channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  entra_tenant_id uuid not null,
  mailbox_address text collate "C" not null,
  mailbox_object_id uuid,
  default_department_id uuid,
  send_acknowledgement boolean not null default true,
  send_agent_replies boolean not null default true,
  send_resolution boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft', 'verified', 'active', 'paused', 'error')),
  last_verified_at timestamptz,
  last_error_code text,
  last_error_message text check (last_error_message is null or char_length(last_error_message) <= 500),
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  poll_watermark timestamptz,
  activated_at timestamptz,
  activated_by uuid references public.user_profiles(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_by uuid,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint exchange_mail_channels_id_tenant_unique unique (id, tenant_id),
  constraint exchange_mail_channels_mailbox_address_unique unique (mailbox_address),
  constraint exchange_mail_channels_mailbox_address_valid check (
    mailbox_address = lower(mailbox_address)
    and char_length(mailbox_address) between 3 and 254
    and mailbox_address ~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  constraint exchange_mail_channels_department_tenant_fk foreign key (default_department_id, tenant_id)
    references public.departments (id, tenant_id) on delete set null (default_department_id),
  constraint exchange_mail_channels_created_by_tenant_fk foreign key (tenant_id, created_by)
    references public.tenant_memberships (tenant_id, user_id) on delete set null (created_by),
  constraint exchange_mail_channels_updated_by_tenant_fk foreign key (tenant_id, updated_by)
    references public.tenant_memberships (tenant_id, user_id) on delete set null (updated_by)
);

create table if not exists public.exchange_mail_subscriptions (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  graph_subscription_id text not null unique check (char_length(graph_subscription_id) between 1 and 512),
  client_state_hash text not null check (client_state_hash ~ '^[0-9a-f]{64}$'),
  resource text not null check (char_length(resource) between 1 and 1000),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'removed', 'expired')),
  last_notification_at timestamptz,
  last_renewed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint exchange_mail_subscriptions_channel_tenant_fk foreign key (channel_id, tenant_id)
    references public.exchange_mail_channels (id, tenant_id) on delete cascade
);
create index if not exists exchange_mail_subscriptions_due_idx
  on public.exchange_mail_subscriptions (expires_at) where status = 'active';

create table if not exists public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel_id uuid not null references public.exchange_mail_channels(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  kind text check (kind in ('new_ticket', 'reply', 'acknowledgement', 'agent_reply', 'resolution', 'test')),
  graph_message_id text,
  internet_message_id text,
  conversation_id text,
  ticket_id uuid,
  comment_id uuid references public.ticket_comments(id) on delete set null,
  from_address text,
  to_addresses text[] not null default '{}'::text[],
  cc_addresses text[] not null default '{}'::text[],
  subject text check (subject is null or char_length(subject) <= 500),
  occurred_at timestamptz,
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processing', 'processed', 'ignored', 'failed')),
  ignore_reason text,
  attempt_count integer not null default 0 check (attempt_count between 0 and 6),
  next_attempt_at timestamptz not null default timezone('utc', now()),
  last_error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint mail_messages_channel_tenant_fk foreign key (channel_id, tenant_id)
    references public.exchange_mail_channels (id, tenant_id) on delete cascade,
  constraint mail_messages_ticket_tenant_fk foreign key (ticket_id, tenant_id)
    references public.tickets (id, tenant_id) on delete set null (ticket_id)
);
create unique index if not exists mail_messages_inbound_graph_message_unique
  on public.mail_messages (channel_id, graph_message_id)
  where direction = 'inbound' and graph_message_id is not null;
create unique index if not exists mail_messages_agent_reply_comment_unique
  on public.mail_messages (comment_id)
  where kind = 'agent_reply' and comment_id is not null;
create unique index if not exists mail_messages_ticket_notice_unique
  on public.mail_messages (ticket_id, kind)
  where kind in ('acknowledgement', 'resolution') and ticket_id is not null;
create index if not exists mail_messages_due_idx
  on public.mail_messages (processing_status, next_attempt_at, created_at)
  where processing_status in ('pending', 'failed');
create index if not exists mail_messages_ticket_idx
  on public.mail_messages (tenant_id, ticket_id, created_at desc) where ticket_id is not null;

create schema if not exists mail_private;
revoke all on schema mail_private from public, anon, authenticated;
grant usage on schema mail_private to service_role;

create table if not exists mail_private.dispatch_config (
  singleton boolean primary key default true check (singleton),
  dispatch_secret text not null check (char_length(dispatch_secret) = 64),
  function_url text not null check (function_url ~ '^https://'),
  created_at timestamptz not null default timezone('utc', now())
);
insert into mail_private.dispatch_config (singleton, dispatch_secret, function_url)
values (
  true,
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  'https://ewizsylzrwogsztsthbl.supabase.co/functions/v1/exchange-mail-worker'
)
on conflict (singleton) do nothing;

create table if not exists mail_private.service_identity (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.exchange_mail_channels enable row level security;
alter table public.exchange_mail_channels force row level security;
alter table public.exchange_mail_subscriptions enable row level security;
alter table public.exchange_mail_subscriptions force row level security;
alter table public.mail_messages enable row level security;
alter table public.mail_messages force row level security;
alter table mail_private.dispatch_config enable row level security;
alter table mail_private.dispatch_config force row level security;
alter table mail_private.service_identity enable row level security;
alter table mail_private.service_identity force row level security;

revoke all on table public.exchange_mail_channels, public.exchange_mail_subscriptions, public.mail_messages
  from public, anon, authenticated;
revoke all on table mail_private.dispatch_config, mail_private.service_identity
  from public, anon, authenticated;
grant select, insert, update, delete on table public.exchange_mail_channels, public.exchange_mail_subscriptions, public.mail_messages to service_role;
grant select, insert, update, delete on table mail_private.dispatch_config, mail_private.service_identity to service_role;

create policy exchange_mail_channels_service_role_only on public.exchange_mail_channels
  for all to service_role using (true) with check (true);
create policy exchange_mail_subscriptions_service_role_only on public.exchange_mail_subscriptions
  for all to service_role using (true) with check (true);
create policy mail_messages_service_role_only on public.mail_messages
  for all to service_role using (true) with check (true);
create policy exchange_mail_dispatch_config_service_role_only on mail_private.dispatch_config
  for all to service_role using (true) with check (true);
create policy exchange_mail_service_identity_service_role_only on mail_private.service_identity
  for all to service_role using (true) with check (true);

create or replace function public.exchange_mail_feature_enabled(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce((
    select flag.enabled = true
      and (flag.pilot_ends_at is null or flag.pilot_ends_at > timezone('utc', now()))
    from public.tenant_feature_flags flag
    where flag.tenant_id = p_tenant_id
      and flag.feature_key = 'integrations.email'
  ), false);
$$;
revoke all on function public.exchange_mail_feature_enabled(uuid) from public, anon, authenticated;

create or replace function public.exchange_mail_verify_dispatch_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, mail_private, pg_temp
as $$
  select p_secret is not null
    and exists (
      select 1
      from mail_private.dispatch_config config
      where config.singleton
        and config.dispatch_secret = p_secret
    );
$$;
revoke all on function public.exchange_mail_verify_dispatch_secret(text) from public, anon, authenticated;
grant execute on function public.exchange_mail_verify_dispatch_secret(text) to service_role;

create or replace function public.exchange_mail_enqueue_inbound(
  p_tenant_id uuid,
  p_channel_id uuid,
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
     or p_graph_message_id is null
     or char_length(p_graph_message_id) not between 1 and 1024 then
    raise exception 'Invalid Exchange inbound message reference' using errcode = '22023';
  end if;
  insert into public.mail_messages (
    tenant_id, channel_id, direction, graph_message_id
  ) values (
    p_tenant_id, p_channel_id, 'inbound', p_graph_message_id
  ) on conflict do nothing
  returning id into v_message_id;
  return v_message_id;
end;
$$;
revoke all on function public.exchange_mail_enqueue_inbound(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.exchange_mail_enqueue_inbound(uuid, uuid, text)
  to service_role;

create or replace function public.exchange_mail_wake_worker(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, mail_private, pg_temp
as $$
declare
  v_url text;
  v_secret text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return;
  end if;
  select config.function_url, config.dispatch_secret
  into v_url, v_secret
  from mail_private.dispatch_config config
  where config.singleton;
  if v_url is null or v_secret is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return;
  end if;
  execute 'select net.http_post($1, $2, $3, $4, $5)'
    using v_url,
          '{}'::jsonb,
          p_payload,
          jsonb_build_object(
            'Content-Type', 'application/json',
            'x-nextdesk-dispatch-secret', v_secret
          ),
          3000;
exception when others then
  -- Provider wakeups are best effort and must never block application writes.
  return;
end;
$$;
revoke all on function public.exchange_mail_wake_worker(jsonb) from public, anon, authenticated;

create or replace function public.exchange_mail_dispatch_outbound()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.direction = 'outbound' and new.processing_status = 'pending' then
    perform public.exchange_mail_wake_worker(
      jsonb_build_object('action', 'dispatchOutbound', 'ids', jsonb_build_array(new.id))
    );
  end if;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.exchange_mail_dispatch_outbound() from public, anon, authenticated;
drop trigger if exists exchange_mail_dispatch_outbound on public.mail_messages;
create trigger exchange_mail_dispatch_outbound
  after insert on public.mail_messages
  for each row execute function public.exchange_mail_dispatch_outbound();

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

  select channel.id, channel.mailbox_address
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
    tenant_id, channel_id, direction, kind, ticket_id, comment_id,
    from_address, to_addresses, subject
  ) values (
    v_ticket.tenant_id, v_channel.id, 'outbound', 'agent_reply', v_ticket.id, new.id,
    v_channel.mailbox_address, array[v_recipient], v_ticket.subject
  ) on conflict do nothing;
  return new;
exception when others then
  -- Email delivery is deferred and must never prevent a ticket comment.
  return new;
end;
$$;
revoke all on function public.exchange_mail_enqueue_agent_reply() from public, anon, authenticated;
drop trigger if exists exchange_mail_enqueue_agent_reply on public.ticket_comments;
create trigger exchange_mail_enqueue_agent_reply
  after insert on public.ticket_comments
  for each row execute function public.exchange_mail_enqueue_agent_reply();

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
  -- The ticket lifecycle has no separate category column; the tenant-local
  -- established "resolved" status key is the resolved category.
  if not exists (
    select 1 from public.ticket_statuses status
    where status.id = new.status_id
      and status.tenant_id = new.tenant_id
      and status.key = 'resolved'
  ) or not public.exchange_mail_feature_enabled(new.tenant_id) then
    return new;
  end if;
  select channel.id, channel.mailbox_address into v_channel
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
    tenant_id, channel_id, direction, kind, ticket_id, from_address, to_addresses, subject
  ) values (
    new.tenant_id, v_channel.id, 'outbound', 'resolution', new.id,
    v_channel.mailbox_address, array[v_recipient], new.subject
  ) on conflict do nothing;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.exchange_mail_enqueue_resolution() from public, anon, authenticated;
drop trigger if exists exchange_mail_enqueue_resolution on public.tickets;
create trigger exchange_mail_enqueue_resolution
  after update of status_id on public.tickets
  for each row execute function public.exchange_mail_enqueue_resolution();

create or replace function public.exchange_mail_kick_maintenance()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if exists (
    select 1 from public.exchange_mail_channels channel where channel.status = 'active'
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

-- pg_cron is absent from some local clusters. Where present, keep exactly one
-- named schedule so rerunning the migration body is safe for restored systems.
do $$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  for v_job_id in select jobid from cron.job where jobname = 'nextdesk-exchange-mail-maintenance'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'nextdesk-exchange-mail-maintenance',
    '*/5 * * * *',
    'select public.exchange_mail_kick_maintenance();'
  );
exception when others then
  -- Scheduling must not make a migration unavailable when a provider restricts cron.
  null;
end;
$$;

create trigger exchange_mail_channels_updated_at
  before update on public.exchange_mail_channels
  for each row execute function public.set_updated_at();
create trigger mail_messages_updated_at
  before update on public.mail_messages
  for each row execute function public.set_updated_at();

comment on table public.exchange_mail_channels is
  'Mandantenlokale Konfiguration für genau ein Exchange-Online-Supportpostfach; nur service_role greift direkt zu.';
comment on table public.mail_messages is
  'Metadaten und Zustandsdaten für Exchange-Mailverarbeitung. E-Mail-Körper werden bewusst nie gespeichert.';
comment on function public.exchange_mail_kick_maintenance() is
  'Weckt den Exchange-Mail-Worker nur für aktive Kanäle oder fällige Warteschlangeneinträge.';

commit;
