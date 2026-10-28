begin;

create or replace function public.release_inventory_source_reservations_on_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_table_schema <> 'public' or tg_op <> 'DELETE' then
    raise exception 'Unsupported inventory source reservation release target' using errcode = '22023';
  end if;

  if tg_table_name = 'event_space_request_equipment' then
    perform public.release_inventory_source_reservations(
      old.tenant_id, 'event_space_equipment', old.request_id, old.equipment_key,
      null, null
    );
  elsif tg_table_name = 'onboarding_tasks' then
    perform public.release_inventory_source_reservations(
      old.tenant_id, 'onboarding_template_task', null, null,
      old.entry_id, old.id
    );
  else
    raise exception 'Unsupported inventory source reservation release target' using errcode = '22023';
  end if;
  return old;
end;
$$;

revoke all on function public.release_inventory_source_reservations_on_delete()
  from public, anon, authenticated;


drop trigger if exists inventory_source_reservation_event_equipment_insert
  on public.event_space_request_equipment;

create trigger inventory_source_reservation_event_equipment_insert
  after insert on public.event_space_request_equipment
  for each row execute function public.reserve_inventory_from_event_space_equipment();


drop trigger if exists inventory_source_reservation_onboarding_task_insert
  on public.onboarding_tasks;

create trigger inventory_source_reservation_onboarding_task_insert
  after insert on public.onboarding_tasks
  for each row execute function public.reserve_inventory_from_onboarding_task();


drop trigger if exists inventory_source_reservation_event_equipment_release
  on public.event_space_request_equipment;

create trigger inventory_source_reservation_event_equipment_release
  before delete on public.event_space_request_equipment
  for each row execute function public.release_inventory_source_reservations_on_delete();


drop trigger if exists inventory_source_reservation_onboarding_task_release
  on public.onboarding_tasks;

create trigger inventory_source_reservation_onboarding_task_release
  before delete on public.onboarding_tasks
  for each row execute function public.release_inventory_source_reservations_on_delete();


-- Rules, successful source links and structured exception states are private to
-- service-side orchestration. Composite foreign keys provide the tenant fence
-- even when service_role bypasses browser-facing RLS checks.
alter table public.inventory_source_reservation_rules enable row level security;

alter table public.inventory_source_reservation_rules force row level security;

alter table public.inventory_source_reservations enable row level security;

alter table public.inventory_source_reservations force row level security;

alter table public.inventory_source_reservation_exceptions enable row level security;

alter table public.inventory_source_reservation_exceptions force row level security;


revoke all on table public.inventory_source_reservation_rules,
  public.inventory_source_reservations,
  public.inventory_source_reservation_exceptions
  from public, anon, authenticated;

grant select, insert, update, delete on table public.inventory_source_reservation_rules,
  public.inventory_source_reservations,
  public.inventory_source_reservation_exceptions
  to service_role;


create policy inventory_source_reservation_rules_service_role_only
  on public.inventory_source_reservation_rules
  for all to service_role using (true) with check (true);

create policy inventory_source_reservations_service_role_only
  on public.inventory_source_reservations
  for all to service_role using (true) with check (true);

create policy inventory_source_reservation_exceptions_service_role_only
  on public.inventory_source_reservation_exceptions
  for all to service_role using (true) with check (true);


comment on table public.inventory_source_reservation_rules is
  'Service-only opt-in rules for future event-equipment and onboarding-template-task inventory holds; each rule is tenant-bound and disabled by default.';

comment on table public.inventory_source_reservations is
  'Private, tenant-composite binding of one automatic inventory reservation to one concrete source and rule; source deletion releases only open holds.';

comment on table public.inventory_source_reservation_exceptions is
  'Private structured exception states for automatic source reservations; stores opaque IDs and controlled codes only, never source text, quantities or supplier data.';

commit;
