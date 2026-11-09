begin;
set local search_path = pg_catalog, public;

-- Kaderstufen (1 = höchste Stufe, z. B. Geschäftsleitung) und Sichtbarkeit von
-- Shop-Artikeln pro Kaderstufe.
--
-- Die Stufe einer Person ergibt sich aus
--   1. einer manuellen Festlegung (tenant_member_cadre_overrides), sonst
--   2. ihrer Funktion aus Entra (bzw. aus dem Personenverzeichnis), die über
--      tenant_cadre_title_rules einer Stufe zugeordnet ist, sonst
--   3. 0 = kein Kader.
-- Sie wird bei jeder Abfrage neu berechnet, damit Änderungen der Funktion in
-- Entra ohne weiteren Schritt wirken.

create table if not exists public.tenant_cadre_title_rules (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  job_title text not null,
  job_title_key text generated always as (lower(btrim(job_title))) stored,
  cadre_level smallint not null,
  updated_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, job_title_key),
  constraint tenant_cadre_title_rules_level_check check (cadre_level between 1 and 3),
  constraint tenant_cadre_title_rules_title_check
    check (char_length(btrim(job_title)) between 2 and 160)
);

create table if not exists public.tenant_member_cadre_overrides (
  tenant_id uuid not null,
  user_id uuid not null,
  -- 0 = ausdrücklich kein Kader, 1–3 = Kaderstufe.
  cadre_level smallint not null,
  updated_by uuid,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, user_id),
  constraint tenant_member_cadre_overrides_membership_fkey
    foreign key (tenant_id, user_id)
    references public.tenant_memberships (tenant_id, user_id)
    on delete cascade,
  constraint tenant_member_cadre_overrides_level_check check (cadre_level between 0 and 3)
);

alter table public.tenant_cadre_title_rules enable row level security;
alter table public.tenant_member_cadre_overrides enable row level security;
revoke all on table public.tenant_cadre_title_rules, public.tenant_member_cadre_overrides
  from public, anon, authenticated;
grant select, insert, update, delete on table public.tenant_cadre_title_rules,
  public.tenant_member_cadre_overrides to service_role;

-- Leer = für alle sichtbar; sonst nur für die genannten Kaderstufen.
alter table public.shop_catalog_items
  add column if not exists visible_cadre_levels smallint[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'shop_catalog_items_visible_cadre_levels_check'
      and conrelid = 'public.shop_catalog_items'::regclass
  ) then
    alter table public.shop_catalog_items
      add constraint shop_catalog_items_visible_cadre_levels_check
      check (
        visible_cadre_levels <@ array[1, 2, 3]::smallint[]
        and array_position(visible_cadre_levels, null) is null
      );
  end if;
end;
$$;

-- Stufe zu einer Funktion (0 = keine Regel).
create or replace function public.tenant_cadre_level_for_title(
  p_tenant_id uuid,
  p_job_title text
)
returns smallint
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce((
    select rule.cadre_level
    from public.tenant_cadre_title_rules rule
    where rule.tenant_id = p_tenant_id
      and rule.job_title_key = lower(btrim(p_job_title))
  ), 0::smallint);
$$;

-- Funktion einer Person: Entra hat Vorrang vor dem Personenverzeichnis.
create or replace function public.tenant_member_job_title(
  p_tenant_id uuid,
  p_user_id uuid
)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    (
      select nullif(btrim(person.job_title), '')
      from public.tenant_entra_directory_people person
      where person.tenant_id = p_tenant_id
        and person.local_user_id = p_user_id
        and person.job_title is not null
      order by person.inactive_at nulls first
      limit 1
    ),
    (
      select nullif(btrim(directory.job_title), '')
      from public.tenant_member_directory directory
      where directory.tenant_id = p_tenant_id
        and directory.user_id = p_user_id
    )
  );
$$;

-- Kaderstufe einer Person (0 = kein Kader).
create or replace function public.tenant_member_cadre_level(
  p_tenant_id uuid,
  p_user_id uuid
)
returns smallint
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    (
      select override.cadre_level
      from public.tenant_member_cadre_overrides override
      where override.tenant_id = p_tenant_id
        and override.user_id = p_user_id
    ),
    public.tenant_cadre_level_for_title(
      p_tenant_id,
      public.tenant_member_job_title(p_tenant_id, p_user_id)
    )
  );
$$;

-- Darf eine Person mit dieser Stufe den Artikel sehen und bestellen?
create or replace function public.shop_item_visible_for_cadre(
  p_visible_levels smallint[],
  p_cadre_level integer
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(cardinality(p_visible_levels), 0) = 0
    or coalesce(p_cadre_level, 0) = any (p_visible_levels);
$$;

revoke all on function public.tenant_cadre_level_for_title(uuid, text) from public, anon, authenticated;
revoke all on function public.tenant_member_job_title(uuid, uuid) from public, anon, authenticated;
revoke all on function public.tenant_member_cadre_level(uuid, uuid) from public, anon, authenticated;
revoke all on function public.shop_item_visible_for_cadre(smallint[], integer) from public, anon, authenticated;
grant execute on function public.tenant_cadre_level_for_title(uuid, text) to service_role;
grant execute on function public.tenant_member_job_title(uuid, uuid) to service_role;
grant execute on function public.tenant_member_cadre_level(uuid, uuid) to service_role;
grant execute on function public.shop_item_visible_for_cadre(smallint[], integer) to service_role;

-- Letzte Sicherung: Eigene Bestellungen nur für Artikel der eigenen Kaderstufe.
-- Agenten (shop.fulfill / shop.manage) sind ausgenommen, ebenso Bestellungen,
-- die ein Agent für eine andere Person aufgibt (placed_by gesetzt).
create or replace function public.shop_order_line_cadre_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order record;
  v_levels smallint[];
begin
  if new.catalog_item_id is null then
    return new;
  end if;
  select visible_cadre_levels into v_levels
  from public.shop_catalog_items
  where id = new.catalog_item_id and tenant_id = new.tenant_id;
  if coalesce(cardinality(v_levels), 0) = 0 then
    return new;
  end if;
  select requester_id, placed_by into v_order
  from public.shop_orders
  where id = new.order_id and tenant_id = new.tenant_id;
  if not found or (v_order.placed_by is not null and v_order.placed_by <> v_order.requester_id) then
    return new;
  end if;
  if public.shop_item_visible_for_cadre(
       v_levels,
       public.tenant_member_cadre_level(new.tenant_id, v_order.requester_id))
     or public.shop_has_permission(v_order.requester_id, new.tenant_id, 'shop.fulfill')
     or public.shop_has_permission(v_order.requester_id, new.tenant_id, 'shop.manage') then
    return new;
  end if;
  raise exception 'shop_item_not_for_cadre' using errcode = '42501';
end;
$$;

revoke all on function public.shop_order_line_cadre_guard() from public, anon, authenticated;

create or replace trigger shop_order_line_cadre_guard
  before insert on public.shop_order_lines
  for each row execute function public.shop_order_line_cadre_guard();

commit;
