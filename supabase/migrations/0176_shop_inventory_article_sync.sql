begin;

set local search_path = pg_catalog, public;

-- One article for Lager and Shop: a shop article linked to a stock article
-- (shop_catalog_items.inventory_item_id) shares its name and article number.
-- Changing either side updates the other, so nothing is captured twice.
-- Stock article numbers are lowercase by design; the shop keeps its own
-- spelling as long as it only differs in case.

create or replace function public.shop_inventory_article_number(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select case
    when p_value is null then null
    when lower(btrim(p_value)) ~ '^[a-z0-9][a-z0-9._/-]{0,159}$'
      then lower(btrim(p_value))
    else null
  end;
$$;

-- Stock article changed: carry name and number to its shop articles.
create or replace function public.shop_sync_from_inventory_item()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_name text := left(new.name, 160);
begin
  if char_length(btrim(v_name)) >= 2 then
    update public.shop_catalog_items item
    set name = btrim(v_name),
        updated_at = timezone('utc', now())
    where item.tenant_id = new.tenant_id
      and item.inventory_item_id = new.id
      and item.name is distinct from btrim(v_name);
  end if;

  update public.shop_catalog_items item
  set article_number = new.article_number,
      updated_at = timezone('utc', now())
  where item.tenant_id = new.tenant_id
    and item.inventory_item_id = new.id
    and lower(coalesce(item.article_number, '')) is distinct from new.article_number;

  return new;
end;
$$;

drop trigger if exists shop_sync_from_inventory_item on public.inventory_items;
create trigger shop_sync_from_inventory_item
  after update of name, article_number on public.inventory_items
  for each row
  when (old.name is distinct from new.name
        or old.article_number is distinct from new.article_number)
  execute function public.shop_sync_from_inventory_item();

-- Shop article changed (or newly linked): carry name and number to the stock
-- article. A number that is not a valid stock number, or that another stock
-- article already uses, stays a shop-only spelling.
create or replace function public.shop_sync_to_inventory_item()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_number text := public.shop_inventory_article_number(new.article_number);
begin
  if new.inventory_item_id is null then
    return new;
  end if;

  update public.inventory_items item
  set name = new.name,
      updated_at = timezone('utc', now())
  where item.tenant_id = new.tenant_id
    and item.id = new.inventory_item_id
    and item.name is distinct from new.name;

  if v_number is not null and not exists (
    select 1
    from public.inventory_items other
    where other.tenant_id = new.tenant_id
      and other.article_number = v_number
      and other.id <> new.inventory_item_id
  ) then
    update public.inventory_items item
    set article_number = v_number,
        updated_at = timezone('utc', now())
    where item.tenant_id = new.tenant_id
      and item.id = new.inventory_item_id
      and item.article_number is distinct from v_number;
  end if;

  return new;
end;
$$;

drop trigger if exists shop_sync_to_inventory_item on public.shop_catalog_items;
create trigger shop_sync_to_inventory_item
  after insert or update of name, article_number, inventory_item_id
  on public.shop_catalog_items
  for each row
  when (pg_trigger_depth() < 2)
  execute function public.shop_sync_to_inventory_item();

revoke all on function public.shop_sync_from_inventory_item() from public, anon, authenticated;
revoke all on function public.shop_sync_to_inventory_item() from public, anon, authenticated;

commit;
