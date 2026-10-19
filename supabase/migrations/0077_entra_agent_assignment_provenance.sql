begin;

set local search_path = pg_catalog, public;

alter table public.tenant_entra_directory_people
  add column if not exists agent_requested_by uuid references public.user_profiles(id) on delete restrict,
  add column if not exists agent_requested_at timestamptz,
  add column if not exists agent_role_assignment_id uuid references public.user_role_assignments(id) on delete restrict;

-- Vormerkungen aus der Zeit vor einer nachweisbaren Mandantenadministration
-- dürfen nie nachträglich eine Rolle erzeugen.
update public.tenant_entra_directory_people
set
  agent_requested = false,
  agent_department_id = null,
  agent_requested_by = null,
  agent_requested_at = null,
  agent_role_assignment_id = null
where agent_requested_by is null
   or agent_requested_at is null;

update public.tenant_entra_directory_people
set
  agent_department_id = null,
  agent_requested_by = null,
  agent_requested_at = null,
  agent_role_assignment_id = null
where agent_requested = false;

alter table public.tenant_entra_directory_people
  drop constraint if exists tenant_entra_directory_people_agent_request_provenance_check;
alter table public.tenant_entra_directory_people
  add constraint tenant_entra_directory_people_agent_request_provenance_check
  check (
    (
      agent_requested
      and agent_department_id is not null
      and agent_requested_by is not null
      and agent_requested_at is not null
    )
    or (
      not agent_requested
      and agent_department_id is null
      and agent_requested_by is null
      and agent_requested_at is null
      and agent_role_assignment_id is null
    )
  );

