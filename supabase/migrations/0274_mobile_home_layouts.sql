begin;

set local search_path = pg_catalog, public;

-- Home-Seite der App pro Person: Reihenfolge und ausgeblendete Bereiche werden
-- zwischen den Geräten einer Person abgeglichen (iPhone, Android, weitere
-- Geräte). Die Zeile gehört genau einer Person; nur sie kann sie lesen und
-- ändern. Mit dem Konto wird sie gelöscht.

create table if not exists public.mobile_home_layouts (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  layout jsonb not null,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint mobile_home_layouts_layout_valid check (
    jsonb_typeof(layout) = 'object'
    and jsonb_typeof(layout -> 'order') = 'array'
    and jsonb_typeof(layout -> 'hidden') = 'array'
    and pg_column_size(layout) <= 4096
  )
);

create trigger mobile_home_layouts_updated_at
  before update on public.mobile_home_layouts
  for each row execute function public.set_updated_at();

alter table public.mobile_home_layouts enable row level security;

revoke all on table public.mobile_home_layouts from public, anon, authenticated;
grant select, insert, update, delete on table public.mobile_home_layouts to authenticated;
grant select, insert, update, delete on table public.mobile_home_layouts to service_role;

create policy mobile_home_layouts_select_own
  on public.mobile_home_layouts
  for select to authenticated
  using (user_id = auth.uid());

create policy mobile_home_layouts_insert_own
  on public.mobile_home_layouts
  for insert to authenticated
  with check (user_id = auth.uid());

create policy mobile_home_layouts_update_own
  on public.mobile_home_layouts
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy mobile_home_layouts_delete_own
  on public.mobile_home_layouts
  for delete to authenticated
  using (user_id = auth.uid());

commit;
