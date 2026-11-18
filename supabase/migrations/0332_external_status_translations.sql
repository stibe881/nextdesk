-- Externe Störungen: deutsche Kurzfassung der Anbietertexte (Titel und
-- Meldung). Die Texte sind öffentlich (Statusseiten der Anbieter) und werden
-- pro Originaltext einmal übersetzt, unabhängig vom Mandanten.
create table if not exists public.external_status_translations (
  source_hash text primary key check (source_hash ~ '^[0-9a-f]{64}$'),
  title_de text not null check (char_length(title_de) between 1 and 300),
  message_de text check (message_de is null or char_length(message_de) <= 4000),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.external_status_translations enable row level security;
revoke all on public.external_status_translations from public, anon, authenticated;
grant select, insert, update on public.external_status_translations to service_role;
