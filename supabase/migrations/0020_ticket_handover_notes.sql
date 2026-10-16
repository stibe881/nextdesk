begin;

-- Keep object lookup deterministic while this migration creates security-definer
-- trigger functions. Every application relation is schema-qualified below.
set local search_path = pg_catalog, public;

create table if not exists public.ticket_handover_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null,
  author_id uuid not null default auth.uid(),
  summary text not null
    constraint ticket_handover_notes_summary_length_check
      check (char_length(btrim(summary)) between 3 and 2000),
  next_steps text
    constraint ticket_handover_notes_next_steps_length_check
      check (next_steps is null or char_length(next_steps) <= 3000),
  risk_level text not null default 'medium'
    constraint ticket_handover_notes_risk_level_check
      check (risk_level in ('low', 'medium', 'high')),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  resolved_by uuid,
  constraint ticket_handover_notes_acknowledgement_pair_check
    check ((acknowledged_at is null) = (acknowledged_by is null)),
  constraint ticket_handover_notes_resolution_pair_check
    check ((resolved_at is null) = (resolved_by is null)),
  constraint ticket_handover_notes_ticket_tenant_fk
    foreign key (ticket_id, tenant_id)
    references public.tickets (id, tenant_id)
    on delete cascade,
  constraint ticket_handover_notes_author_tenant_fk
    foreign key (tenant_id, author_id)
    references public.tenant_memberships (tenant_id, user_id)
    on delete restrict,
  constraint ticket_handover_notes_acknowledger_tenant_fk
    foreign key (tenant_id, acknowledged_by)
    references public.tenant_memberships (tenant_id, user_id)
    on delete restrict,
  constraint ticket_handover_notes_resolver_tenant_fk
    foreign key (tenant_id, resolved_by)
    references public.tenant_memberships (tenant_id, user_id)
    on delete restrict
);

-- The guarded ALTERs also make the migration safe to reapply when an earlier
-- interrupted manual deployment created the relation without all safeguards.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.ticket_handover_notes'::regclass
      and conname = 'ticket_handover_notes_ticket_tenant_fk'
  ) then
    alter table public.ticket_handover_notes
      add constraint ticket_handover_notes_ticket_tenant_fk
      foreign key (ticket_id, tenant_id)
      references public.tickets (id, tenant_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.ticket_handover_notes'::regclass
      and conname = 'ticket_handover_notes_author_tenant_fk'
  ) then
    alter table public.ticket_handover_notes
      add constraint ticket_handover_notes_author_tenant_fk
      foreign key (tenant_id, author_id)
      references public.tenant_memberships (tenant_id, user_id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.ticket_handover_notes'::regclass
      and conname = 'ticket_handover_notes_acknowledger_tenant_fk'
  ) then
    alter table public.ticket_handover_notes
      add constraint ticket_handover_notes_acknowledger_tenant_fk
      foreign key (tenant_id, acknowledged_by)
      references public.tenant_memberships (tenant_id, user_id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.ticket_handover_notes'::regclass
      and conname = 'ticket_handover_notes_resolver_tenant_fk'
  ) then
    alter table public.ticket_handover_notes
      add constraint ticket_handover_notes_resolver_tenant_fk
      foreign key (tenant_id, resolved_by)
      references public.tenant_memberships (tenant_id, user_id)
      on delete restrict;
  end if;
end;
$$;

create index if not exists ticket_handover_notes_ticket_created_idx
  on public.ticket_handover_notes (tenant_id, ticket_id, created_at desc);
create index if not exists ticket_handover_notes_unacknowledged_idx
  on public.ticket_handover_notes (tenant_id, ticket_id, created_at desc)
  where acknowledged_at is null;
create index if not exists ticket_handover_notes_unresolved_risk_idx
  on public.ticket_handover_notes (tenant_id, ticket_id, risk_level, created_at desc)
  where resolved_at is null;
create index if not exists ticket_handover_notes_author_idx
  on public.ticket_handover_notes (tenant_id, author_id, created_at desc);

