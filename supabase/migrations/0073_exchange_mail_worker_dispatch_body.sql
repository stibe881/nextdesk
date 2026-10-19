begin;

set local search_path = pg_catalog, public;

-- pg_net expects the JSON request body before URL parameters. The worker
-- accepts its action only from request.json(), so pass p_payload as body and
-- keep parameters empty.
create or replace function public.exchange_mail_wake_worker(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, mail_private, pg_temp
as $$
declare
  v_url text;
  v_secret text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return;
  end if;
  select config.function_url, config.dispatch_secret
  into v_url, v_secret
  from mail_private.dispatch_config config
  where config.singleton;
  if v_url is null or v_secret is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return;
  end if;
  execute 'select net.http_post($1, $2, $3, $4, $5)'
    using v_url,
          p_payload,
          '{}'::jsonb,
          jsonb_build_object(
            'Content-Type', 'application/json',
            'x-nextdesk-dispatch-secret', v_secret
          ),
          3000;
exception when others then
  -- Provider wakeups are best effort and must never block application writes.
  return;
end;
$$;

revoke all on function public.exchange_mail_wake_worker(jsonb)
  from public, anon, authenticated;
grant execute on function public.exchange_mail_wake_worker(jsonb)
  to service_role;

commit;
