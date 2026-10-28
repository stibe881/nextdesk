begin;

-- Lagerartikelbilder bleiben ausschliesslich im privaten Storage. Es werden
-- bewusst keine storage.objects-Policies angelegt: Nur die Inventory Edge
-- Function erzeugt signierte Einzelobjekt-URLs mit bereits geprüfter
-- Mitgliedschaft, Feature-Freigabe und Berechtigung.
do $$
begin
  if exists (
    select 1
    from pg_namespace
    where nspname = 'storage'
  )
  and exists (
    select 1
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'storage'
      and c.relname = 'buckets'
      and c.relkind in ('r', 'p')
  ) then
    execute $storage_bucket$
      insert into storage.buckets (
        id,
        name,
        public,
        file_size_limit,
        allowed_mime_types
      )
      values (
        'inventory-item-images',
        'inventory-item-images',
        false,
        5242880,
        array['image/jpeg', 'image/png', 'image/webp']::text[]
      )
      on conflict (id) do update
      set
        name = excluded.name,
        public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types
    $storage_bucket$;
  end if;
end;
$$;

-- A single row is the primary image for an item. The composite foreign key
-- maintains tenant isolation even for service-role commands.
create table if not exists public.inventory_item_images (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id uuid not null,
  is_primary boolean not null default true check (is_primary),
  storage_bucket text not null default 'inventory-item-images'
    check (storage_bucket = 'inventory-item-images'),
  storage_object_path text not null unique check (
    char_length(storage_object_path) = 110
    and storage_object_path = lower(storage_object_path)
    and array_length(string_to_array(storage_object_path, '/'), 1) = 3
    and split_part(storage_object_path, '/', 1) = tenant_id::text
    and split_part(storage_object_path, '/', 2) = item_id::text
    and split_part(storage_object_path, '/', 3) ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size between 1 and 5242880),
  width integer not null check (width between 1 and 4096),
  height integer not null check (height between 1 and 4096),
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  constraint inventory_item_images_dimensions_check
    check (width::bigint * height::bigint <= 12000000),
  constraint inventory_item_images_item_tenant_fk
    foreign key (item_id, tenant_id)
    references public.inventory_items (id, tenant_id) on delete cascade,
  constraint inventory_item_images_one_primary_per_item
    unique (item_id, tenant_id)
);

-- Upload intents bind a generated object key to one actor and expire no later
-- than 15 minutes after issuance. They contain neither a signed URL nor any
-- browser-readable policy and are deleted on successful completion.
create table if not exists public.inventory_item_image_uploads (
  storage_object_path text primary key check (
    char_length(storage_object_path) = 110
    and storage_object_path = lower(storage_object_path)
    and array_length(string_to_array(storage_object_path, '/'), 1) = 3
    and split_part(storage_object_path, '/', 1) = tenant_id::text
    and split_part(storage_object_path, '/', 2) = item_id::text
    and split_part(storage_object_path, '/', 3) ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id uuid not null,
  created_by uuid not null references public.user_profiles(id) on delete cascade,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size between 1 and 5242880),
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  constraint inventory_item_image_uploads_expiry_check
    check (expires_at >= created_at and expires_at <= created_at + interval '15 minutes'),
  constraint inventory_item_image_uploads_item_tenant_fk
    foreign key (item_id, tenant_id)
    references public.inventory_items (id, tenant_id) on delete cascade
);

create index if not exists inventory_item_image_uploads_expiry_idx
  on public.inventory_item_image_uploads (expires_at);

-- Both relations are service-only. In particular, clients cannot read rows,
-- request storage paths or write storage.objects through browser policies.
alter table public.inventory_item_images enable row level security;
alter table public.inventory_item_image_uploads enable row level security;

revoke all on table public.inventory_item_images, public.inventory_item_image_uploads
  from public, anon, authenticated;
grant select, insert, update, delete on table public.inventory_item_images,
  public.inventory_item_image_uploads to service_role;

comment on table public.inventory_item_images is
  'Service-only metadata for exactly one private primary image per tenant-bound inventory item; permanent Storage URLs are never stored.';
comment on table public.inventory_item_image_uploads is
  'Service-only, actor-bound inventory image upload intents. Each expires no later than 15 minutes after issuance.';

commit;
