begin;

-- Kurzlebige Zwischenzustände des OAuth-Vermittlers (Edge Function oauth-proxy).
-- Er ergänzt die PKCE-Angaben, die der Supabase-OAuth-Server verlangt, und gibt
-- Programmen wie den Gemini-Connectors einen eigenen, einmal verwendbaren Code.
-- Die Tabelle ist nur für service_role zugänglich; Zeilen verfallen nach
-- wenigen Minuten und werden bei jeder neuen Anmeldung aufgeräumt.
create table if not exists public.oauth_proxy_flows (
  id uuid primary key default gen_random_uuid(),
  state text not null unique check (char_length(state) between 32 and 128),
  client_redirect_uri text not null check (client_redirect_uri ~ '^https://'),
  client_state text check (client_state is null or char_length(client_state) <= 2048),
  verifier text not null check (char_length(verifier) between 43 and 128),
  proxy_code text unique check (proxy_code is null or char_length(proxy_code) between 32 and 128),
  tokens_encrypted text,
  code_expires_at timestamptz,
  used_at timestamptz,
  expires_at timestamptz not null default (timezone('utc', now()) + interval '10 minutes'),
  created_at timestamptz not null default timezone('utc', now()),
  constraint oauth_proxy_flows_code_complete check (
    (proxy_code is null) = (tokens_encrypted is null)
    and (proxy_code is null) = (code_expires_at is null)
  )
);

create index if not exists oauth_proxy_flows_expires_idx
  on public.oauth_proxy_flows (expires_at);

alter table public.oauth_proxy_flows enable row level security;
revoke all on table public.oauth_proxy_flows from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.oauth_proxy_flows to service_role;

comment on table public.oauth_proxy_flows is
  'Short-lived state of the OAuth proxy. Only the oauth-proxy Edge Function (service_role) may access it.';

commit;
