begin;

set local search_path = pg_catalog, public;

-- Anlässe: die Bestellung (PDF «Anlassdetails» der Anlässe-App) bleibt beim
-- Anlass erhalten. Der Mail-Eingang legt sie im privaten Bucket
-- «event-space-documents» ab (Pfad <tenant>/<request>.pdf); geöffnet wird sie
-- nur über eine kurz gültige signierte Adresse der Edge Function
-- «event-spaces».
alter table public.event_space_requests
  add column if not exists source_document_path text
    check (source_document_path is null or char_length(source_document_path) <= 300);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-space-documents', 'event-space-documents', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

commit;
