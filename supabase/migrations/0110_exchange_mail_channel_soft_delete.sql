begin;

set local search_path = pg_catalog, public;

-- A channel remains referenced by historical tickets. Archive the channel
-- instead of physically deleting it so ticket origin and minimal mail
-- processing telemetry remain intact.
alter table public.exchange_mail_channels
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

alter table public.exchange_mail_channels
  drop constraint if exists exchange_mail_channels_deleted_by_tenant_fk;
alter table public.exchange_mail_channels
  add constraint exchange_mail_channels_deleted_by_tenant_fk
  foreign key (tenant_id, deleted_by)
  references public.tenant_memberships (tenant_id, user_id)
  on delete set null (deleted_by);

-- Deleted channels must not reserve an address or Entra mailbox identity for
-- a later, explicit configuration of that support mailbox.
alter table public.exchange_mail_channels
  drop constraint if exists exchange_mail_channels_mailbox_address_unique;
drop index if exists public.exchange_mail_channels_mailbox_address_unique;
drop index if exists public.exchange_mail_channels_entra_mailbox_object_unique;

create unique index if not exists exchange_mail_channels_mailbox_address_active_unique
  on public.exchange_mail_channels (mailbox_address)
  where deleted_at is null;

create unique index if not exists exchange_mail_channels_entra_mailbox_object_active_unique
  on public.exchange_mail_channels (entra_tenant_id, mailbox_object_id)
  where access_mode = 'delegated'
    and mailbox_object_id is not null
    and deleted_at is null;

create index if not exists exchange_mail_channels_visible_tenant_created_idx
  on public.exchange_mail_channels (tenant_id, created_at)
  where deleted_at is null;

-- All producers use this database-side fence. FOR SHARE serializes a queued
-- message with an administrative channel update, so deleteMailbox can either
-- cancel the committed entry or the later insert is rejected here.
create or replace function public.exchange_mail_messages_require_active_channel()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform 1
  from public.exchange_mail_channels channel
  where channel.id = new.channel_id
    and channel.tenant_id = new.tenant_id
    and channel.configuration_version = new.exchange_configuration_version
    and channel.status = 'active'
    and channel.deleted_at is null
  for share;
  if not found then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function public.exchange_mail_messages_require_active_channel()
  from public, anon, authenticated;

drop trigger if exists exchange_mail_messages_require_active_channel on public.mail_messages;
create trigger exchange_mail_messages_require_active_channel
before insert on public.mail_messages
for each row execute function public.exchange_mail_messages_require_active_channel();

comment on column public.exchange_mail_channels.deleted_at is
  'Zeitpunkt der administrativ bestätigten Entfernung aus der aktiven Support-Postfachkonfiguration; Ticketherkunft bleibt erhalten.';
comment on column public.exchange_mail_channels.deleted_by is
  'Aktive Mandantenadministration, die das Support-Postfach entfernt hat.';

commit;