create or replace function public.set_entra_agent_request(
  p_tenant_id uuid,
  p_entra_object_id uuid,
  p_enabled boolean,
  p_department_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_person public.tenant_entra_directory_people%rowtype;
  v_membership_status public.membership_status;
  v_role_id uuid;
  v_existing_assignment_id uuid;
  v_assignment_id uuid;
  v_effective_immediately boolean := false;
begin
  perform set_config('nextdesk.entra_agent_assignment_operation', 'on', true);

  if not exists (
    select 1
    from public.tenant_memberships membership
    join public.roles role
      on role.tenant_id = membership.tenant_id
     and role.name = 'Tenant administrator'
     and role.scope = 'tenant'
     and role.active = true
    join public.user_role_assignments assignment
      on assignment.tenant_id = membership.tenant_id
     and assignment.user_id = membership.user_id
     and assignment.role_id = role.id
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_actor_id
      and membership.status = 'active'
      and assignment.starts_at <= v_now
      and (assignment.expires_at is null or assignment.expires_at > v_now)
  ) then
    raise exception 'tenant_admin_required';
  end if;

  select *
  into v_person
  from public.tenant_entra_directory_people
  where tenant_id = p_tenant_id
    and entra_object_id = p_entra_object_id
  for update;

  if not found then
    raise exception 'entra_person_not_active';
  end if;

  if p_enabled
     and (not v_person.account_enabled or v_person.inactive_at is not null) then
    raise exception 'entra_person_not_active';
  end if;

  if not p_enabled and not v_person.agent_requested then
    raise exception 'entra_agent_request_not_configured';
  end if;

  if p_enabled then
    if p_department_id is null
       or not exists (
        select 1
        from public.departments department
        where department.id = p_department_id
          and department.tenant_id = p_tenant_id
          and department.active = true
       ) then
      raise exception 'department_not_in_tenant';
    end if;

    if v_person.local_user_id is not null then
      select status
      into v_membership_status
      from public.tenant_memberships
      where tenant_id = p_tenant_id
        and user_id = v_person.local_user_id;

      if v_membership_status = 'removed' then
        raise exception 'entra_person_removed';
      end if;

      if v_membership_status = 'active' then
        v_effective_immediately := true;
        select id
        into v_role_id
        from public.roles
        where tenant_id = p_tenant_id
          and name = 'Support agent'
          and scope = 'department'
          and active = true;
        if v_role_id is null then
          raise exception 'agent_role_not_found';
        end if;

        -- Eine aktive Rolle ausserhalb dieser nachweisbaren Vormerkung gehört
        -- einem anderen kontrollierten Prozess und darf nie übernommen,
        -- dupliziert oder beim späteren Entzug entfernt werden.
        select assignment.id
        into v_existing_assignment_id
        from public.user_role_assignments assignment
        where assignment.tenant_id = p_tenant_id
          and assignment.user_id = v_person.local_user_id
          and assignment.role_id = v_role_id
          and assignment.starts_at <= v_now
          and (assignment.expires_at is null or assignment.expires_at > v_now)
        limit 1;
        if v_existing_assignment_id is not null
           and v_existing_assignment_id is distinct from v_person.agent_role_assignment_id then
          raise exception 'entra_person_already_support_agent';
        end if;

        if v_person.agent_role_assignment_id is not null then
          update public.user_role_assignments
          set
            starts_at = least(starts_at, v_now - interval '1 microsecond'),
            expires_at = v_now
          where id = v_person.agent_role_assignment_id
            and tenant_id = p_tenant_id
            and user_id = v_person.local_user_id
            and expires_at is null;
        end if;

        insert into public.department_memberships (
          tenant_id,
          department_id,
          user_id,
          status
        )
        values (p_tenant_id, p_department_id, v_person.local_user_id, 'active')
        on conflict (department_id, user_id)
        do update set status = 'active';

        insert into public.tenant_member_directory (
          tenant_id,
          user_id,
          department_id
        )
        values (p_tenant_id, v_person.local_user_id, p_department_id)
        on conflict (tenant_id, user_id)
        do update set department_id = excluded.department_id;

        insert into public.user_role_assignments (
          tenant_id,
          user_id,
          role_id,
          department_id,
          assigned_by
        )
        values (
          p_tenant_id,
          v_person.local_user_id,
          v_role_id,
          p_department_id,
          p_actor_id
        )
        returning id into v_assignment_id;
      end if;
    end if;

    update public.tenant_entra_directory_people
    set
      agent_requested = true,
      agent_department_id = p_department_id,
      agent_requested_by = p_actor_id,
      agent_requested_at = v_now,
      agent_role_assignment_id = v_assignment_id
    where tenant_id = p_tenant_id
      and entra_object_id = p_entra_object_id;

    insert into public.audit_logs (
      tenant_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      severity,
      metadata
    )
    values (
      p_tenant_id,
      p_actor_id,
      'tenant.entra_person.agent_requested',
      'tenant_entra_directory_person',
      p_entra_object_id,
      'security',
      jsonb_build_object(
        'departmentId', p_department_id,
        'effectiveImmediately', v_effective_immediately
      )
    );

    return jsonb_build_object(
      'updated', true,
      'agentRequested', true,
      'effectiveImmediately', v_effective_immediately
    );
  end if;

  if v_person.agent_role_assignment_id is not null then
    update public.user_role_assignments
    set
      starts_at = least(starts_at, v_now - interval '1 microsecond'),
      expires_at = v_now
    where id = v_person.agent_role_assignment_id
      and tenant_id = p_tenant_id
      and expires_at is null;
  end if;

  update public.tenant_entra_directory_people
  set
    agent_requested = false,
    agent_department_id = null,
    agent_requested_by = null,
    agent_requested_at = null,
    agent_role_assignment_id = null
  where tenant_id = p_tenant_id
    and entra_object_id = p_entra_object_id;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    severity,
    metadata
  )
  values (
    p_tenant_id,
    p_actor_id,
    'tenant.entra_person.agent_request_revoked',
    'tenant_entra_directory_person',
    p_entra_object_id,
    'security',
    jsonb_build_object('effectiveImmediately', v_effective_immediately)
  );

  return jsonb_build_object(
    'updated', true,
    'agentRequested', false,
    'effectiveImmediately', v_effective_immediately
  );
end;
$$;

