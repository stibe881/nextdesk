begin;

-- Lizenzen werden wie Verträge verwaltet: gleiche Rolle ("Verträge"), gleiche
-- Berechtigung (contracts.manage) und gleicher Funktionsschalter
-- (contracts.management). Der Zugriff läuft ausschliesslich über die Edge
-- Function "licenses"; die Tabelle ist für Browser-Rollen gesperrt.
create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null check (
    char_length(btrim(title)) between 3 and 240
    and title = btrim(title)
    and title !~ '[[:cntrl:]]'
  ),
  vendor_name text not null check (
    char_length(btrim(vendor_name)) between 2 and 160
    and vendor_name = btrim(vendor_name)
    and vendor_name !~ '[[:cntrl:]]'
  ),
  reference_number text check (
    reference_number is null or (
      char_length(btrim(reference_number)) between 1 and 120
      and reference_number = btrim(reference_number)
      and reference_number !~ '[[:cntrl:]]'
    )
  ),
  license_type text not null default 'subscription'
    check (license_type in ('subscription', 'perpetual', 'volume', 'open_source', 'other')),
  quantity integer check (quantity between 1 and 1000000),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'terminated', 'archived')),
  starts_on date,
  ends_on date,
  notice_period_days integer check (notice_period_days between 0 and 3650),
  responsible_user_id uuid references public.user_profiles(id) on delete set null,
  notes text check (
    notes is null or (
      char_length(btrim(notes)) <= 2000
      and notes = btrim(notes)
      and notes !~ '[[:cntrl:]]'
    )
  ),
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  updated_by uuid not null references public.user_profiles(id) on delete restrict,
  archived_by uuid references public.user_profiles(id) on delete restrict,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint licenses_id_tenant_unique unique (id, tenant_id),
  constraint licenses_end_after_start check (ends_on is null or starts_on is null or ends_on >= starts_on),
  constraint licenses_archive_metadata check (
    (status = 'archived' and archived_at is not null and archived_by is not null)
    or (status <> 'archived' and archived_at is null and archived_by is null)
  )
);

create unique index licenses_tenant_reference_unique
  on public.licenses (tenant_id, reference_number)
  where reference_number is not null;
create index licenses_tenant_status_end_idx
  on public.licenses (tenant_id, status, ends_on);
create index licenses_tenant_responsible_idx
  on public.licenses (tenant_id, responsible_user_id)
  where responsible_user_id is not null;

create or replace function public.validate_license_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'licenses' then
    raise exception 'Invalid license trigger target' using errcode = '22023';
  end if;
  if new.responsible_user_id is not null and not exists (
    select 1 from public.tenant_memberships membership
    where membership.tenant_id = new.tenant_id
      and membership.user_id = new.responsible_user_id
      and membership.status = 'active'
  ) then
    raise exception 'License responsible user must be an active tenant member' using errcode = '23503';
  end if;

  if tg_op = 'INSERT' then
    if new.created_by is null or new.updated_by is null or new.created_by <> new.updated_by then
      raise exception 'License actor is required' using errcode = '22023';
    end if;
    if new.status not in ('draft', 'active') then
      raise exception 'License must start as draft or active' using errcode = '22023';
    end if;
  else
    if new.id <> old.id
      or new.tenant_id <> old.tenant_id
      or new.created_by <> old.created_by
      or new.created_at <> old.created_at then
      raise exception 'Immutable license identity changed' using errcode = '22023';
    end if;
    if old.status = 'archived' then
      raise exception 'Archived licenses are terminal' using errcode = '22023';
    end if;
    if not (
      new.status = old.status
      or (old.status = 'draft' and new.status in ('active', 'archived'))
      or (old.status = 'active' and new.status in ('terminated', 'archived'))
      or (old.status = 'terminated' and new.status = 'archived')
    ) then
      raise exception 'Invalid license status transition' using errcode = '22023';
    end if;
  end if;

  if new.status = 'archived' then
    if new.archived_by is null then
      new.archived_by := new.updated_by;
    end if;
    if new.archived_by <> new.updated_by then
      raise exception 'Archive actor must match update actor' using errcode = '22023';
    end if;
    if new.archived_at is null then
      new.archived_at := timezone('utc', now());
    end if;
  else
    new.archived_by := null;
    new.archived_at := null;
  end if;
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create or replace function public.audit_license_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.licenses%rowtype;
  v_previous_status text;
begin
  v_row := coalesce(new, old);
  v_previous_status := case when tg_op = 'INSERT' then null else old.status end;
  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  ) values (
    v_row.tenant_id,
    coalesce(new.updated_by, old.updated_by),
    'license.' || lower(tg_op),
    'license',
    v_row.id,
    'info',
    jsonb_build_object(
      'operation', tg_op,
      'previous_status', v_previous_status,
      'next_status', v_row.status,
      'archived', v_row.status = 'archived'
    )
  );
  return null;
end;
$$;
revoke all on function public.validate_license_change() from public, anon, authenticated;
revoke all on function public.audit_license_change() from public, anon, authenticated;

drop trigger if exists licenses_validate_change on public.licenses;
create trigger licenses_validate_change
  before insert or update on public.licenses
  for each row execute function public.validate_license_change();
drop trigger if exists licenses_audit_changes on public.licenses;
create trigger licenses_audit_changes
  after insert or update on public.licenses
  for each row execute function public.audit_license_change();

alter table public.licenses enable row level security;
revoke all on table public.licenses from public, anon, authenticated, service_role;
grant select, insert, update on table public.licenses to service_role;

comment on table public.licenses is
  'Tenant-isolated license metadata. Browser roles use the licenses Edge Function; no license keys, files or payment data are stored here.';

commit;
