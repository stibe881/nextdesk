begin;

set local search_path = pg_catalog, public;

-- Managed article categories per workspace. Agents create them in the article
-- dialog or the catalog management; articles reference them by id.
create table if not exists public.shop_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null
    check (char_length(btrim(name)) between 2 and 80 and name = btrim(name)),
  sort_order integer not null default 0,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint shop_categories_id_tenant_unique unique (id, tenant_id)
);

create unique index if not exists shop_categories_tenant_name_unique
  on public.shop_categories (tenant_id, lower(name));

alter table public.shop_categories enable row level security;
revoke all on table public.shop_categories from public, anon, authenticated;
grant select, insert, update, delete on table public.shop_categories to service_role;

-- Internal details for agents: article number and supplier link. They are
-- never sent to employees.
alter table public.shop_catalog_items
  add column if not exists article_number text
    check (article_number is null or char_length(btrim(article_number)) between 1 and 80),
  add column if not exists supplier_url text
    check (supplier_url is null or (char_length(supplier_url) <= 1000 and supplier_url ~ '^https?://[^[:space:]]+$')),
  add column if not exists category_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'shop_catalog_items_category_fk'
  ) then
    alter table public.shop_catalog_items
      add constraint shop_catalog_items_category_fk
      foreign key (category_id, tenant_id)
      references public.shop_categories (id, tenant_id)
      on delete set null (category_id);
  end if;
end;
$$;

-- Existing free-text categories become managed categories.
insert into public.shop_categories (tenant_id, name)
select distinct on (item.tenant_id, lower(item.category)) item.tenant_id, item.category
from public.shop_catalog_items item
order by item.tenant_id, lower(item.category), item.category
on conflict do nothing;

update public.shop_catalog_items item
set category_id = category.id
from public.shop_categories category
where category.tenant_id = item.tenant_id
  and lower(category.name) = lower(item.category)
  and item.category_id is null;

commit;
