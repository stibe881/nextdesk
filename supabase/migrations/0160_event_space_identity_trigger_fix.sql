-- PL/pgSQL does not short-circuit "tg_table_name = 'x' and new.col ..."; the
-- field reference is resolved for every table. Updating event_space_tasks
-- therefore failed with "record new has no field created_by", so tasks could
-- not be ticked off. Nest the checks so each table only touches its own
-- columns.
begin;

create or replace function public.validate_event_space_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_schema <> 'public' or tg_table_name not in (
    'event_spaces', 'event_space_task_templates', 'event_space_requests',
    'event_space_request_equipment', 'event_space_tasks'
  ) then
    raise exception 'Unsupported event space trigger target' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'Event-space tenant is immutable' using errcode = '23514';
    end if;
    if tg_table_name in ('event_spaces', 'event_space_task_templates', 'event_space_requests', 'event_space_tasks') then
      if new.created_at is distinct from old.created_at then
        raise exception 'Event-space creation timestamp is immutable' using errcode = '23514';
      end if;
    end if;
    if tg_table_name = 'event_spaces' then
      if new.created_by is distinct from old.created_by then
        raise exception 'Event-space creator is immutable' using errcode = '23514';
      end if;
    end if;
    if tg_table_name = 'event_space_requests' then
      if new.created_by is distinct from old.created_by
        or new.series_id is distinct from old.series_id
        or new.series_index is distinct from old.series_index
        or new.recurrence_kind is distinct from old.recurrence_kind then
        raise exception 'Event-space request provenance is immutable' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

commit;
