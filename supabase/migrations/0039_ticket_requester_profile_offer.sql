begin;
set local search_path = pg_catalog, public;

alter table public.ticket_requester_profiles
  add column offer text;

alter table public.ticket_requester_profiles
  add constraint ticket_requester_profiles_offer_valid
  check (
    offer is null or (
      char_length(offer) between 1 and 120
      and offer = btrim(offer)
      and offer !~ '[[:cntrl:]]'
    )
  );

create or replace function public.validate_ticket_requester_profile_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'ticket_requester_profiles' then
    raise exception 'Invalid trigger target' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' and (
    new.requester_id is distinct from old.requester_id
    or new.tenant_id is distinct from old.tenant_id
  ) then
    raise exception 'Requester profile identity is immutable' using errcode = '23514';
  end if;

  new.location := nullif(btrim(new.location), '');
  new.department := nullif(btrim(new.department), '');
  new.offer := nullif(btrim(new.offer), '');
  new.language := nullif(lower(btrim(new.language)), '');
  new.preferred_contact_channel := nullif(lower(btrim(new.preferred_contact_channel)), '');
  new.important_note := nullif(btrim(new.important_note), '');
  return new;
end;
$$;

comment on column public.ticket_requester_profiles.offer is
  'Optional business offer or service context of a requester, separate from the ticket category and safe to edit only through requester-profile permissions.';

commit;
