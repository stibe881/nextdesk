begin;
set local search_path = pg_catalog, public;

-- Entra directory imports can contain every active employee. Requester contact
-- email addresses must therefore remain visible only to ticket-capable staff,
-- or to the authenticated person for their own account-bound contact.
drop policy if exists ticket_requesters_select_member on public.ticket_requesters;
create policy ticket_requesters_select_authorized on public.ticket_requesters
  for select to authenticated
  using (
    public.can_manage_ticket_requesters(tenant_id)
    or (auth.uid() is not null and user_id = auth.uid())
  );

-- Initialize a requester profile from Microsoft Entra's standard department
-- attribute without touching a manually maintained value. Graph has no
-- equivalent standard offer field, and this function deliberately never writes
-- support department IDs, memberships, roles or agent access.
create or replace function public.initialise_entra_requester_profile(
  p_tenant_id uuid,
  p_requester_id uuid,
  p_department text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_department text;
  v_changed boolean := false;
begin
  if p_tenant_id is null or p_requester_id is null then
    raise exception 'Invalid Entra requester profile arguments' using errcode = '22023';
  end if;

  v_department := nullif(btrim(p_department), '');
  if v_department is null
    or char_length(v_department) > 120
    or v_department ~ '[[:cntrl:]]'
  then
    return false;
  end if;

  perform 1
  from public.ticket_requesters as requester
  where requester.id = p_requester_id
    and requester.tenant_id = p_tenant_id;
  if not found then
    return false;
  end if;

  insert into public.ticket_requester_profiles (
    requester_id, tenant_id, department
  ) values (
    p_requester_id, p_tenant_id, v_department
  )
  on conflict (requester_id) do update
    set department = excluded.department
    where public.ticket_requester_profiles.department is null
      or btrim(public.ticket_requester_profiles.department) = ''
  returning true into v_changed;

  return coalesce(v_changed, false);
end;
$$;

-- Materialize active directory people as requester contacts, so they are
-- available to authorised ticket staff before their first nextDesk login. The
-- immutable contact binding is intentionally left untouched for all existing
-- manual, email and portal contacts.
create or replace function public.sync_entra_directory_requesters(
  p_tenant_id uuid
)
returns table (
  requester_contacts_created integer,
  requester_profiles_initialized integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_contacts_created integer := 0;
  v_profiles_initialized integer := 0;
begin
  if p_tenant_id is null then
    raise exception 'Invalid Entra directory tenant' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('nextdesk:entra-requesters:' || p_tenant_id::text, 0)
  );

  with candidates as (
    select
      directory.tenant_id,
      lower(btrim(directory.email)) as email,
      directory.display_name
    from public.tenant_entra_directory_people as directory
    where directory.tenant_id = p_tenant_id
      and directory.account_enabled = true
      and directory.inactive_at is null
  ), inserted as (
    insert into public.ticket_requesters (
      tenant_id, email, display_name, source
    )
    select tenant_id, email, display_name, 'entra'
    from candidates
    on conflict (tenant_id, email) where email is not null do nothing
    returning id
  )
  select count(*)::integer into v_contacts_created from inserted;

  with candidates as (
    select
      directory.tenant_id,
      lower(btrim(directory.email)) as email,
      nullif(btrim(directory.source_department_name), '') as department
    from public.tenant_entra_directory_people as directory
    where directory.tenant_id = p_tenant_id
      and directory.account_enabled = true
      and directory.inactive_at is null
  ), initialized as (
    insert into public.ticket_requester_profiles (
      requester_id, tenant_id, department
    )
    select requester.id, candidates.tenant_id, candidates.department
    from candidates
    join public.ticket_requesters as requester
      on requester.tenant_id = candidates.tenant_id
      and requester.email = candidates.email
    where candidates.department is not null
      and char_length(candidates.department) <= 120
      and candidates.department !~ '[[:cntrl:]]'
    on conflict (requester_id) do update
      set department = excluded.department
      where public.ticket_requester_profiles.department is null
        or btrim(public.ticket_requester_profiles.department) = ''
    returning requester_id
  )
  select count(*)::integer into v_profiles_initialized from initialized;

  return query select v_contacts_created, v_profiles_initialized;
end;
$$;

revoke all on function public.initialise_entra_requester_profile(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.initialise_entra_requester_profile(uuid, uuid, text)
  to service_role;
revoke all on function public.sync_entra_directory_requesters(uuid)
  from public, anon, authenticated;
grant execute on function public.sync_entra_directory_requesters(uuid)
  to service_role;

-- Backfill only the already synchronized, active directory entries. Existing
-- manual profile values win; disabled directory people are not created or
-- removed by this operation.
do $$
declare
  v_tenant record;
begin
  for v_tenant in
    select distinct tenant_id
    from public.tenant_entra_directory_people
  loop
    perform public.sync_entra_directory_requesters(v_tenant.tenant_id);
  end loop;
end;
$$;

comment on function public.initialise_entra_requester_profile(uuid, uuid, text) is
  'Initializes only an empty requester department from the Entra directory; never changes manual profiles, offers or access rights.';
comment on function public.sync_entra_directory_requesters(uuid) is
  'Materializes active Entra directory people as requester contacts and initializes only empty requester department profiles.';

commit;
