begin;
set local search_path = pg_catalog, public;

-- Store a real requester independently of the authenticated creator/service
-- account retained in tickets.requester_id for account-less email requests.
-- This deliberately accepts ASCII mailbox addresses (IDN domains use punycode),
-- not quoted local parts, display-name headers or internationalized mailboxes.
create or replace function public.normalize_ticket_requester_email(p_email text)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_email text;
begin
  -- Reject controls BEFORE trimming: CR/LF and tabs must never be hidden by
  -- normalization. Only surrounding ordinary spaces are accepted and trimmed.
  if p_email collate "C" ~ '[[:cntrl:]]' then
    raise exception 'Invalid requester email' using errcode = '23514';
  end if;

  v_email := lower(btrim(p_email) collate "C");
  if octet_length(v_email) not between 3 and 254
    or octet_length(split_part(v_email, '@', 1)) > 64
    or v_email collate "C" ~ '[[:space:][:cntrl:]]'
    or v_email collate "C" !~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  then
    -- Never include the supplied address in an exception or audit payload.
    raise exception 'Invalid requester email' using errcode = '23514';
  end if;

  return v_email;
end;
$$;

create table public.ticket_requesters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references public.user_profiles(id) on delete restrict,
  email text collate "C",
  display_name text not null default 'Anfragende Person',
  source text not null default 'manual',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ticket_requesters_id_tenant_unique unique (id, tenant_id),
  constraint ticket_requesters_email_normalized
    check (email is null or email = public.normalize_ticket_requester_email(email)),
  constraint ticket_requesters_display_name_valid
    check (char_length(display_name) between 1 and 240 and btrim(display_name) <> ''),
  constraint ticket_requesters_source_valid
    check (source in ('portal', 'manual', 'email'))
);

-- The NULL predicates are essential: several account-less contacts may coexist,
-- but a normalized address or user may belong to only one contact per tenant.
-- C collation avoids locale-dependent identity comparisons for mailbox keys.
create unique index ticket_requesters_tenant_user_unique
  on public.ticket_requesters (tenant_id, user_id) where user_id is not null;
create unique index ticket_requesters_tenant_email_unique
  on public.ticket_requesters (tenant_id, email) where email is not null;

create or replace function public.validate_ticket_requester_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'ticket_requesters' then
    raise exception 'Invalid trigger target' using errcode = '22023';
  end if;

  -- A contact's tenant and account binding are immutable, even for service-role
  -- writes. Otherwise changing a contact could invalidate already stored tickets
  -- without running the ticket trigger. Reassignment uses another contact ID.
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.user_id is distinct from old.user_id
  ) then
    raise exception 'Requester contact identity is immutable' using errcode = '23514';
  end if;

  new.email := public.normalize_ticket_requester_email(new.email);
  new.display_name := coalesce(nullif(btrim(new.display_name), ''), 'Anfragende Person');
  return new;
end;
$$;

create trigger ticket_requesters_validate_change
  before insert or update on public.ticket_requesters
  for each row execute function public.validate_ticket_requester_change();
create trigger ticket_requesters_updated_at
  before update on public.ticket_requesters
  for each row execute function public.set_updated_at();

create or replace function public.audit_ticket_requester_changes()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_contact_id uuid;
  v_source text;
  v_before_data jsonb;
  v_after_data jsonb;
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'ticket_requesters' then
    raise exception 'Invalid trigger target' using errcode = '22023';
  end if;

  if tg_op <> 'INSERT' then
    v_before_data := jsonb_build_object('contact_id', old.id, 'source', old.source);
    v_tenant_id := old.tenant_id;
    v_contact_id := old.id;
    v_source := old.source;
  end if;
  if tg_op <> 'DELETE' then
    v_after_data := jsonb_build_object('contact_id', new.id, 'source', new.source);
    v_tenant_id := new.tenant_id;
    v_contact_id := new.id;
    v_source := new.source;
  end if;

  -- Do not serialize the row: neither email, display_name nor user_id belongs
  -- in the audit log. Names can themselves contain email addresses.
  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity,
    before_data, after_data, metadata
  ) values (
    v_tenant_id, auth.uid(), 'ticket.requester.' || lower(tg_op),
    'ticket_requester', v_contact_id, 'info', v_before_data, v_after_data,
    jsonb_build_object('contact_id', v_contact_id, 'source', v_source)
  );
  return null;
end;
$$;

create trigger ticket_requesters_audit_changes
  after insert or update or delete on public.ticket_requesters
  for each row execute function public.audit_ticket_requester_changes();

alter table public.tickets add column requester_contact_id uuid;

