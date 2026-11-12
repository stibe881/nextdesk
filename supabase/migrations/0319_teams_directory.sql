begin;

set local search_path = pg_catalog, public;

-- Menü «Teams»: Abbild aller Teams des Microsoft-Mandanten (auch der bereits
-- bestehenden), abgeglichen über Microsoft Graph. Teams mit Laufzeit stehen
-- zusätzlich in teams_requests (source = 'import' für bestehende Teams, denen
-- nachträglich ein Ende gesetzt wurde).
create table public.teams_directory (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  graph_team_id text not null,
  display_name text not null check (char_length(display_name) between 1 and 300),
  description text,
  visibility text check (visibility is null or visibility in ('public', 'private', 'hiddenmembership')),
  is_archived boolean not null default false,
  web_url text,
  owner_ids uuid[] not null default '{}',
  created_in_graph_at timestamptz,
  synced_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, graph_team_id)
);

create index teams_directory_name_idx
  on public.teams_directory (tenant_id, lower(display_name));

alter table public.teams_directory enable row level security;
alter table public.teams_directory force row level security;
revoke all on table public.teams_directory from public, anon, authenticated;
grant select, insert, update, delete on table public.teams_directory to service_role;
create policy teams_directory_service_role_only on public.teams_directory
  for all to service_role using (true) with check (true);

comment on table public.teams_directory is
  'Abbild der Microsoft-Teams-Teams eines Mandanten für das Menü «Teams». Nur Service-Rolle (Edge Function teams-admin).';

alter table public.teams_requests
  add column if not exists source text not null default 'order'
    check (source in ('order', 'import'));

comment on column public.teams_requests.source is
  'order = über den Shop bestellt, import = bestehendes Team, dem im Menü «Teams» ein Ende gesetzt wurde.';

commit;
