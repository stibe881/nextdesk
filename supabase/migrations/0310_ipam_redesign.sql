begin;
set local search_path = pg_catalog, public;

-- IPAM-Redesign: Notizen und Zonen, Standort-Vorlagen, Standort-Layout
-- (VLAN-Basis, Supernetz, Asset-Standort) und ein Änderungsprotokoll mit
-- Herkunft und Rücknahme.
--
-- Änderungsprotokoll: Trigger auf ipam_prefixes, ipam_vlans, ipam_sites,
-- ipam_addresses und ipam_site_templates. Wer schreibt, setzt auf der Zeile
-- change_actor/change_source (oder transaktionslokal die Einstellungen
-- ipam.change_actor/ipam.change_source, z. B. für Löschungen über
-- ipam_delete_logged). Der Trigger liest beides, protokolliert und setzt die
-- Spalten wieder auf null, damit ein späterer Schreiber ohne Angabe nichts
-- erbt. Felder ohne Aussagewert (updated_at, change_*, prefix_id, last_seen_*
-- bei Adressen) zählen nicht als Änderung; reine «gesehen»-Updates der
-- Discovery werden nicht protokolliert.
--
-- Alles nur für service_role (Edge Function ipam prüft ipam.read/ipam.manage).

-- --------------------------------------------------------------- Spalten

alter table public.ipam_prefixes
  add column if not exists notes text,
  add column if not exists change_actor uuid,
  add column if not exists change_source text;

alter table public.ipam_vlans
  add column if not exists notes text,
  add column if not exists zone text,
  add column if not exists status text not null default 'active',
  add column if not exists change_actor uuid,
  add column if not exists change_source text;

alter table public.ipam_sites
  add column if not exists asset_location_id uuid,
  add column if not exists vlan_base integer,
  add column if not exists supernet_prefix_id uuid,
  add column if not exists template_id uuid,
  add column if not exists change_actor uuid,
  add column if not exists change_source text;

alter table public.ipam_addresses
  add column if not exists change_actor uuid,
  add column if not exists change_source text;

create table if not exists public.ipam_site_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 1000),
  -- Länge des Standort-Supernetzes (IPv4), z. B. 19.
  prefix_length smallint not null check (prefix_length between 8 and 30),
  -- [{ function, description, vlanOffset, offset24, length, zone, dhcp }]
  entries jsonb not null default '[]'::jsonb check (jsonb_typeof(entries) = 'array'),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  change_actor uuid,
  change_source text,
  unique (tenant_id, id),
  unique (tenant_id, name)
);

