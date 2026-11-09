begin;

set local search_path = pg_catalog, public;

-- Optional team that receives every new ticket of an e-mail channel (support
-- mailbox). The team must belong to the tenant; it is only assigned while it
-- is active and in the same department as the new ticket.
alter table public.exchange_mail_channels
  add column if not exists default_team_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'exchange_mail_channels_default_team_fk'
      and conrelid = 'public.exchange_mail_channels'::regclass
  ) then
    alter table public.exchange_mail_channels
      add constraint exchange_mail_channels_default_team_fk
      foreign key (default_team_id) references public.teams(id) on delete set null;
  end if;
end $$;

commit;
