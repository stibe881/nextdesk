-- Requester contacts from e-mail: names were derived from the address in
-- lower case («luana nett») and every incoming mail overwrote a corrected
-- name again. The mail intake now keeps existing names
-- (_shared/requester-name.ts); this guard makes sure no other path can
-- downgrade a name to the bare address form, and existing names are fixed.

create or replace function public.ticket_requester_derived_name(p_email text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select btrim(regexp_replace(
    lower(split_part(coalesce(p_email, ''), '@', 1)),
    '[^[:alnum:]-]+', ' ', 'g'
  ));
$$;

create or replace function public.ticket_requesters_keep_name()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_derived text := public.ticket_requester_derived_name(new.email);
  v_new text := lower(btrim(coalesce(new.display_name, '')));
  v_old text := lower(btrim(coalesce(old.display_name, '')));
  v_new_is_derived boolean;
  v_old_is_derived boolean;
begin
  if new.display_name is not distinct from old.display_name then
    return new;
  end if;
  v_new_is_derived := v_new in ('', 'e-mail-kontakt', v_derived, replace(v_derived, '-', ' '));
  v_old_is_derived := v_old in ('', 'e-mail-kontakt', v_derived, replace(v_derived, '-', ' '));
  -- A real name is never replaced by the bare address form ...
  if v_new_is_derived and not v_old_is_derived then
    new.display_name := old.display_name;
  -- ... and a capitalised name never by the same name in lower case.
  elsif v_new = v_old
        and new.display_name = lower(new.display_name)
        and old.display_name <> lower(old.display_name) then
    new.display_name := old.display_name;
  end if;
  return new;
end;
$$;

drop trigger if exists ticket_requesters_keep_name on public.ticket_requesters;
create trigger ticket_requesters_keep_name
  before update of display_name on public.ticket_requesters
  for each row execute function public.ticket_requesters_keep_name();

-- Existing lower-case names: the Entra name if there is a proper one,
-- otherwise the same words capitalised.
update public.ticket_requesters requester
   set display_name = coalesce(
         (select person.display_name
            from public.tenant_entra_directory_people person
           where person.tenant_id = requester.tenant_id
             and lower(person.email) = lower(requester.email)
             and person.display_name <> lower(person.display_name)
           limit 1),
         initcap(requester.display_name)
       )
 where requester.display_name = lower(requester.display_name)
   and requester.display_name ~ '[[:alpha:]]';
