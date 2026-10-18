begin;

create table public.ticket_custom_field_sections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  label text not null collate "C",
  position integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ticket_custom_field_sections_tenant_position_unique unique (tenant_id, position) deferrable initially immediate,
  constraint ticket_custom_field_sections_id_tenant_unique unique (id, tenant_id),
  constraint ticket_custom_field_sections_label_valid check (
    char_length(label) between 2 and 120
    and label = btrim(label)
    and label !~ '[[:cntrl:]]'
  ),
  constraint ticket_custom_field_sections_position_valid check (position >= 0)
);

create index ticket_custom_field_sections_tenant_position_idx
  on public.ticket_custom_field_sections (tenant_id, position);

create trigger ticket_custom_field_sections_updated_at
before update on public.ticket_custom_field_sections
for each row execute function public.set_updated_at();

alter table public.ticket_custom_field_definitions
  add column section_id uuid,
  add column position integer;

insert into public.ticket_custom_field_sections (tenant_id, label, position)
select definition.tenant_id, 'Allgemein', 0
from public.ticket_custom_field_definitions definition
left join public.ticket_custom_field_sections section
  on section.tenant_id = definition.tenant_id
where section.id is null
group by definition.tenant_id;

with ordered_definitions as (
  select
    definition.id,
    section.id as section_id,
    row_number() over (
      partition by definition.tenant_id
      order by definition.active desc, lower(definition.label), definition.id
    ) - 1 as position
  from public.ticket_custom_field_definitions definition
  join public.ticket_custom_field_sections section
    on section.tenant_id = definition.tenant_id
   and section.position = 0
)
update public.ticket_custom_field_definitions definition
set section_id = ordered_definitions.section_id,
    position = ordered_definitions.position
from ordered_definitions
where definition.id = ordered_definitions.id;

alter table public.ticket_custom_field_definitions
  alter column section_id set not null,
  alter column position set not null,
  add constraint ticket_custom_field_definitions_section_tenant_fk
    foreign key (section_id, tenant_id)
    references public.ticket_custom_field_sections (id, tenant_id)
    on delete restrict,
  add constraint ticket_custom_field_definitions_section_position_unique
    unique (tenant_id, section_id, position) deferrable initially immediate,
  add constraint ticket_custom_field_definitions_position_valid check (position >= 0);

create index ticket_custom_field_definitions_layout_idx
  on public.ticket_custom_field_definitions (tenant_id, section_id, position, active);

create table public.ticket_custom_field_layout_versions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  version bigint not null default 1,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ticket_custom_field_layout_versions_positive check (version > 0)
);

insert into public.ticket_custom_field_layout_versions (tenant_id)
select tenant_id from public.ticket_custom_field_sections
on conflict (tenant_id) do nothing;

alter table public.ticket_custom_field_sections enable row level security;
alter table public.ticket_custom_field_layout_versions enable row level security;
revoke all on table public.ticket_custom_field_sections, public.ticket_custom_field_layout_versions from anon, authenticated;

