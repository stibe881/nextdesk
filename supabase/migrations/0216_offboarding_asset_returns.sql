begin;

set local search_path = pg_catalog, public;

-- Geräte-Rückgabe beim Austritt: pro aktiver Gerätezuweisung der austretenden
-- Person entsteht auf Wunsch eine Rückgabe-Aufgabe im Austritt. Sobald diese
-- Aufgabe erledigt ist, gilt die Zuweisung als zurückgegeben und das Gerät
-- kommt wieder an Lager.

create table if not exists public.onboarding_asset_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  task_id uuid not null,
  assignment_id uuid not null references public.asset_assignments(id) on delete cascade,
  asset_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint onboarding_asset_returns_task_unique unique (task_id),
  -- One return task per device hand-out keeps repeated requests idempotent.
  constraint onboarding_asset_returns_assignment_unique unique (assignment_id),
  constraint onboarding_asset_returns_task_tenant_fk
    foreign key (task_id, tenant_id)
    references public.onboarding_tasks (id, tenant_id) on delete cascade,
  constraint onboarding_asset_returns_asset_tenant_fk
    foreign key (asset_id, tenant_id)
    references public.assets (id, tenant_id) on delete cascade
);
create index if not exists onboarding_asset_returns_asset_idx
  on public.onboarding_asset_returns (tenant_id, asset_id);

alter table public.onboarding_asset_returns enable row level security;
revoke all on table public.onboarding_asset_returns from public, anon, authenticated;
grant all on table public.onboarding_asset_returns to service_role;

create or replace function public.onboarding_complete_asset_return()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_link record;
  v_returned integer;
  v_now timestamptz := timezone('utc', now());
begin
  if new.status <> 'completed' or old.status = 'completed' then
    return null;
  end if;
  for v_link in
    select link.assignment_id, link.asset_id, link.tenant_id
    from public.onboarding_asset_returns link
    where link.task_id = new.id and link.tenant_id = new.tenant_id
  loop
    update public.asset_assignments held
    set returned_at = greatest(v_now, held.assigned_at)
    where held.id = v_link.assignment_id
      and held.tenant_id = v_link.tenant_id
      and held.returned_at is null;
    get diagnostics v_returned = row_count;
    -- Only the return that actually closed the assignment moves the device;
    -- a device that was already handed back and reassigned stays untouched.
    if v_returned = 0 then
      continue;
    end if;
    update public.assets device
    set lifecycle_state = 'stock',
        lifecycle_changed_at = v_now
    where device.id = v_link.asset_id
      and device.tenant_id = v_link.tenant_id
      and device.lifecycle_state in ('active', 'repair');
    -- assets_record_lifecycle wrote the history row in this statement; it
    -- records the reason like the other documented transitions.
    update public.asset_lifecycle_events history
    set reason = 'Rückgabe beim Austritt'
    where history.asset_id = v_link.asset_id
      and history.tenant_id = v_link.tenant_id
      and history.next_state = 'stock'
      and history.reason is null
      and history.occurred_at = v_now;
  end loop;
  return null;
end;
$$;
revoke all on function public.onboarding_complete_asset_return() from public, anon, authenticated;

create or replace trigger onboarding_tasks_complete_asset_return
  after update of status on public.onboarding_tasks
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function public.onboarding_complete_asset_return();

commit;
