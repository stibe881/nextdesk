begin;

-- Logos sind für die Darstellung des jeweiligen Portals öffentlich abrufbar,
-- werden aber ausschließlich durch die serverseitig autorisierte
-- Tenant-Admin-Function in einen zufälligen Mandantenpfad geschrieben. Der
-- lokale Schema-Harness enthält keine Supabase-Storage-Schemas; in Supabase
-- selbst ist `storage.buckets` immer vorhanden.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'tenant-branding',
      'tenant-branding',
      true,
      2097152,
      array['image/png', 'image/jpeg', 'image/webp']::text[]
    )
    on conflict (id) do update
    set
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;
end;
$$;

commit;
