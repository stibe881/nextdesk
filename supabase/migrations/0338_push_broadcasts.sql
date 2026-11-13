set local search_path = pg_catalog, public;

-- Push-Mitteilungen, die Administratoren selbst verfassen und an iPhone und
-- Android senden (Einstellungen → Funktionen → Push-Benachrichtigungen).

-- Android-Geräte (Expo-Push-Token). Die iPhone-Geräte liegen weiter in
-- push_devices; der bestehende Ablauf für Ticket-Mitteilungen bleibt unberührt.
create table public.push_android_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  expo_token text not null unique
    check (expo_token ~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$'),
  device_name text check (device_name is null or char_length(device_name) between 1 and 80),
  app_version text check (app_version is null or char_length(app_version) between 1 and 80),
  enabled boolean not null default true,
  disabled_reason text check (disabled_reason is null or char_length(disabled_reason) between 1 and 200),
  last_registered_at timestamptz not null default timezone('utc', now()),
  last_sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint push_android_devices_membership_fk
    foreign key (tenant_id, user_id)
    references public.tenant_memberships (tenant_id, user_id)
    on delete cascade
);
create index push_android_devices_tenant_user_idx
  on public.push_android_devices (tenant_id, user_id)
  where enabled;

create trigger push_android_devices_updated_at
  before update on public.push_android_devices
  for each row execute function public.set_updated_at();

alter table public.push_android_devices enable row level security;
alter table public.push_android_devices force row level security;
revoke all on table public.push_android_devices from public, anon, authenticated;
grant select, insert, update, delete on table public.push_android_devices to service_role;
create policy push_android_devices_service_role_only on public.push_android_devices
  for all to service_role using (true) with check (true);

-- Verlauf der gesendeten Mitteilungen.
create table public.push_broadcasts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references public.user_profiles(id) on delete set null,
  title text not null check (char_length(title) between 1 and 60),
  body text not null check (char_length(body) between 1 and 200),
  audience_kind text not null check (audience_kind in ('all', 'roles', 'departments')),
  audience_ids uuid[] not null default '{}' check (cardinality(audience_ids) <= 50),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  recipient_count integer not null default 0,
  ios_devices integer not null default 0,
  android_devices integer not null default 0,
  delivered_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz
);
create index push_broadcasts_tenant_idx
  on public.push_broadcasts (tenant_id, created_at desc);

alter table public.push_broadcasts enable row level security;
alter table public.push_broadcasts force row level security;
revoke all on table public.push_broadcasts from public, anon, authenticated;
grant select, insert, update, delete on table public.push_broadcasts to service_role;
create policy push_broadcasts_service_role_only on public.push_broadcasts
  for all to service_role using (true) with check (true);

comment on table public.push_broadcasts is
  'Von Administratoren verfasste Push-Mitteilungen (Verlauf). Zugriff nur über die Edge Function push-broadcast.';
comment on table public.push_android_devices is
  'Android-Geräte mit Expo-Push-Token für Push-Mitteilungen. Zugriff nur über die Edge Functions push-android und push-broadcast.';
