begin;

set local search_path = pg_catalog, public;

-- 1. Ticket-Aufteilung: a ticket is split into child tickets for other
--    departments or teams (tickets.parent_ticket_id, relation 'parent').
--    The parent can only be resolved or closed when every child is resolved
--    or closed; the last finished child notifies the parent's assignee.
-- 2. Lieferantenfälle: a ticket is handed to an external vendor; the case
--    keeps the vendor's case number and the time of the last vendor update,
--    a cron job reminds the assignee when the vendor stays silent.
-- 3. The ticket timeline reads existing data only (ticket_events,
--    ticket_comments, ticket columns, vendor cases, child tickets).

create index if not exists tickets_parent_ticket_idx
  on public.tickets (parent_ticket_id)
  where parent_ticket_id is not null;

-- The status rules of 0195 plus the child rule. SECURITY DEFINER so the check
-- also sees children in departments the acting person cannot read.
create or replace function public.enforce_ticket_status_rules()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_old_key text;
  v_new_key text;
  v_old_closed boolean;
  v_new_closed boolean;
  v_merging boolean;
begin
  if new.status_id is not distinct from old.status_id then
    return new;
  end if;
  select key, is_closed into v_old_key, v_old_closed
  from public.ticket_statuses where id = old.status_id;
  select key, is_closed into v_new_key, v_new_closed
  from public.ticket_statuses where id = new.status_id;
  v_merging := old.merged_into_ticket_id is null and new.merged_into_ticket_id is not null;

  if v_new_key = 'new' and v_old_key is distinct from 'new' then
    raise exception 'Ein Ticket kann nicht auf «Neu» zurückgesetzt werden.'
      using errcode = '23514', hint = 'ticket_status_new_locked';
  end if;

  if v_old_key = 'new'
    and new.assigned_agent_id is null
    and not v_merging then
    raise exception 'Der Status «Neu» kann erst geändert werden, wenn das Ticket einer Person zugewiesen ist.'
      using errcode = '23514', hint = 'ticket_assignee_required';
  end if;

  if coalesce(v_new_closed, false)
    and not coalesce(v_old_closed, false)
    and not v_merging
    and exists (
      select 1
      from public.tickets child
      join public.ticket_statuses child_status on child_status.id = child.status_id
      where child.parent_ticket_id = new.id
        and child.merged_into_ticket_id is null
        and not child_status.is_closed
    ) then
    raise exception 'Das Ticket kann erst gelöst oder geschlossen werden, wenn alle Teil-Tickets gelöst oder geschlossen sind.'
      using errcode = '23514', hint = 'ticket_children_open';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_ticket_status_rules() from public, anon, authenticated;

-- When the last open child is resolved or closed: internal event on the
-- parent and a notification for the parent's assignee. Best effort.
create or replace function public.notify_ticket_children_done()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_old_closed boolean;
  v_new_closed boolean;
  v_parent public.tickets%rowtype;
  v_parent_closed boolean;
  v_child_count integer;
begin
  if new.parent_ticket_id is null or new.status_id is not distinct from old.status_id then
    return null;
  end if;
  select is_closed into v_old_closed from public.ticket_statuses where id = old.status_id;
  select is_closed into v_new_closed from public.ticket_statuses where id = new.status_id;
  if not coalesce(v_new_closed, false) or coalesce(v_old_closed, false) then
    return null;
  end if;
  if exists (
    select 1
    from public.tickets sibling
    join public.ticket_statuses sibling_status on sibling_status.id = sibling.status_id
    where sibling.parent_ticket_id = new.parent_ticket_id
      and sibling.merged_into_ticket_id is null
      and not sibling_status.is_closed
  ) then
    return null;
  end if;

  select * into v_parent from public.tickets where id = new.parent_ticket_id;
  if not found then
    return null;
  end if;
  select is_closed into v_parent_closed from public.ticket_statuses where id = v_parent.status_id;
  if coalesce(v_parent_closed, false) or v_parent.merged_into_ticket_id is not null then
    return null;
  end if;
  select count(*) into v_child_count
  from public.tickets child
  where child.parent_ticket_id = v_parent.id and child.merged_into_ticket_id is null;

  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (
    v_parent.id,
    null,
    'ticket.children_done',
    jsonb_build_object(
      'childCount', v_child_count,
      'lastChildTicketId', new.id,
      'lastChildTicketNumber', new.ticket_number
    )
  );
  perform public.push_insert_ticket_notification(
    v_parent.tenant_id,
    v_parent.assigned_agent_id,
    v_parent.id,
    'ticket.children_done',
    jsonb_build_object(
      'ticketNumber', v_parent.ticket_number,
      'subject', left(v_parent.subject, 240),
      'childCount', v_child_count,
      'lastChildTicketNumber', new.ticket_number
    ),
    null
  );
  return null;