-- Identity fields and the tenant/ticket relationship cannot be repointed. An
-- acknowledgement or resolution may only be attributed to the current actor
-- when that state changes; this still lets another authorized agent edit a
-- previously acknowledged/resolved note without taking over its attribution.
create or replace function public.validate_ticket_handover_note_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'ticket_handover_notes' then
    raise exception 'Unsupported ticket handover note trigger target'
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    if new.author_id is null or new.author_id is distinct from auth.uid() then
      raise exception 'Ticket handover note author must be the current actor'
        using errcode = '42501';
    end if;

    if new.acknowledged_by is not null
      and new.acknowledged_by is distinct from auth.uid() then
      raise exception 'Ticket handover acknowledgement must be attributed to the current actor'
        using errcode = '42501';
    end if;

    if new.resolved_by is not null
      and new.resolved_by is distinct from auth.uid() then
      raise exception 'Ticket handover resolution must be attributed to the current actor'
        using errcode = '42501';
    end if;

    return new;
  end if;

  if tg_op <> 'UPDATE' then
    raise exception 'Unsupported ticket handover note trigger operation'
      using errcode = '22023';
  end if;

  if new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.ticket_id is distinct from old.ticket_id then
    raise exception 'Ticket handover note identity is immutable'
      using errcode = '23514';
  end if;

  if new.author_id is distinct from old.author_id then
    raise exception 'Ticket handover note author is immutable'
      using errcode = '23514';
  end if;

  if new.created_at is distinct from old.created_at then
    raise exception 'Ticket handover note creation timestamp is immutable'
      using errcode = '23514';
  end if;

  if new.acknowledged_at is distinct from old.acknowledged_at
    or new.acknowledged_by is distinct from old.acknowledged_by then
    if new.acknowledged_at is null
      or new.acknowledged_by is null
      or new.acknowledged_by is distinct from auth.uid() then
      raise exception 'Ticket handover acknowledgement must be set together by the current actor'
        using errcode = '42501';
    end if;
  end if;

  if new.resolved_at is distinct from old.resolved_at
    or new.resolved_by is distinct from old.resolved_by then
    if new.resolved_at is null
      or new.resolved_by is null
      or new.resolved_by is distinct from auth.uid() then
      raise exception 'Ticket handover resolution must be set together by the current actor'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.audit_ticket_handover_note_changes()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  before_row jsonb;
  after_row jsonb;
  affected_row jsonb;
  affected_tenant_id uuid;
  affected_note_id uuid;
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'ticket_handover_notes' then
    raise exception 'Unsupported ticket handover note audit target'
      using errcode = '22023';
  end if;

  if tg_op <> 'INSERT' then
    before_row := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    after_row := to_jsonb(new);
  end if;

  affected_row := coalesce(after_row, before_row);
  affected_tenant_id := (affected_row ->> 'tenant_id')::uuid;
  affected_note_id := (affected_row ->> 'id')::uuid;

  -- Do not create an orphaned audit record while tenant-cascade deletion is
  -- already removing the parent tenant and its audit trail.
  if exists (select 1 from public.tenants where id = affected_tenant_id) then
    insert into public.audit_logs (
      tenant_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      severity,
      before_data,
      after_data,
      metadata
    ) values (
      affected_tenant_id,
      auth.uid(),
      'ticket_handover_notes.' || lower(tg_op),
      'ticket_handover_note',
      affected_note_id,
      'info',
      before_row,
      after_row,
      jsonb_build_object(
        'table', tg_table_name,
        'operation', tg_op,
        'ticket_id', affected_row -> 'ticket_id'
      )
    );
  end if;

  return null;
end;
$$;

revoke all on function public.validate_ticket_handover_note_change()
  from public, anon, authenticated;
revoke all on function public.audit_ticket_handover_note_changes()
  from public, anon, authenticated;

drop trigger if exists ticket_handover_notes_validate_change
  on public.ticket_handover_notes;
create trigger ticket_handover_notes_validate_change
before insert or update on public.ticket_handover_notes
for each row execute function public.validate_ticket_handover_note_change();

drop trigger if exists ticket_handover_notes_audit_changes
  on public.ticket_handover_notes;
create trigger ticket_handover_notes_audit_changes
after insert or update or delete on public.ticket_handover_notes
for each row execute function public.audit_ticket_handover_note_changes();

alter table public.ticket_handover_notes enable row level security;

-- Do not rely on implicit privileges: only authenticated API clients and the
-- server-side service role receive table privileges, and every client action
-- remains constrained by the policies below.
revoke all on table public.ticket_handover_notes from public, anon, authenticated;
grant select, insert, update, delete on table public.ticket_handover_notes
  to authenticated, service_role;

drop policy if exists ticket_handover_notes_select_readable
  on public.ticket_handover_notes;
create policy ticket_handover_notes_select_readable
on public.ticket_handover_notes
for select to authenticated
using (
  public.is_active_tenant_member(tenant_id)
  and public.can_read_ticket(ticket_id)
);

drop policy if exists ticket_handover_notes_insert_authorized
  on public.ticket_handover_notes;
create policy ticket_handover_notes_insert_authorized
on public.ticket_handover_notes
for insert to authenticated
with check (
  author_id = auth.uid()
  and public.is_active_tenant_member(tenant_id)
  and (acknowledged_by is null or acknowledged_by = auth.uid())
  and (resolved_by is null or resolved_by = auth.uid())
  and exists (
    select 1
    from public.tickets as ticket
    where ticket.id = ticket_id
      and ticket.tenant_id = tenant_id
      and public.has_ticket_permission(
        ticket.tenant_id,
        ticket.department_id,
        'ticket.update'
      )
  )
);

drop policy if exists ticket_handover_notes_update_authorized
  on public.ticket_handover_notes;
create policy ticket_handover_notes_update_authorized
on public.ticket_handover_notes
for update to authenticated
using (
  exists (
    select 1
    from public.tickets as ticket
    where ticket.id = ticket_id
      and ticket.tenant_id = tenant_id
      and public.has_ticket_permission(
        ticket.tenant_id,
        ticket.department_id,
        'ticket.update'
      )
  )
)
with check (
  public.is_active_tenant_member(tenant_id)
  and exists (
    select 1
    from public.tickets as ticket
    where ticket.id = ticket_id
      and ticket.tenant_id = tenant_id
      and public.has_ticket_permission(
        ticket.tenant_id,
        ticket.department_id,
        'ticket.update'
      )
  )
);

drop policy if exists ticket_handover_notes_delete_authorized
  on public.ticket_handover_notes;
create policy ticket_handover_notes_delete_authorized
on public.ticket_handover_notes
for delete to authenticated
using (
  exists (
    select 1
    from public.tickets as ticket
    where ticket.id = ticket_id
      and ticket.tenant_id = tenant_id
      and public.has_ticket_permission(
        ticket.tenant_id,
        ticket.department_id,
        'ticket.update'
      )
  )
);

commit;
