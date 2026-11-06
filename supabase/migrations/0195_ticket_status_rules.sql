begin;

set local search_path = pg_catalog, public;

-- Status rules that hold everywhere (ticket detail, list, bulk actions, app,
-- automations):
--   * a ticket leaves "Neu" only when an agent is assigned;
--   * no ticket goes back to "Neu".
-- Merging a duplicate closes it without an assignee and stays allowed.
create or replace function public.enforce_ticket_status_rules()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_old_key text;
  v_new_key text;
begin
  if new.status_id is not distinct from old.status_id then
    return new;
  end if;
  select key into v_old_key from public.ticket_statuses where id = old.status_id;
  select key into v_new_key from public.ticket_statuses where id = new.status_id;

  if v_new_key = 'new' and v_old_key is distinct from 'new' then
    raise exception 'Ein Ticket kann nicht auf «Neu» zurückgesetzt werden.'
      using errcode = '23514', hint = 'ticket_status_new_locked';
  end if;

  if v_old_key = 'new'
    and new.assigned_agent_id is null
    and not (old.merged_into_ticket_id is null and new.merged_into_ticket_id is not null) then
    raise exception 'Der Status «Neu» kann erst geändert werden, wenn das Ticket einer Person zugewiesen ist.'
      using errcode = '23514', hint = 'ticket_assignee_required';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_ticket_status_rules() from public, anon, authenticated;

drop trigger if exists tickets_enforce_status_rules on public.tickets;
create trigger tickets_enforce_status_rules
  before update of status_id on public.tickets
  for each row
  execute function public.enforce_ticket_status_rules();

commit;
