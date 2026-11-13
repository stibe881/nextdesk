-- Updates of external incidents notify the team, too (reason «updated» for a
-- new text of the provider, «resolved» when the provider resolves it). The
-- notification carries the latest text of the provider for mail and push.
do $$
declare
  v_def text;
  v_old text := E'    ''reason'', p_reason,\n';
begin
  select pg_get_functiondef('public.monitoring_incident_notify(uuid,text)'::regprocedure) into v_def;
  if position('''message''' in v_def) > 0 then
    return;
  end if;
  if position(v_old in v_def) = 0 then
    raise exception 'monitoring_incident_notify: anchor not found';
  end if;
  execute replace(v_def, v_old, v_old
    || E'    ''message'', case when p_reason in (''updated'', ''resolved'') then (\n'
    || E'      select left(event.message, 1000) from public.monitoring_incident_events event\n'
    || E'       where event.incident_id = v_incident.id and event.message is not null\n'
    || E'       order by event.created_at desc limit 1) end,\n');
end;
$$;
