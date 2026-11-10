begin;

set local search_path = pg_catalog, public;

-- Eingeladene Personen, die sich zum ersten Mal anmelden, haben noch keine Zeile
-- in user_profiles. tenant_memberships.user_id verweist darauf (Fremdschlüssel);
-- die Annahme der Einladung schlug deshalb fehl, und die Person landete im
-- Dialog «Arbeitsbereich erstellen». Das Profil wird jetzt vor der Mitgliedschaft
-- angelegt.
create or replace function public.claim_current_tenant_user_invitation(
  p_user_id uuid,
  p_email citext,
  p_invitation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  insert into public.user_profiles (id)
  values (p_user_id)
  on conflict (id) do nothing;

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
$function$;

commit;