-- One deterministic historical contact per (tenant, requester_id), including
-- users no longer active in the tenant. Never infer an email from auth.users or
-- from a ticket description. Email-era service users cannot safely be resolved
-- to an external sender from the old schema, so those contacts stay user-bound.
-- Stable IDs/timestamps and portal-first source selection do not depend on the
-- order in which historical tickets happen to be read.
insert into public.ticket_requesters (
  id, tenant_id, user_id, email, display_name, source, created_at, updated_at
)
select
  md5('nextdesk:ticket-requester:' || ticket.tenant_id::text || ':' || ticket.requester_id::text)::uuid,
  ticket.tenant_id,
  ticket.requester_id,
  null,
  coalesce(nullif(left(btrim(profile.display_name), 240), ''), 'Anfragende Person'),
  case when bool_or(ticket.source = 'portal') then 'portal' else 'manual' end,
  min(ticket.created_at),
  max(ticket.updated_at)
from public.tickets as ticket
join public.user_profiles as profile on profile.id = ticket.requester_id
group by ticket.tenant_id, ticket.requester_id, profile.display_name;

update public.tickets as ticket
set requester_contact_id = contact.id
from public.ticket_requesters as contact
where contact.tenant_id = ticket.tenant_id and contact.user_id = ticket.requester_id;

alter table public.tickets
  add constraint tickets_requester_contact_tenant_fk
  foreign key (requester_contact_id, tenant_id)
  references public.ticket_requesters (id, tenant_id) on delete restrict;
alter table public.tickets alter column requester_contact_id set not null;
create index tickets_requester_contact_tenant_idx
  on public.tickets (tenant_id, requester_contact_id);

-- Private, concurrency-safe resolver for legacy account-based ticket creation.
-- It never guesses or copies an email, overwrites a contact or changes its source.
-- Untrusted clients cannot invoke this SECURITY DEFINER helper directly.
create or replace function public.ensure_ticket_user_requester(
  p_tenant_id uuid,
  p_user_id uuid,
  p_source text default 'portal'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_contact_id uuid;
  v_display_name text;
begin
  if p_tenant_id is null or p_user_id is null
    or p_source is null or p_source not in ('portal', 'manual') then
    raise exception 'Invalid user requester arguments' using errcode = '22023';
  end if;

  select contact.id into v_contact_id
  from public.ticket_requesters as contact
  where contact.tenant_id = p_tenant_id and contact.user_id = p_user_id
  for share;
  if found then
    return v_contact_id;
  end if;

  select coalesce(nullif(left(btrim(profile.display_name), 240), ''), 'Anfragende Person')
  into v_display_name
  from public.user_profiles as profile where profile.id = p_user_id;
  if not found then
    raise exception 'Requester user profile not found' using errcode = '23503';
  end if;

  insert into public.ticket_requesters (tenant_id, user_id, display_name, source)
  values (p_tenant_id, p_user_id, v_display_name, p_source)
  on conflict (tenant_id, user_id) where user_id is not null do nothing
  returning id into v_contact_id;

  -- DO NOTHING + a fresh statement avoids a needless update/audit entry and
  -- sees a concurrent winner under READ COMMITTED. Stronger isolation may
  -- require retrying the whole transaction rather than returning NULL.
  if v_contact_id is null then
    select contact.id into v_contact_id
    from public.ticket_requesters as contact
    where contact.tenant_id = p_tenant_id and contact.user_id = p_user_id
    for share;
    if not found then
      raise exception 'Retry requester contact resolution' using errcode = '40001';
    end if;
  end if;
  return v_contact_id;
end;
$$;

create or replace function public.validate_ticket_requester_contact()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_contact_user_id uuid;
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'tickets' then
    raise exception 'Invalid trigger target' using errcode = '22023';
  end if;

  if new.requester_contact_id is null then
    -- Keep existing portal/manual account-based INSERTs compatible, but make
    -- the contact explicit in the stored row. Email intake MUST supply the
    -- real sender contact; silently using the service account is forbidden.
    if tg_op <> 'INSERT' or new.source = 'email' then
      raise exception 'An explicit requester contact is required' using errcode = '23502';
    end if;
    new.requester_contact_id := public.ensure_ticket_user_requester(
      new.tenant_id, new.requester_id,
      case when new.source = 'portal' then 'portal' else 'manual' end
    );
  end if;

  -- FOR SHARE serializes validation with contact deletion/edits. The composite
  -- FK is an additional tenant boundary, including for service-role writes.
  select contact.user_id into v_contact_user_id
  from public.ticket_requesters as contact
  where contact.id = new.requester_contact_id and contact.tenant_id = new.tenant_id
  for share;
  if not found then
    raise exception 'Requester contact must belong to the ticket tenant' using errcode = '23503';
  end if;
  if v_contact_user_id is not null and new.requester_id is distinct from v_contact_user_id then
    raise exception 'Ticket requester must match the contact user' using errcode = '23514';
  end if;
  -- A contact with user_id IS NULL is email-bound; requester_id may then be
  -- the creator or service account, while requester_contact_id is the sender.
  return new;
end;
$$;

create trigger tickets_validate_requester_contact
  before insert or update of tenant_id, requester_id, requester_contact_id, source on public.tickets
  for each row execute function public.validate_ticket_requester_contact();

create or replace function public.audit_ticket_requester_contact_changes()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_before_data jsonb;
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'tickets' then
    raise exception 'Invalid trigger target' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if new.requester_contact_id is not distinct from old.requester_contact_id
      and new.requester_id is not distinct from old.requester_id
      and new.tenant_id is not distinct from old.tenant_id
      and new.source is not distinct from old.source then
      return null;
    end if;
    v_before_data := jsonb_build_object('contact_id', old.requester_contact_id, 'source', old.source);
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity,
    before_data, after_data, metadata
  ) values (
    new.tenant_id, auth.uid(), 'ticket.requester_contact.' || lower(tg_op),
    'ticket', new.id, 'info', v_before_data,
    jsonb_build_object('contact_id', new.requester_contact_id, 'source', new.source),
    jsonb_build_object('contact_id', new.requester_contact_id, 'source', new.source)
  );
  return null;
