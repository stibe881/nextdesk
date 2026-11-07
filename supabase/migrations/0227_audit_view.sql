-- Audit-Ansicht für Verantwortliche: serverseitige Filterung mit
-- Keyset-Pagination über (occurred_at, id), Freitextsuche über Aktion,
-- Objekttyp und Metadaten (ohne vertrauliche Werte) sowie Personensuche.
-- Alle Funktionen sind ausschliesslich für service_role ausführbar; die Edge
-- Function tenant-audit-log prüft die Berechtigung vor jedem Aufruf.
begin;
set local search_path = pg_catalog, public;

create index if not exists audit_logs_tenant_time_id_idx
  on public.audit_logs (tenant_id, occurred_at desc, id desc);
create index if not exists audit_logs_tenant_actor_time_idx
  on public.audit_logs (tenant_id, actor_id, occurred_at desc, id desc)
  where actor_id is not null;
create index if not exists audit_logs_tenant_entity_time_idx
  on public.audit_logs (tenant_id, entity_type, occurred_at desc, id desc);

-- Ersetzt Werte unter Schlüsseln mit token, secret, password oder key
-- (beliebig verschachtelt) durch «[verborgen]». Gleiche Regel wie
-- redactAuditSecrets() in supabase/functions/_shared/audit-view.ts.
create or replace function public.audit_redact_jsonb(p_value jsonb)
returns jsonb
language plpgsql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
  v_key text;
  v_item jsonb;
begin
  if p_value is null then
    return null;
  end if;
  if jsonb_typeof(p_value) = 'object' then
    v_result := '{}'::jsonb;
    for v_key, v_item in select key, value from jsonb_each(p_value) loop
      if v_key ~* '(token|secret|password|key)' then
        v_result := v_result || jsonb_build_object(v_key, '[verborgen]');
      else
        v_result := v_result || jsonb_build_object(v_key, public.audit_redact_jsonb(v_item));
      end if;
    end loop;
    return v_result;
  elsif jsonb_typeof(p_value) = 'array' then
    select coalesce(jsonb_agg(public.audit_redact_jsonb(element.value) order by element.position), '[]'::jsonb)
    into v_result
    from jsonb_array_elements(p_value) with ordinality as element(value, position);
    return v_result;
  end if;
  return p_value;
end;
$$;

create or replace function public.audit_log_search(
  p_tenant_id uuid,
  p_actor_id uuid default null,
  p_action text default null,
  p_action_prefixes text[] default null,
  p_excluded_prefixes text[] default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_severity text default null,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null,
  p_query text default null,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
)
returns setof public.audit_logs
language sql
stable
set search_path = pg_catalog, public
as $$
  with search as (
    select
      case
        when nullif(btrim(coalesce(p_query, '')), '') is null then null
        else '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
      end as pattern
  )
  select log.*
  from public.audit_logs log
  cross join search
  where p_tenant_id is not null
    and log.tenant_id = p_tenant_id
    and (p_actor_id is null or log.actor_id = p_actor_id)
    and (p_action is null or log.action = p_action)
    and (
      p_action_prefixes is null
      or exists (select 1 from unnest(p_action_prefixes) prefix where starts_with(log.action, prefix))
    )
    and (
      p_excluded_prefixes is null
      or not exists (select 1 from unnest(p_excluded_prefixes) prefix where starts_with(log.action, prefix))
    )
    and (p_entity_type is null or log.entity_type = p_entity_type)
    and (p_entity_id is null or log.entity_id = p_entity_id)
    and (p_severity is null or log.severity::text = p_severity)
    and (p_start_at is null or log.occurred_at >= p_start_at)
    and (p_end_at is null or log.occurred_at <= p_end_at)
    and (
      p_cursor_at is null
      or p_cursor_id is null
      or (log.occurred_at, log.id) < (p_cursor_at, p_cursor_id)
    )
    and (
      search.pattern is null
      or log.action ilike search.pattern
      or log.entity_type ilike search.pattern
      or public.audit_redact_jsonb(log.metadata)::text ilike search.pattern
    )
  order by log.occurred_at desc, log.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 1001);
$$;

-- Personensuche für den Filter «Person»: Mitglieder des Mandanten (auch
-- ehemalige, da sie im Protokoll vorkommen) nach Name oder E-Mail.
create or replace function public.audit_log_actor_search(
  p_tenant_id uuid,
  p_query text default null,
  p_limit integer default 20
)
returns table (user_id uuid, display_name text, email text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with search as (
    select
      case
        when nullif(btrim(coalesce(p_query, '')), '') is null then null
        else '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
      end as pattern
  )
  select membership.user_id, profile.display_name, account.email::text
  from public.tenant_memberships membership
  cross join search
  join public.user_profiles profile on profile.id = membership.user_id
  left join auth.users account on account.id = membership.user_id
  where p_tenant_id is not null
    and membership.tenant_id = p_tenant_id
    and (
      search.pattern is null
      or profile.display_name ilike search.pattern
      or account.email::text ilike search.pattern
    )
  order by lower(coalesce(nullif(btrim(profile.display_name), ''), account.email::text, '')), membership.user_id
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- Objekttypen, die im Protokoll des Mandanten vorkommen (für den Filter).
create or replace function public.audit_log_entity_types(p_tenant_id uuid)
returns table (entity_type text)
language sql
stable
set search_path = pg_catalog, public
as $$
  select distinct log.entity_type
  from public.audit_logs log
  where p_tenant_id is not null
    and log.tenant_id = p_tenant_id
  order by log.entity_type
  limit 300;
$$;

revoke all on function public.audit_redact_jsonb(jsonb) from public, anon, authenticated;
revoke all on function public.audit_log_search(
  uuid, uuid, text, text[], text[], text, uuid, text, timestamptz, timestamptz, text, timestamptz, uuid, integer
) from public, anon, authenticated;
revoke all on function public.audit_log_actor_search(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.audit_log_entity_types(uuid) from public, anon, authenticated;

grant execute on function public.audit_redact_jsonb(jsonb) to service_role;
grant execute on function public.audit_log_search(
  uuid, uuid, text, text[], text[], text, uuid, text, timestamptz, timestamptz, text, timestamptz, uuid, integer
) to service_role;
grant execute on function public.audit_log_actor_search(uuid, text, integer) to service_role;
grant execute on function public.audit_log_entity_types(uuid) to service_role;

commit;
