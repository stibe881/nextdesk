-- Agents receive every notification by push and by e-mail by default.
--
-- * user_is_ticket_agent(): same rule as is_tenant_ticket_agent(), for any user.
-- * agent_notification_defaults_all(): writes "everything on" preferences.
-- * When a user gets an agent role and has no stored preferences yet, these
--   defaults are stored (trigger on user_role_assignments). Later personal
--   changes are kept.
-- * One-off: every current agent gets everything switched on.

create or replace function public.user_is_ticket_agent(p_tenant_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p_tenant_id is not null and p_user_id is not null
    and exists (
      select 1 from public.tenant_memberships membership
       where membership.tenant_id = p_tenant_id
         and membership.user_id = p_user_id
         and membership.status = 'active'
    )
    and exists (
      select 1
      from public.user_role_assignments assignment
      join public.roles role
        on role.id = assignment.role_id
        and role.tenant_id = assignment.tenant_id
        and role.active
        and role.scope in ('tenant', 'department')
      join public.role_permissions role_permission on role_permission.role_id = role.id
      where assignment.user_id = p_user_id
        and assignment.tenant_id = p_tenant_id
        and assignment.starts_at <= timezone('utc', now())
        and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
        and role_permission.permission_code in (
          'ticket.read.department', 'ticket.read.assigned', 'ticket.update', 'ticket.internal_notes.read'
        )
    );
$$;

revoke all on function public.user_is_ticket_agent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.user_is_ticket_agent(uuid, uuid) to service_role;

create or replace function public.agent_notification_defaults_all(
  p_tenant_id uuid,
  p_user_id uuid,
  p_overwrite boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_push text[] := array[
    'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
    'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline',
    'inventory_low_stock', 'shop'
  ]::text[];
  v_email text[] := array[
    'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
    'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline',
    'inventory_low_stock', 'shop', 'service_task', 'infrastructure'
  ]::text[];
  v_modes jsonb := (
    select jsonb_object_agg(category, 'immediate')
      from unnest(array[
        'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
        'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline',
        'inventory_low_stock', 'shop', 'infrastructure'
      ]::text[]) as category
  );
begin
  if p_overwrite then
    insert into public.push_preferences (
      tenant_id, user_id, enabled_categories, email_categories,
      category_modes, global_enabled
    ) values (p_tenant_id, p_user_id, v_push, v_email, v_modes, true)
    on conflict (tenant_id, user_id) do update
      set enabled_categories = excluded.enabled_categories,
          email_categories = excluded.email_categories,
          category_modes = excluded.category_modes,
          global_enabled = true,
          updated_at = timezone('utc', now());
  else
    insert into public.push_preferences (
      tenant_id, user_id, enabled_categories, email_categories,
      category_modes, global_enabled
    ) values (p_tenant_id, p_user_id, v_push, v_email, v_modes, true)
    on conflict (tenant_id, user_id) do nothing;
  end if;
end;
$$;

revoke all on function public.agent_notification_defaults_all(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.agent_notification_defaults_all(uuid, uuid, boolean) to service_role;

create or replace function public.agent_notification_defaults_on_role()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  begin
    if public.user_is_ticket_agent(new.tenant_id, new.user_id) then
      perform public.agent_notification_defaults_all(new.tenant_id, new.user_id, false);
    end if;
  exception when others then
    -- Notification defaults must never block a role assignment.
    raise warning 'agent_notification_defaults_on_role failed: %', sqlstate;
  end;
  return null;
end;
$$;

revoke all on function public.agent_notification_defaults_on_role() from public, anon, authenticated;

drop trigger if exists user_role_assignments_agent_notification_defaults
  on public.user_role_assignments;
create trigger user_role_assignments_agent_notification_defaults
  after insert or update of role_id, starts_at, expires_at
  on public.user_role_assignments
  for each row execute function public.agent_notification_defaults_on_role();

-- One-off: switch everything on for all current agents.
do $$
declare
  v_member record;
begin
  for v_member in
    select distinct membership.tenant_id, membership.user_id
      from public.tenant_memberships membership
     where membership.status = 'active'
       and public.user_is_ticket_agent(membership.tenant_id, membership.user_id)
  loop
    perform public.agent_notification_defaults_all(v_member.tenant_id, v_member.user_id, true);
  end loop;
end;
$$;
