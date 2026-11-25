begin;

set local search_path = pg_catalog, public;

-- Austrittsmeldung per Mail (PDF der Personal-App): legt einen Austritt
-- (kind = 'offboarding') an. Wie beim Eintritt verhindert der Fingerabdruck
-- Doppelerfassungen. Die Vorlagenaufgaben des Eintritts (Gerät, Konto …)
-- passen nicht zu einem Austritt und entfallen; stattdessen kommen die
-- Aufgaben aus der Meldung sowie die Abteilungsaufgaben für Austritte.
create or replace function public.create_offboarding_entry_from_email(
  p_tenant_id uuid,
  p_fingerprint text,
  p_employee_name text,
  p_exit_on date,
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
set search_path to 'public', 'pg_temp'
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
    raise exception 'Invalid offboarding intake' using errcode = '22023';
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

  if (p_details ->> 'reporterUserId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select membership.user_id into v_manager
    from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.status = 'active'
      and membership.user_id = (p_details ->> 'reporterUserId')::uuid;
  end if;
  v_manager := coalesce(v_manager, v_responsible);

  select template.id into v_template
  from public.onboarding_templates template
  where template.tenant_id = p_tenant_id and template.template_key = 'standard' and template.active;
  if v_template is null then
    raise exception 'Onboarding template unavailable' using errcode = '23503';
  end if;

  v_entry := public.create_onboarding_entry_with_kind(
    p_tenant_id, p_employee_name, p_exit_on,
    coalesce(nullif(btrim(p_organisation_unit), ''), 'Nicht angegeben'),
    coalesce(nullif(btrim(p_location), ''), 'Nicht angegeben'),
    v_manager, null, v_template, v_responsible, 'offboarding'
  );

  -- Eintritts-Vorlagenaufgaben entfernen.
  delete from public.onboarding_tasks task
  where task.entry_id = v_entry and task.tenant_id = p_tenant_id
    and task.template_task_id is not null;

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
      p_exit_on + coalesce((v_task ->> 'dueOffsetDays')::integer, 0),
      null, v_position
    );
  end loop;

  return query select true, v_entry;
end;
$$;

revoke all on function public.create_offboarding_entry_from_email(
  uuid, text, text, date, text, text, text, jsonb, jsonb, text
) from public, anon, authenticated;
grant execute on function public.create_offboarding_entry_from_email(
  uuid, text, text, date, text, text, text, jsonb, jsonb, text
) to service_role;

commit;
