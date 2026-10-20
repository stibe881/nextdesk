begin;

-- A removal is an explicit offboarding decision. It is terminal at the
-- database boundary so a delayed SSO flow, retry or service-side upsert cannot
-- recreate access without an explicitly designed rehiring process.
create or replace function public.prevent_removed_tenant_membership_reactivation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'removed'
     and new.status is distinct from 'removed'
     and coalesce(
       current_setting('nextdesk.explicit_tenant_reinvite', true),
       'off'
     ) <> 'on' then
    raise exception 'A removed tenant membership cannot be reactivated';
  end if;
  return new;
end;
$$;

drop trigger if exists tenant_memberships_prevent_removed_reactivation
  on public.tenant_memberships;
create trigger tenant_memberships_prevent_removed_reactivation
before update of status on public.tenant_memberships
for each row execute function public.prevent_removed_tenant_membership_reactivation();

-- A later rehiring needs an explicit new invitation. Only this existing,
-- permission-checked delivery procedure can transition removed -> invited;
-- the SSO gate below can never use this exception to restore access.
create or replace function public.record_tenant_invitation_delivery(
  p_actor_id uuid,
  p_invitation_id uuid,
  p_invited_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation public.tenant_invitations%rowtype;
begin
  select * into v_invitation
  from public.tenant_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  perform public.assert_user_has_tenant_permission(
    p_actor_id,
    v_invitation.tenant_id,
    'user.manage'
  );

  if v_invitation.status not in ('pending', 'sent') then
    raise exception 'Invitation cannot be delivered in its current state'
      using errcode = '22023';
  end if;
  if v_invitation.expires_at <= timezone('utc', now()) then
    update public.tenant_invitations
    set status = 'expired'
    where id = p_invitation_id;
    raise exception 'Invitation has expired' using errcode = '22023';
  end if;

  insert into public.user_profiles (id)
  values (p_invited_user_id)
  on conflict (id) do nothing;

  if exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = v_invitation.tenant_id
      and membership.user_id = p_invited_user_id
      and membership.status = 'active'
  ) then
    raise exception 'User is already an active tenant member'
      using errcode = '23505';
  end if;

  -- A re-invited user starts with no inherited privileges. This local flag is
  -- scoped to the transaction and is checked by the membership trigger above.
  perform set_config('nextdesk.explicit_tenant_reinvite', 'on', true);
  -- A prior Entra agent role can be tracked by the provenance trigger. This
  -- authorized re-invitation transaction may expire it, but it cannot grant or
  -- modify a role and the flag is local to this transaction only.
  perform set_config('nextdesk.entra_agent_assignment_operation', 'on', true);
  update public.user_role_assignments
  set expires_at = greatest(
    timezone('utc', now()),
    starts_at + interval '1 microsecond'
  )
  where tenant_id = v_invitation.tenant_id
    and user_id = p_invited_user_id
    and (expires_at is null or expires_at > timezone('utc', now()));
  perform set_config('nextdesk.entra_agent_assignment_operation', 'off', true);

  insert into public.tenant_memberships (tenant_id, user_id, status)
  values (v_invitation.tenant_id, p_invited_user_id, 'invited')
  on conflict (tenant_id, user_id) do update
    set status = 'invited',
        joined_at = null,
        updated_at = timezone('utc', now());
  perform set_config('nextdesk.explicit_tenant_reinvite', 'off', true);

  update public.tenant_invitations
  set invited_user_id = p_invited_user_id,
      status = 'sent',
      sent_at = timezone('utc', now()),
      failure_reason = null
  where id = p_invitation_id;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    severity
  ) values (
    v_invitation.tenant_id,
    p_actor_id,
    'tenant.invitation.sent',
    'tenant_invitation',
    p_invitation_id,
    'security'
  );
end;
$$;

-- SSO has already verified the Azure identity, domain and tenant claim before
-- calling this RPC. The RPC serializes the only allowed membership transition:
-- invited -> active. Suspended and removed memberships are never promoted.
alter table public.tenant_user_invitations
  add column if not exists accepted_by uuid references auth.users(id) on delete set null;