create or replace function public.ticket_custom_field_layout_version(
  p_tenant_id uuid,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_version bigint;
begin
  insert into public.ticket_custom_field_layout_versions (tenant_id)
  values (p_tenant_id)
  on conflict (tenant_id) do nothing;

  select version into v_version
  from public.ticket_custom_field_layout_versions
  where tenant_id = p_tenant_id
  for update;

  if p_expected_version <> v_version then
    raise exception 'layout_version_conflict' using errcode = 'P0001';
  end if;
  return v_version;
end;
$$;

create or replace function public.bump_ticket_custom_field_layout_version(
  p_tenant_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_version bigint;
begin
  update public.ticket_custom_field_layout_versions
  set version = version + 1,
      updated_at = timezone('utc', now())
  where tenant_id = p_tenant_id
  returning version into v_version;
  return v_version;
end;
$$;

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
    select id, row_number() over (order by position, id) - 1 as next_position
    from public.ticket_custom_field_definitions
    where tenant_id = p_tenant_id and section_id = p_section_id
  )
  update public.ticket_custom_field_definitions definition
  set position = ordered.next_position
  from ordered
  where definition.id = ordered.id;
end;
$$;

create or replace function public.list_ticket_custom_field_layout(
  p_actor_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.assert_user_has_tenant_permission(
    p_actor_id,
    p_tenant_id,
    'tenant.settings.manage'
  );

  return jsonb_build_object(
    'version', coalesce((
      select version from public.ticket_custom_field_layout_versions
      where tenant_id = p_tenant_id
    ), 1),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', section.id,
        'label', section.label,
        'position', section.position
      ) order by section.position, section.id)
      from public.ticket_custom_field_sections section
      where section.tenant_id = p_tenant_id
    ), '[]'::jsonb),
    'definitions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', definition.id,
        'fieldKey', definition.field_key,
        'label', definition.label,
        'fieldType', definition.field_type,
        'required', definition.required,
        'active', definition.active,
        'options', definition.options,
        'sectionId', definition.section_id,
        'position', definition.position
      ) order by section.position, definition.position, definition.id)
      from public.ticket_custom_field_definitions definition
      join public.ticket_custom_field_sections section
        on section.id = definition.section_id
       and section.tenant_id = definition.tenant_id
      where definition.tenant_id = p_tenant_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.save_ticket_custom_field_section(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_section_id uuid,
  p_label text,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_section public.ticket_custom_field_sections%rowtype;
  v_label text := btrim(p_label);
  v_version bigint;
  v_new boolean := p_section_id is null;
begin
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'tenant.settings.manage');
  if char_length(v_label) not between 2 and 120 or v_label ~ '[[:cntrl:]]' then
    raise exception 'invalid_custom_field_section' using errcode = '22023';
  end if;
  perform public.ticket_custom_field_layout_version(p_tenant_id, p_expected_version);

  if p_section_id is null then
    insert into public.ticket_custom_field_sections (tenant_id, label, position)
    values (
      p_tenant_id,
      v_label,
      coalesce((select max(position) + 1 from public.ticket_custom_field_sections where tenant_id = p_tenant_id), 0)
    ) returning * into v_section;
  else
    update public.ticket_custom_field_sections
    set label = v_label
    where id = p_section_id and tenant_id = p_tenant_id
    returning * into v_section;
    if not found then raise exception 'custom_field_section_not_found' using errcode = 'P0002'; end if;
  end if;

  v_version := public.bump_ticket_custom_field_layout_version(p_tenant_id);
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_tenant_id, p_actor_id,
    case when v_new then 'ticket.custom_field.section.created' else 'ticket.custom_field.section.updated' end,
    'ticket_custom_field_section', v_section.id,
    jsonb_build_object('position', v_section.position, 'layoutVersion', v_version)
  );
  return jsonb_build_object('id', v_section.id, 'label', v_section.label, 'position', v_section.position, 'version', v_version);
end;
$$;

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
  v_target_position integer;
  v_version bigint;
begin
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'tenant.settings.manage');
  if p_position < 0 then raise exception 'invalid_custom_field_position' using errcode = '22023'; end if;
  perform public.ticket_custom_field_layout_version(p_tenant_id, p_expected_version);
  select * into v_definition from public.ticket_custom_field_definitions
  where id = p_definition_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'custom_field_definition_not_found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.ticket_custom_field_sections where id = p_section_id and tenant_id = p_tenant_id) then
    raise exception 'custom_field_section_not_found' using errcode = 'P0002';
  end if;
  v_target_position := least(p_position, coalesce((select count(*) - 1 from public.ticket_custom_field_definitions where tenant_id = p_tenant_id and section_id = p_section_id and id <> p_definition_id), 0));
  set constraints ticket_custom_field_definitions_section_position_unique deferred;
  update public.ticket_custom_field_definitions
  set section_id = p_section_id,
      position = 100000 + position
  where id = v_definition.id and tenant_id = p_tenant_id;
  perform public.normalize_ticket_custom_field_positions(p_tenant_id, v_definition.section_id);
  update public.ticket_custom_field_definitions
  set position = 100000 + position + case when position >= 0 then 1 else 0 end
  where tenant_id = p_tenant_id and section_id = p_section_id and id <> p_definition_id;
  update public.ticket_custom_field_definitions
  set section_id = p_section_id, position = v_target_position
  where id = v_definition.id and tenant_id = p_tenant_id;
  perform public.normalize_ticket_custom_field_positions(p_tenant_id, p_section_id);
  v_version := public.bump_ticket_custom_field_layout_version(p_tenant_id);
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant_id, p_actor_id, 'ticket.custom_field.layout.reordered', 'ticket_custom_field_definition', p_definition_id, jsonb_build_object('sectionId', p_section_id, 'position', v_target_position, 'layoutVersion', v_version));
  return v_version;