create or replace function public.apply_entra_agent_request(
  p_tenant_id uuid,
  p_entra_object_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_person public.tenant_entra_directory_people%rowtype;
  v_role_id uuid;
  v_assignment_valid boolean := false;
  v_assignment_id uuid;
  v_existing_assignment_id uuid;
begin
  perform set_config('nextdesk.entra_agent_assignment_operation', 'on', true);

  select *
  into v_person
  from public.tenant_entra_directory_people
  where tenant_id = p_tenant_id
    and entra_object_id = p_entra_object_id
  for update;

  if not found
     or not v_person.account_enabled
     or v_person.inactive_at is not null
     or v_person.local_user_id is distinct from p_user_id
     or not v_person.agent_requested then
    return jsonb_build_object('applied', false);
  end if;

  if v_person.agent_requested_by is null
     or v_person.agent_requested_at is null
     or v_person.agent_department_id is null
     or not exists (
      select 1
      from public.departments department
      where department.id = v_person.agent_department_id
        and department.tenant_id = p_tenant_id
        and department.active = true
     ) then
    if v_person.agent_role_assignment_id is not null then
      update public.user_role_assignments
      set
        starts_at = least(starts_at, v_now - interval '1 microsecond'),
        expires_at = v_now
      where id = v_person.agent_role_assignment_id
        and tenant_id = p_tenant_id
        and expires_at is null;
    end if;

    update public.tenant_entra_directory_people
    set
      agent_requested = false,
      agent_department_id = null,
      agent_requested_by = null,
      agent_requested_at = null,
      agent_role_assignment_id = null
    where tenant_id = p_tenant_id
      and entra_object_id = p_entra_object_id;

    insert into public.audit_logs (
      tenant_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      severity,
      metadata
    )
    values (
      p_tenant_id,
      p_user_id,
      'tenant.sso_entra_agent_request.invalidated',
      'tenant_entra_directory_person',
      p_entra_object_id,
      'security',
      jsonb_build_object('source', 'tenant_sso_access')
    );
    return jsonb_build_object('applied', false, 'invalidated', true);
  end if;

  if not exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_user_id
      and membership.status = 'active'
  ) then
    return jsonb_build_object('applied', false);
  end if;

  if v_person.agent_role_assignment_id is not null then
    select exists (
      select 1
      from public.user_role_assignments assignment
      join public.roles role on role.id = assignment.role_id
      where assignment.id = v_person.agent_role_assignment_id
        and assignment.tenant_id = p_tenant_id
        and assignment.user_id = p_user_id
        and assignment.department_id = v_person.agent_department_id
        and assignment.starts_at <= v_now
        and (assignment.expires_at is null or assignment.expires_at > v_now)
        and role.name = 'Support agent'
        and role.scope = 'department'
        and role.active = true
    ) into v_assignment_valid;
  end if;

  if v_assignment_valid then
    return jsonb_build_object('applied', true, 'alreadyApplied', true);
  end if;

  -- Eine einmal verfolgte, aber nicht mehr wirksame Zuweisung darf nicht
  -- stillschweigend wiederbelebt werden. Sie muss durch eine neue bewusste
  -- Mandantenadmin-Aktion bestätigt werden.
  if v_person.agent_role_assignment_id is not null then
    return jsonb_build_object(
      'applied', false,
      'trackedAssignmentUnavailable', true
    );
  end if;

  select id
  into v_role_id
  from public.roles
  where tenant_id = p_tenant_id
    and name = 'Support agent'
    and scope = 'department'
    and active = true;
  if v_role_id is null then
    raise exception 'agent_role_not_found';
  end if;

  select assignment.id
  into v_existing_assignment_id
  from public.user_role_assignments assignment
  where assignment.tenant_id = p_tenant_id
    and assignment.user_id = p_user_id
    and assignment.role_id = v_role_id
    and assignment.starts_at <= v_now
    and (assignment.expires_at is null or assignment.expires_at > v_now)
  limit 1;
  if v_existing_assignment_id is not null
     and v_existing_assignment_id is distinct from v_person.agent_role_assignment_id then
    return jsonb_build_object(
      'applied', false,
      'blockedByExistingAgentRole', true
    );
  end if;

  insert into public.department_memberships (
    tenant_id,
    department_id,
    user_id,
    status
  )
  values (p_tenant_id, v_person.agent_department_id, p_user_id, 'active')
  on conflict (department_id, user_id)
  do update set status = 'active';

  insert into public.tenant_member_directory (
    tenant_id,
    user_id,
    department_id
  )
  values (p_tenant_id, p_user_id, v_person.agent_department_id)
  on conflict (tenant_id, user_id)
  do update set department_id = excluded.department_id;

  insert into public.user_role_assignments (
    tenant_id,
    user_id,
    role_id,
    department_id,
    assigned_by
  )
  values (
    p_tenant_id,
    p_user_id,
    v_role_id,
    v_person.agent_department_id,
    v_person.agent_requested_by
  )
  returning id into v_assignment_id;

  update public.tenant_entra_directory_people
  set agent_role_assignment_id = v_assignment_id
  where tenant_id = p_tenant_id
    and entra_object_id = p_entra_object_id;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    severity,
    metadata
  )
  values (
    p_tenant_id,
    p_user_id,
    'tenant.sso_entra_agent_request.applied',
    'tenant_entra_directory_person',
    p_entra_object_id,
    'security',
    jsonb_build_object(
      'departmentId', v_person.agent_department_id,
      'requestedBy', v_person.agent_requested_by,
      'source', 'tenant_sso_access'
    )
  );

  return jsonb_build_object('applied', true);
