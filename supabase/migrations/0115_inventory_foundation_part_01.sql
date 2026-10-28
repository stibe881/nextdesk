begin;

-- Inventory is an opt-in tenant capability. The existing feature category is
-- deliberately reused; no room, entry or onboarding domain is coupled here.
insert into public.feature_catalog (key, name, description, category, default_enabled)
values (
  'inventory.management',
  'Bestandsverwaltung',
  'Mandantenbezogene Lagerorte, Artikel, Bestandsbewegungen, Reservierungen und Inventuren.',
  'assets',
  false
)
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    default_enabled = excluded.default_enabled;


-- Existing tenants need the disabled default as well; new tenants receive it
-- through initialize_tenant_feature_flags().
insert into public.tenant_feature_flags (tenant_id, feature_key, enabled)
select tenant.id, 'inventory.management', false
from public.tenants as tenant
on conflict (tenant_id, feature_key) do nothing;


insert into public.permissions (code, description, is_sensitive)
values
  ('inventory.read', 'Read inventory workspace data.', false),
  ('inventory.manage', 'Manage inventory locations and item master data.', true),
  ('inventory.move', 'Post inventory receipts, issues, transfers and reservations.', true),
  ('inventory.adjust', 'Post manual inventory adjustments.', true),
  ('inventory.count.close', 'Close inventory counts and post count adjustments.', true)
on conflict (code) do update
set description = excluded.description,
    is_sensitive = excluded.is_sensitive;


-- Only the exact active tenant-system administrator role receives defaults.
-- Other roles must be granted an inventory capability intentionally.
insert into public.role_permissions (role_id, permission_code)
select role.id, permission.code
from public.roles as role
cross join (values
  ('inventory.read'),
  ('inventory.manage'),
  ('inventory.move'),
  ('inventory.adjust'),
  ('inventory.count.close')
) as permission(code)
where role.active
  and role.is_system
  and role.scope = 'tenant'
  and role.name = 'Tenant administrator'
on conflict (role_id, permission_code) do nothing;


create or replace function public.grant_default_inventory_permissions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.active
    and new.is_system
    and new.scope = 'tenant'
    and new.name = 'Tenant administrator' then
    insert into public.role_permissions (role_id, permission_code)
    values
      (new.id, 'inventory.read'),
      (new.id, 'inventory.manage'),
      (new.id, 'inventory.move'),
      (new.id, 'inventory.adjust'),
      (new.id, 'inventory.count.close')
    on conflict (role_id, permission_code) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.grant_default_inventory_permissions() from public, anon, authenticated;

drop trigger if exists roles_grant_default_inventory_permissions on public.roles;

create trigger roles_grant_default_inventory_permissions
  after insert or update of active, is_system, scope, name on public.roles
  for each row execute function public.grant_default_inventory_permissions();


-- All inventory relations include tenant_id and tenant-bound composite foreign
-- keys. This preserves tenant isolation even for service-role writes, where RLS
-- is intentionally bypassed for server-side commands.
create table if not exists public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null check (
    code = lower(btrim(code))
    and code ~ '^[a-z0-9][a-z0-9_-]{0,62}$'
  ),
  name text not null check (
    char_length(btrim(name)) between 1 and 160
    and name = btrim(name)
    and name !~ '[[:cntrl:]]'
  ),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inventory_locations_id_tenant_unique unique (id, tenant_id),
  constraint inventory_locations_tenant_code_unique unique (tenant_id, code)
);


create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  article_number text not null check (
    article_number = lower(btrim(article_number))
    and article_number ~ '^[a-z0-9][a-z0-9._/-]{0,159}$'
  ),
  name text not null check (
    char_length(btrim(name)) between 1 and 240
    and name = btrim(name)
    and name !~ '[[:cntrl:]]'
  ),
  category text not null default 'general' check (
    char_length(btrim(category)) between 1 and 120
    and category = btrim(category)
    and category !~ '[[:cntrl:]]'
  ),
  unit text not null default 'each' check (
    unit = lower(btrim(unit))
    and unit ~ '^[a-z][a-z0-9_-]{0,31}$'
  ),
  tracking_mode text not null default 'quantity'
    check (tracking_mode in ('quantity', 'serial')),
  minimum_quantity numeric(18,3) not null default 0 check (minimum_quantity >= 0),
  target_quantity numeric(18,3) not null default 0 check (target_quantity >= minimum_quantity),
  manufacturer text check (
    manufacturer is null or (
      char_length(btrim(manufacturer)) between 1 and 160
      and manufacturer = btrim(manufacturer)
      and manufacturer !~ '[[:cntrl:]]'
    )
  ),
  model text check (
    model is null or (
      char_length(btrim(model)) between 1 and 160
      and model = btrim(model)
      and model !~ '[[:cntrl:]]'
    )
  ),
  supplier text check (
    supplier is null or (
      char_length(btrim(supplier)) between 1 and 160
      and supplier = btrim(supplier)
      and supplier !~ '[[:cntrl:]]'
    )
  ),
  note text check (
    note is null or (
      char_length(btrim(note)) between 1 and 2000
      and note = btrim(note)
      and note !~ '[[:cntrl:]]'
    )
  ),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inventory_items_id_tenant_unique unique (id, tenant_id),
  constraint inventory_items_tenant_article_number_unique unique (tenant_id, article_number)
);


create table if not exists public.inventory_item_identifiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id uuid not null,
  identifier_type text not null check (identifier_type in ('barcode', 'qr')),
  canonical_value text not null check (
    char_length(canonical_value) between 1 and 200
    and canonical_value = lower(btrim(canonical_value))
    and canonical_value !~ '[[:cntrl:]]'
  ),
  created_at timestamptz not null default timezone('utc', now()),
  constraint inventory_item_identifiers_item_tenant_fk
    foreign key (item_id, tenant_id)
    references public.inventory_items (id, tenant_id) on delete cascade,
  constraint inventory_item_identifiers_tenant_value_unique
    unique (tenant_id, canonical_value),
  constraint inventory_item_identifiers_tenant_item_type_unique
    unique (tenant_id, item_id, identifier_type)
);


create table if not exists public.inventory_serial_units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id uuid not null,
  serial_number text not null check (
    char_length(serial_number) between 1 and 200
    and serial_number = lower(btrim(serial_number))
    and serial_number !~ '[[:cntrl:]]'
  ),
  asset_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inventory_serial_units_id_tenant_unique unique (id, tenant_id),
  constraint inventory_serial_units_item_tenant_fk
    foreign key (item_id, tenant_id)
    references public.inventory_items (id, tenant_id) on delete restrict,
  constraint inventory_serial_units_asset_tenant_fk
    foreign key (asset_id, tenant_id)
    references public.assets (id, tenant_id) on delete set null (asset_id),
  constraint inventory_serial_units_tenant_serial_number_unique
    unique (tenant_id, serial_number)
);

commit;
