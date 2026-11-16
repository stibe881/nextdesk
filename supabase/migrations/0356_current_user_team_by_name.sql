begin;

set local search_path = pg_catalog, public;

-- Whether the signed-in person belongs to an active team with this name in
-- the tenant (name compared without case and surrounding spaces). The app
-- shows the «Öffnen» group of the Home long-press menu only to the team
-- «System Engineer». Same membership rules as is_current_user_team_member.
create or replace function public.is_current_user_in_team_named(
  p_tenant_id uuid,
  p_team_name text
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.team_memberships membership
    join public.teams team on team.id = membership.team_id
    join public.tenant_memberships tenant_membership
      on tenant_membership.tenant_id = membership.tenant_id
     and tenant_membership.user_id = membership.user_id
    join public.department_memberships department_membership
      on department_membership.department_id = team.department_id
     and department_membership.user_id = membership.user_id
    where membership.tenant_id = p_tenant_id
      and membership.user_id = auth.uid()
      and team.tenant_id = p_tenant_id
      and team.active
      and lower(btrim(team.name)) = lower(btrim(p_team_name))
      and tenant_membership.status = 'active'
      and department_membership.status = 'active'
  );
$$;

revoke all on function public.is_current_user_in_team_named(uuid, text) from public, anon;
grant execute on function public.is_current_user_in_team_named(uuid, text) to authenticated;

commit;