end;
$$;

create or replace function public.deactivate_stale_entra_directory_people(
  p_tenant_id uuid,
  p_started_at timestamptz,
  p_actor_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_person public.tenant_entra_directory_people%rowtype;
  v_now timestamptz := timezone('utc', now());
  v_count integer := 0;
begin
  perform set_config('nextdesk.entra_agent_assignment_operation', 'on', true);

  for v_person in
    select *
    from public.tenant_entra_directory_people
    where tenant_id = p_tenant_id
      and (
        last_synced_at < p_started_at
        or (
          agent_requested
          and (not account_enabled or inactive_at is not null)
        )
      )
    for update
  loop
    if v_person.agent_role_assignment_id is not null then
      update public.user_role_assignments
      set
        starts_at = least(starts_at, v_now - interval '1 microsecond'),
        expires_at = v_now
      where id = v_person.agent_role_assignment_id
        and tenant_id = p_tenant_id
        and expires_at is null;
    end if;

    update public.tenant_entra_directory_people
    set
      account_enabled = false,
      inactive_at = p_started_at,
      agent_requested = false,
      agent_department_id = null,
      agent_requested_by = null,
      agent_requested_at = null,
      agent_role_assignment_id = null
    where tenant_id = p_tenant_id
      and entra_object_id = v_person.entra_object_id;

    if v_person.agent_requested then
      insert into public.audit_logs (
        tenant_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        severity,
        metadata
      )
      values (
        p_tenant_id,
        p_actor_id,
        'tenant.entra_person.agent_request_revoked_on_deactivation',
        'tenant_entra_directory_person',
        v_person.entra_object_id,
        'security',
        jsonb_build_object('source', 'entra_directory_sync')
      );
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Ausschliesslich die drei obigen SECURITY DEFINER-Funktionen dürfen eine
-- nachweisbar aus der Entra-Vormerkung entstandene Rolle ändern oder entfernen.
-- Damit kann kein allgemeiner Rollen- oder Personenbearbeitungspfad eine
-- Vormerkung und ihre Rollenreferenz auseinanderreissen und bei einem späteren
-- SSO-Login ungewollt wiederherstellen.
create or replace function public.protect_entra_agent_role_assignment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tracked boolean := false;
begin
  if current_setting('nextdesk.entra_agent_assignment_operation', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.expires_at is not distinct from old.expires_at
     and new.starts_at is not distinct from old.starts_at
     and new.role_id is not distinct from old.role_id
     and new.user_id is not distinct from old.user_id
     and new.department_id is not distinct from old.department_id then
    return new;
  end if;

  select exists (
    select 1
    from public.tenant_entra_directory_people person
    where person.agent_role_assignment_id = old.id
  ) into v_tracked;

  if v_tracked then
    raise exception 'entra_agent_assignment_managed_separately';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists user_role_assignments_protect_entra_agent_assignment on public.user_role_assignments;
create trigger user_role_assignments_protect_entra_agent_assignment
before update of expires_at, starts_at, role_id, user_id, department_id or delete
on public.user_role_assignments
for each row
execute function public.protect_entra_agent_role_assignment();

revoke all on function public.protect_entra_agent_role_assignment() from public, anon, authenticated, service_role;
revoke all on function public.set_entra_agent_request(uuid, uuid, boolean, uuid, uuid) from public, anon, authenticated;
revoke all on function public.apply_entra_agent_request(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.deactivate_stale_entra_directory_people(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.set_entra_agent_request(uuid, uuid, boolean, uuid, uuid) to service_role;
grant execute on function public.apply_entra_agent_request(uuid, uuid, uuid) to service_role;
grant execute on function public.deactivate_stale_entra_directory_people(uuid, timestamptz, uuid) to service_role;

comment on column public.tenant_entra_directory_people.agent_requested_by is
  'Mandantenadministration, die die nachweisbare Agentenvormerkung gesetzt hat.';
comment on column public.tenant_entra_directory_people.agent_requested_at is
  'Zeitpunkt der nachweisbaren Agentenvormerkung durch eine Mandantenadministration.';
comment on column public.tenant_entra_directory_people.agent_role_assignment_id is
  'Ausschliesslich von der Entra-Agentenvormerkung erzeugte Rollen-Zuweisung; sie wird beim Entzug oder Entra-Offboarding atomar beendet.';

commit;