end;
$$;

create trigger tickets_audit_requester_contact_changes
  after insert or update of tenant_id, requester_id, requester_contact_id, source on public.tickets
  for each row execute function public.audit_ticket_requester_contact_changes();

-- Contacts are tenant-wide, not department-specific. A tenant ticket editor or
-- an editor with effective ticket.update in an active department may manage
-- them. Use the existing RBAC helpers so inactive/expired roles and department
-- memberships cannot accidentally authorize contact mutations.
create or replace function public.can_manage_ticket_requesters(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select auth.uid() is not null
    and public.is_active_tenant_member(p_tenant_id)
    and (
      public.has_tenant_permission(p_tenant_id, 'ticket.update')
      or exists (
        select 1 from public.departments as department
        where department.tenant_id = p_tenant_id and department.active
          and public.has_ticket_permission(p_tenant_id, department.id, 'ticket.update')
      )
    );
$$;

alter table public.ticket_requesters enable row level security;

create policy ticket_requesters_select_member on public.ticket_requesters
  for select to authenticated
  using (auth.uid() is not null and public.is_active_tenant_member(tenant_id));

create policy ticket_requesters_insert_authorized on public.ticket_requesters
  for insert to authenticated
  with check (
    auth.uid() is not null
    and public.is_active_tenant_member(tenant_id)
    and (
      public.can_manage_ticket_requesters(tenant_id)
      -- Portal users may create ONLY their own account-bound contact. Allowing
      -- an arbitrary email here would let them claim another sender's identity.
      or (source = 'portal' and user_id = auth.uid() and email is null)
    )
  );

create policy ticket_requesters_update_authorized on public.ticket_requesters
  for update to authenticated
  using (public.can_manage_ticket_requesters(tenant_id))
  with check (public.can_manage_ticket_requesters(tenant_id));

-- No anonymous access, no client deletion and no client execution of private
-- definer helpers. The trusted service role still uses all integrity triggers.
revoke all on table public.ticket_requesters from public, anon, authenticated;
grant select, insert, update on table public.ticket_requesters to authenticated;
grant select, insert, update, delete on table public.ticket_requesters to service_role;

revoke all on function public.normalize_ticket_requester_email(text) from public, anon, authenticated;
grant execute on function public.normalize_ticket_requester_email(text) to authenticated, service_role;
revoke all on function public.can_manage_ticket_requesters(uuid) from public, anon, authenticated;
grant execute on function public.can_manage_ticket_requesters(uuid) to authenticated, service_role;
revoke all on function public.ensure_ticket_user_requester(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ensure_ticket_user_requester(uuid, uuid, text) to service_role;
revoke all on function public.validate_ticket_requester_change() from public, anon, authenticated;
revoke all on function public.validate_ticket_requester_contact() from public, anon, authenticated;
revoke all on function public.audit_ticket_requester_changes() from public, anon, authenticated;
revoke all on function public.audit_ticket_requester_contact_changes() from public, anon, authenticated;

comment on table public.ticket_requesters is
  'Tenant-isolated requester identities. Email may identify a requester without an auth account; audit payloads contain only contact IDs and sources.';
comment on column public.tickets.requester_contact_id is
  'Explicit requester identity in the same tenant. Account-bound contacts must match requester_id; email-only contacts may retain a creator/service requester_id.';

commit;
