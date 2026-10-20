begin;

-- The form builder exposes only active definitions. Keep their visual sequence
-- contiguous and place retired definitions afterwards so an active position
-- sent by the browser remains stable even after a field was retired.
create or replace function public.normalize_ticket_custom_field_positions(
  p_tenant_id uuid,
  p_section_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  set constraints ticket_custom_field_definitions_section_position_unique deferred;
  with ordered as (
    select id, row_number() over (
      order by active desc, position, id
    ) - 1 as next_position
    from public.ticket_custom_field_definitions
    where tenant_id = p_tenant_id and section_id = p_section_id
  )
  update public.ticket_custom_field_definitions definition
  set position = ordered.next_position
  from ordered
  where definition.id = ordered.id;
end;
$$;

-- p_position is the zero-based position amongst active fields, matching the
-- visible form canvas. Retired fields stay stored for historical ticket values
-- but no longer shift drag-and-drop or keyboard moves.
create or replace function public.move_ticket_custom_field_definition(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_definition_id uuid,
  p_section_id uuid,
  p_position integer,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_definition public.ticket_custom_field_definitions%rowtype;
  v_source_section_id uuid;
  v_target_active_count integer;
  v_target_position integer;
  v_position integer;
  v_inserted boolean := false;
  v_row record;
  v_version bigint;
begin
  perform public.assert_user_has_tenant_permission(
    p_actor_id,
    p_tenant_id,
    'tenant.settings.manage'
  );
  if p_position < 0 then
    raise exception 'invalid_custom_field_position' using errcode = '22023';
  end if;

  perform public.ticket_custom_field_layout_version(
    p_tenant_id,
    p_expected_version
  );

  select * into v_definition
  from public.ticket_custom_field_definitions
  where id = p_definition_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'custom_field_definition_not_found' using errcode = 'P0002';
  end if;
  if not v_definition.active then
    raise exception 'custom_field_definition_inactive' using errcode = '55000';
  end if;
  if not exists (
    select 1
    from public.ticket_custom_field_sections
    where id = p_section_id and tenant_id = p_tenant_id
  ) then
    raise exception 'custom_field_section_not_found' using errcode = 'P0002';
  end if;

  v_source_section_id := v_definition.section_id;
  select count(*)::integer into v_target_active_count
  from public.ticket_custom_field_definitions
  where tenant_id = p_tenant_id
    and section_id = p_section_id
    and active
    and id <> p_definition_id;
  v_target_position := least(p_position, v_target_active_count);

  set constraints ticket_custom_field_definitions_section_position_unique deferred;

  -- Temporarily place the moved definition outside its source ordering. The
  -- layout-version lock above serializes all regular builder commands.
  update public.ticket_custom_field_definitions
  set section_id = p_section_id,
      position = 2147483000
  where id = v_definition.id and tenant_id = p_tenant_id;

  if v_source_section_id <> p_section_id then
    v_position := 0;
    for v_row in
      select id
      from public.ticket_custom_field_definitions
      where tenant_id = p_tenant_id and section_id = v_source_section_id
      order by active desc, position, id
    loop
      update public.ticket_custom_field_definitions
      set position = v_position
      where id = v_row.id;
      v_position := v_position + 1;
    end loop;
  end if;

  v_position := 0;
  for v_row in
    select id
    from public.ticket_custom_field_definitions
    where tenant_id = p_tenant_id
      and section_id = p_section_id
      and active
      and id <> p_definition_id
    order by position, id
  loop
    if not v_inserted and v_position = v_target_position then
      update public.ticket_custom_field_definitions
      set position = v_position
      where id = v_definition.id;
      v_position := v_position + 1;
      v_inserted := true;
    end if;

    update public.ticket_custom_field_definitions
    set position = v_position
    where id = v_row.id;
    v_position := v_position + 1;
  end loop;

  if not v_inserted then
    update public.ticket_custom_field_definitions
    set position = v_position
    where id = v_definition.id;
    v_position := v_position + 1;
  end if;

  for v_row in
    select id
    from public.ticket_custom_field_definitions
    where tenant_id = p_tenant_id
      and section_id = p_section_id
      and not active
    order by position, id
  loop
    update public.ticket_custom_field_definitions
    set position = v_position
    where id = v_row.id;
    v_position := v_position + 1;
  end loop;

  perform public.normalize_ticket_custom_field_positions(
    p_tenant_id,
    p_section_id
  );
  if v_source_section_id <> p_section_id then
    perform public.normalize_ticket_custom_field_positions(
      p_tenant_id,
      v_source_section_id
    );
  end if;

  v_version := public.bump_ticket_custom_field_layout_version(p_tenant_id);
  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_tenant_id,
    p_actor_id,
    'ticket.custom_field.layout.reordered',
    'ticket_custom_field_definition',
    v_definition.id,
    jsonb_build_object(
      'sectionId', p_section_id,
      'position', v_target_position,
      'layoutVersion', v_version
    )
  );
  return v_version;
end;
$$;

-- Every change that can alter the visible canvas participates in the same
-- optimistic layout version. Legacy unversioned signatures are retained only
-- as database objects for dependency-safe rollout and lose all service access.
create or replace function public.upsert_ticket_custom_field_definition(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_definition_id uuid,
  p_field_key text,
  p_label text,
  p_field_type text,
  p_required boolean,
  p_options jsonb,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_definition public.ticket_custom_field_definitions%rowtype;
  v_field_key text := lower(btrim(p_field_key));
  v_label text := btrim(p_label);
  v_field_type text := lower(btrim(p_field_type));
  v_options jsonb := coalesce(p_options, '[]'::jsonb);
  v_is_new boolean := p_definition_id is null;
  v_was_active boolean;
  v_section_id uuid;
  v_version bigint;
begin
  perform public.assert_user_has_tenant_permission(
    p_actor_id,
    p_tenant_id,
    'tenant.settings.manage'
  );
  if v_field_key !~ '^[a-z][a-z0-9_]{1,62}$'
    or char_length(v_label) not between 2 and 120
    or v_label ~ '[[:cntrl:]]'
    or v_field_type not in ('text', 'number', 'date', 'select', 'checkbox')
    or not public.ticket_custom_field_options_valid(v_field_type, v_options) then
    raise exception 'invalid_custom_field_definition' using errcode = '22023';
  end if;

  perform public.ticket_custom_field_layout_version(
    p_tenant_id,
    p_expected_version
  );

  if p_definition_id is not null then
    select * into v_definition
    from public.ticket_custom_field_definitions
    where id = p_definition_id and tenant_id = p_tenant_id
    for update;
    if not found then
      raise exception 'custom_field_definition_not_found' using errcode = 'P0002';
    end if;
    if v_definition.field_key <> v_field_key
      or v_definition.field_type <> v_field_type then
      raise exception 'custom_field_definition_immutable' using errcode = '22023';
    end if;
    v_was_active := v_definition.active;
    update public.ticket_custom_field_definitions
    set label = v_label,
        required = coalesce(p_required, false),
        options = v_options,
        active = true
    where id = p_definition_id and tenant_id = p_tenant_id
    returning * into v_definition;
    if not v_was_active then
      perform public.normalize_ticket_custom_field_positions(
        p_tenant_id,
        v_definition.section_id
      );
    end if;
  else
    select id into v_section_id
    from public.ticket_custom_field_sections
    where tenant_id = p_tenant_id
    order by position, id
    limit 1;
    if v_section_id is null then
      insert into public.ticket_custom_field_sections (
        tenant_id,
        label,
        position
      ) values (
        p_tenant_id,
        'Allgemein',
        0
      ) returning id into v_section_id;
    end if;
    insert into public.ticket_custom_field_definitions (
      tenant_id,
      field_key,
      label,
      field_type,
      required,
      options,
      section_id,
      position
    ) values (
      p_tenant_id,
      v_field_key,
      v_label,
      v_field_type,
      coalesce(p_required, false),
      v_options,
      v_section_id,
      coalesce((
        select max(position) + 1
        from public.ticket_custom_field_definitions
        where tenant_id = p_tenant_id and section_id = v_section_id
      ), 0)
    ) returning * into v_definition;
    perform public.normalize_ticket_custom_field_positions(
      p_tenant_id,
      v_section_id
    );
  end if;

  v_version := public.bump_ticket_custom_field_layout_version(p_tenant_id);
  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_tenant_id,
    p_actor_id,
    case
      when v_is_new then 'ticket.custom_field_definition.created'
      else 'ticket.custom_field_definition.updated'
    end,
    'ticket_custom_field_definition',
    v_definition.id,
    jsonb_build_object(
      'fieldKey', v_definition.field_key,
      'fieldType', v_definition.field_type,
      'layoutVersion', v_version
    )
  );
  return jsonb_build_object(
    'id', v_definition.id,
    'fieldKey', v_definition.field_key,
    'label', v_definition.label,
    'fieldType', v_definition.field_type,
    'required', v_definition.required,
    'active', v_definition.active,
    'options', v_definition.options,
    'layoutVersion', v_version
  );
end;
$$;

create or replace function public.retire_ticket_custom_field_definition(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_definition_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_definition public.ticket_custom_field_definitions%rowtype;
  v_version bigint;
begin
  perform public.assert_user_has_tenant_permission(
    p_actor_id,
    p_tenant_id,
    'tenant.settings.manage'
  );
  perform public.ticket_custom_field_layout_version(
    p_tenant_id,
    p_expected_version
  );

  update public.ticket_custom_field_definitions
  set active = false
  where id = p_definition_id
    and tenant_id = p_tenant_id
    and active
  returning * into v_definition;
  if not found then
    if exists (
      select 1
      from public.ticket_custom_field_definitions
      where id = p_definition_id and tenant_id = p_tenant_id
    ) then
      raise exception 'custom_field_definition_inactive' using errcode = '55000';
    end if;
    raise exception 'custom_field_definition_not_found' using errcode = 'P0002';
  end if;

  perform public.normalize_ticket_custom_field_positions(
    p_tenant_id,
    v_definition.section_id
  );
  v_version := public.bump_ticket_custom_field_layout_version(p_tenant_id);
  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_tenant_id,
    p_actor_id,
    'ticket.custom_field_definition.retired',
    'ticket_custom_field_definition',
    v_definition.id,
    jsonb_build_object(
      'fieldKey', v_definition.field_key,
      'fieldType', v_definition.field_type,
      'layoutVersion', v_version
    )
  );
  return jsonb_build_object('id', v_definition.id, 'version', v_version);
end;
$$;

-- Palette creation is deliberately a single database command. If the target
-- section or target position is invalid, both the temporary definition and its
-- audit/version changes roll back with the command.
create or replace function public.create_ticket_custom_field_definition_at_position(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_field_key text,
  p_label text,
  p_field_type text,
  p_required boolean,
  p_options jsonb,
  p_section_id uuid,
  p_position integer,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_definition jsonb;
  v_definition_id uuid;
  v_after_create_version bigint;
  v_version bigint;
begin
  v_definition := public.upsert_ticket_custom_field_definition(
    p_actor_id,
    p_tenant_id,
    null,
    p_field_key,
    p_label,
    p_field_type,
    p_required,
    p_options,
    p_expected_version
  );
  v_definition_id := (v_definition->>'id')::uuid;
  v_after_create_version := (v_definition->>'layoutVersion')::bigint;
  v_version := public.move_ticket_custom_field_definition(
    p_actor_id,
    p_tenant_id,
    v_definition_id,
    p_section_id,
    p_position,
    v_after_create_version
  );
  return v_definition || jsonb_build_object(
    'sectionId',
    p_section_id,
    'position',
    p_position,
    'layoutVersion',
    v_version
  );
end;
$$;

-- Do not leave an executable route that bypasses the layout-version lock.
revoke all on function public.upsert_ticket_custom_field_definition(
  uuid, uuid, uuid, text, text, text, boolean, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.retire_ticket_custom_field_definition(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.upsert_ticket_custom_field_definition(
  uuid, uuid, uuid, text, text, text, boolean, jsonb, bigint
) from public, anon, authenticated;
revoke all on function public.retire_ticket_custom_field_definition(
  uuid, uuid, uuid, bigint
) from public, anon, authenticated;
revoke all on function public.create_ticket_custom_field_definition_at_position(
  uuid, uuid, text, text, text, boolean, jsonb, uuid, integer, bigint
) from public, anon, authenticated;
grant execute on function public.upsert_ticket_custom_field_definition(
  uuid, uuid, uuid, text, text, text, boolean, jsonb, bigint
) to service_role;
grant execute on function public.retire_ticket_custom_field_definition(
  uuid, uuid, uuid, bigint
) to service_role;
grant execute on function public.create_ticket_custom_field_definition_at_position(
  uuid, uuid, text, text, text, boolean, jsonb, uuid, integer, bigint
) to service_role;

-- Repack existing layouts under a tenant-level layout-version lock. The bump
-- invalidates editors that loaded their old active/retired position semantics.
do $$
declare
  v_tenant record;
  v_section record;
begin
  for v_tenant in
    select distinct tenant_id
    from public.ticket_custom_field_sections
    order by tenant_id
  loop
    insert into public.ticket_custom_field_layout_versions (tenant_id)
    values (v_tenant.tenant_id)
    on conflict (tenant_id) do nothing;

    perform 1
    from public.ticket_custom_field_layout_versions
    where tenant_id = v_tenant.tenant_id
    for update;

    for v_section in
      select id
      from public.ticket_custom_field_sections
      where tenant_id = v_tenant.tenant_id
      order by position, id
    loop
      perform public.normalize_ticket_custom_field_positions(
        v_tenant.tenant_id,
        v_section.id
      );
    end loop;
    perform public.bump_ticket_custom_field_layout_version(v_tenant.tenant_id);
  end loop;
end;
$$;

commit;
