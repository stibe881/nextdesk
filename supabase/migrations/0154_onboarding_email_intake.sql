begin;

-- Eintritte können jetzt auch automatisch aus der Eintrittsmeldung der
-- Personal-App (E-Mail mit PDF) entstehen. Die zusätzlichen Angaben aus dem PDF
-- liegen in "details"; "fingerprint" verhindert Doppelerfassungen.
alter table public.onboarding_entries
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'email')),
  add column if not exists details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  add column if not exists fingerprint text
    check (fingerprint is null or char_length(fingerprint) = 64),
  add column if not exists source_ticket_number text
    check (source_ticket_number is null or char_length(source_ticket_number) <= 40);

create unique index if not exists onboarding_entries_fingerprint_unique
  on public.onboarding_entries (tenant_id, fingerprint)
  where fingerprint is not null;

-- Die verantwortliche Person für automatisch angelegte Eintritte: das am
-- längsten aktive Mitglied mit dem Recht "onboarding.manage".
create or replace function public.onboarding_default_responsible(p_tenant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select membership.user_id
  from public.tenant_memberships membership
  where membership.tenant_id = p_tenant_id
    and membership.status = 'active'
    and exists (
      select 1
      from public.user_role_assignments assignment
      join public.roles role
        on role.id = assignment.role_id
       and role.tenant_id = assignment.tenant_id
       and role.active
      join public.role_permissions permission
        on permission.role_id = role.id
       and permission.permission_code = 'onboarding.manage'
      where assignment.tenant_id = p_tenant_id
        and assignment.user_id = membership.user_id
        and assignment.starts_at <= timezone('utc', now())
        and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
    )
  order by membership.created_at, membership.user_id
  limit 1;
$$;

revoke all on function public.onboarding_default_responsible(uuid) from public, anon, authenticated;
grant execute on function public.onboarding_default_responsible(uuid) to service_role;

-- Legt einen Eintritt aus der Eintrittsmeldung an: Vorgesetzte Person nach Name
-- suchen (sonst die verantwortliche Person), Standardvorlage verwenden und die
-- Checkliste um die Angaben aus dem PDF ergänzen.
create or replace function public.create_onboarding_entry_from_email(
  p_tenant_id uuid,
  p_fingerprint text,
  p_employee_name text,
  p_starts_on date,
  p_organisation_unit text,
  p_location text,
  p_supervisor_name text,
  p_details jsonb,
  p_extra_tasks jsonb,
  p_source_ticket_number text
)
returns table (created boolean, entry_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing uuid;
  v_responsible uuid;
  v_manager uuid;
  v_template uuid;
  v_entry uuid;
  v_task jsonb;
  v_position integer;
begin
  if p_tenant_id is null or p_fingerprint is null or char_length(p_fingerprint) <> 64
    or jsonb_typeof(p_details) <> 'object' or jsonb_typeof(p_extra_tasks) <> 'array'
    or jsonb_array_length(p_extra_tasks) > 20 then
    raise exception 'Invalid onboarding intake' using errcode = '22023';
  end if;

  select entry.id into v_existing
  from public.onboarding_entries entry
  where entry.tenant_id = p_tenant_id and entry.fingerprint = p_fingerprint;
  if v_existing is not null then
    return query select false, v_existing;
    return;
  end if;

  v_responsible := public.onboarding_default_responsible(p_tenant_id);
  if v_responsible is null then
    raise exception 'No onboarding responsible person available' using errcode = 'P0002';
  end if;

  select profile.id into v_manager
  from public.user_profiles profile
  join public.tenant_memberships membership
    on membership.user_id = profile.id
   and membership.tenant_id = p_tenant_id
   and membership.status = 'active'
  where p_supervisor_name is not null
    and lower(btrim(profile.display_name)) = lower(btrim(p_supervisor_name))
  order by membership.created_at
  limit 1;
  v_manager := coalesce(v_manager, v_responsible);

  select template.id into v_template
  from public.onboarding_templates template
  where template.tenant_id = p_tenant_id and template.template_key = 'standard' and template.active;
  if v_template is null then
    raise exception 'Onboarding template unavailable' using errcode = '23503';
  end if;

  v_entry := public.create_onboarding_entry(
    p_tenant_id, p_employee_name, p_starts_on,
    coalesce(nullif(btrim(p_organisation_unit), ''), 'Nicht angegeben'),
    coalesce(nullif(btrim(p_location), ''), 'Nicht angegeben'),
    v_manager, v_responsible, v_template, v_responsible
  );

  update public.onboarding_entries
  set source = 'email',
      details = p_details,
      fingerprint = p_fingerprint,
      source_ticket_number = p_source_ticket_number
  where id = v_entry and tenant_id = p_tenant_id;

  select coalesce(max(task.position), 0) into v_position
  from public.onboarding_tasks task where task.entry_id = v_entry;
  for v_task in select value from jsonb_array_elements(p_extra_tasks) loop
    v_position := v_position + 1;
    exit when v_position > 100;
    insert into public.onboarding_tasks (
      tenant_id, entry_id, title, due_on, responsible_user_id, position
    )
    values (
      p_tenant_id, v_entry,
      left(btrim(v_task ->> 'title'), 240),
      p_starts_on + coalesce((v_task ->> 'dueOffsetDays')::integer, -3),
      v_responsible, v_position
    );
  end loop;

  return query select true, v_entry;
end;
$$;

revoke all on function public.create_onboarding_entry_from_email(
  uuid, text, text, date, text, text, text, jsonb, jsonb, text
) from public, anon, authenticated;
grant execute on function public.create_onboarding_entry_from_email(
  uuid, text, text, date, text, text, text, jsonb, jsonb, text
) to service_role;

commit;