create table if not exists public.ipam_change_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  at timestamptz not null default timezone('utc', now()),
  actor_id uuid references public.user_profiles(id) on delete set null,
  source text not null check (source in (
    'user', 'cleanup', 'planner', 'template', 'discovery', 'intune', 'prtg', 'import', 'api', 'system'
  )),
  object_type text not null check (object_type in ('prefix', 'vlan', 'site', 'address', 'template')),
  object_id uuid not null,
  object_label text not null default '' check (char_length(object_label) <= 300),
  action text not null check (action in ('create', 'update', 'delete')),
  -- Abteilung des Objekts (Adressen: die ihres Subnetzes) für die Sichtbarkeit.
  department_id uuid,
  -- Namen der geänderten Spalten (update) bzw. leer (create/delete).
  changes jsonb not null default '[]'::jsonb check (jsonb_typeof(changes) = 'array'),
  -- update: nur die geänderten Spalten; create: after = ganze Zeile;
  -- delete: before = ganze Zeile.
  before jsonb,
  after jsonb
);
create index if not exists ipam_change_log_recent on public.ipam_change_log (tenant_id, at desc);
create index if not exists ipam_change_log_object on public.ipam_change_log (tenant_id, object_type, object_id);
create index if not exists ipam_change_log_tenant_id on public.ipam_change_log (tenant_id, id desc);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ipam_prefixes_notes_length') then
    alter table public.ipam_prefixes add constraint ipam_prefixes_notes_length
      check (notes is null or char_length(notes) <= 4000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ipam_vlans_notes_length') then
    alter table public.ipam_vlans add constraint ipam_vlans_notes_length
      check (notes is null or char_length(notes) <= 4000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ipam_vlans_zone_length') then
    alter table public.ipam_vlans add constraint ipam_vlans_zone_length
      check (zone is null or char_length(zone) <= 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ipam_vlans_status_valid') then
    alter table public.ipam_vlans add constraint ipam_vlans_status_valid
      check (status in ('active', 'deprecated'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ipam_sites_vlan_base_range') then
    alter table public.ipam_sites add constraint ipam_sites_vlan_base_range
      check (vlan_base is null or vlan_base between 1 and 4094);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ipam_sites_asset_location_fk') then
    alter table public.ipam_sites add constraint ipam_sites_asset_location_fk
      foreign key (asset_location_id, tenant_id) references public.asset_locations(id, tenant_id)
      on delete set null (asset_location_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ipam_sites_supernet_fk') then
    alter table public.ipam_sites add constraint ipam_sites_supernet_fk
      foreign key (supernet_prefix_id, tenant_id) references public.ipam_prefixes(id, tenant_id)
      on delete set null (supernet_prefix_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ipam_sites_template_fk') then
    alter table public.ipam_sites add constraint ipam_sites_template_fk
      foreign key (template_id, tenant_id) references public.ipam_site_templates(id, tenant_id)
      on delete set null (template_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ipam_prefixes_change_source_valid') then
    alter table public.ipam_prefixes add constraint ipam_prefixes_change_source_valid check (change_source is null or change_source in (
      'user', 'cleanup', 'planner', 'template', 'discovery', 'intune', 'prtg', 'import', 'api', 'system'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ipam_vlans_change_source_valid') then
    alter table public.ipam_vlans add constraint ipam_vlans_change_source_valid check (change_source is null or change_source in (
      'user', 'cleanup', 'planner', 'template', 'discovery', 'intune', 'prtg', 'import', 'api', 'system'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ipam_sites_change_source_valid') then
    alter table public.ipam_sites add constraint ipam_sites_change_source_valid check (change_source is null or change_source in (
      'user', 'cleanup', 'planner', 'template', 'discovery', 'intune', 'prtg', 'import', 'api', 'system'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ipam_addresses_change_source_valid') then
    alter table public.ipam_addresses add constraint ipam_addresses_change_source_valid check (change_source is null or change_source in (
      'user', 'cleanup', 'planner', 'template', 'discovery', 'intune', 'prtg', 'import', 'api', 'system'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ipam_site_templates_change_source_valid') then
    alter table public.ipam_site_templates add constraint ipam_site_templates_change_source_valid check (change_source is null or change_source in (
      'user', 'cleanup', 'planner', 'template', 'discovery', 'intune', 'prtg', 'import', 'api', 'system'));
  end if;
end;
$$;

-- Ein Asset-Standort gehört höchstens zu einem IPAM-Standort.
create unique index if not exists ipam_sites_asset_location_unique
  on public.ipam_sites (tenant_id, asset_location_id) where asset_location_id is not null;
create index if not exists ipam_vlans_site on public.ipam_vlans (tenant_id, site_id);
create index if not exists ipam_prefixes_site on public.ipam_prefixes (tenant_id, site_id);

alter table public.ipam_site_templates enable row level security;
alter table public.ipam_change_log enable row level security;
revoke all on table public.ipam_site_templates, public.ipam_change_log from public, anon, authenticated;
grant select, insert, update, delete on table public.ipam_site_templates to service_role;
grant select, insert on table public.ipam_change_log to service_role;
grant delete on table public.ipam_sites, public.ipam_vlans to service_role;

-- --------------------------------------------------------------- Protokoll

create or replace function public.ipam_change_log_capture()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ignore text[] := array['updated_at', 'created_at', 'created_by', 'change_actor', 'change_source'];
  v_object_type text;
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_fields text[] := '{}';
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_key text;
  v_source text;
  v_actor uuid;
  v_department uuid;
  v_label text;
begin
  v_object_type := case tg_table_name
    when 'ipam_prefixes' then 'prefix'
    when 'ipam_vlans' then 'vlan'
    when 'ipam_sites' then 'site'
    when 'ipam_addresses' then 'address'
    else 'template' end;
  if v_object_type = 'address' then
    v_ignore := v_ignore || array['prefix_id', 'last_seen_at', 'last_seen_source'];
  end if;

  -- Herkunft: Angabe auf der Zeile, sonst transaktionslokale Einstellung.
  if tg_op = 'DELETE' then
    v_source := old.change_source;
    v_actor := old.change_actor;
  else
    v_source := new.change_source;
    v_actor := new.change_actor;
  end if;
  if v_source is null then
    v_source := nullif(current_setting('ipam.change_source', true), '');
    v_actor := nullif(current_setting('ipam.change_actor', true), '')::uuid;
  end if;

  if tg_op = 'INSERT' then
    v_new := to_jsonb(new) - v_ignore;
    v_row := v_new;
    v_after := v_new;
    v_before := null;
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old) - v_ignore;
    v_row := v_old;
    v_before := v_old;
    v_after := null;
  else
    v_old := to_jsonb(old) - v_ignore;
    v_new := to_jsonb(new) - v_ignore;
    v_row := v_new;
    for v_key in select jsonb_object_keys(v_new) loop
      if (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_fields := v_fields || v_key;
        v_before := v_before || jsonb_build_object(v_key, v_old -> v_key);
        v_after := v_after || jsonb_build_object(v_key, v_new -> v_key);
      end if;
    end loop;
    if coalesce(array_length(v_fields, 1), 0) = 0 then
      new.change_actor := null;
      new.change_source := null;
      return new;
    end if;
  end if;

  -- Schreiber ohne Angabe (Discovery, Intune-/PRTG-Abgleich, alte Wege).
  if v_source is null then
    v_source := 'system';
    if v_object_type = 'address' and tg_op = 'UPDATE' then
      if new.last_seen_at is distinct from old.last_seen_at then
        v_source := case
          when lower(coalesce(new.last_seen_source, '')) like 'intune%' then 'intune'
          when lower(coalesce(new.last_seen_source, '')) like 'prtg%' then 'prtg'
          else 'discovery' end;
      elsif 'prtg_device_id' = any(v_fields) then
        v_source := 'prtg';
      elsif 'intune_device_id' = any(v_fields)
         or ('custom_fields' = any(v_fields) and new.custom_fields ? 'intune_user')
         or (new.intune_device_id is not null
             and v_fields <@ array['asset_id', 'owner_user_id', 'hostname']) then
        v_source := 'intune';
      end if;
    end if;
  end if;

  if v_actor is not null and not exists (select 1 from public.user_profiles where id = v_actor) then
    v_actor := null;
  end if;

  if v_object_type = 'address' then
    select prefix.department_id into v_department
      from public.ipam_prefixes prefix
     where prefix.id = nullif(case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'prefix_id', '')::uuid;
  elsif v_object_type <> 'template' then
    v_department := nullif(v_row ->> 'department_id', '')::uuid;
  end if;

  v_label := case v_object_type
    when 'prefix' then v_row ->> 'prefix'
    when 'vlan' then concat_ws(' ', 'VLAN ' || (v_row ->> 'vlan_number'), v_row ->> 'name')
    when 'address' then concat_ws(' · ', host((v_row ->> 'address')::inet), nullif(v_row ->> 'hostname', ''))
    else v_row ->> 'name' end;

  insert into public.ipam_change_log (
    tenant_id, actor_id, source, object_type, object_id, object_label, action,
    department_id, changes, before, after
  ) values (
    (v_row ->> 'tenant_id')::uuid, v_actor, v_source, v_object_type, (v_row ->> 'id')::uuid,
    left(coalesce(v_label, ''), 300),
    case tg_op when 'INSERT' then 'create' when 'DELETE' then 'delete' else 'update' end,
    v_department, to_jsonb(v_fields), v_before, v_after
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  new.change_actor := null;
  new.change_source := null;
  return new;
end;
$$;

-- «zz»: nach den übrigen BEFORE-Triggern (z. B. Prefix-Zuordnung der Adresse).
create or replace trigger ipam_zz_change_log
  before insert or update or delete on public.ipam_prefixes
  for each row execute function public.ipam_change_log_capture();
create or replace trigger ipam_zz_change_log
  before insert or update or delete on public.ipam_vlans
  for each row execute function public.ipam_change_log_capture();
create or replace trigger ipam_zz_change_log
  before insert or update or delete on public.ipam_sites
  for each row execute function public.ipam_change_log_capture();
create or replace trigger ipam_zz_change_log
  before insert or update or delete on public.ipam_addresses
  for each row execute function public.ipam_change_log_capture();
create or replace trigger ipam_zz_change_log
  before insert or update or delete on public.ipam_site_templates
  for each row execute function public.ipam_change_log_capture();

-- Aufbewahrung: alte Einträge entfernen (nicht eingeplant; bei Bedarf manuell
-- oder per Cron aufrufen).
create or replace function public.ipam_change_log_prune(p_keep interval default interval '2 years')
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_rows integer;
begin
  delete from public.ipam_change_log where at < timezone('utc', now()) - p_keep;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- Seite des Protokolls mit «ist der neueste Eintrag des Objekts» (für die
-- Rücknahme). p_departments null = keine Abteilungsbeschränkung.
create or replace function public.ipam_change_log_page(
  p_tenant_id uuid,
  p_departments uuid[],
  p_object_type text default null,
  p_object_id uuid default null,
  p_source text default null,
  p_since timestamptz default null,
  p_before bigint default null,
  p_limit integer default 50
)
returns table (
  id bigint,
  at timestamptz,
  actor_id uuid,
  source text,
  object_type text,
  object_id uuid,
  object_label text,
  action text,
  changes jsonb,
  before jsonb,
  after jsonb,
  is_latest boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select entry.id, entry.at, entry.actor_id, entry.source, entry.object_type, entry.object_id,
         entry.object_label, entry.action, entry.changes, entry.before, entry.after,
         not exists (
           select 1 from public.ipam_change_log later
           where later.tenant_id = entry.tenant_id
             and later.object_type = entry.object_type
             and later.object_id = entry.object_id
             and later.id > entry.id
         )
  from public.ipam_change_log entry
  where entry.tenant_id = p_tenant_id
    and (p_departments is null or entry.department_id is null or entry.department_id = any(p_departments))
    and (p_object_type is null or entry.object_type = p_object_type)
    and (p_object_id is null or entry.object_id = p_object_id)
    and (p_source is null or entry.source = p_source)
    and (p_since is null or entry.at >= p_since)
    and (p_before is null or entry.id < p_before)
  order by entry.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 101);
$$;

-- Löschen mit Herkunft (die Einstellungen gelten nur in dieser Transaktion,
-- auch für Folgeänderungen wie «site_id → null» an VLANs und Subnetzen).
create or replace function public.ipam_delete_logged(
  p_tenant_id uuid,
  p_object_type text,
  p_object_id uuid,
  p_actor_id uuid,
  p_source text default 'user'
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_table text;
  v_rows integer;
begin
  v_table := case p_object_type
    when 'vlan' then 'ipam_vlans'
    when 'site' then 'ipam_sites'
    when 'template' then 'ipam_site_templates'
    when 'address' then 'ipam_addresses'
    else null end;
  if v_table is null then
    raise exception 'Unsupported object type' using errcode = '22023';
  end if;
  perform set_config('ipam.change_source', coalesce(p_source, 'user'), true);
  perform set_config('ipam.change_actor', coalesce(p_actor_id::text, ''), true);
  execute format('delete from public.%I where id = $1 and tenant_id = $2', v_table)
    using p_object_id, p_tenant_id;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- Rücknahme einer Änderung (nur update, nur solange das Objekt seither
-- unverändert ist). Ergebnis: ok | not_found | not_undoable | changed_since.
create or replace function public.ipam_change_undo(
  p_tenant_id uuid,
  p_entry_id bigint,
  p_actor_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_entry public.ipam_change_log;
  v_table text;
  v_columns text[];
  v_current jsonb;
  v_column text;
  v_assign text;
begin
  select * into v_entry from public.ipam_change_log
   where id = p_entry_id and tenant_id = p_tenant_id;
  if not found then
    return 'not_found';
  end if;
  if v_entry.action <> 'update' or v_entry.before is null then
    return 'not_undoable';
  end if;
  if exists (
    select 1 from public.ipam_change_log later
    where later.tenant_id = p_tenant_id
      and later.object_type = v_entry.object_type
      and later.object_id = v_entry.object_id
      and later.id > v_entry.id
  ) then
    return 'changed_since';
  end if;
  v_table := case v_entry.object_type
    when 'prefix' then 'ipam_prefixes'
    when 'vlan' then 'ipam_vlans'
    when 'site' then 'ipam_sites'
    when 'address' then 'ipam_addresses'
    else 'ipam_site_templates' end;

  -- Nur echte, änderbare Spalten der Tabelle.
  select array_agg(attribute.attname order by attribute.attnum) into v_columns
  from pg_attribute attribute
  where attribute.attrelid = ('public.' || v_table)::regclass
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attname <> all (array['id', 'tenant_id', 'created_at', 'created_by', 'updated_at',
                                         'change_actor', 'change_source', 'prefix_id'])
    and v_entry.before ? attribute.attname::text;
  if coalesce(array_length(v_columns, 1), 0) = 0 then
    return 'not_undoable';
  end if;

  execute format('select to_jsonb(row_data) from public.%I row_data where id = $1 and tenant_id = $2 for update', v_table)
    into v_current using v_entry.object_id, p_tenant_id;
  if v_current is null then
    return 'not_undoable';
  end if;
  foreach v_column in array v_columns loop
    if (v_current -> v_column) is distinct from (v_entry.after -> v_column) then
      return 'changed_since';
    end if;
  end loop;

  select string_agg(format('%I = restored.%I', column_name, column_name), ', ')
    into v_assign from unnest(v_columns) column_name;
  v_assign := v_assign || ', updated_at = timezone(''utc'', now()), change_source = ''user'', change_actor = $4';
  execute format(
    'update public.%I target set %s from jsonb_populate_record(null::public.%I, $1) restored where target.id = $2 and target.tenant_id = $3',
    v_table, v_assign, v_table)
  using v_entry.before, v_entry.object_id, p_tenant_id, p_actor_id;
  return 'ok';
end;
$$;

-- --------------------------------------------------------------- Layout

-- Legt Standort (optional), Supernetz (optional), VLANs und Subnetze in
-- einer Transaktion an (Subnetz-Planer, Standort-Vorlagen). Die Edge
-- Function berechnet die Platzierung; hier wird nur atomar geschrieben und
-- erneut auf Überschneidungen geprüft (SQLSTATE P0001, Meldung
-- «ipam_layout_conflict: <cidr>»).
--
-- p_layout: {
--   vrfId, departmentId, siteId,
--   site: { name, code, address, description, vlanBase, templateId,
--           assetLocationId, newAssetLocationName } | null,
--   supernet: { prefix, description } | null,
--   parentPrefix: cidr | null  (Container der neuen Subnetze; sonst das Supernetz),
--   vlans: [{ vlanNumber, name, zone, description }],
--   prefixes: [{ prefix, description, status, securityZone, gateway,
--                dhcpStart, dhcpEnd, vlanNumber, warningPercent }]
-- }
create or replace function public.ipam_apply_layout(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_source text,
  p_layout jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_vrf uuid := nullif(p_layout ->> 'vrfId', '')::uuid;
  v_department uuid := nullif(p_layout ->> 'departmentId', '')::uuid;
  v_site uuid := nullif(p_layout ->> 'siteId', '')::uuid;
  v_site_data jsonb := case when jsonb_typeof(p_layout -> 'site') = 'object' then p_layout -> 'site' end;
  v_location uuid;
  v_supernet uuid;
  v_supernet_cidr cidr;
  v_parent_cidr cidr := nullif(p_layout ->> 'parentPrefix', '')::cidr;
  v_item jsonb;
  v_cidr cidr;
  v_vlan uuid;
  v_vlans jsonb := '{}'::jsonb;
  v_prefix uuid;
  v_prefix_ids uuid[] := '{}';
  v_vlan_ids uuid[] := '{}';
  v_conflict text;
begin
  if p_source not in ('user', 'cleanup', 'planner', 'template', 'import', 'api', 'system') then
    raise exception 'Invalid source' using errcode = '22023';
  end if;
  perform set_config('ipam.change_source', p_source, true);
  perform set_config('ipam.change_actor', coalesce(p_actor_id::text, ''), true);

  if v_site_data is not null then
    v_location := nullif(v_site_data ->> 'assetLocationId', '')::uuid;
    if nullif(btrim(v_site_data ->> 'newAssetLocationName'), '') is not null then
      select id into v_location from public.asset_locations
       where tenant_id = p_tenant_id and name = btrim(v_site_data ->> 'newAssetLocationName');
      if v_location is null then
        insert into public.asset_locations (tenant_id, name)
        values (p_tenant_id, btrim(v_site_data ->> 'newAssetLocationName'))
        returning id into v_location;
      end if;
    end if;
    insert into public.ipam_sites (
      tenant_id, department_id, name, code, address, description, vlan_base, template_id, asset_location_id
    ) values (
      p_tenant_id, v_department, btrim(v_site_data ->> 'name'),
      nullif(btrim(v_site_data ->> 'code'), ''), nullif(btrim(v_site_data ->> 'address'), ''),
      nullif(btrim(v_site_data ->> 'description'), ''),
      nullif(v_site_data ->> 'vlanBase', '')::integer,
      nullif(v_site_data ->> 'templateId', '')::uuid, v_location
    ) returning id into v_site;
  end if;

  if jsonb_typeof(p_layout -> 'supernet') = 'object' then
    v_supernet_cidr := (p_layout -> 'supernet' ->> 'prefix')::cidr;
    select id into v_supernet from public.ipam_prefixes
     where tenant_id = p_tenant_id and vrf_id is not distinct from v_vrf and prefix = v_supernet_cidr;
    if v_supernet is null then
      select string_agg(other.prefix::text, ', ' order by other.prefix) into v_conflict
        from public.ipam_prefixes other
       where other.tenant_id = p_tenant_id
         and other.vrf_id is not distinct from v_vrf
         and other.prefix && v_supernet_cidr
         and not (other.prefix >> v_supernet_cidr);
      if v_conflict is not null then
        raise exception 'ipam_layout_conflict: %', v_conflict using errcode = 'P0001';
      end if;
      insert into public.ipam_prefixes (
        tenant_id, department_id, vrf_id, site_id, prefix, status, description, created_by
      ) values (
        p_tenant_id, v_department, v_vrf, v_site, v_supernet_cidr, 'container',
        nullif(btrim(p_layout -> 'supernet' ->> 'description'), ''), p_actor_id
      ) returning id into v_supernet;
    end if;
    if v_site_data is not null then
      update public.ipam_sites set supernet_prefix_id = v_supernet where id = v_site;
    end if;
    v_parent_cidr := coalesce(v_parent_cidr, v_supernet_cidr);
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_layout -> 'vlans', '[]'::jsonb)) loop
    select id into v_vlan from public.ipam_vlans
     where tenant_id = p_tenant_id and site_id is not distinct from v_site
       and vlan_number = (v_item ->> 'vlanNumber')::integer;
    if v_vlan is null then
      insert into public.ipam_vlans (tenant_id, department_id, site_id, vlan_number, name, zone, description)
      values (p_tenant_id, v_department, v_site, (v_item ->> 'vlanNumber')::integer,
              left(btrim(v_item ->> 'name'), 120), nullif(left(btrim(v_item ->> 'zone'), 60), ''),
              nullif(left(btrim(v_item ->> 'description'), 1000), ''))
      returning id into v_vlan;
      v_vlan_ids := v_vlan_ids || v_vlan;
    end if;
    v_vlans := v_vlans || jsonb_build_object(v_item ->> 'vlanNumber', v_vlan);
    v_vlan := null;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_layout -> 'prefixes', '[]'::jsonb)) loop
    v_cidr := (v_item ->> 'prefix')::cidr;
    select string_agg(other.prefix::text, ', ' order by other.prefix) into v_conflict
      from public.ipam_prefixes other
     where other.tenant_id = p_tenant_id
       and other.vrf_id is not distinct from v_vrf
       and other.prefix && v_cidr
       -- Erlaubt sind nur der Container selbst und Netze, die ihn enthalten.
       and not (case when v_parent_cidr is null then other.prefix >> v_cidr
                     else other.prefix >>= v_parent_cidr and v_parent_cidr >>= v_cidr end);
    if v_conflict is not null then
      raise exception 'ipam_layout_conflict: %', v_conflict using errcode = 'P0001';
    end if;
    v_vlan := null;
    if nullif(v_item ->> 'vlanNumber', '') is not null then
      v_vlan := nullif(v_vlans ->> (v_item ->> 'vlanNumber'), '')::uuid;
      if v_vlan is null then
        select id into v_vlan from public.ipam_vlans
         where tenant_id = p_tenant_id and site_id is not distinct from v_site
           and vlan_number = (v_item ->> 'vlanNumber')::integer;
      end if;
    end if;
    insert into public.ipam_prefixes (
      tenant_id, department_id, vrf_id, site_id, vlan_id, prefix, status, security_zone, gateway,
      dhcp_start, dhcp_end, description, utilization_warning_percent, created_by
    ) values (
      p_tenant_id, v_department, v_vrf, v_site, v_vlan, v_cidr,
      coalesce(nullif(v_item ->> 'status', ''), 'active'),
      nullif(left(btrim(v_item ->> 'securityZone'), 60), ''),
      nullif(v_item ->> 'gateway', '')::inet,
      nullif(v_item ->> 'dhcpStart', '')::inet,
      nullif(v_item ->> 'dhcpEnd', '')::inet,
      nullif(left(btrim(v_item ->> 'description'), 1000), ''),
      coalesce(nullif(v_item ->> 'warningPercent', '')::smallint, 85),
      p_actor_id
    ) returning id into v_prefix;
    v_prefix_ids := v_prefix_ids || v_prefix;
  end loop;

  return jsonb_build_object(
    'siteId', v_site,
    'supernetPrefixId', v_supernet,
    'assetLocationId', v_location,
    'prefixIds', to_jsonb(v_prefix_ids),
    'vlanIds', to_jsonb(v_vlan_ids)
  );
end;
$$;

revoke all on function public.ipam_change_log_capture() from public, anon, authenticated;
revoke all on function public.ipam_change_log_prune(interval) from public, anon, authenticated;
revoke all on function public.ipam_change_log_page(uuid, uuid[], text, uuid, text, timestamptz, bigint, integer)
  from public, anon, authenticated;
revoke all on function public.ipam_delete_logged(uuid, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.ipam_change_undo(uuid, bigint, uuid) from public, anon, authenticated;
revoke all on function public.ipam_apply_layout(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.ipam_change_log_prune(interval) to service_role;
grant execute on function public.ipam_change_log_page(uuid, uuid[], text, uuid, text, timestamptz, bigint, integer)
  to service_role;
grant execute on function public.ipam_delete_logged(uuid, text, uuid, uuid, text) to service_role;
grant execute on function public.ipam_change_undo(uuid, bigint, uuid) to service_role;
grant execute on function public.ipam_apply_layout(uuid, uuid, text, jsonb) to service_role;

commit;
