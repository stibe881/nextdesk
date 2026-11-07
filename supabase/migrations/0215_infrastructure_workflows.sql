begin;

set local search_path = pg_catalog, public;

-- Infrastructure workflows:
-- 1. Planned work on devices becomes a maintenance window of the system status
--    (linked to the devices) and is announced to the people concerned ahead.
-- 2. A device's maintenance checklist becomes a recurring service task; each
--    completed occurrence is logged as maintenance of the device.

-- 1. Maintenance windows for devices -----------------------------------------
create table if not exists public.service_status_maintenance_assets (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  maintenance_id uuid not null,
  asset_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (maintenance_id, asset_id),
  constraint service_status_maintenance_assets_maintenance_fk
    foreign key (maintenance_id, tenant_id)
    references public.service_status_maintenances (id, tenant_id) on delete cascade,
  constraint service_status_maintenance_assets_asset_fk
    foreign key (asset_id, tenant_id)
    references public.assets (id, tenant_id) on delete cascade
);
create index if not exists service_status_maintenance_assets_asset_idx
  on public.service_status_maintenance_assets (tenant_id, asset_id);
alter table public.service_status_maintenance_assets enable row level security;
revoke all on table public.service_status_maintenance_assets from public, anon, authenticated;
grant all on table public.service_status_maintenance_assets to service_role;

alter table public.service_status_maintenances
  add column if not exists announced_at timestamptz;

-- Announces maintenance windows that start within the next 24 hours, once:
-- public windows to every active member, internal ones to the people who
-- manage assets.
create or replace function public.maintenance_announce_run()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_window record;
  v_count integer := 0;
  v_inserted integer;
begin
  for v_window in
    select maintenance.*,
      (
        select string_agg(service.name, ', ' order by service.name)
        from public.service_status_maintenance_services link
        join public.services service on service.id = link.service_id
        where link.maintenance_id = maintenance.id
      ) as service_names
    from public.service_status_maintenances maintenance
    where maintenance.state = 'scheduled'
      and maintenance.announced_at is null
      and maintenance.starts_at > timezone('utc', now())
      and maintenance.starts_at <= timezone('utc', now()) + interval '24 hours'
    order by maintenance.starts_at
    limit 50
    for update skip locked
  loop
    update public.service_status_maintenances
    set announced_at = timezone('utc', now())
    where id = v_window.id;

    insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
    select v_window.tenant_id, membership.user_id, null, 'maintenance.upcoming',
      jsonb_build_object(
        'maintenanceId', v_window.id,
        'title', v_window.title,
        'startsAt', v_window.starts_at,
        'endsAt', v_window.ends_at,
        'services', coalesce(v_window.service_names, '')
      )
    from public.tenant_memberships membership
    where membership.tenant_id = v_window.tenant_id
      and membership.status = 'active'
      and (
        v_window.public_enabled
        or public.user_has_tenant_permission(membership.user_id, v_window.tenant_id, 'asset.manage')
      )
    limit 2000;
    get diagnostics v_inserted = row_count;
    v_count := v_count + v_inserted;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.maintenance_announce_run() from public, anon, authenticated;

-- 2. Maintenance checklists as recurring service tasks ------------------------
alter table public.asset_infrastructure
  add column if not exists maintenance_checklist jsonb not null default '[]'::jsonb,
  add column if not exists service_task_template_id uuid
    references public.service_task_templates(id) on delete set null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'asset_infrastructure_checklist_valid'
      and conrelid = 'public.asset_infrastructure'::regclass
  ) then
    alter table public.asset_infrastructure
      add constraint asset_infrastructure_checklist_valid
      check (
        jsonb_typeof(maintenance_checklist) = 'array'
        and jsonb_array_length(maintenance_checklist) <= 40
      );
  end if;
end;
$$;
create index if not exists asset_infrastructure_service_task_idx
  on public.asset_infrastructure (service_task_template_id)
  where service_task_template_id is not null;

-- A done occurrence of a device's maintenance task counts as maintenance.
create or replace function public.service_task_log_infrastructure_maintenance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_infra record;
  v_done integer;
  v_total integer;
begin
  if new.status <> 'done' or old.status = 'done' then
    return new;
  end if;
  for v_infra in
    select infra.asset_id, infra.tenant_id
    from public.asset_infrastructure infra
    where infra.service_task_template_id = new.template_id
      and infra.tenant_id = new.tenant_id
  loop
    select
      count(*) filter (where coalesce((item ->> 'done')::boolean, false)),
      count(*)
    into v_done, v_total
    from jsonb_array_elements(
      case when jsonb_typeof(new.checklist) = 'array' then new.checklist else '[]'::jsonb end
    ) item;
    insert into public.asset_maintenance_log (tenant_id, asset_id, performed_on, kind, note, actor_id)
    values (
      v_infra.tenant_id,
      v_infra.asset_id,
      coalesce((new.completed_at at time zone 'Europe/Zurich')::date, current_date),
      'maintenance',
      left(
        'Wartung gemäss Checkliste erledigt (Serviceaufgabe'
          || case when v_total > 0 then ', ' || v_done || '/' || v_total || ' Punkte' else '' end
          || ')'
          || case when nullif(btrim(coalesce(new.note, '')), '') is not null
               then ': ' || btrim(new.note) else '' end,
        2000
      ),
      new.completed_by
    );
    update public.asset_infrastructure
    set last_maintenance_on = greatest(
          coalesce(last_maintenance_on, date '2000-01-01'),
          coalesce((new.completed_at at time zone 'Europe/Zurich')::date, current_date)
        ),
        updated_at = timezone('utc', now())
    where asset_id = v_infra.asset_id;
  end loop;
  return new;
end;
$$;
revoke all on function public.service_task_log_infrastructure_maintenance()
  from public, anon, authenticated;

create or replace trigger service_task_occurrences_infrastructure_maintenance
  after update of status on public.service_task_occurrences
  for each row execute function public.service_task_log_infrastructure_maintenance();

do $$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  for v_job_id in select jobid from cron.job where jobname = 'nextdesk-maintenance-announce'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'nextdesk-maintenance-announce',
    '23 * * * *',
    'select public.maintenance_announce_run();'
  );
exception when others then
  null;
end;
$$;

commit;
