begin;

set local search_path = pg_catalog, public;

-- Software-Katalog mit Intune-Verteilung und Lizenz-Rückgewinnung
-- ----------------------------------------------------------------
-- 1. Shop-Artikel können mit einer Intune-App (mobileApp) verknüpft werden.
--    Nach der Freigabe einer Bestellung weist nextDesk die App zu: die
--    bestellende Person (bzw. ihr Gerät) wird Mitglied einer Entra-
--    Sicherheitsgruppe, der die App in Intune zugewiesen ist. Jede Zuweisung
--    ist ein Datensatz in shop_software_deployments; das Ergebnis steht als
--    Ereignis in der Bestellung.
-- 2. Lizenzen erhalten Kosten pro Platz, eine optionale Microsoft-365-SKU und
--    Zuweisungen an Personen. Zuweisungen an ausgetretene oder inaktive
--    Personen erscheinen als Rückgewinnungs-Kandidaten; ein wöchentlicher Job
--    benachrichtigt die Lizenzverantwortlichen über neue Kandidaten.

-- 1. Software im Shop
-- -------------------
alter table public.shop_catalog_items
  add column if not exists intune_app_id uuid,
  add column if not exists intune_app_name text
    check (intune_app_name is null or char_length(intune_app_name) between 1 and 240),
  add column if not exists intune_assignment_mode text
    check (intune_assignment_mode is null or intune_assignment_mode in ('user_group', 'device_group')),
  add column if not exists intune_target_group_id uuid,
  add column if not exists intune_ensure_app_assignment boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'shop_catalog_items_intune_complete'
      and conrelid = 'public.shop_catalog_items'::regclass
  ) then
    alter table public.shop_catalog_items
      add constraint shop_catalog_items_intune_complete check (
        (intune_app_id is null and intune_assignment_mode is null and intune_target_group_id is null
          and not intune_ensure_app_assignment)
        or (intune_app_id is not null and intune_assignment_mode is not null
          and intune_target_group_id is not null and kind = 'order')
      );
  end if;
end;
$$;

comment on column public.shop_catalog_items.intune_app_id is
  'Intune mobileApp id. Set: the article is software and is assigned through Intune after approval.';
comment on column public.shop_catalog_items.intune_target_group_id is
  'Entra security group that has the app assigned. user_group: the requester is added; device_group: the requester''s Intune devices are added.';
comment on column public.shop_catalog_items.intune_ensure_app_assignment is
  'When true, nextDesk also creates the mobileApp assignment (intent required) to the group if it is missing.';

create table if not exists public.shop_software_deployments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,
  order_line_id uuid not null,
  catalog_item_id uuid,
  requester_id uuid not null references public.user_profiles(id) on delete cascade,
  intune_app_id uuid not null,
  app_name text not null check (char_length(app_name) between 1 and 240),
  assignment_mode text not null check (assignment_mode in ('user_group', 'device_group')),
  target_group_id uuid not null,
  ensure_app_assignment boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'installing', 'assigned', 'failed')),
  entra_object_id uuid,
  members_added integer not null default 0 check (members_added >= 0),
  error_code text check (error_code is null or char_length(error_code) <= 60),
  error_message text check (error_message is null or char_length(error_message) <= 500),
  attempts integer not null default 0 check (attempts between 0 and 1000),
  last_attempt_at timestamptz,
  assigned_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint shop_software_deployments_line_unique unique (order_line_id),
  constraint shop_software_deployments_order_fk
    foreign key (order_id, tenant_id) references public.shop_orders (id, tenant_id) on delete cascade,
  constraint shop_software_deployments_line_fk
    foreign key (order_line_id) references public.shop_order_lines (id) on delete cascade,
  constraint shop_software_deployments_catalog_fk
    foreign key (catalog_item_id, tenant_id) references public.shop_catalog_items (id, tenant_id)
    on delete set null (catalog_item_id),
  constraint shop_software_deployments_assigned_at
    check (status <> 'assigned' or assigned_at is not null)
);

create index if not exists shop_software_deployments_order_idx
  on public.shop_software_deployments (tenant_id, order_id);
create index if not exists shop_software_deployments_open_idx
  on public.shop_software_deployments (tenant_id, status, last_attempt_at)
  where status in ('pending', 'installing', 'failed');

alter table public.shop_software_deployments enable row level security;
revoke all on table public.shop_software_deployments from public, anon, authenticated;
grant select, insert, update on table public.shop_software_deployments to service_role;

