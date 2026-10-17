begin;

create or replace function public.user_has_ticket_permission_for(
  p_user_id uuid,
  p_tenant_id uuid,
  p_department_id uuid,
  p_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.tenants tenant
    join public.tenant_memberships membership
      on membership.tenant_id = tenant.id
      and membership.user_id = p_user_id
      and membership.status = 'active'
    join public.department_memberships department_membership
      on department_membership.tenant_id = tenant.id
      and department_membership.user_id = p_user_id
      and department_membership.department_id = p_department_id
      and department_membership.status = 'active'
    join public.user_role_assignments assignment
      on assignment.tenant_id = tenant.id
      and assignment.user_id = p_user_id
      and assignment.starts_at <= timezone('utc', now())
      and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
    join public.roles role
      on role.id = assignment.role_id
      and role.tenant_id = assignment.tenant_id
      and role.active
      and role.scope in ('tenant', 'department')
      and (role.scope = 'tenant' or assignment.department_id = p_department_id)
    join public.role_permissions permission
      on permission.role_id = role.id
      and permission.permission_code = p_permission_code
    where tenant.id = p_tenant_id
      and tenant.status = 'active'
  );
$$;

create or replace function public.ticket_custom_field_options_valid(
  p_field_type text,
  p_options jsonb
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_field_type = 'select' then
      jsonb_typeof(p_options) = 'array'
      and jsonb_array_length(p_options) between 1 and 50
      and not exists (
        select 1
        from jsonb_array_elements(p_options) as option_value
        where jsonb_typeof(option_value) <> 'string'
          or char_length(btrim(option_value #>> '{}')) not between 1 and 100
          or option_value #>> '{}' ~ '[[:cntrl:]]'
      )
      and not exists (
        select lower(btrim(option_value #>> '{}'))
        from jsonb_array_elements(p_options) as option_value
        group by lower(btrim(option_value #>> '{}'))
        having count(*) > 1
      )
    else p_options = '[]'::jsonb
  end;
$$;

create table public.ticket_custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  field_key text not null collate "C",
  label text not null collate "C",
  field_type text not null collate "C",
  required boolean not null default false,
  active boolean not null default true,
  options jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ticket_custom_field_definitions_tenant_key_unique unique (tenant_id, field_key),
  constraint ticket_custom_field_definitions_id_tenant_unique unique (id, tenant_id),
  constraint ticket_custom_field_definitions_key_valid
    check (field_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  constraint ticket_custom_field_definitions_label_valid
    check (
      char_length(label) between 2 and 120
      and label = btrim(label)
      and label !~ '[[:cntrl:]]'
    ),
  constraint ticket_custom_field_definitions_type_valid
    check (field_type in ('text', 'number', 'date', 'select', 'checkbox')),
  constraint ticket_custom_field_definitions_options_valid
    check (public.ticket_custom_field_options_valid(field_type, options))
);

create index ticket_custom_field_definitions_tenant_active_idx
  on public.ticket_custom_field_definitions (tenant_id, active, label);

create trigger ticket_custom_field_definitions_updated_at
before update on public.ticket_custom_field_definitions
for each row execute function public.set_updated_at();

create table public.ticket_custom_field_values (
  ticket_id uuid not null,
  tenant_id uuid not null,
  definition_id uuid not null,
  text_value text collate "C",
  number_value numeric,
  date_value date,
  boolean_value boolean,
  select_value text collate "C",
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (ticket_id, definition_id),
  constraint ticket_custom_field_values_ticket_tenant_fk
    foreign key (ticket_id, tenant_id)
    references public.tickets (id, tenant_id) on delete cascade,
  constraint ticket_custom_field_values_definition_tenant_fk
    foreign key (definition_id, tenant_id)
    references public.ticket_custom_field_definitions (id, tenant_id) on delete restrict,
  constraint ticket_custom_field_values_exactly_one_value
    check (num_nonnulls(text_value, number_value, date_value, boolean_value, select_value) = 1),
  constraint ticket_custom_field_values_text_valid
    check (
      text_value is null or (
        char_length(text_value) between 1 and 2000
        and text_value = btrim(text_value)
        and text_value !~ '[[:cntrl:]]'
      )
    ),
  constraint ticket_custom_field_values_select_valid
    check (
      select_value is null or (
        char_length(select_value) between 1 and 100
        and select_value = btrim(select_value)
        and select_value !~ '[[:cntrl:]]'
      )
    )
);

create index ticket_custom_field_values_ticket_idx
  on public.ticket_custom_field_values (ticket_id, tenant_id);

alter table public.ticket_custom_field_definitions enable row level security;
alter table public.ticket_custom_field_values enable row level security;

revoke all on table public.ticket_custom_field_definitions, public.ticket_custom_field_values from anon, authenticated;

create or replace function public.list_ticket_custom_field_definitions(
  p_actor_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.tenants tenant
    join public.tenant_memberships membership
      on membership.tenant_id = tenant.id
      and membership.user_id = p_actor_id
      and membership.status = 'active'
    where tenant.id = p_tenant_id and tenant.status = 'active'
  ) then
    raise exception 'custom_field_definitions_denied' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', definition.id,
        'fieldKey', definition.field_key,
        'label', definition.label,
        'fieldType', definition.field_type,
        'required', definition.required,
        'active', definition.active,
        'options', definition.options
      ) order by definition.active desc, lower(definition.label), definition.id
    )
    from public.ticket_custom_field_definitions definition
    where definition.tenant_id = p_tenant_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.upsert_ticket_custom_field_definition(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_definition_id uuid,
  p_field_key text,
  p_label text,
  p_field_type text,
  p_required boolean,
  p_options jsonb
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

  if p_definition_id is not null then
    select * into v_definition
    from public.ticket_custom_field_definitions
    where id = p_definition_id and tenant_id = p_tenant_id
    for update;
    if not found then
      raise exception 'custom_field_definition_not_found' using errcode = 'P0002';
    end if;
    if v_definition.field_key <> v_field_key or v_definition.field_type <> v_field_type then
      raise exception 'custom_field_definition_immutable' using errcode = '22023';
    end if;

    update public.ticket_custom_field_definitions
    set label = v_label,
        required = coalesce(p_required, false),
        options = v_options,
        active = true
    where id = p_definition_id and tenant_id = p_tenant_id
    returning * into v_definition;
  else
    insert into public.ticket_custom_field_definitions (
      tenant_id, field_key, label, field_type, required, options
    ) values (
      p_tenant_id, v_field_key, v_label, v_field_type, coalesce(p_required, false), v_options
    ) returning * into v_definition;
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    p_tenant_id,
    p_actor_id,
    case when v_is_new then 'ticket.custom_field_definition.created' else 'ticket.custom_field_definition.updated' end,
    'ticket_custom_field_definition',
    v_definition.id,
    jsonb_build_object('fieldKey', v_definition.field_key, 'fieldType', v_definition.field_type)
  );

  return jsonb_build_object(
    'id', v_definition.id,
    'fieldKey', v_definition.field_key,
    'label', v_definition.label,
    'fieldType', v_definition.field_type,
    'required', v_definition.required,
    'active', v_definition.active,
    'options', v_definition.options
  );
end;
$$;

create or replace function public.retire_ticket_custom_field_definition(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_definition_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_definition public.ticket_custom_field_definitions%rowtype;
begin
  perform public.assert_user_has_tenant_permission(
    p_actor_id,
    p_tenant_id,
    'tenant.settings.manage'
  );

  update public.ticket_custom_field_definitions
  set active = false
  where id = p_definition_id and tenant_id = p_tenant_id
  returning * into v_definition;
  if not found then
    raise exception 'custom_field_definition_not_found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    p_tenant_id,
    p_actor_id,
    'ticket.custom_field_definition.retired',
    'ticket_custom_field_definition',
    v_definition.id,
    jsonb_build_object('fieldKey', v_definition.field_key, 'fieldType', v_definition.field_type)
  );
end;
$$;

create or replace function public.list_ticket_custom_field_values(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_ticket_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ticket public.tickets%rowtype;
begin
  select * into v_ticket
  from public.tickets ticket
  where ticket.id = p_ticket_id and ticket.tenant_id = p_tenant_id;
  if not found then
    raise exception 'ticket_not_found' using errcode = 'P0002';
  end if;

  if not (
    (v_ticket.requester_id = p_actor_id and public.user_has_tenant_permission(p_actor_id, p_tenant_id, 'ticket.read.own'))
    or (v_ticket.affected_user_id = p_actor_id and public.user_has_tenant_permission(p_actor_id, p_tenant_id, 'ticket.read.own'))
    or (v_ticket.assigned_agent_id = p_actor_id and public.user_has_ticket_permission_for(p_actor_id, p_tenant_id, v_ticket.department_id, 'ticket.read.assigned'))
    or public.user_has_ticket_permission_for(p_actor_id, p_tenant_id, v_ticket.department_id, 'ticket.read.department')
  ) then
    raise exception 'ticket_custom_field_read_denied' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'definitionId', value.definition_id,
        'textValue', value.text_value,
        'numberValue', value.number_value,
        'dateValue', value.date_value,
        'booleanValue', value.boolean_value,
        'selectValue', value.select_value
      ) order by definition.label, definition.id
    )
    from public.ticket_custom_field_values value
    join public.ticket_custom_field_definitions definition
      on definition.id = value.definition_id and definition.tenant_id = value.tenant_id
    where value.ticket_id = p_ticket_id and value.tenant_id = p_tenant_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.apply_ticket_custom_field_values(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_values jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ticket public.tickets%rowtype;
  v_entry jsonb;
  v_definition public.ticket_custom_field_definitions%rowtype;
  v_definition_id uuid;
  v_raw_value jsonb;
  v_text text;
  v_number numeric;
  v_date date;
  v_boolean boolean;
  v_select text;
  v_seen uuid[] := array[]::uuid[];
  v_changed integer := 0;
begin
  if jsonb_typeof(p_values) <> 'array' or jsonb_array_length(p_values) > 50 then
    raise exception 'invalid_custom_field_values' using errcode = '22023';
  end if;

  select * into v_ticket
  from public.tickets ticket
  where ticket.id = p_ticket_id and ticket.tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'ticket_not_found' using errcode = 'P0002';
  end if;

  if not public.user_has_ticket_permission_for(
    p_actor_id, p_tenant_id, v_ticket.department_id, 'ticket.update'
  ) then
    raise exception 'ticket_custom_field_update_denied' using errcode = '42501';
  end if;

  for v_entry in select value from jsonb_array_elements(p_values)
  loop
    if jsonb_typeof(v_entry) <> 'object'
      or not (v_entry ? 'definitionId')
      or not (v_entry ? 'value')
      or (select count(*) from jsonb_object_keys(v_entry)) <> 2
      or jsonb_typeof(v_entry->'definitionId') <> 'string' then
      raise exception 'invalid_custom_field_values' using errcode = '22023';
    end if;

    begin
      v_definition_id := (v_entry->>'definitionId')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid_custom_field_values' using errcode = '22023';
    end;
    if v_definition_id = any(v_seen) then
      raise exception 'duplicate_custom_field_value' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_definition_id);

    select * into v_definition
    from public.ticket_custom_field_definitions definition
    where definition.id = v_definition_id
      and definition.tenant_id = p_tenant_id
      and definition.active
    for share;
    if not found then
      raise exception 'invalid_custom_field_definition' using errcode = '22023';
    end if;

    v_raw_value := v_entry->'value';
    if jsonb_typeof(v_raw_value) = 'null' then
      if v_definition.required then
        raise exception 'required_custom_field_missing' using errcode = '22023';
      end if;
      delete from public.ticket_custom_field_values
      where ticket_id = p_ticket_id and tenant_id = p_tenant_id and definition_id = v_definition_id;
      if found then v_changed := v_changed + 1; end if;
      continue;
    end if;

    v_text := null;
    v_number := null;
    v_date := null;
    v_boolean := null;
    v_select := null;

    case v_definition.field_type
      when 'text' then
        if jsonb_typeof(v_raw_value) <> 'string'
          or char_length(btrim(v_raw_value #>> '{}')) not between 1 and 2000
          or v_raw_value #>> '{}' ~ '[[:cntrl:]]' then
          raise exception 'invalid_custom_field_value' using errcode = '22023';
        end if;
        v_text := btrim(v_raw_value #>> '{}');
      when 'number' then
        if jsonb_typeof(v_raw_value) <> 'number' then
          raise exception 'invalid_custom_field_value' using errcode = '22023';
        end if;
        begin
          v_number := (v_raw_value #>> '{}')::numeric;
        exception when numeric_value_out_of_range then
          raise exception 'invalid_custom_field_value' using errcode = '22023';
        end;
      when 'date' then
        if jsonb_typeof(v_raw_value) <> 'string'
          or v_raw_value #>> '{}' !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'invalid_custom_field_value' using errcode = '22023';
        end if;
        begin
          v_date := (v_raw_value #>> '{}')::date;
        exception when datetime_field_overflow then
          raise exception 'invalid_custom_field_value' using errcode = '22023';
        end;
      when 'checkbox' then
        if jsonb_typeof(v_raw_value) <> 'boolean' then
          raise exception 'invalid_custom_field_value' using errcode = '22023';
        end if;
        v_boolean := (v_raw_value #>> '{}')::boolean;
      when 'select' then
        if jsonb_typeof(v_raw_value) <> 'string'
          or char_length(btrim(v_raw_value #>> '{}')) not between 1 and 100
          or v_raw_value #>> '{}' ~ '[[:cntrl:]]' then
          raise exception 'invalid_custom_field_value' using errcode = '22023';
        end if;
        v_select := btrim(v_raw_value #>> '{}');
        if not exists (
          select 1 from jsonb_array_elements_text(v_definition.options) as option_value
          where option_value = v_select
        ) then
          raise exception 'invalid_custom_field_value' using errcode = '22023';
        end if;
    end case;

    insert into public.ticket_custom_field_values (
      ticket_id, tenant_id, definition_id, text_value, number_value, date_value, boolean_value, select_value
    ) values (
      p_ticket_id, p_tenant_id, v_definition_id, v_text, v_number, v_date, v_boolean, v_select
    ) on conflict (ticket_id, definition_id) do update
      set text_value = excluded.text_value,
          number_value = excluded.number_value,
          date_value = excluded.date_value,
          boolean_value = excluded.boolean_value,
          select_value = excluded.select_value,
          updated_at = timezone('utc', now());
    v_changed := v_changed + 1;
  end loop;

  if v_changed > 0 then
    insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
    values (
      p_ticket_id,
      p_actor_id,
      'ticket.custom_fields.updated',
      jsonb_build_object('fieldCount', jsonb_array_length(p_values))
    );
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      p_tenant_id,
      p_actor_id,
      'ticket.custom_fields.updated',
      'ticket',
      p_ticket_id,
      jsonb_build_object('fieldCount', jsonb_array_length(p_values))
    );
  end if;

  return v_changed;
end;
$$;

revoke all on function public.user_has_ticket_permission_for(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.ticket_custom_field_options_valid(text, jsonb) from public, anon, authenticated;
revoke all on function public.list_ticket_custom_field_definitions(uuid, uuid) from public, anon, authenticated;
revoke all on function public.upsert_ticket_custom_field_definition(uuid, uuid, uuid, text, text, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.retire_ticket_custom_field_definition(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.list_ticket_custom_field_values(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.apply_ticket_custom_field_values(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.list_ticket_custom_field_definitions(uuid, uuid) to service_role;
grant execute on function public.upsert_ticket_custom_field_definition(uuid, uuid, uuid, text, text, text, boolean, jsonb) to service_role;
grant execute on function public.retire_ticket_custom_field_definition(uuid, uuid, uuid) to service_role;
grant execute on function public.list_ticket_custom_field_values(uuid, uuid, uuid) to service_role;
grant execute on function public.apply_ticket_custom_field_values(uuid, uuid, uuid, jsonb) to service_role;

comment on table public.ticket_custom_field_definitions is
  'Tenant-scoped user-defined ticket fields. Definitions are retired, never hard-deleted.';
comment on table public.ticket_custom_field_values is
  'Typed, tenant- and ticket-bound values for active custom ticket field definitions.';

commit;
