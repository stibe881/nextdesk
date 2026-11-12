begin;

set local search_path = pg_catalog, public;

-- Hinweise für Anfragende: interne Werbung der ICT in Ticket-Mails, im Portal
-- und in der App. Pflege in Einstellungen → Funktionen; Auslieferung nur, wenn
-- die Funktion «portal.notices» eingeschaltet ist.
insert into public.feature_catalog (key, name, description, category, default_enabled)
values (
  'portal.notices',
  'Hinweise für Anfragende',
  'Die ICT bewirbt eigene Dienste: Hinweisblock in Ticket-Mails sowie Banner und Hinweisleiste im Portal und in der App, mit Zeitplan und Statistik.',
  'integrations',
  false
)
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category;

insert into public.tenant_feature_flags (tenant_id, feature_key, enabled)
select tenant.id, 'portal.notices', false
from public.tenants as tenant
on conflict (tenant_id, feature_key) do nothing;

create table public.requester_notices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  body text not null check (char_length(body) between 1 and 220),
  button_label text not null check (char_length(button_label) between 1 and 30),
  link_kind text not null check (link_kind in ('shop', 'knowledge', 'new_ticket', 'url')),
  link_target text check (link_target is null or char_length(link_target) <= 500),
  symbol text check (symbol is null or char_length(symbol) between 1 and 4),
  color text not null default 'brand' check (color in ('brand', 'info', 'success', 'warning')),
  show_portal_banner boolean not null default false,
  show_portal_bar boolean not null default false,
  show_mail boolean not null default false,
  show_app boolean not null default false,
  dismissible boolean not null default true,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint requester_notices_dates_check check (ends_on >= starts_on),
  constraint requester_notices_link_pair_check check (
    (link_kind in ('shop', 'new_ticket') and link_target is null)
    or (link_kind in ('knowledge', 'url') and link_target is not null)
  )
);

create index requester_notices_tenant_idx
  on public.requester_notices (tenant_id, status, ends_on);

create trigger requester_notices_updated_at
  before update on public.requester_notices
  for each row execute function public.set_updated_at();

create table public.requester_notice_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  frequency_days integer not null default 7 check (frequency_days between 0 and 30),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

-- Welche Mail-Empfänger zuletzt welchen Hinweis erhielten (Häufigkeitsgrenze
-- und Wechsel reihum). Die Adresse wird nur als Hash gespeichert.
create table public.requester_notice_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  notice_id uuid not null references public.requester_notices(id) on delete cascade,
  recipient_key text not null check (char_length(recipient_key) between 16 and 128),
  delivered_at timestamptz not null default timezone('utc', now())
);

create index requester_notice_deliveries_recipient_idx
  on public.requester_notice_deliveries (tenant_id, recipient_key, delivered_at desc);
create index requester_notice_deliveries_notice_idx
  on public.requester_notice_deliveries (notice_id);

create table public.requester_notice_dismissals (
  notice_id uuid not null references public.requester_notices(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  dismissed_at timestamptz not null default timezone('utc', now()),
  primary key (notice_id, user_id)
);

create index requester_notice_dismissals_user_idx
  on public.requester_notice_dismissals (user_id);

-- Zähler pro Hinweis, Tag und Kanal (ohne Personenbezug).
create table public.requester_notice_stats (
  notice_id uuid not null references public.requester_notices(id) on delete cascade,
  day date not null,
  channel text not null check (channel in ('portal', 'app', 'mail')),
  views integer not null default 0,
  clicks integer not null default 0,
  dismissals integer not null default 0,
  primary key (notice_id, day, channel)
);

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'requester_notices', 'requester_notice_settings',
    'requester_notice_deliveries', 'requester_notice_dismissals',
    'requester_notice_stats'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant select, insert, update, delete on table public.%I to service_role', v_table);
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      v_table || '_service_role_only', v_table
    );
  end loop;
end;
$$;

comment on table public.requester_notices is
  'Hinweise der ICT für Anfragende (Mail, Portal, App). Nur Service-Rolle (Edge Function requester-notices).';
comment on table public.requester_notice_deliveries is
  'Ausgelieferte Mail-Hinweise je Empfänger (nur Hash der Adresse) für Häufigkeitsgrenze und Wechsel.';

create or replace function public.requester_notice_count(
  p_notice_id uuid,
  p_channel text,
  p_event text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_channel not in ('portal', 'app', 'mail') or p_event not in ('view', 'click', 'dismiss') then
    return;
  end if;
  insert into public.requester_notice_stats (notice_id, day, channel, views, clicks, dismissals)
  values (
    p_notice_id,
    (timezone('Europe/Zurich', now()))::date,
    p_channel,
    case when p_event = 'view' then 1 else 0 end,
    case when p_event = 'click' then 1 else 0 end,
    case when p_event = 'dismiss' then 1 else 0 end
  )
  on conflict (notice_id, day, channel) do update
  set views = public.requester_notice_stats.views + excluded.views,
      clicks = public.requester_notice_stats.clicks + excluded.clicks,
      dismissals = public.requester_notice_stats.dismissals + excluded.dismissals;
end;
$$;

revoke all on function public.requester_notice_count(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.requester_notice_count(uuid, text, text)
  to service_role;

commit;