create or replace function public.claim_verified_tenant_sso_membership(
  p_tenant_id uuid,
  p_user_id uuid,
  p_email citext
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.membership_status;
  v_invitation public.tenant_user_invitations%rowtype;
  v_has_invitation boolean := false;
begin
  -- Lock the invitation first. The revocation procedure uses the same lock
  -- order before it updates the linked membership, avoiding a deadlock while
  -- making revocation win cleanly before a later SSO claim.
  select * into v_invitation
  from public.tenant_user_invitations invitation
  where invitation.tenant_id = p_tenant_id
    and invitation.email = lower(trim(p_email::text))::citext
  order by invitation.created_at desc, invitation.id desc
  limit 1
  for update;
  v_has_invitation := found;

  if v_has_invitation and v_invitation.status = 'revoked' then
    return jsonb_build_object('status', 'removed', 'was_active', false);
  end if;
  if v_has_invitation
     and v_invitation.status = 'sent'
     and v_invitation.expires_at <= timezone('utc', now()) then
    update public.tenant_user_invitations invitation
    set status = 'expired'
    where invitation.id = v_invitation.id
      and invitation.tenant_id = p_tenant_id
      and invitation.status = 'sent';
    v_invitation.status := 'expired';
  end if;

  select membership.status
  into v_status
  from public.tenant_memberships membership
  where membership.tenant_id = p_tenant_id
    and membership.user_id = p_user_id
  for update;

  if found then
    if v_status = 'removed' then
      return jsonb_build_object('status', 'removed', 'was_active', false);
    end if;
    if v_status = 'suspended' then
      return jsonb_build_object('status', 'suspended', 'was_active', false);
    end if;
    if v_status = 'active' then
      return jsonb_build_object('status', 'active', 'was_active', true);
    end if;

    update public.tenant_memberships membership
    set status = 'active',
        joined_at = coalesce(membership.joined_at, timezone('utc', now())),
        updated_at = timezone('utc', now())
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_user_id
      and membership.status = 'invited';
  else
    insert into public.tenant_memberships (
      tenant_id,
      user_id,
      status,
      joined_at
    ) values (
      p_tenant_id,
      p_user_id,
      'active',
      timezone('utc', now())
    );
  end if;

  if v_has_invitation and v_invitation.status = 'sent' then
    update public.tenant_user_invitations invitation
    set accepted_by = p_user_id
    where invitation.id = v_invitation.id
      and invitation.tenant_id = p_tenant_id
      and invitation.status = 'sent';
  end if;

  return jsonb_build_object(
    'status',
    'active',
    'was_active',
    false,
    'invitation',
    case
      when v_has_invitation and v_invitation.status = 'sent' then jsonb_build_object(
        'id', v_invitation.id,
        'tenant_id', v_invitation.tenant_id,
        'invited_by', v_invitation.invited_by,
        'role_name', v_invitation.role_name,
        'display_name', v_invitation.display_name,
        'job_title', v_invitation.job_title,
        'offer', v_invitation.offer,
        'department_id', v_invitation.department_id,
        'wants_agent', v_invitation.wants_agent
      )
      else null
    end
  );
end;
$$;

-- Email-link invitation acceptance is distinct from Azure SSO. It nevertheless
-- locks the exact invitation and membership rows in the same order as a revoke,
-- so a late browser request cannot create access after a revocation.
create or replace function public.claim_current_tenant_user_invitation(
  p_user_id uuid,
  p_email citext,
  p_invitation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation public.tenant_user_invitations%rowtype;
  v_membership_status public.membership_status;
begin
  select * into v_invitation
  from public.tenant_user_invitations invitation
  where invitation.id = p_invitation_id
    and invitation.email = lower(trim(p_email::text))::citext
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_invitation.status = 'revoked' then
    return jsonb_build_object('status', 'removed');
  end if;
  if v_invitation.status <> 'sent'
     or v_invitation.expires_at <= timezone('utc', now()) then
    if v_invitation.status = 'sent' then
      update public.tenant_user_invitations invitation
      set status = 'expired'
      where invitation.id = v_invitation.id
        and invitation.status = 'sent';
    end if;
    return jsonb_build_object('status', 'expired');
  end if;

  select membership.status
  into v_membership_status
  from public.tenant_memberships membership
  where membership.tenant_id = v_invitation.tenant_id
    and membership.user_id = p_user_id
  for update;

  if found then
    if v_membership_status = 'removed' then
      return jsonb_build_object('status', 'removed');
    end if;
    if v_membership_status = 'suspended' then
      return jsonb_build_object('status', 'suspended');
    end if;
    if v_membership_status = 'invited' then
      update public.tenant_memberships membership
      set status = 'active',
          joined_at = coalesce(membership.joined_at, timezone('utc', now())),
          updated_at = timezone('utc', now())
      where membership.tenant_id = v_invitation.tenant_id
        and membership.user_id = p_user_id
        and membership.status = 'invited';
    end if;
  else
    insert into public.tenant_memberships (
      tenant_id,
      user_id,
      status,
      joined_at
    ) values (
      v_invitation.tenant_id,
      p_user_id,
      'active',
      timezone('utc', now())
    );
  end if;

  update public.tenant_user_invitations invitation
  set accepted_by = p_user_id
  where invitation.id = v_invitation.id
    and invitation.status = 'sent';

  return jsonb_build_object(
    'status',
    'active',
    'invitation',
    jsonb_build_object(
      'id', v_invitation.id,
      'tenant_id', v_invitation.tenant_id,
      'invited_by', v_invitation.invited_by,
      'role_name', v_invitation.role_name,
      'display_name', v_invitation.display_name,
      'job_title', v_invitation.job_title,
      'offer', v_invitation.offer,
      'department_id', v_invitation.department_id,
      'wants_agent', v_invitation.wants_agent
    )
  );
end;
$$;

-- Active role assignments must observe and lock the same membership row. If a
-- cancellation wins, a later role write is rejected; if a role write wins, the
-- cancellation waits and expires it before completing. Expiring historical
-- assignments remains possible after removal.
create or replace function public.validate_role_assignment_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_scope public.role_scope;
  membership_status public.membership_status;
  is_expiring_existing_assignment boolean := false;
begin
  select role.scope
  into assigned_scope
  from public.roles role
  where role.id = new.role_id
    and role.tenant_id = new.tenant_id;

  if assigned_scope is null or assigned_scope = 'platform' then
    raise exception 'Role must belong to the assignment tenant and must not be a platform role';
  end if;

  -- A removal transaction may need a timestamp one microsecond after the
  -- original assignment start to satisfy historical constraints. It is still
  -- an expiry at commit time, never a new usable role for a removed member.
  is_expiring_existing_assignment := tg_op = 'UPDATE'
    and new.expires_at is not null
    and (
      old.expires_at is not null and new.expires_at <= old.expires_at
      or old.expires_at is null
         and new.expires_at <= timezone('utc', now()) + interval '1 second'
    );

  if not is_expiring_existing_assignment
     and (new.expires_at is null or new.expires_at > timezone('utc', now())) then
    select membership.status
    into membership_status
    from public.tenant_memberships membership
    where membership.tenant_id = new.tenant_id
      and membership.user_id = new.user_id
    for update;

    if membership_status is distinct from 'active' then
      raise exception 'A role can only be assigned to an active tenant member';
    end if;
  end if;

  if assigned_scope = 'tenant' and (new.department_id is not null or new.team_id is not null) then
    raise exception 'Tenant role assignments may not contain a department or team scope';
  end if;

  if assigned_scope = 'department' and (new.department_id is null or new.team_id is not null) then
    raise exception 'Department role assignments require exactly a department scope';
  end if;

  if assigned_scope = 'team' and new.team_id is null then
    raise exception 'Team role assignments require a team scope';
  end if;

  return new;
end;
$$;

-- Cancellation must be effective even if SSO has promoted an invited person in
-- the moment before the administrator confirms the cancellation. The linked
-- role records are then expired in the same transaction.
create or replace function public.cancel_tenant_invitation(
  p_actor_id uuid,
  p_invitation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation public.tenant_invitations%rowtype;
begin
  select * into v_invitation
  from public.tenant_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  perform public.assert_user_has_tenant_permission(
    p_actor_id,
    v_invitation.tenant_id,
    'user.manage'
  );

  -- A concurrent acceptance can commit after the administrator opened the
  -- cancellation dialog. Treat an accepted invitation as an explicit
  -- offboarding target as well, so acceptance can never win the race and leave
  -- the membership or its roles active.
  if v_invitation.status not in ('pending', 'sent', 'failed', 'accepted') then
    raise exception 'Invitation cannot be cancelled in its current state'
      using errcode = '22023';
  end if;

  update public.tenant_invitations
  set status = 'cancelled'
  where id = p_invitation_id;

  if v_invitation.invited_user_id is not null then
    update public.tenant_memberships
    set status = 'removed',
        updated_at = timezone('utc', now())
    where tenant_id = v_invitation.tenant_id
      and user_id = v_invitation.invited_user_id
      and status in ('invited', 'active');

    -- The provenance trigger protects Entra-created agent assignments from
    -- generic edits. A permission-checked cancellation is an explicit
    -- offboarding operation and must be able to expire, never reassign, them.
    perform set_config('nextdesk.entra_agent_assignment_operation', 'on', true);
    update public.user_role_assignments
    set expires_at = greatest(
      timezone('utc', now()),
      starts_at + interval '1 microsecond'
    )
    where tenant_id = v_invitation.tenant_id
      and user_id = v_invitation.invited_user_id
      and (expires_at is null or expires_at > timezone('utc', now()));
    perform set_config('nextdesk.entra_agent_assignment_operation', 'off', true);
  end if;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    severity
  ) values (
    v_invitation.tenant_id,
    p_actor_id,
    'tenant.invitation.cancelled',
    'tenant_invitation',
    p_invitation_id,
    'security'
  );
end;
$$;

-- tenant_user_invitations is the current user-management flow. It must use
-- the same terminal removal semantics as the legacy invitation procedure,
-- otherwise a revoked invitation can race with the SSO membership claim.
create or replace function public.revoke_tenant_user_invitation(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_invitation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation public.tenant_user_invitations%rowtype;
begin
  select * into v_invitation
  from public.tenant_user_invitations
  where id = p_invitation_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  perform public.assert_user_has_tenant_permission(
    p_actor_id,
    p_tenant_id,
    'user.manage'
  );
  -- The client marks a claimed invitation as accepted only after downstream
  -- profile and role work. A revocation that races with that last update must
  -- therefore remove both sent and already accepted invitations.
  if v_invitation.status not in ('sent', 'accepted') then
    raise exception 'Invitation cannot be revoked in its current state'
      using errcode = '22023';
  end if;

  update public.tenant_user_invitations
  set status = 'revoked'
  where id = p_invitation_id
    and tenant_id = p_tenant_id
    and status in ('sent', 'accepted');

  update public.tenant_memberships
  set status = 'removed',
      updated_at = timezone('utc', now())
  where tenant_id = p_tenant_id
    and user_id = v_invitation.accepted_by
    and status in ('invited', 'active');

  -- This is only reachable after the tenant-admin permission check and the
  -- locked invitation lookup above. It grants no role; it permits the existing
  -- provenance trigger to expire an Entra-tracked agent role during removal.
  perform set_config('nextdesk.entra_agent_assignment_operation', 'on', true);
  update public.user_role_assignments
  set expires_at = greatest(
    timezone('utc', now()),
    starts_at + interval '1 microsecond'
  )
  where tenant_id = p_tenant_id
    and user_id = v_invitation.accepted_by
    and (expires_at is null or expires_at > timezone('utc', now()));
  perform set_config('nextdesk.entra_agent_assignment_operation', 'off', true);

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    severity,
    metadata
  ) values (
    p_tenant_id,
    p_actor_id,
    'tenant.user_invitation.revoked',
    'tenant_user_invitation',
    p_invitation_id,
    'security',
    jsonb_build_object('source', 'tenant_users')
  );
end;
$$;

revoke all on function public.prevent_removed_tenant_membership_reactivation()
  from public, anon, authenticated;
revoke all on function public.claim_verified_tenant_sso_membership(uuid, uuid, citext)
  from public, anon, authenticated;
revoke all on function public.claim_current_tenant_user_invitation(uuid, citext, uuid)
  from public, anon, authenticated;
revoke all on function public.validate_role_assignment_scope()
  from public, anon, authenticated;
revoke all on function public.cancel_tenant_invitation(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.revoke_tenant_user_invitation(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.claim_verified_tenant_sso_membership(uuid, uuid, citext)
  to service_role;
grant execute on function public.claim_current_tenant_user_invitation(uuid, citext, uuid)
  to service_role;
grant execute on function public.prevent_removed_tenant_membership_reactivation()
  to service_role;
grant execute on function public.validate_role_assignment_scope()
  to service_role;
grant execute on function public.cancel_tenant_invitation(uuid, uuid)
  to service_role;
grant execute on function public.revoke_tenant_user_invitation(uuid, uuid, uuid)
  to service_role;

comment on function public.claim_verified_tenant_sso_membership(uuid, uuid, citext) is
  'Service-role-only SSO membership gate. It never promotes removed or suspended users.';
comment on function public.claim_current_tenant_user_invitation(uuid, citext, uuid) is
  'Service-role-only current invitation acceptance gate. It locks the invitation and membership before granting access.';
comment on function public.prevent_removed_tenant_membership_reactivation() is
  'Makes removed tenant memberships terminal so delayed provisioning cannot recreate access.';
comment on function public.validate_role_assignment_scope() is
  'Allows active role writes only for locked active memberships; historical role expiry remains available after offboarding.';
comment on function public.cancel_tenant_invitation(uuid, uuid) is
  'Cancels an invitation and terminally removes both invited and concurrently activated memberships.';
comment on function public.revoke_tenant_user_invitation(uuid, uuid, uuid) is
  'Revokes a current user invitation and terminally removes the linked invited or concurrently activated membership.';

commit;
