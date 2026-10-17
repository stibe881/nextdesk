begin;

-- Synchronisiert den sichtbaren Profilnamen aus den bestätigten Entra-/Auth-Metadaten.
-- E-Mail-Adressen werden bewusst nie als sichtbarer Ersatzwert verwendet.
create or replace function public.auth_profile_display_name(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_metadata jsonb;
  v_given_name text;
  v_family_name text;
  v_full_name text;
begin
  if p_user_id is null then
    return null;
  end if;

  select raw_user_meta_data
    into v_metadata
  from auth.users
  where id = p_user_id;

  if not found then
    return null;
  end if;

  v_given_name := nullif(btrim(coalesce(
    v_metadata ->> 'given_name',
    v_metadata ->> 'givenName',
    v_metadata ->> 'first_name',
    v_metadata ->> 'firstName'
  )), '');
  v_family_name := nullif(btrim(coalesce(
    v_metadata ->> 'family_name',
    v_metadata ->> 'familyName',
    v_metadata ->> 'last_name',
    v_metadata ->> 'lastName'
  )), '');
  v_full_name := nullif(btrim(concat_ws(' ', v_given_name, v_family_name)), '');

  return coalesce(
    v_full_name,
    nullif(btrim(v_metadata ->> 'name'), ''),
    nullif(btrim(v_metadata ->> 'full_name'), ''),
    nullif(btrim(v_metadata ->> 'display_name'), '')
  );
end;
$$;

create or replace function public.sync_user_profile_display_name(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_display_name text;
begin
  v_display_name := public.auth_profile_display_name(p_user_id);
  if v_display_name is null then
    return;
  end if;

  update public.user_profiles
  set display_name = left(v_display_name, 240),
      updated_at = timezone('utc', now())
  where id = p_user_id
    and (
      display_name is null
      or btrim(display_name) = ''
      or lower(btrim(display_name)) in ('nextdesk benutzer', 'benutzerkonto')
    );
end;
$$;

create or replace function public.ticket_comments_sync_author_name()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
begin
  perform public.sync_user_profile_display_name(new.author_id);
  return new;
end;
$$;

-- Bestehende Kommentare erhalten nach der nächsten Ticketansicht ebenfalls den Namen.
update public.user_profiles as profile
set display_name = left(public.auth_profile_display_name(profile.id), 240),
    updated_at = timezone('utc', now())
where (profile.display_name is null
       or btrim(profile.display_name) = ''
       or lower(btrim(profile.display_name)) in ('nextdesk benutzer', 'benutzerkonto'))
  and public.auth_profile_display_name(profile.id) is not null;

drop trigger if exists ticket_comments_sync_author_name on public.ticket_comments;
create trigger ticket_comments_sync_author_name
  after insert on public.ticket_comments
  for each row execute function public.ticket_comments_sync_author_name();

revoke all on function public.auth_profile_display_name(uuid) from public;
revoke all on function public.sync_user_profile_display_name(uuid) from public;
grant execute on function public.auth_profile_display_name(uuid) to service_role;
grant execute on function public.sync_user_profile_display_name(uuid) to service_role;

commit;
