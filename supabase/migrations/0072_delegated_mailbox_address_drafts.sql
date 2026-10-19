begin;

set local search_path = pg_catalog, public;

-- A delegated connector can have Exchange mailbox delegation without any
-- directory-profile permission for the shared mailbox. Keep the tenant-bound
-- connector mandatory, but allow a draft channel to use its validated address
-- until the explicit mailbox/read/send verification runs.
alter table public.exchange_mail_channels
  drop constraint if exists exchange_mail_channels_delegated_connection_valid;
alter table public.exchange_mail_channels
  add constraint exchange_mail_channels_delegated_connection_valid
  check (
    (access_mode = 'legacy_rbac' and connection_id is null)
    or (access_mode = 'delegated' and connection_id is not null)
  );

commit;
