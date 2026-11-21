begin;

set local search_path = pg_catalog, public;

-- Eintritte: die Eintrittsmeldung (PDF) bleibt beim Eintritt erhalten. Die
-- Erkennung im Mail-Eingang legt sie im privaten Bucket «onboarding-documents»
-- ab (Pfad <tenant>/<entry>.pdf); geöffnet wird sie nur über eine kurz gültige
-- signierte Adresse der Edge Function «onboarding».
alter table public.onboarding_entries
  add column if not exists source_document_path text
    check (source_document_path is null or char_length(source_document_path) <= 300);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('onboarding-documents', 'onboarding-documents', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

commit;
