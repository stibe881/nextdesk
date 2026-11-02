begin;

-- Wird eine E-Mail-Adresse in Entra einer anderen Person zugeordnet (oder
-- vertauschen zwei Personen ihre Adressen), verletzt der Import die
-- Eindeutigkeit (tenant_id, email) und der ganze Abgleich scheitert. Vor dem
-- Schreiben werden deshalb bisherige Inhaberinnen und Inhaber einer Adresse
-- freigegeben, wenn dieselbe Adresse im Import einer anderen Person gehört.
create or replace function public.upsert_fenced_entra_directory_people_batch(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_run_id uuid,
  p_sync_generation bigint,
  p_entra_tenant_id uuid,
  p_started_at timestamp with time zone,
  p_people jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_imported integer := 0;
begin
  perform public.assert_user_has_tenant_permission(
    p_actor_id,
    p_tenant_id,
    'tenant.settings.manage'
  );
  if p_started_at is null
     or jsonb_typeof(p_people) <> 'array'
     or jsonb_array_length(p_people) > 250 then
    raise exception 'Invalid Entra directory sync batch' using errcode = '22023';
  end if;

  perform public.assert_fenced_entra_directory_sync_run(
    p_tenant_id,
    p_run_id,
    p_sync_generation,
    p_entra_tenant_id
  );

  update public.tenant_entra_directory_people as holder
  set email = 'freigegeben-' || holder.entra_object_id::text || '@nextdesk.invalid',
      account_enabled = false,
      inactive_at = coalesce(holder.inactive_at, p_started_at)
  where holder.tenant_id = p_tenant_id
    and exists (
      select 1
      from jsonb_to_recordset(p_people) as incoming(
        entra_object_id uuid,
        email text
      )
      where incoming.email = holder.email
        and incoming.entra_object_id is distinct from holder.entra_object_id
    );

  with input as (
    select *
    from jsonb_to_recordset(p_people) as person(
      entra_object_id uuid,
      email text,
      display_name text,
      job_title text,
      source_department_name text,
      account_enabled boolean
    )
  ), written as (
    insert into public.tenant_entra_directory_people as directory (
      tenant_id,
      entra_object_id,
      email,
      display_name,
      job_title,
      source_department_name,
      account_enabled,
      inactive_at,
      last_synced_at
    )
    select
      p_tenant_id,
      input.entra_object_id,
      input.email,
      input.display_name,
      input.job_title,
      input.source_department_name,
      input.account_enabled,
      case when input.account_enabled then null else p_started_at end,
      p_started_at
    from input
    on conflict (tenant_id, entra_object_id) do update
      set email = excluded.email,
          display_name = excluded.display_name,
          job_title = excluded.job_title,
          source_department_name = excluded.source_department_name,
          account_enabled = excluded.account_enabled,
          inactive_at = excluded.inactive_at,
          last_synced_at = excluded.last_synced_at
    returning 1
  )
  select count(*)::integer into v_imported from written;

  update public.tenant_entra_directory_sync_configurations
  set sync_lease_expires_at = timezone('utc', now()) + interval '20 minutes'
  where tenant_id = p_tenant_id
    and active_sync_run_id = p_run_id
    and sync_generation = p_sync_generation;

  if not found then
    raise exception 'Entra directory sync run is no longer valid' using errcode = 'P0002';
  end if;

  return v_imported;
end;
$function$;

commit;