end;
$$;

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
    select jsonb_agg(jsonb_build_object(
      'id', definition.id,
      'fieldKey', definition.field_key,
      'label', definition.label,
      'fieldType', definition.field_type,
      'required', definition.required,
      'active', definition.active,
      'options', definition.options
    ) order by section.position, definition.position, definition.id)
    from public.ticket_custom_field_definitions definition
    join public.ticket_custom_field_sections section
      on section.id = definition.section_id and section.tenant_id = definition.tenant_id
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
  v_section_id uuid;
begin
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'tenant.settings.manage');
  if v_field_key !~ '^[a-z][a-z0-9_]{1,62}$' or char_length(v_label) not between 2 and 120 or v_label ~ '[[:cntrl:]]' or v_field_type not in ('text', 'number', 'date', 'select', 'checkbox') or not public.ticket_custom_field_options_valid(v_field_type, v_options) then
    raise exception 'invalid_custom_field_definition' using errcode = '22023';
  end if;
  if p_definition_id is not null then
    select * into v_definition from public.ticket_custom_field_definitions where id = p_definition_id and tenant_id = p_tenant_id for update;
    if not found then raise exception 'custom_field_definition_not_found' using errcode = 'P0002'; end if;
    if v_definition.field_key <> v_field_key or v_definition.field_type <> v_field_type then raise exception 'custom_field_definition_immutable' using errcode = '22023'; end if;
    update public.ticket_custom_field_definitions set label = v_label, required = coalesce(p_required, false), options = v_options, active = true where id = p_definition_id and tenant_id = p_tenant_id returning * into v_definition;
  else
    select id into v_section_id from public.ticket_custom_field_sections where tenant_id = p_tenant_id order by position, id limit 1;
    if v_section_id is null then
      insert into public.ticket_custom_field_sections (tenant_id, label, position) values (p_tenant_id, 'Allgemein', 0) returning id into v_section_id;
      insert into public.ticket_custom_field_layout_versions (tenant_id) values (p_tenant_id) on conflict (tenant_id) do nothing;
    end if;
    insert into public.ticket_custom_field_definitions (tenant_id, field_key, label, field_type, required, options, section_id, position)
    values (p_tenant_id, v_field_key, v_label, v_field_type, coalesce(p_required, false), v_options, v_section_id, coalesce((select max(position) + 1 from public.ticket_custom_field_definitions where tenant_id = p_tenant_id and section_id = v_section_id), 0))
    returning * into v_definition;
  end if;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_tenant_id, p_actor_id, case when v_is_new then 'ticket.custom_field_definition.created' else 'ticket.custom_field_definition.updated' end, 'ticket_custom_field_definition', v_definition.id, jsonb_build_object('fieldKey', v_definition.field_key, 'fieldType', v_definition.field_type));
  return jsonb_build_object('id', v_definition.id, 'fieldKey', v_definition.field_key, 'label', v_definition.label, 'fieldType', v_definition.field_type, 'required', v_definition.required, 'active', v_definition.active, 'options', v_definition.options);
end;
$$;

revoke all on function public.ticket_custom_field_layout_version(uuid, bigint) from public, anon, authenticated;
revoke all on function public.bump_ticket_custom_field_layout_version(uuid) from public, anon, authenticated;
revoke all on function public.normalize_ticket_custom_field_positions(uuid, uuid) from public, anon, authenticated;
revoke all on function public.list_ticket_custom_field_layout(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_ticket_custom_field_section(uuid, uuid, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.move_ticket_custom_field_definition(uuid, uuid, uuid, uuid, integer, bigint) from public, anon, authenticated;
revoke all on function public.list_ticket_custom_field_definitions(uuid, uuid) from public, anon, authenticated;
revoke all on function public.upsert_ticket_custom_field_definition(uuid, uuid, uuid, text, text, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.list_ticket_custom_field_layout(uuid, uuid) to service_role;
grant execute on function public.save_ticket_custom_field_section(uuid, uuid, uuid, text, bigint) to service_role;
grant execute on function public.move_ticket_custom_field_definition(uuid, uuid, uuid, uuid, integer, bigint) to service_role;
grant execute on function public.list_ticket_custom_field_definitions(uuid, uuid) to service_role;
grant execute on function public.upsert_ticket_custom_field_definition(uuid, uuid, uuid, text, text, text, boolean, jsonb) to service_role;

comment on table public.ticket_custom_field_sections is
  'Tenant-scoped visual sections for the ticket custom-field form builder.';
comment on table public.ticket_custom_field_layout_versions is
  'Optimistic concurrency version for each tenant custom-field layout.';

commit;
