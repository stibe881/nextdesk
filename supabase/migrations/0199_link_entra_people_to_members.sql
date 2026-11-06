-- Active members are linked to their Entra person by e-mail. Until now this
-- only happened during a particular SSO sign-in, so older members had no link
-- and showed no Entra data (function, department, manager) and no manager
-- relations for shop approvals or ticket visibility.

create or replace function public.link_entra_person_to_member(
  p_tenant_id uuid,
  p_user_id uuid
)
returns void
language sql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
  update public.tenant_entra_directory_people person
  set local_user_id = p_user_id
  from auth.users account
  where account.id = p_user_id
    and person.tenant_id = p_tenant_id
    and person.local_user_id is null
    and person.account_enabled
    and person.inactive_at is null
    and lower(person.email) = lower(btrim(account.email))
    -- A member is linked to at most one Entra person.
    and not exists (
      select 1
      from public.tenant_entra_directory_people other
      where other.tenant_id = p_tenant_id
        and other.local_user_id = p_user_id
    );
$$;
revoke all on function public.link_entra_person_to_member(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.link_entra_person_to_member(uuid, uuid)
  to service_role;

create or replace function public.link_entra_person_on_membership()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.status = 'active' then
    perform public.link_entra_person_to_member(new.tenant_id, new.user_id);
  end if;
  return new;
end;
$$;
revoke all on function public.link_entra_person_on_membership()
  from public, anon, authenticated;

create or replace trigger tenant_memberships_link_entra_person
after insert or update of status on public.tenant_memberships
for each row execute function public.link_entra_person_on_membership();

-- People synchronised after the member joined are linked as well.
create or replace function public.link_member_on_entra_person()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_user_id uuid;
begin
  if new.local_user_id is not null
    or not new.account_enabled
    or new.inactive_at is not null then
    return new;
  end if;
  select membership.user_id into v_user_id
  from public.tenant_memberships membership
  join auth.users account on account.id = membership.user_id
  where membership.tenant_id = new.tenant_id
    and membership.status = 'active'
    and lower(btrim(account.email)) = lower(new.email)
    and not exists (
      select 1
      from public.tenant_entra_directory_people other
      where other.tenant_id = new.tenant_id
        and other.local_user_id = membership.user_id
    )
  limit 1;
  if v_user_id is not null then
    new.local_user_id := v_user_id;
  end if;
  return new;
end;
$$;
revoke all on function public.link_member_on_entra_person()
  from public, anon, authenticated;

create or replace trigger tenant_entra_directory_people_link_member
before insert or update of email, account_enabled, inactive_at
on public.tenant_entra_directory_people
for each row execute function public.link_member_on_entra_person();

-- Backfill existing active members.
select public.link_entra_person_to_member(membership.tenant_id, membership.user_id)
from public.tenant_memberships membership
where membership.status = 'active';