exception when others then
  return null;
end;
$$;

revoke all on function public.notify_ticket_children_done() from public, anon, authenticated;

create or replace trigger tickets_notify_children_done
  after update of status_id on public.tickets
  for each row
  execute function public.notify_ticket_children_done();

-- Creates the child tickets of a split in one transaction. Called by the
-- ticket-coordination Edge Function after it checked the caller's
-- permissions, departments, teams and agents. Children are internal work
-- items: the splitting person is the requester, the parent's requester is
-- the affected person.
create or replace function public.ticket_split_create_children(
  p_tenant_id uuid,
  p_parent_ticket_id uuid,
  p_actor_id uuid,
  p_children jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_parent public.tickets%rowtype;
  v_parent_closed boolean;
  v_status_id uuid;
  v_child jsonb;
  v_department record;
  v_team_id uuid;
  v_agent_id uuid;
  v_number text;
  v_child_id uuid;
  v_result jsonb := '[]'::jsonb;
begin
  if p_actor_id is null
    or jsonb_typeof(p_children) is distinct from 'array'
    or jsonb_array_length(p_children) not between 1 and 10 then
    raise exception 'ticket_split_invalid' using errcode = '22023', hint = 'ticket_split_invalid';
  end if;

  select * into v_parent
  from public.tickets
  where id = p_parent_ticket_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'ticket_not_found' using errcode = 'P0002';
  end if;
  select is_closed into v_parent_closed from public.ticket_statuses where id = v_parent.status_id;
  if coalesce(v_parent_closed, false) or v_parent.merged_into_ticket_id is not null then
    raise exception 'ticket_split_parent_closed' using errcode = '22023', hint = 'ticket_split_parent_closed';
  end if;

  select id into v_status_id
  from public.ticket_statuses
  where tenant_id = p_tenant_id and key = 'new';
  if v_status_id is null then
    raise exception 'ticket_split_status_missing' using errcode = '22023', hint = 'ticket_split_invalid';
  end if;

  for v_child in select value from jsonb_array_elements(p_children)
  loop
    select department.id, department.key into v_department
    from public.departments department
    where department.id = nullif(v_child ->> 'departmentId', '')::uuid
      and department.tenant_id = p_tenant_id
      and department.active;
    if not found then
      raise exception 'ticket_split_department_invalid'
        using errcode = '22023', hint = 'ticket_split_department_invalid';
    end if;
    v_team_id := nullif(v_child ->> 'teamId', '')::uuid;
    v_agent_id := nullif(v_child ->> 'agentId', '')::uuid;

    v_number := public.reserve_ticket_number(p_tenant_id, v_department.id, left(v_department.key, 8));
    insert into public.tickets (
      tenant_id, department_id, ticket_number, subject, description,
      status_id, priority_id, category_id, subcategory_id,
      requester_id, affected_user_id, customer_organization_id,
      assigned_team_id, assigned_agent_id, parent_ticket_id
    )
    values (
      p_tenant_id,
      v_department.id,
      v_number,
      v_child ->> 'subject',
      v_child ->> 'description',
      v_status_id,
      v_parent.priority_id,
      case when v_department.id = v_parent.department_id then v_parent.category_id end,
      case when v_department.id = v_parent.department_id then v_parent.subcategory_id end,
      p_actor_id,
      coalesce(v_parent.affected_user_id, v_parent.requester_id),
      v_parent.customer_organization_id,
      v_team_id,
      v_agent_id,
      v_parent.id
    )
    returning id into v_child_id;

    insert into public.ticket_relations (ticket_id, related_ticket_id, relation_type, created_by)
    values (v_child_id, v_parent.id, 'parent', p_actor_id)
    on conflict do nothing;
    insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
    values (
      v_child_id,
      p_actor_id,
      'ticket.created',
      jsonb_build_object(
        'source', 'ticket_split',
        'parentTicketId', v_parent.id,
        'parentTicketNumber', v_parent.ticket_number
      )
    );
    v_result := v_result || jsonb_build_array(
      jsonb_build_object('id', v_child_id, 'ticketNumber', v_number)
    );
  end loop;

  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (v_parent.id, p_actor_id, 'ticket.split', jsonb_build_object('children', v_result));
  return v_result;
end;
$$;

revoke all on function public.ticket_split_create_children(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.ticket_split_create_children(uuid, uuid, uuid, jsonb)
  to service_role;

-- 2. Vendors and vendor cases (service role only; the Edge Function checks
--    permissions with the caller's own rights).
create table if not exists public.ticket_vendors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 160),
  contact_email text check (
    contact_email is null
    or (char_length(contact_email) <= 254 and contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  ),
  contact_phone text check (contact_phone is null or char_length(contact_phone) between 3 and 40),
  reminder_after_hours integer not null default 48 check (reminder_after_hours between 1 and 2160),
  active boolean not null default true,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create unique index if not exists ticket_vendors_tenant_name_idx
  on public.ticket_vendors (tenant_id, lower(btrim(name)));
create unique index if not exists ticket_vendors_tenant_id_idx
  on public.ticket_vendors (tenant_id, id);

create table if not exists public.ticket_vendor_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  vendor_id uuid not null,
  external_case_number text check (
    external_case_number is null or char_length(btrim(external_case_number)) between 1 and 120
  ),
  opened_at timestamptz not null default timezone('utc', now()),
  last_vendor_update_at timestamptz,
  reminder_sent_at timestamptz,
  closed_at timestamptz,
  note text check (note is null or char_length(note) <= 4000),
  opened_by uuid references public.user_profiles(id) on delete set null,
  closed_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ticket_vendor_cases_vendor_tenant_fk
    foreign key (tenant_id, vendor_id)
    references public.ticket_vendors (tenant_id, id) on delete restrict,
  constraint ticket_vendor_cases_closed_after_open
    check (closed_at is null or closed_at >= opened_at)
);
-- At most one open case per ticket and vendor.
create unique index if not exists ticket_vendor_cases_open_idx
  on public.ticket_vendor_cases (ticket_id, vendor_id)
  where closed_at is null;
create index if not exists ticket_vendor_cases_ticket_idx
  on public.ticket_vendor_cases (ticket_id, opened_at);
create index if not exists ticket_vendor_cases_open_reminder_idx
  on public.ticket_vendor_cases (tenant_id, opened_at)
  where closed_at is null;

-- The case belongs to the tenant of its ticket.
create or replace function public.ticket_vendor_cases_check_tenant()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.tickets ticket
    where ticket.id = new.ticket_id and ticket.tenant_id = new.tenant_id
  ) then
    raise exception 'Vendor case must belong to the ticket tenant' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function public.ticket_vendor_cases_check_tenant() from public, anon, authenticated;

create or replace trigger ticket_vendor_cases_check_tenant
  before insert or update of tenant_id, ticket_id on public.ticket_vendor_cases
  for each row execute function public.ticket_vendor_cases_check_tenant();
create or replace trigger ticket_vendors_updated_at
  before update on public.ticket_vendors
  for each row execute function public.set_updated_at();
create or replace trigger ticket_vendor_cases_updated_at
  before update on public.ticket_vendor_cases
  for each row execute function public.set_updated_at();

alter table public.ticket_vendors enable row level security;
alter table public.ticket_vendor_cases enable row level security;
revoke all on table public.ticket_vendors, public.ticket_vendor_cases
  from public, anon, authenticated;
grant all on table public.ticket_vendors, public.ticket_vendor_cases to service_role;

-- Opens a vendor case and moves the ticket to «Wartend auf Drittanbieter»
-- when the tenant has that status. A status rule that blocks the change
-- (e.g. «Neu» without assignee) does not block the case itself.
create or replace function public.ticket_vendor_case_open(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_vendor_id uuid,
  p_actor_id uuid,
  p_external_case_number text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket public.tickets%rowtype;
  v_ticket_closed boolean;
  v_vendor public.ticket_vendors%rowtype;
  v_case_id uuid;
  v_waiting record;
  v_now timestamptz := timezone('utc', now());
  v_status_changed boolean := false;
  v_status_skipped text;
begin
  select * into v_ticket
  from public.tickets
  where id = p_ticket_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'ticket_not_found' using errcode = 'P0002';
  end if;
  select is_closed into v_ticket_closed from public.ticket_statuses where id = v_ticket.status_id;
  if coalesce(v_ticket_closed, false) or v_ticket.merged_into_ticket_id is not null then
    raise exception 'vendor_case_ticket_closed' using errcode = '22023', hint = 'vendor_case_ticket_closed';
  end if;
  select * into v_vendor
  from public.ticket_vendors
  where id = p_vendor_id and tenant_id = p_tenant_id and active;
  if not found then
    raise exception 'vendor_invalid' using errcode = '22023', hint = 'vendor_invalid';
  end if;
  if exists (
    select 1 from public.ticket_vendor_cases
    where ticket_id = p_ticket_id and vendor_id = p_vendor_id and closed_at is null
  ) then
    raise exception 'vendor_case_exists' using errcode = '23505', hint = 'vendor_case_exists';
  end if;

  insert into public.ticket_vendor_cases (
    tenant_id, ticket_id, vendor_id, external_case_number, opened_at, note, opened_by
  )
  values (
    p_tenant_id, p_ticket_id, p_vendor_id,
    nullif(btrim(coalesce(p_external_case_number, '')), ''),
    v_now,
    nullif(btrim(coalesce(p_note, '')), ''),
    p_actor_id
  )
  returning id into v_case_id;

  select id, key into v_waiting
  from public.ticket_statuses
  where tenant_id = p_tenant_id and key = 'waiting_vendor';
  if v_waiting.id is not null and v_waiting.id is distinct from v_ticket.status_id then
    begin
      update public.tickets
      set status_id = v_waiting.id, waiting_since = v_now
      where id = p_ticket_id;
      v_status_changed := true;
    exception when check_violation then
      get stacked diagnostics v_status_skipped = pg_exception_hint;
      v_status_skipped := coalesce(nullif(v_status_skipped, ''), 'status_rule');
    end;
  end if;

  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (
    p_ticket_id,
    p_actor_id,
    'ticket.vendor_case_opened',
    jsonb_build_object(
      'caseId', v_case_id,
      'vendorId', v_vendor.id,
      'vendorName', v_vendor.name,
      'externalCaseNumber', nullif(btrim(coalesce(p_external_case_number, '')), ''),
      'statusChanged', v_status_changed
    )
  );
  if v_status_changed then
    insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
    values (
      p_ticket_id,
      p_actor_id,
      'ticket.updated',
      jsonb_build_object(
        'changedFields', jsonb_build_array('status'),
        'statusTransition', jsonb_build_object(
          'fromStatusId', v_ticket.status_id,
          'toStatusKey', 'waiting_vendor',
          'isClosed', false,
          'occurredAt', v_now
        )
      )
    );
  end if;
  return jsonb_build_object(
    'caseId', v_case_id,
    'statusChanged', v_status_changed,
    'statusSkipped', v_status_skipped
  );
end;
$$;

-- «Rückmeldung erhalten»: the vendor answered; restarts the reminder clock.
create or replace function public.ticket_vendor_case_record_update(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_case_id uuid,
  p_actor_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_case public.ticket_vendor_cases%rowtype;
  v_vendor_name text;
  v_now timestamptz := timezone('utc', now());
begin
  update public.ticket_vendor_cases
  set last_vendor_update_at = v_now
  where id = p_case_id
    and ticket_id = p_ticket_id
    and tenant_id = p_tenant_id
    and closed_at is null
  returning * into v_case;
  if not found then
    raise exception 'vendor_case_not_found' using errcode = 'P0002';
  end if;
  select name into v_vendor_name from public.ticket_vendors where id = v_case.vendor_id;
  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (
    p_ticket_id,
    p_actor_id,
    'ticket.vendor_update',
    jsonb_build_object(
      'caseId', v_case.id,
      'vendorName', v_vendor_name,
      'note', nullif(left(btrim(coalesce(p_note, '')), 2000), '')
    )
  );
  return jsonb_build_object('caseId', v_case.id, 'lastVendorUpdateAt', v_now);
end;
$$;

-- Closes a vendor case. When no open case remains and the ticket still waits
-- for the vendor, it goes back to «In Bearbeitung».
create or replace function public.ticket_vendor_case_close(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_case_id uuid,
  p_actor_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_case public.ticket_vendor_cases%rowtype;
  v_ticket public.tickets%rowtype;
  v_vendor_name text;
  v_current_key text;
  v_in_progress uuid;
  v_now timestamptz := timezone('utc', now());
  v_status_changed boolean := false;
begin
  select * into v_ticket
  from public.tickets
  where id = p_ticket_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'ticket_not_found' using errcode = 'P0002';
  end if;
  update public.ticket_vendor_cases
  set closed_at = v_now, closed_by = p_actor_id
  where id = p_case_id
    and ticket_id = p_ticket_id
    and tenant_id = p_tenant_id
    and closed_at is null
  returning * into v_case;
  if not found then
    raise exception 'vendor_case_not_found' using errcode = 'P0002';
  end if;
  select name into v_vendor_name from public.ticket_vendors where id = v_case.vendor_id;

  select key into v_current_key from public.ticket_statuses where id = v_ticket.status_id;
  if v_current_key = 'waiting_vendor' and not exists (
    select 1 from public.ticket_vendor_cases
    where ticket_id = p_ticket_id and closed_at is null
  ) then
    select id into v_in_progress
    from public.ticket_statuses
    where tenant_id = p_tenant_id and key = 'in_progress';
    if v_in_progress is not null then
      begin
        update public.tickets
        set status_id = v_in_progress, waiting_since = null
        where id = p_ticket_id;
        v_status_changed := true;
      exception when check_violation then
        v_status_changed := false;
      end;
    end if;
  end if;

  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (
    p_ticket_id,
    p_actor_id,
    'ticket.vendor_case_closed',
    jsonb_build_object(
      'caseId', v_case.id,
      'vendorName', v_vendor_name,
      'externalCaseNumber', v_case.external_case_number,
      'note', nullif(left(btrim(coalesce(p_note, '')), 2000), '')
    )
  );
  if v_status_changed then
    insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
    values (
      p_ticket_id,
      p_actor_id,
      'ticket.updated',
      jsonb_build_object(
        'changedFields', jsonb_build_array('status'),
        'statusTransition', jsonb_build_object(
          'fromStatusId', v_ticket.status_id,
          'toStatusKey', 'in_progress',
          'isClosed', false,
          'occurredAt', v_now
        )
      )
    );
  end if;
  return jsonb_build_object('caseId', v_case.id, 'statusChanged', v_status_changed);
end;
$$;

revoke all on function public.ticket_vendor_case_open(uuid, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.ticket_vendor_case_record_update(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.ticket_vendor_case_close(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.ticket_vendor_case_open(uuid, uuid, uuid, uuid, text, text)
  to service_role;
grant execute on function public.ticket_vendor_case_record_update(uuid, uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.ticket_vendor_case_close(uuid, uuid, uuid, uuid, text)
  to service_role;

-- Reminder: no vendor update for reminder_after_hours -> notification to the
-- assignee, repeated every reminder_after_hours while the vendor stays silent.
create or replace function public.ticket_vendor_send_reminders()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_case record;
  v_now timestamptz := timezone('utc', now());
  v_count integer := 0;
begin
  for v_case in
    select
      vendor_case.id,
      vendor_case.ticket_id,
      vendor_case.external_case_number,
      coalesce(vendor_case.last_vendor_update_at, vendor_case.opened_at) as silent_since,
      vendor.name as vendor_name,
      vendor.reminder_after_hours,
      ticket.tenant_id,
      ticket.assigned_agent_id,
      ticket.ticket_number,
      ticket.subject
    from public.ticket_vendor_cases vendor_case
    join public.ticket_vendors vendor
      on vendor.id = vendor_case.vendor_id and vendor.tenant_id = vendor_case.tenant_id
    join public.tickets ticket on ticket.id = vendor_case.ticket_id
    where vendor_case.closed_at is null
      and ticket.closed_at is null
      and ticket.merged_into_ticket_id is null
      and coalesce(vendor_case.last_vendor_update_at, vendor_case.opened_at)
        <= v_now - make_interval(hours => vendor.reminder_after_hours)
      and (
        vendor_case.reminder_sent_at is null
        or vendor_case.reminder_sent_at <= v_now - make_interval(hours => vendor.reminder_after_hours)
      )
    order by vendor_case.opened_at
    limit 500
    for update of vendor_case skip locked
  loop
    update public.ticket_vendor_cases set reminder_sent_at = v_now where id = v_case.id;
    insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
    values (
      v_case.ticket_id,
      null,
      'ticket.vendor_reminder',
      jsonb_build_object(
        'caseId', v_case.id,
        'vendorName', v_case.vendor_name,
        'silentSince', v_case.silent_since
      )
    );
    perform public.push_insert_ticket_notification(
      v_case.tenant_id,
      v_case.assigned_agent_id,
      v_case.ticket_id,
      'ticket.vendor_reminder',
      jsonb_build_object(
        'ticketNumber', v_case.ticket_number,
        'subject', left(v_case.subject, 240),
        'vendorName', v_case.vendor_name,
        'externalCaseNumber', v_case.external_case_number,
        'silentSince', v_case.silent_since,
        'hours', v_case.reminder_after_hours
      ),
      null
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.ticket_vendor_send_reminders() from public, anon, authenticated;

do $$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  for v_job_id in select jobid from cron.job where jobname = 'nextdesk-ticket-vendor-reminders'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'nextdesk-ticket-vendor-reminders',
    '*/30 * * * *',
    'select public.ticket_vendor_send_reminders();'
  );
exception when others then
  null;
end;
$$;

-- Push: both new notifications use the «Wiedervorlagen» category.
create or replace function public.push_notification_category(p_kind text)
returns text
language sql
immutable strict
set search_path = pg_catalog
as $function$
  select case
    when p_kind = 'ticket.assigned' then 'assigned'
    when p_kind = 'ticket.requester_reply' then 'requester_reply'
    when p_kind = 'ticket.support_reply' then 'support_reply'
    when p_kind = 'ticket.mention' then 'mention'
    when p_kind in ('ticket.supervisor_request', 'ticket.supervisor_answer') then 'mention'
    when p_kind like 'ticket.watch.%' then 'mention'
    when p_kind = 'ticket.resolved' then 'resolved'
    when p_kind = 'ticket.approval.requested' then 'approval'
    when p_kind = 'ticket.follow_up_due' then 'follow_up'
    when p_kind = 'ticket.rule_reminder' then 'follow_up'
    when p_kind in ('ticket.vendor_reminder', 'ticket.children_done') then 'follow_up'
    when p_kind = 'ticket.escalation_opened' then 'escalation'
    when p_kind like 'ticket.sla.%' then 'sla'
    when p_kind = 'contract.deadline' then 'contract_deadline'
    when p_kind = 'inventory.low_stock' then 'inventory_low_stock'
    when p_kind like 'shop.order.%' then 'shop'
    when p_kind like 'service_task.%' then 'service_task'
    when p_kind = 'infrastructure.due' then 'infrastructure'
    else null
  end;
$function$;

comment on table public.ticket_vendors is
  'Lieferanten/Drittanbieter pro Mandant. Nur Service-Rolle; Verwaltung über die Edge Function ticket-coordination.';
comment on table public.ticket_vendor_cases is
  'Lieferantenfälle pro Ticket (externe Fallnummer, letzte Rückmeldung, Erinnerung). Nur Service-Rolle.';

commit;
