begin;

revoke all on table public.inventory_locations, public.inventory_items,
  public.inventory_item_identifiers, public.inventory_serial_units,
  public.inventory_events, public.inventory_event_lines,
  public.inventory_stock_balances, public.inventory_reservations,
  public.inventory_counts, public.inventory_count_lines,
  public.inventory_command_receipts
  from public, anon, authenticated;

grant select, insert, update, delete on table public.inventory_locations,
  public.inventory_items, public.inventory_item_identifiers,
  public.inventory_serial_units, public.inventory_events,
  public.inventory_event_lines, public.inventory_stock_balances,
  public.inventory_reservations, public.inventory_counts,
  public.inventory_count_lines, public.inventory_command_receipts to service_role;


revoke all on function public.upsert_inventory_location(uuid, uuid, uuid, uuid, text, text, boolean) from public, anon, authenticated;

revoke all on function public.upsert_inventory_item(uuid, uuid, uuid, uuid, text, text, text, text, text, numeric, numeric, text, text, text, text, boolean) from public, anon, authenticated;

revoke all on function public.post_inventory_movement(uuid, uuid, uuid, text, jsonb, uuid) from public, anon, authenticated;

revoke all on function public.create_inventory_reservation(uuid, uuid, uuid, uuid, uuid, numeric, uuid, uuid) from public, anon, authenticated;

revoke all on function public.release_inventory_reservation(uuid, uuid, uuid, uuid) from public, anon, authenticated;

revoke all on function public.start_inventory_count(uuid, uuid, uuid, uuid) from public, anon, authenticated;

revoke all on function public.record_inventory_count_line(uuid, uuid, uuid, uuid, uuid, numeric) from public, anon, authenticated;

revoke all on function public.close_inventory_count(uuid, uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.upsert_inventory_location(uuid, uuid, uuid, uuid, text, text, boolean) to service_role;

grant execute on function public.upsert_inventory_item(uuid, uuid, uuid, uuid, text, text, text, text, text, numeric, numeric, text, text, text, text, boolean) to service_role;

grant execute on function public.post_inventory_movement(uuid, uuid, uuid, text, jsonb, uuid) to service_role;

grant execute on function public.create_inventory_reservation(uuid, uuid, uuid, uuid, uuid, numeric, uuid, uuid) to service_role;

grant execute on function public.release_inventory_reservation(uuid, uuid, uuid, uuid) to service_role;

grant execute on function public.start_inventory_count(uuid, uuid, uuid, uuid) to service_role;

grant execute on function public.record_inventory_count_line(uuid, uuid, uuid, uuid, uuid, numeric) to service_role;

grant execute on function public.close_inventory_count(uuid, uuid, uuid, uuid) to service_role;


comment on table public.inventory_stock_balances is
  'Private current-balance projection maintained only alongside immutable inventory event lines; service-role workspace reads may use it.';

comment on table public.inventory_events is
  'Append-only tenant inventory ledger header. client_request_id makes server-side postings idempotent.';

comment on table public.inventory_command_receipts is
  'Private tenant command receipts prevent retrying master-data and count-line mutations.';

comment on table public.inventory_reservations is
  'Explicit stock hold with no automatic expiration. Ticket linkage is optional and composite-tenant-bound.';

comment on function public.inventory_apply_event(uuid, uuid, uuid, text, jsonb, text, uuid) is
  'Private SECURITY DEFINER ledger writer. Command RPCs authorize actors before calling it; public and browser roles have no execute privilege.';

commit;
