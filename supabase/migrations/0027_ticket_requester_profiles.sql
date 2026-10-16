begin;
set local search_path = pg_catalog, public;

-- A requester profile is deliberately separate from the immutable requester
-- identity. Existing requester IDs and ticket requester_contact_id relations
-- remain unchanged while every profile is bound to the same tenant/contact pair.
create table public.ticket_requester_profiles (
  requester_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location text,
  department text,
  language text collate "C",
  preferred_contact_channel text collate "C",
  important_note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ticket_requester_profiles_requester_tenant_fk
    foreign key (requester_id, tenant_id)
    references public.ticket_requesters (id, tenant_id) on delete cascade,
  constraint ticket_requester_profiles_location_valid
    check (
      location is null or (
        char_length(location) between 1 and 120
        and location = btrim(location)
        and location !~ '[[:cntrl:]]'
      )
    ),
  constraint ticket_requester_profiles_department_valid
    check (
      department is null or (
        char_length(department) between 1 and 120
        and department = btrim(department)
        and department !~ '[[:cntrl:]]'
      )
    ),
  constraint ticket_requester_profiles_language_valid
    check (
      language is null or (
        char_length(language) between 2 and 35
        and language = lower(language)
        and language ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$'
      )
    ),
  constraint ticket_requester_profiles_contact_channel_valid
    check (
      preferred_contact_channel is null
      or preferred_contact_channel in ('email', 'phone', 'portal', 'chat', 'sms')
    ),
  constraint ticket_requester_profiles_important_note_valid
    check (
      important_note is null or (
        char_length(important_note) between 1 and 2000
        and important_note = btrim(important_note)
        and important_note !~ '[[:cntrl:]]'
      )
    )
);

create index ticket_requester_profiles_tenant_updated_idx
  on public.ticket_requester_profiles (tenant_id, updated_at desc);

create or replace function public.validate_ticket_requester_profile_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'ticket_requester_profiles' then
    raise exception 'Invalid trigger target' using errcode = '22023';
  end if;

  -- The requester identity is tenant-bound and immutable. A different person
  -- must receive a different profile rather than moving existing profile data.
  if tg_op = 'UPDATE' and (
    new.requester_id is distinct from old.requester_id
    or new.tenant_id is distinct from old.tenant_id
  ) then
    raise exception 'Requester profile identity is immutable' using errcode = '23514';
  end if;

  new.location := nullif(btrim(new.location), '');
  new.department := nullif(btrim(new.department), '');
  new.language := nullif(lower(btrim(new.language)), '');
  new.preferred_contact_channel := nullif(lower(btrim(new.preferred_contact_channel)), '');
  new.important_note := nullif(btrim(new.important_note), '');
  return new;
end;
$$;

create trigger ticket_requester_profiles_validate_change
  before insert or update on public.ticket_requester_profiles
  for each row execute function public.validate_ticket_requester_profile_change();
create trigger ticket_requester_profiles_updated_at
  before update on public.ticket_requester_profiles
  for each row execute function public.set_updated_at();

create or replace function public.audit_ticket_requester_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_requester_id uuid;
  v_before_data jsonb;
  v_after_data jsonb;
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'ticket_requester_profiles' then
    raise exception 'Invalid trigger target' using errcode = '22023';
  end if;

  if tg_op <> 'INSERT' then
    v_tenant_id := old.tenant_id;
    v_requester_id := old.requester_id;
    v_before_data := jsonb_build_object('requester_id', old.requester_id);
  end if;
  if tg_op <> 'DELETE' then
    v_tenant_id := new.tenant_id;
    v_requester_id := new.requester_id;
    v_after_data := jsonb_build_object('requester_id', new.requester_id);
  end if;

  -- Profile values can contain sensitive information. Audit records only carry
  -- the stable requester ID and never serialize profile fields or changed values.
  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity,
    before_data, after_data, metadata
  ) values (
    v_tenant_id, auth.uid(), 'ticket.requester_profile.' || lower(tg_op),
    'ticket_requester_profile', v_requester_id, 'info',
    v_before_data, v_after_data,
    jsonb_build_object('requester_id', v_requester_id)
  );
  return null;
end;
$$;

create trigger ticket_requester_profiles_audit_changes
  after insert or update or delete on public.ticket_requester_profiles
  for each row execute function public.audit_ticket_requester_profile_changes();

alter table public.ticket_requester_profiles enable row level security;

-- Reuse the contact-management authorization model. Requester profiles are
-- tenant-wide metadata and must not be readable by ordinary portal users.
create policy ticket_requester_profiles_select_authorized
  on public.ticket_requester_profiles
  for select to authenticated
  using (public.can_manage_ticket_requesters(tenant_id));
create policy ticket_requester_profiles_insert_authorized
  on public.ticket_requester_profiles
  for insert to authenticated
  with check (public.can_manage_ticket_requesters(tenant_id));
create policy ticket_requester_profiles_update_authorized
  on public.ticket_requester_profiles
  for update to authenticated
  using (public.can_manage_ticket_requesters(tenant_id))
  with check (public.can_manage_ticket_requesters(tenant_id));

revoke all on table public.ticket_requester_profiles from public, anon, authenticated;
grant select, insert, update on table public.ticket_requester_profiles to authenticated;
grant select, insert, update, delete on table public.ticket_requester_profiles to service_role;

revoke all on function public.validate_ticket_requester_profile_change() from public, anon, authenticated;
revoke all on function public.audit_ticket_requester_profile_changes() from public, anon, authenticated;

comment on table public.ticket_requester_profiles is
  'Tenant-isolated optional requester metadata. Profile values are intentionally excluded from audit payloads.';
comment on column public.ticket_requester_profiles.important_note is
  'Sensitive requester note. Never serialize this value into audit data.';

commit;
