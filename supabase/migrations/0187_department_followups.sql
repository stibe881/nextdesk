begin;

set local search_path = pg_catalog, public;

-- Follow-ups to the department scoping of module data (migration 0177).
--
-- 1. upsert_inventory_item takes the department of the item. A new item gets
--    its department in the same statement that creates it (before, the edge
--    function set it in a second update, so the item was briefly visible to
--    every department). An existing item keeps its department unless
--    p_set_department is true.
-- 2. Expiry reminder tickets of contracts and licenses go to the department of
--    the contract or license; without an active one, to the previous choice
--    (the ICT department of the tenant).

-- 1. Inventory items ---------------------------------------------------------

-- The new parameters have defaults, so callers with the old named parameters
-- keep working. The old signature is dropped to keep calls unambiguous.
drop function if exists public.upsert_inventory_item(
  uuid, uuid, uuid, uuid, text, text, text, text, text, numeric, numeric,
  text, text, text, text, boolean
);

create or replace function public.upsert_inventory_item(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_client_request_id uuid,
  p_item_id uuid,
  p_article_number text,
  p_name text,
  p_category text,
  p_unit text,
  p_tracking_mode text,
  p_minimum_quantity numeric,
  p_target_quantity numeric,
  p_manufacturer text,
  p_model text,
  p_supplier text,
  p_note text,
  p_active boolean,
  p_department_id uuid default null,
  p_set_department boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_item public.inventory_items%rowtype;
  v_receipt_target_id uuid;
  v_article_number text := lower(btrim(coalesce(p_article_number, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_category text := btrim(coalesce(p_category, ''));
  v_unit text := lower(btrim(coalesce(p_unit, '')));
  v_manufacturer text := nullif(btrim(p_manufacturer), '');
  v_model text := nullif(btrim(p_model), '');
  v_supplier text := nullif(btrim(p_supplier), '');
  v_note text := nullif(btrim(p_note), '');
  v_department_changed boolean := false;
  v_exists boolean;
begin
  if p_actor_id is null or p_tenant_id is null or p_client_request_id is null or p_active is null
     or p_set_department is null
     or v_article_number !~ '^[a-z0-9][a-z0-9._/-]{0,159}$'
     or char_length(v_name) not between 1 and 240 or v_name ~ '[[:cntrl:]]'
     or char_length(v_category) not between 1 and 120 or v_category ~ '[[:cntrl:]]'
     or v_unit !~ '^[a-z][a-z0-9_-]{0,31}$'
     or p_tracking_mode is null
     or p_tracking_mode not in ('quantity', 'serial')
     or p_minimum_quantity is null or p_target_quantity is null
     or p_minimum_quantity < 0 or p_target_quantity < p_minimum_quantity
     or p_minimum_quantity <> trunc(p_minimum_quantity, 3)
     or p_target_quantity <> trunc(p_target_quantity, 3)
     or (v_manufacturer is not null and (char_length(v_manufacturer) > 160 or v_manufacturer ~ '[[:cntrl:]]'))
     or (v_model is not null and (char_length(v_model) > 160 or v_model ~ '[[:cntrl:]]'))
     or (v_supplier is not null and (char_length(v_supplier) > 160 or v_supplier ~ '[[:cntrl:]]'))
     or (v_note is not null and (char_length(v_note) > 2000 or v_note ~ '[[:cntrl:]]')) then
    raise exception 'Invalid inventory item' using errcode = '22023';
  end if;
  perform public.assert_user_has_tenant_permission(p_actor_id, p_tenant_id, 'inventory.manage');

  perform public.inventory_lock_request(p_tenant_id, p_client_request_id);
  select target_id into v_receipt_target_id
  from public.inventory_command_receipts
  where tenant_id = p_tenant_id
    and command_type = 'upsert_inventory_item'
    and client_request_id = p_client_request_id
  for key share;
  if found then
    return v_receipt_target_id;
  end if;

  if p_item_id is null then
    select * into v_item
    from public.inventory_items
    where tenant_id = p_tenant_id and article_number = v_article_number
    for update;
  else
    select * into v_item
    from public.inventory_items
    where id = p_item_id and tenant_id = p_tenant_id
    for update;
    if not found then
      raise exception 'Inventory item not found' using errcode = 'P0002';
    end if;
  end if;
  v_exists := found;

  -- A department that is newly assigned must be an active department of the
  -- tenant. Keeping the current department is always allowed.
  if p_department_id is not null
     and (not v_exists
          or (p_set_department and v_item.department_id is distinct from p_department_id))
     and not exists (
       select 1 from public.departments department
       where department.id = p_department_id
         and department.tenant_id = p_tenant_id
         and department.active
     ) then
    raise exception 'Invalid inventory item department' using errcode = '22023';
  end if;

  if v_exists then
    if v_item.tracking_mode <> p_tracking_mode
       and (
         exists (
           select 1 from public.inventory_serial_units
           where tenant_id = p_tenant_id and item_id = v_item.id
         )
         or exists (
           select 1 from public.inventory_event_lines
           where tenant_id = p_tenant_id and item_id = v_item.id
         )
       ) then
      raise exception 'Cannot change tracking mode after serial units or ledger history exist' using errcode = '23514';
    end if;
    v_department_changed := p_set_department
      and v_item.department_id is distinct from p_department_id;
    update public.inventory_items
    set article_number = v_article_number,
        name = v_name,
        category = v_category,
        unit = v_unit,
        tracking_mode = p_tracking_mode,
        minimum_quantity = p_minimum_quantity,
        target_quantity = p_target_quantity,
        manufacturer = v_manufacturer,
        model = v_model,
        supplier = v_supplier,
        note = v_note,
        active = p_active,
        department_id = case when p_set_department then p_department_id else department_id end
    where id = v_item.id and tenant_id = p_tenant_id
    returning * into v_item;
  else
    insert into public.inventory_items (
      tenant_id, article_number, name, category, unit, tracking_mode,
      minimum_quantity, target_quantity, manufacturer, model, supplier, note, active,
      department_id
    ) values (
      p_tenant_id, v_article_number, v_name, v_category, v_unit, p_tracking_mode,
      p_minimum_quantity, p_target_quantity, v_manufacturer, v_model, v_supplier, v_note, p_active,
      p_department_id
    ) returning * into v_item;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (
    p_tenant_id, p_actor_id, 'inventory.item.upserted', 'inventory_item', v_item.id, 'info',
    jsonb_build_object('type', 'item_upsert', 'count', 1, 'reference_type', 'inventory_item')
      || case when v_department_changed
              then jsonb_build_object('department_changed', true)
              else '{}'::jsonb end
  );
  insert into public.inventory_command_receipts (
    tenant_id, command_type, client_request_id, target_id
  ) values (
    p_tenant_id, 'upsert_inventory_item', p_client_request_id, v_item.id
  ) on conflict (tenant_id, command_type, client_request_id) do nothing
  returning target_id into v_receipt_target_id;
  if v_receipt_target_id is null then
    select target_id into v_receipt_target_id
    from public.inventory_command_receipts
    where tenant_id = p_tenant_id
      and command_type = 'upsert_inventory_item'
      and client_request_id = p_client_request_id
    for key share;
  end if;
  return v_receipt_target_id;
end;
$$;

revoke all on function public.upsert_inventory_item(
  uuid, uuid, uuid, uuid, text, text, text, text, text, numeric, numeric,
  text, text, text, text, boolean, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.upsert_inventory_item(
  uuid, uuid, uuid, uuid, text, text, text, text, text, numeric, numeric,
  text, text, text, text, boolean, uuid, boolean
) to service_role;

-- 2. Expiry reminder tickets -------------------------------------------------

-- p_department_id is optional, so calls with the four old parameters keep
-- working. The old signature is dropped to keep calls unambiguous.
drop function if exists public.create_expiry_reminder_ticket(uuid, uuid, text, text);

create or replace function public.create_expiry_reminder_ticket(
  p_tenant_id uuid,
  p_requester_id uuid,
  p_subject text,
  p_description text,
  p_department_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_department record;
  v_status_id uuid;
  v_priority_id uuid;
  v_number text;
  v_ticket_id uuid;
begin
  -- The requested department when it is an active department of the tenant,
  -- otherwise the ICT department (or the first active one).
  select department.id, department.key
  into v_department
  from public.departments department
  where department.tenant_id = p_tenant_id
    and department.active
  order by (department.id = p_department_id) is true desc,
           (department.kind = 'ict') desc,
           department.key
  limit 1;
  select status.id into v_status_id
  from public.ticket_statuses status
  where status.tenant_id = p_tenant_id and status.key = 'new';
  select priority.id into v_priority_id
  from public.ticket_priorities priority
  where priority.tenant_id = p_tenant_id and priority.key = 'normal';
  if v_department.id is null or v_status_id is null or v_priority_id is null then
    return null;
  end if;

  v_number := public.reserve_ticket_number(
    p_tenant_id, v_department.id, left(v_department.key, 8)
  );
  insert into public.tickets (
    tenant_id, department_id, ticket_number, subject, description,
    status_id, priority_id, requester_id, source
  ) values (
    p_tenant_id, v_department.id, v_number, left(p_subject, 240),
    left(p_description, 50000), v_status_id, v_priority_id, p_requester_id,
    'automation'
  )
  returning id into v_ticket_id;

  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (
    v_ticket_id, p_requester_id, 'ticket.created',
    jsonb_build_object('source', 'expiry_reminder')
  );
  return v_ticket_id;
end;
$$;
revoke all on function public.create_expiry_reminder_ticket(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;

-- Same as migration 0152, plus the department of the contract or license.
create or replace function public.create_due_expiry_reminders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_record record;
  v_today date := timezone('Europe/Zurich', now())::date;
  v_ticket_id uuid;
  v_created integer := 0;
  v_kind text;
  v_cancel_on date;
  v_description text;
begin
  for v_kind in select unnest(array['contract', 'license']) loop
    if v_kind = 'license' and to_regclass('public.licenses') is null then
      continue;
    end if;
    for v_record in execute format($q$
      select item.id, item.tenant_id, item.title, item.ends_on,
             item.notice_period_days, item.reference_number,
             item.%1$s as party, item.reminder_days_before,
             coalesce(item.responsible_user_id, item.created_by) as requester_id,
             %4$s as auto_renew,
             item.department_id
      from public.%2$I item
      where item.status = 'active'
        and item.archived_at is null
        and item.ends_on is not null
        and item.reminder_days_before is not null
        %3$s
        and $1 >= item.ends_on - item.reminder_days_before
        and item.reminder_sent_for is distinct from item.ends_on
        and exists (
          select 1 from public.tenant_feature_flags flag
          where flag.tenant_id = item.tenant_id
            and flag.feature_key = 'contracts.management'
            and flag.enabled
            and (flag.pilot_ends_at is null or flag.pilot_ends_at > timezone('utc', now()))
        )
      order by item.ends_on, item.id
      for update of item skip locked
      limit 100
    $q$, case when v_kind = 'contract' then 'counterparty_name' else 'vendor_name' end,
         case when v_kind = 'contract' then 'contracts' else 'licenses' end,
         -- Ein bereits gekündigter Vertrag läuft planmässig aus.
         case when v_kind = 'contract' then 'and not item.cancelled' else '' end,
         case when v_kind = 'contract' then 'item.auto_renew' else 'false' end)
      using v_today
    loop
      v_cancel_on := case
        when v_record.notice_period_days is null then null
        else v_record.ends_on - v_record.notice_period_days
      end;
      v_description := format(
        E'%s läuft am %s aus.\n\n%s: %s%s%s\n\nBitte rechtzeitig prüfen, verlängern oder kündigen.',
        case when v_kind = 'contract' then 'Der Vertrag' else 'Die Lizenz' end,
        to_char(v_record.ends_on, 'DD.MM.YYYY'),
        case when v_kind = 'contract' then 'Gegenpartei' else 'Hersteller' end,
        v_record.party,
        case when v_record.reference_number is null then ''
             else E'\nNummer: ' || v_record.reference_number end,
        case when v_cancel_on is null then ''
             else E'\nKündigungsfrist: ' || v_record.notice_period_days
               || ' Tage (spätestens bis ' || to_char(v_cancel_on, 'DD.MM.YYYY') || ')' end
      ) || case when v_record.auto_renew
                then E'\n\nAchtung: Der Vertrag verlängert sich automatisch, wenn er nicht rechtzeitig gekündigt wird.'
                else '' end;
      v_ticket_id := public.create_expiry_reminder_ticket(
        v_record.tenant_id,
        v_record.requester_id,
        format('%s läuft bald aus: %s (%s)',
               case when v_kind = 'contract' then 'Vertrag' else 'Lizenz' end,
               v_record.title, to_char(v_record.ends_on, 'DD.MM.YYYY')),
        v_description,
        v_record.department_id
      );
      if v_ticket_id is null then
        continue;
      end if;
      execute format(
        'update public.%I set reminder_ticket_id = $1, reminder_sent_for = $2 where id = $3',
        case when v_kind = 'contract' then 'contracts' else 'licenses' end
      ) using v_ticket_id, v_record.ends_on, v_record.id;
      v_created := v_created + 1;
    end loop;
  end loop;
  return v_created;
end;
$$;
revoke all on function public.create_due_expiry_reminders()
  from public, anon, authenticated;
grant execute on function public.create_due_expiry_reminders() to service_role;

commit;
