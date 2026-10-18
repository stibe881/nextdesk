begin;

set local search_path = pg_catalog, public;

-- Die Abteilungsansicht ist absichtlich standardmässig deaktiviert. Bestehende
-- Mandantenentscheidungen bleiben unverändert; fehlende Flags werden mit false ergänzt.
insert into public.feature_catalog (key, name, description, category, default_enabled)
values (
  'requester.department-view',
  'Abteilungsansicht für Anfragende',
  'Anfragende sehen Titel/Status/Nummer der Tickets ihrer eigenen Abteilung, keine Inhalte.',
  'portal',
  false
)
on conflict (key) do nothing;

insert into public.tenant_feature_flags (tenant_id, feature_key, enabled)
select tenant.id, catalog.key, catalog.default_enabled
from public.tenants tenant
join public.feature_catalog catalog
  on catalog.key = 'requester.department-view'
on conflict (tenant_id, feature_key) do nothing;

-- Die Outbox speichert nur einen kleinen, strukturierten Ereignisumschlag. Diese
-- Migration erzeugt bewusst keine Ereignisse, Trigger oder Auslieferung.
create table public.outbound_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_type text not null check (char_length(btrim(event_type)) between 1 and 160),
  entity_type text not null check (char_length(btrim(entity_type)) between 1 and 80),
  entity_id uuid not null,
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object')
    check (octet_length(payload::text) <= 4096),
  status text not null default 'pending' check (status in ('pending', 'skipped')),
  created_at timestamptz not null default timezone('utc', now())
);
create index outbound_events_tenant_status_created_idx
  on public.outbound_events (tenant_id, status, created_at);

alter table public.outbound_events enable row level security;
alter table public.outbound_events force row level security;

revoke all on table public.outbound_events from public, anon, authenticated;
grant select, insert, update, delete on table public.outbound_events to service_role;

create policy outbound_events_service_role_only on public.outbound_events
  for all to service_role
  using (true)
  with check (true);

-- Erreichbarkeit ist eine private Textpräferenz im vorhandenen JSON-Objekt.
-- Die Begrenzung gilt auch für direkte, bereits autorisierte Präferenzschreibwege.
alter table public.workspace_preferences
  add constraint workspace_preferences_availability_valid
  check (
    not (preferences ? 'availability')
    or (
      jsonb_typeof(preferences -> 'availability') = 'string'
      and char_length(btrim(preferences ->> 'availability')) between 1 and 300
    )
  );

comment on table public.outbound_events is
  'Ruhende, mandantenbezogene Outbox-Grundlage ohne Trigger, Auslieferung oder externe Provider.';
comment on column public.workspace_preferences.preferences is
  'Mandantenbezogene persönliche Einstellungen; availability ist optionaler Text mit höchstens 300 Zeichen.';

commit;
