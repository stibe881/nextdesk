-- Personal notification days. Together with the personal notification time
-- (stored as quiet hours) each person decides on which weekdays and at what
-- time push notifications arrive. Days are ISO weekdays: 1 = Monday ...
-- 7 = Sunday. On other days the delivery queue holds messages and sends them
-- on the next selected day.

alter table public.push_preferences
  add column if not exists delivery_days smallint[] not null
    default array[1, 2, 3, 4, 5, 6, 7]::smallint[];

alter table public.push_preferences
  drop constraint if exists push_preferences_delivery_days_valid;
alter table public.push_preferences
  add constraint push_preferences_delivery_days_valid
  check (
    cardinality(delivery_days) between 1 and 7
    and delivery_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
  );

-- push_work_state is consulted by every push claim function; "active" now
-- reflects whether today is one of the person's notification days.
create or replace function public.push_work_state(p_tenant_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_timezone text;
  v_days smallint[];
  v_local_timestamp timestamp without time zone;
  v_weekday integer;
  v_active boolean;
begin
  select preference.timezone, preference.delivery_days
  into v_timezone, v_days
  from public.push_preferences preference
  where preference.tenant_id = p_tenant_id
    and preference.user_id = p_user_id;
  v_timezone := coalesce(v_timezone, 'Europe/Zurich');
  begin
    v_local_timestamp := timezone(v_timezone, now());
  exception when others then
    v_timezone := 'Europe/Zurich';
    v_local_timestamp := timezone(v_timezone, now());
  end;

  v_weekday := extract(isodow from v_local_timestamp)::integer;
  v_active := v_days is null
    or cardinality(v_days) = 0
    or v_weekday = any(v_days);

  return jsonb_build_object(
    'required', false,
    'startHour', 0,
    'endHour', 24,
    'timezone', v_timezone,
    'localDate', to_char(v_local_timestamp::date, 'YYYY-MM-DD'),
    'localHour', extract(hour from v_local_timestamp)::integer,
    'withinWindow', v_active,
    'checkedInAt', null,
    'checkedOutAt', null,
    'declinedAt', null,
    'checkedIn', false,
    'active', v_active
  );
end;
$$;
revoke all on function public.push_work_state(uuid, uuid) from public, anon, authenticated;
grant execute on function public.push_work_state(uuid, uuid) to service_role;
