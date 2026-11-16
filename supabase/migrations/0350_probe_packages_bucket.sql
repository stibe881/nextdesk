-- Installationspaket der Sonde (tools/ipam-agent) zum Herunterladen in
-- nextDesk. Der Workflow «Publish probe package» baut das Paket bei jeder
-- Änderung am Agenten und legt es zusammen mit latest.json in diesen privaten
-- Bucket. Die Edge Function monitoring-sensors gibt berechtigten Personen
-- einen kurzlebigen signierten Link; es gibt keine Storage-Policies, also
-- keinen direkten Zugriff aus dem Browser.
--
-- Der lokale Schema-Harness enthält keine Supabase-Storage-Schemas.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'probe-packages',
      'probe-packages',
      false,
      104857600,
      array['application/zip', 'application/json']::text[]
    )
    on conflict (id) do update
    set
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;
end;
$$;