comment on table public.shop_software_deployments is
  'Intune software assignments of approved shop orders (one per order line). Service role only; the shop Edge Function runs Microsoft Graph.';

-- Creates the deployments of an approved order and claims the pending ones
-- for the caller. A deployment stuck in "installing" for more than ten
-- minutes is claimed again. Returns the claimed deployments with the
-- requester's Entra object id from the directory sync.
create or replace function public.shop_software_deployments_claim(
  p_tenant_id uuid,
  p_order_id uuid
)
returns table (
  deployment_id uuid,
  order_line_id uuid,
  requester_id uuid,
  intune_app_id uuid,
  app_name text,
  assignment_mode text,
  target_group_id uuid,
  ensure_app_assignment boolean,
  entra_object_id uuid,
  attempts integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
#variable_conflict use_column
declare
  v_order public.shop_orders%rowtype;
  v_created integer;
begin
  select * into v_order
  from public.shop_orders
  where id = p_order_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  -- Only approved, still open (or already handed out) orders are deployed.
  if v_order.status not in ('submitted', 'in_progress', 'ready', 'issued') then
    return;
  end if;

  insert into public.shop_software_deployments (
    tenant_id, order_id, order_line_id, catalog_item_id, requester_id,
    intune_app_id, app_name, assignment_mode, target_group_id, ensure_app_assignment
  )
  select line.tenant_id, line.order_id, line.id, item.id, v_order.requester_id,
         item.intune_app_id, coalesce(item.intune_app_name, line.item_name),
         item.intune_assignment_mode, item.intune_target_group_id, item.intune_ensure_app_assignment
  from public.shop_order_lines line
  join public.shop_catalog_items item
    on item.id = line.catalog_item_id and item.tenant_id = line.tenant_id
  where line.order_id = v_order.id
    and line.tenant_id = p_tenant_id
    and line.status not in ('cancelled', 'returned')
    and item.intune_app_id is not null
  on conflict on constraint shop_software_deployments_line_unique do nothing;
  get diagnostics v_created = row_count;
  if v_created > 0 then
    perform public.shop_log(p_tenant_id, v_order.id, null, 'software_queued',
      case when v_created = 1 then 'Software wird über Intune zugewiesen.'
           else v_created || ' Programme werden über Intune zugewiesen.' end, false);
  end if;

  return query
  with claimed as (
    update public.shop_software_deployments deployment
       set status = 'installing',
           attempts = deployment.attempts + 1,
           last_attempt_at = timezone('utc', now()),
           updated_at = timezone('utc', now())
     where deployment.tenant_id = p_tenant_id
       and deployment.order_id = v_order.id
       and (
         deployment.status = 'pending'
         or (deployment.status = 'installing'
             and deployment.last_attempt_at < timezone('utc', now()) - interval '10 minutes')
       )
    returning deployment.*
  )
  select claimed.id, claimed.order_line_id, claimed.requester_id, claimed.intune_app_id,
         claimed.app_name, claimed.assignment_mode, claimed.target_group_id,
         claimed.ensure_app_assignment,
         (
           select person.entra_object_id
           from public.tenant_entra_directory_people person
           where person.tenant_id = p_tenant_id
             and person.local_user_id = claimed.requester_id
           order by (person.inactive_at is null) desc, person.account_enabled desc, person.last_synced_at desc
           limit 1
         ),
         claimed.attempts
  from claimed;
end;
$$;

-- Stores the result of one deployment, writes the order event and notifies.
-- When every remaining line of the order is software and assigned, the
-- order is completed (nothing to hand out).
create or replace function public.shop_software_deployment_record(
  p_tenant_id uuid,
  p_deployment_id uuid,
  p_success boolean,
  p_entra_object_id uuid,
  p_members_added integer,
  p_error_code text,
  p_error_message text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_deployment public.shop_software_deployments%rowtype;
  v_order public.shop_orders%rowtype;
  v_now timestamptz := timezone('utc', now());
  v_open integer;
begin
  select * into v_deployment
  from public.shop_software_deployments
  where id = p_deployment_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'Deployment not found' using errcode = 'P0002';
  end if;
  if v_deployment.status = 'assigned' then
    return 'assigned';
  end if;

  if p_success then
    update public.shop_software_deployments
       set status = 'assigned', assigned_at = v_now,
           entra_object_id = coalesce(p_entra_object_id, entra_object_id),
           members_added = greatest(coalesce(p_members_added, 0), 0),
           error_code = null, error_message = null, updated_at = v_now
     where id = v_deployment.id;
    perform public.shop_log(p_tenant_id, v_deployment.order_id, null, 'software_assigned',
      format('«%s» wurde über Intune zugewiesen.', v_deployment.app_name), false);
    perform public.shop_notify(p_tenant_id, v_deployment.requester_id,
      'shop.order.software_assigned', v_deployment.order_id,
      jsonb_build_object('appName', v_deployment.app_name));

    select * into v_order from public.shop_orders where id = v_deployment.order_id for update;
    select count(*) into v_open
    from public.shop_order_lines line
    left join public.shop_software_deployments deployment
      on deployment.order_line_id = line.id and deployment.status = 'assigned'
    where line.order_id = v_order.id
      and line.status not in ('cancelled', 'returned', 'issued')
      and deployment.id is null;
    if v_open = 0 and v_order.status in ('submitted', 'in_progress', 'ready') then
      update public.shop_order_lines line
         set status = 'issued', issued_at = v_now, updated_at = v_now
        from public.shop_software_deployments deployment
       where deployment.order_line_id = line.id
         and line.order_id = v_order.id
         and line.status in ('open', 'reserved', 'backorder');
      update public.shop_orders
         set status = 'issued', issued_at = v_now, closed_at = v_now, updated_at = v_now
       where id = v_order.id;
      perform public.shop_log(p_tenant_id, v_order.id, null, 'issued',
        'Alle Programme sind zugewiesen.', false);
    end if;
    return 'assigned';
  end if;

  update public.shop_software_deployments
     set status = 'failed',
         entra_object_id = coalesce(p_entra_object_id, entra_object_id),
         error_code = left(coalesce(nullif(btrim(p_error_code), ''), 'unknown'), 60),
         error_message = left(nullif(btrim(coalesce(p_error_message, '')), ''), 500),
         updated_at = v_now
   where id = v_deployment.id;
  perform public.shop_log(p_tenant_id, v_deployment.order_id, null, 'software_failed',
    format('«%s» konnte nicht zugewiesen werden: %s', v_deployment.app_name,
      coalesce(nullif(btrim(coalesce(p_error_message, '')), ''), 'Unbekannter Fehler')), false);
  perform public.shop_notify_fulfillers(p_tenant_id, 'shop.order.software_failed',
    v_deployment.order_id, null);
  return 'failed';
end;
$$;

-- Puts a failed deployment back into the queue (agent action).
create or replace function public.shop_software_deployment_retry(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_deployment_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_deployment public.shop_software_deployments%rowtype;
begin
  if not public.shop_has_permission(p_actor_id, p_tenant_id, 'shop.fulfill') then
    raise exception 'Not allowed to process orders' using errcode = '42501';
  end if;
  select * into v_deployment
  from public.shop_software_deployments
  where id = p_deployment_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'Deployment not found' using errcode = 'P0002';
  end if;
  if v_deployment.status <> 'failed' then
    raise exception 'Only failed deployments can be retried' using errcode = '23514';
  end if;
  update public.shop_software_deployments
     set status = 'pending', error_code = null, error_message = null,
         updated_at = timezone('utc', now())
   where id = v_deployment.id;
  perform public.shop_log(p_tenant_id, v_deployment.order_id, p_actor_id, 'software_retry',
    format('Zuweisung von «%s» wird erneut versucht.', v_deployment.app_name), true);
  return v_deployment.order_id;
end;
$$;

revoke all on function public.shop_software_deployments_claim(uuid, uuid) from public, anon, authenticated;
revoke all on function public.shop_software_deployment_record(uuid, uuid, boolean, uuid, integer, text, text)
  from public, anon, authenticated;
revoke all on function public.shop_software_deployment_retry(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.shop_software_deployments_claim(uuid, uuid) to service_role;
grant execute on function public.shop_software_deployment_record(uuid, uuid, boolean, uuid, integer, text, text)
  to service_role;
grant execute on function public.shop_software_deployment_retry(uuid, uuid, uuid) to service_role;

-- 2. Lizenz-Rückgewinnung
-- -----------------------
alter table public.licenses
  add column if not exists seat_cost_amount numeric(12, 2)
    check (seat_cost_amount is null or seat_cost_amount >= 0),
  add column if not exists seat_cost_currency text not null default 'CHF'
    check (seat_cost_currency in ('CHF', 'EUR', 'USD')),
  add column if not exists seat_cost_period text
    check (seat_cost_period is null or seat_cost_period in ('monthly', 'quarterly', 'yearly', 'one_time')),
  add column if not exists m365_sku_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'licenses_seat_cost_period_required'
      and conrelid = 'public.licenses'::regclass
  ) then
    alter table public.licenses
      add constraint licenses_seat_cost_period_required
      check (seat_cost_amount is null or seat_cost_period is not null);
  end if;
end;
$$;

comment on column public.licenses.seat_cost_amount is
  'Cost of one seat (one assignment) per seat_cost_period. Used for the estimated saving of license reclamation.';
comment on column public.licenses.m365_sku_id is
  'Optional Microsoft 365 skuId. When set, returning a seat can also remove the license in Entra (Graph assignLicense).';

create table if not exists public.license_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  license_id uuid not null,
  user_id uuid references public.user_profiles(id) on delete set null,
  entra_object_id uuid,
  assignee_label text not null check (
    char_length(btrim(assignee_label)) between 1 and 200 and assignee_label = btrim(assignee_label)
  ),
  note text check (note is null or char_length(note) <= 500),
  assigned_at timestamptz not null default timezone('utc', now()),
  assigned_by uuid references public.user_profiles(id) on delete set null,
  released_at timestamptz,
  released_by uuid references public.user_profiles(id) on delete set null,
  release_reason text check (release_reason is null or char_length(release_reason) <= 500),
  m365_removed_at timestamptz,
  reclaim_notified_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint license_assignments_id_tenant_unique unique (id, tenant_id),
  constraint license_assignments_license_fk
    foreign key (license_id, tenant_id) references public.licenses (id, tenant_id) on delete cascade,
  constraint license_assignments_assignee_present
    check (user_id is not null or entra_object_id is not null),
  constraint license_assignments_release_complete
    check (released_at is null or released_at >= assigned_at)
);

create unique index if not exists license_assignments_active_user_unique
  on public.license_assignments (license_id, user_id)
  where released_at is null and user_id is not null;
create unique index if not exists license_assignments_active_entra_unique
  on public.license_assignments (license_id, entra_object_id)
  where released_at is null and entra_object_id is not null;
create index if not exists license_assignments_tenant_active_idx
  on public.license_assignments (tenant_id, license_id)
  where released_at is null;

alter table public.license_assignments enable row level security;
revoke all on table public.license_assignments from public, anon, authenticated;
grant select, insert, update on table public.license_assignments to service_role;

comment on table public.license_assignments is
  'Seats of a license assigned to people. released_at set = seat returned. Service role only; managed through the license-reclaim Edge Function.';

create table if not exists public.license_reclaim_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  inactivity_days integer not null default 60 check (inactivity_days between 7 and 365),
  use_entra_sign_in boolean not null default true,
  allow_m365_removal boolean not null default false,
  sign_ins_refreshed_at timestamptz,
  sign_ins_error text check (sign_ins_error is null or char_length(sign_ins_error) <= 200),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.license_reclaim_settings enable row level security;
revoke all on table public.license_reclaim_settings from public, anon, authenticated;
grant select, insert, update on table public.license_reclaim_settings to service_role;

comment on table public.license_reclaim_settings is
  'License reclamation settings per tenant (inactivity threshold, Entra sign-in data, optional M365 license removal). Service role only.';

-- Last interactive Entra sign-in (Graph signInActivity), refreshed on demand
-- by the license-reclaim Edge Function. Needs AuditLog.Read.All.
alter table public.tenant_entra_directory_people
  add column if not exists last_sign_in_at timestamptz,
  add column if not exists sign_in_checked_at timestamptz;

-- Stores sign-in data delivered by Graph. Rows:
-- [{"entra_object_id": "...", "last_sign_in_at": "..." | null, "account_enabled": true|false|null}]
create or replace function public.apply_entra_sign_in_activity(
  p_tenant_id uuid,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_tenant_id is null or p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Invalid sign-in payload' using errcode = '22023';
  end if;
  update public.tenant_entra_directory_people person
     set last_sign_in_at = nullif(entry ->> 'last_sign_in_at', '')::timestamptz,
         account_enabled = coalesce((entry ->> 'account_enabled')::boolean, person.account_enabled),
         sign_in_checked_at = timezone('utc', now())
    from jsonb_array_elements(p_rows) entry
   where person.tenant_id = p_tenant_id
     and person.entra_object_id = (entry ->> 'entra_object_id')::uuid;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.apply_entra_sign_in_activity(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_entra_sign_in_activity(uuid, jsonb) to service_role;

-- Monthly cost of one seat.
create or replace function public.license_seat_monthly_cost(p_amount numeric, p_period text)
returns numeric
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_amount is null then null
    when p_period = 'monthly' then round(p_amount, 2)
    when p_period = 'quarterly' then round(p_amount / 3, 2)
    when p_period = 'yearly' then round(p_amount / 12, 2)
    else 0::numeric
  end;
$$;

-- Active seats whose holder has left or no longer signs in. Reasons:
--   membership_inactive  nextDesk membership no longer active
--   entra_disabled       Entra account disabled or removed from the directory
--   offboarded           completed exit (offboarding entry with the same name, exit date reached)
--   inactive             no sign-in for p_inactivity_days (Entra sign-in when
--                        available, otherwise the last nextDesk login)
create or replace function public.license_reclaim_candidates(
  p_tenant_id uuid,
  p_inactivity_days integer default null
)
returns table (
  assignment_id uuid,
  license_id uuid,
  license_title text,
  department_id uuid,
  user_id uuid,
  entra_object_id uuid,
  assignee_label text,
  assigned_at timestamptz,
  reasons text[],
  last_sign_in_at timestamptz,
  sign_in_source text,
  monthly_saving numeric,
  currency text,
  m365_sku_id uuid,
  reclaim_notified_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
#variable_conflict use_column
declare
  v_days integer;
  v_use_entra boolean;
  v_today date := timezone('Europe/Zurich', now())::date;
begin
  select coalesce(p_inactivity_days, settings.inactivity_days), settings.use_entra_sign_in
    into v_days, v_use_entra
  from public.license_reclaim_settings settings
  where settings.tenant_id = p_tenant_id;
  v_days := greatest(coalesce(v_days, p_inactivity_days, 60), 1);
  v_use_entra := coalesce(v_use_entra, true);

  return query
  with seats as (
    select assignment.*, license.title, license.department_id as license_department,
           license.seat_cost_amount, license.seat_cost_period, license.seat_cost_currency,
           license.m365_sku_id as sku
    from public.license_assignments assignment
    join public.licenses license
      on license.id = assignment.license_id and license.tenant_id = assignment.tenant_id
    where assignment.tenant_id = p_tenant_id
      and assignment.released_at is null
      and license.status <> 'archived'
  ),
  enriched as (
    select seat.*,
           person.entra_object_id as person_object_id,
           person.account_enabled as person_enabled,
           person.inactive_at as person_inactive_at,
           person.last_sign_in_at as entra_sign_in,
           person.sign_in_checked_at as entra_checked,
           person.display_name as person_name,
           (seat.user_id is not null and not exists (
             select 1 from public.tenant_memberships membership
             where membership.tenant_id = seat.tenant_id
               and membership.user_id = seat.user_id
               and membership.status = 'active'
           )) as membership_gone,
           (
             select (to_jsonb(auth_user) ->> 'last_sign_in_at')::timestamptz
             from auth.users auth_user
             where auth_user.id = seat.user_id
           ) as app_sign_in,
           profile.display_name as profile_name
    from seats seat
    left join lateral (
      select candidate.*
      from public.tenant_entra_directory_people candidate
      where candidate.tenant_id = seat.tenant_id
        and (
          candidate.entra_object_id = seat.entra_object_id
          or (seat.entra_object_id is null and seat.user_id is not null
              and candidate.local_user_id = seat.user_id)
        )
      order by (candidate.entra_object_id = seat.entra_object_id) desc nulls last,
               (candidate.inactive_at is null) desc
      limit 1
    ) person on true
    left join public.user_profiles profile on profile.id = seat.user_id
  ),
  evaluated as (
    select enriched.*,
           case
             when v_use_entra and enriched.entra_checked is not null then enriched.entra_sign_in
             else enriched.app_sign_in
           end as effective_sign_in,
           case
             when v_use_entra and enriched.entra_checked is not null then 'entra'
             when enriched.user_id is not null then 'nextdesk'
             else null
           end as effective_source
    from enriched
  )
  select evaluated.id, evaluated.license_id, evaluated.title, evaluated.license_department,
         evaluated.user_id, coalesce(evaluated.entra_object_id, evaluated.person_object_id),
         evaluated.assignee_label, evaluated.assigned_at,
         array_remove(array[
           case when evaluated.membership_gone then 'membership_inactive' end,
           case when evaluated.person_object_id is not null
                 and (evaluated.person_enabled = false or evaluated.person_inactive_at is not null)
                then 'entra_disabled' end,
           case when exists (
             select 1 from public.onboarding_entries entry
             where entry.tenant_id = evaluated.tenant_id
               and entry.kind = 'offboarding'
               and entry.starts_on <= v_today
               and lower(btrim(entry.employee_name)) in (
                 lower(btrim(evaluated.assignee_label)),
                 lower(btrim(coalesce(evaluated.profile_name, ''))),
                 lower(btrim(coalesce(evaluated.person_name, '')))
               )
           ) then 'offboarded' end,
           case when evaluated.effective_source is not null
                 and coalesce(evaluated.effective_sign_in, evaluated.assigned_at)
                     < timezone('utc', now()) - make_interval(days => v_days)
                then 'inactive' end
         ], null),
         evaluated.effective_sign_in, evaluated.effective_source,
         public.license_seat_monthly_cost(evaluated.seat_cost_amount, evaluated.seat_cost_period),
         evaluated.seat_cost_currency, evaluated.sku, evaluated.reclaim_notified_at
  from evaluated;
end;
$$;

revoke all on function public.license_seat_monthly_cost(numeric, text) from public, anon, authenticated;
grant execute on function public.license_seat_monthly_cost(numeric, text) to service_role;
revoke all on function public.license_reclaim_candidates(uuid, integer) from public, anon, authenticated;
grant execute on function public.license_reclaim_candidates(uuid, integer) to service_role;

-- Weekly: notifies every license manager (contracts.manage) of a tenant
-- with the contracts module about seats that became candidates since the
-- last run. Each seat is reported once.
create or replace function public.license_reclaim_notify_new_candidates()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tenant uuid;
  v_ids uuid[];
  v_saving numeric;
  v_currency text;
  v_notified integer := 0;
  v_user uuid;
begin
  for v_tenant in
    select distinct assignment.tenant_id
    from public.license_assignments assignment
    join public.tenant_feature_flags flag
      on flag.tenant_id = assignment.tenant_id
     and flag.feature_key = 'contracts.management'
     and flag.enabled
     and (flag.pilot_ends_at is null or flag.pilot_ends_at > timezone('utc', now()))
    where assignment.released_at is null
  loop
    -- Seats that are no longer candidates are reported anew when they
    -- become candidates again.
    update public.license_assignments assignment
       set reclaim_notified_at = null
     where assignment.tenant_id = v_tenant
       and assignment.released_at is null
       and assignment.reclaim_notified_at is not null
       and not exists (
         select 1 from public.license_reclaim_candidates(v_tenant, null) candidate
         where candidate.assignment_id = assignment.id
           and cardinality(candidate.reasons) > 0
       );
    select array_agg(candidate.assignment_id),
           sum(coalesce(candidate.monthly_saving, 0)),
           min(candidate.currency)
      into v_ids, v_saving, v_currency
    from public.license_reclaim_candidates(v_tenant, null) candidate
    where cardinality(candidate.reasons) > 0
      and candidate.reclaim_notified_at is null;
    if v_ids is null or cardinality(v_ids) = 0 then
      continue;
    end if;
    for v_user in
      select membership.user_id
      from public.tenant_memberships membership
      where membership.tenant_id = v_tenant
        and membership.status = 'active'
        and public.has_contracts_management_permission(v_tenant, membership.user_id)
    loop
      insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
      values (v_tenant, v_user, null, 'license.reclaim_candidates',
        jsonb_build_object('count', cardinality(v_ids), 'monthlySaving', round(coalesce(v_saving, 0), 2),
          'currency', coalesce(v_currency, 'CHF')));
      v_notified := v_notified + 1;
    end loop;
    update public.license_assignments
       set reclaim_notified_at = timezone('utc', now())
     where id = any(v_ids);
  end loop;
  return v_notified;
end;
$$;

revoke all on function public.license_reclaim_notify_new_candidates() from public, anon, authenticated;
grant execute on function public.license_reclaim_notify_new_candidates() to service_role;

create or replace function public.license_assignments_touch()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create or replace trigger license_assignments_touch
before update on public.license_assignments
for each row execute function public.license_assignments_touch();

create or replace trigger shop_software_deployments_touch
before update on public.shop_software_deployments
for each row execute function public.license_assignments_touch();

do $$
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  begin
    perform cron.unschedule('nextdesk-license-reclaim');
  exception when others then
    null;
  end;
  perform cron.schedule('nextdesk-license-reclaim', '17 6 * * 1',
    'select public.license_reclaim_notify_new_candidates()');
exception when others then
  null;
end;
$$;

commit;
