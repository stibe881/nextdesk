-- Push notifications no longer depend on a daily work check-in or on the
-- tenant's working hours. Each person decides when notifications arrive via
-- their own notification window, stored as quiet hours in push_preferences
-- (checked by the delivery queue, which holds messages until the window
-- opens).
--
-- push_work_state keeps its response shape so existing app versions keep
-- working: "required" is always false and "active" always true.

create or replace function public.push_work_state(p_tenant_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_timezone text := 'Europe/Zurich';
  v_local_timestamp timestamp without time zone;
begin
  select preference.timezone
  into v_timezone
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

  return jsonb_build_object(
    'required', false,
    'startHour', 0,
    'endHour', 24,
    'timezone', v_timezone,
    'localDate', to_char(v_local_timestamp::date, 'YYYY-MM-DD'),
    'localHour', extract(hour from v_local_timestamp)::integer,
    'withinWindow', true,
    'checkedInAt', null,
    'checkedOutAt', null,
    'declinedAt', null,
    'checkedIn', false,
    'active', true
  );
end;
$$;
revoke all on function public.push_work_state(uuid, uuid) from public, anon, authenticated;
grant execute on function public.push_work_state(uuid, uuid) to service_role;
