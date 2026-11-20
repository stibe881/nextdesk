-- Überwachung: Kategorien der Geräte mit bis zu vier Ebenen
-- (z. B. «Standort Baar → Netzwerk → Switch → 2. OG») statt nur einer Ebene
-- Unterkategorien.

create or replace function public.monitoring_device_groups_check_parent()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_parent record;
  v_above integer := 0;
  v_below integer;
  v_cursor uuid := new.parent_id;
begin
  if new.parent_id is null then
    return new;
  end if;
  select tenant_id into v_parent
    from public.monitoring_device_groups where id = new.parent_id;
  if not found or v_parent.tenant_id <> new.tenant_id then
    raise exception 'monitoring device group: parent not found' using errcode = '23503';
  end if;
  -- Ebenen über der Kategorie; sie darf nicht unter sich selbst hängen.
  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception 'monitoring device group: a category cannot be below itself' using errcode = '23514';
    end if;
    v_above := v_above + 1;
    if v_above > 10 then
      raise exception 'monitoring device group: too many levels' using errcode = '23514';
    end if;
    select parent_id into v_cursor from public.monitoring_device_groups where id = v_cursor;
  end loop;
  -- Ebenen unter der Kategorie (beim Verschieben wandern sie mit).
  with recursive below as (
    select id, 0 as depth from public.monitoring_device_groups where id = new.id
    union all
    select child.id, below.depth + 1
    from public.monitoring_device_groups child
    join below on child.parent_id = below.id
    where below.depth < 10
  )
  select coalesce(max(depth), 0) into v_below from below;
  if v_above + 1 + v_below > 4 then
    raise exception 'monitoring device group: at most four levels' using errcode = '23514';
  end if;
  return new;
end;
$$;
