begin;

-- Private Ablage für Bilder und PDFs zu Verträgen und Lizenzen. Der Zugriff
-- läuft ausschliesslich über die Edge Function "record-attachments".
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
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
        id, name, public, file_size_limit, allowed_mime_types
      )
      values (
        'record-attachments',
        'record-attachments',
        false,
        26214400,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']::text[]
      )
      on conflict (id) do update
      set name = excluded.name,
          public = excluded.public,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types
    $storage_bucket$;
  end if;
end;
$$;

create table public.record_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contract_id uuid,
  license_id uuid,
  storage_object_path text not null unique check (
    char_length(storage_object_path) between 40 and 300
  ),
  original_filename text not null check (
    char_length(btrim(original_filename)) between 1 and 240
    and original_filename !~ '[[:cntrl:]]'
  ),
  content_type text not null check (
    content_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')
  ),
  byte_size bigint not null check (byte_size between 1 and 26214400),
  uploaded_by uuid not null references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  constraint record_attachments_one_parent check (
    (contract_id is not null and license_id is null)
    or (contract_id is null and license_id is not null)
  ),
  constraint record_attachments_contract_fk
    foreign key (contract_id, tenant_id)
    references public.contracts (id, tenant_id) on delete cascade,
  constraint record_attachments_license_fk
    foreign key (license_id, tenant_id)
    references public.licenses (id, tenant_id) on delete cascade
);

create index record_attachments_contract_idx
  on public.record_attachments (tenant_id, contract_id) where contract_id is not null;
create index record_attachments_license_idx
  on public.record_attachments (tenant_id, license_id) where license_id is not null;

alter table public.record_attachments enable row level security;
revoke all on table public.record_attachments from public, anon, authenticated, service_role;
grant select, insert, delete on table public.record_attachments to service_role;

comment on table public.record_attachments is
  'Metadata for images and PDFs attached to contracts and licenses. Files live in the private record-attachments bucket; access only through the record-attachments Edge Function.';

commit;
