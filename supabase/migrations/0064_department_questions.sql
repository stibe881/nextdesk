begin;

set local search_path = pg_catalog, public;

-- A department route is explicit: global tenant administrators never become
-- recipients merely because they can administer a tenant. The referenced
-- (id, tenant_id) key already exists on departments. Tickets have the matching
-- unique index; turn it into an explicit key for the tenant-bound foreign key.
alter table public.tickets
  add constraint tickets_id_tenant_key
  unique using index tickets_id_tenant_unique;

create table public.department_question_routes (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  department_id uuid not null,
  primary_user_id uuid not null,
  backup_user_id uuid,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, department_id),
  constraint department_question_routes_department_tenant_fk
    foreign key (department_id, tenant_id)
    references public.departments (id, tenant_id) on delete cascade,
  constraint department_question_routes_primary_member_fk
    foreign key (tenant_id, primary_user_id)
    references public.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint department_question_routes_backup_member_fk
    foreign key (tenant_id, backup_user_id)
    references public.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint department_question_routes_distinct_users
    check (backup_user_id is null or backup_user_id <> primary_user_id)
);

create table public.ticket_department_questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null,
  department_id uuid not null,
  asked_by uuid not null,
  recipient_user_id uuid not null,
  question text not null collate "C",
  status text not null default 'open' collate "C"
    check (status in ('open', 'answered')),
  answer text collate "C",
  answered_by uuid,
  answered_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ticket_department_questions_id_tenant_unique unique (id, tenant_id),
  constraint ticket_department_questions_ticket_tenant_fk
    foreign key (ticket_id, tenant_id)
    references public.tickets (id, tenant_id) on delete cascade,
  constraint ticket_department_questions_department_tenant_fk
    foreign key (department_id, tenant_id)
    references public.departments (id, tenant_id) on delete restrict,
  constraint ticket_department_questions_asked_by_member_fk
    foreign key (tenant_id, asked_by)
    references public.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint ticket_department_questions_recipient_member_fk
    foreign key (tenant_id, recipient_user_id)
    references public.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint ticket_department_questions_answered_by_member_fk
    foreign key (tenant_id, answered_by)
    references public.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint ticket_department_questions_question_valid
    check (
      char_length(question) between 3 and 3000
      and question = btrim(question)
      and question !~ '[[:cntrl:]]'
    ),
  constraint ticket_department_questions_answer_valid
    check (
      answer is null or (
        char_length(answer) between 1 and 5000
        and answer = btrim(answer)
        and answer !~ '[[:cntrl:]]'
      )
    ),
  constraint ticket_department_questions_state_valid
    check (
      (status = 'open' and answer is null and answered_by is null and answered_at is null)
      or (status = 'answered' and answer is not null and answered_by is not null and answered_at is not null)
    )
);
create index ticket_department_questions_ticket_created_idx
  on public.ticket_department_questions (tenant_id, ticket_id, created_at desc);
create index ticket_department_questions_recipient_open_idx
  on public.ticket_department_questions (tenant_id, recipient_user_id, created_at desc)
  where status = 'open';

alter table public.department_question_routes enable row level security;
alter table public.department_question_routes force row level security;
alter table public.ticket_department_questions enable row level security;
alter table public.ticket_department_questions force row level security;
revoke all on table public.department_question_routes, public.ticket_department_questions
  from public, anon, authenticated;
grant select, insert, update, delete on table public.department_question_routes, public.ticket_department_questions
  to service_role;
create policy department_question_routes_service_role_only on public.department_question_routes
  for all to service_role using (true) with check (true);
create policy ticket_department_questions_service_role_only on public.ticket_department_questions
  for all to service_role using (true) with check (true);

create or replace function public.is_department_question_route_candidate(
  p_tenant_id uuid,
  p_department_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p_user_id is not null
    and exists (
      select 1
      from public.departments department
      join public.tenant_memberships membership
        on membership.tenant_id = department.tenant_id
       and membership.user_id = p_user_id
       and membership.status = 'active'
      join public.department_memberships department_membership
        on department_membership.department_id = department.id
       and department_membership.user_id = p_user_id
       and department_membership.status = 'active'
      where department.id = p_department_id
        and department.tenant_id = p_tenant_id
        and department.active
        and public.user_has_ticket_permission_for(
          p_user_id, p_tenant_id, p_department_id, 'ticket.read.department'
        )
    );
$$;
revoke all on function public.is_department_question_route_candidate(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.is_department_question_route_candidate(uuid, uuid, uuid)
  to service_role;

create or replace function public.validate_department_question_route()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not public.is_department_question_route_candidate(
    new.tenant_id, new.department_id, new.primary_user_id
  ) then
    raise exception 'department_question_primary_invalid' using errcode = '22023';
  end if;
  if new.backup_user_id is not null
     and not public.is_department_question_route_candidate(
       new.tenant_id, new.department_id, new.backup_user_id
     ) then
    raise exception 'department_question_backup_invalid' using errcode = '22023';
  end if;
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;
revoke all on function public.validate_department_question_route() from public, anon, authenticated;
drop trigger if exists department_question_routes_validate on public.department_question_routes;
create trigger department_question_routes_validate
  before insert or update on public.department_question_routes
  for each row execute function public.validate_department_question_route();

create or replace function public.configure_department_question_route(
  p_tenant_id uuid,
  p_department_id uuid,
  p_primary_user_id uuid,
  p_backup_user_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null
     or not public.has_tenant_permission(p_tenant_id, 'department.manage') then
    raise exception 'department_question_route_forbidden' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.departments
    where id = p_department_id and tenant_id = p_tenant_id and active
  ) then
    raise exception 'department_question_department_invalid' using errcode = '22023';
  end if;
  if p_backup_user_id is not null and p_backup_user_id = p_primary_user_id then
    raise exception 'department_question_route_duplicate_people' using errcode = '22023';
  end if;
  insert into public.department_question_routes (
    tenant_id, department_id, primary_user_id, backup_user_id, updated_by
  ) values (
    p_tenant_id, p_department_id, p_primary_user_id, p_backup_user_id, v_actor_id
  ) on conflict (tenant_id, department_id) do update
    set primary_user_id = excluded.primary_user_id,
        backup_user_id = excluded.backup_user_id,
        updated_by = excluded.updated_by;
  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  ) values (
    p_tenant_id, v_actor_id, 'department.question_route.saved',
    'department_question_route', p_department_id, 'info',
    jsonb_build_object('departmentId', p_department_id)
  );
  return true;
end;
$$;
revoke all on function public.configure_department_question_route(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.configure_department_question_route(uuid, uuid, uuid, uuid)
  to authenticated;

create or replace function public.department_question_recipient(
  p_tenant_id uuid,
  p_department_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_route public.department_question_routes%rowtype;
begin
  select * into v_route
  from public.department_question_routes
  where tenant_id = p_tenant_id and department_id = p_department_id;
  if not found then
    return null;
  end if;
  if public.is_department_question_route_candidate(
    p_tenant_id, p_department_id, v_route.primary_user_id
  ) then
    return v_route.primary_user_id;
  end if;
  if v_route.backup_user_id is not null
     and public.is_department_question_route_candidate(
       p_tenant_id, p_department_id, v_route.backup_user_id
     ) then
    return v_route.backup_user_id;
  end if;
  return null;
end;
$$;
revoke all on function public.department_question_recipient(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.department_question_recipient(uuid, uuid)
  to service_role;

create or replace function public.create_ticket_department_question(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_question text
)
returns table (
  id uuid,
  ticket_id uuid,
  department_id uuid,
  recipient_user_id uuid,
  asked_by uuid,
  question text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_ticket public.tickets%rowtype;
  v_recipient_id uuid;
  v_question text := btrim(coalesce(p_question, ''));
  v_created public.ticket_department_questions%rowtype;
begin
  if v_actor_id is null then
    raise exception 'department_question_authentication_required' using errcode = '42501';
  end if;
  if char_length(v_question) not between 3 and 3000 or v_question ~ '[[:cntrl:]]' then
    raise exception 'department_question_invalid' using errcode = '22023';
  end if;
  select * into v_ticket
  from public.tickets
  where tenant_id = p_tenant_id and id = p_ticket_id
  for update;
  if not found then
    raise exception 'department_question_ticket_missing' using errcode = 'P0002';
  end if;
  if v_ticket.assigned_agent_id is distinct from v_actor_id
     or not public.user_has_ticket_permission_for(
       v_actor_id, p_tenant_id, v_ticket.department_id, 'ticket.update'
     ) then
    raise exception 'department_question_assigned_agent_required' using errcode = '42501';
  end if;
  v_recipient_id := public.department_question_recipient(
    p_tenant_id, v_ticket.department_id
  );
  if v_recipient_id is null then
    raise exception 'department_question_recipient_missing' using errcode = 'P0001';
  end if;
  insert into public.ticket_department_questions (
    tenant_id, ticket_id, department_id, asked_by, recipient_user_id, question
  ) values (
    p_tenant_id, v_ticket.id, v_ticket.department_id, v_actor_id, v_recipient_id, v_question
  ) returning * into v_created;
  if v_recipient_id <> v_actor_id then
    insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
    values (
      p_tenant_id, v_recipient_id, v_ticket.id, 'ticket.department_question.asked',
      jsonb_build_object('ticketNumber', v_ticket.ticket_number, 'questionId', v_created.id)
    );
  end if;
  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  ) values (
    p_tenant_id, v_actor_id, 'ticket.department_question.created',
    'ticket_department_question', v_created.id, 'info',
    jsonb_build_object('ticketId', v_ticket.id, 'departmentId', v_ticket.department_id,
      'recipientUserId', v_recipient_id)
  );
  return query select v_created.id, v_created.ticket_id, v_created.department_id,
    v_created.recipient_user_id, v_created.asked_by, v_created.question,
    v_created.status, v_created.created_at;
end;
$$;
revoke all on function public.create_ticket_department_question(uuid, uuid, text)
  from public, anon;
grant execute on function public.create_ticket_department_question(uuid, uuid, text)
  to authenticated;

create or replace function public.answer_ticket_department_question(
  p_tenant_id uuid,
  p_question_id uuid,
  p_answer text
)
returns table (
  id uuid,
  ticket_id uuid,
  assigned_agent_id uuid,
  recipient_user_id uuid,
  status text,
  answered_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_question public.ticket_department_questions%rowtype;
  v_ticket public.tickets%rowtype;
  v_answer text := btrim(coalesce(p_answer, ''));
begin
  if v_actor_id is null then
    raise exception 'department_question_authentication_required' using errcode = '42501';
  end if;
  if char_length(v_answer) not between 1 and 5000 or v_answer ~ '[[:cntrl:]]' then
    raise exception 'department_question_answer_invalid' using errcode = '22023';
  end if;
  select * into v_question
  from public.ticket_department_questions
  where tenant_id = p_tenant_id and id = p_question_id
  for update;
  if not found then
    raise exception 'department_question_missing' using errcode = 'P0002';
  end if;
  if v_question.status <> 'open' then
    raise exception 'department_question_already_answered' using errcode = 'P0001';
  end if;
  if v_question.recipient_user_id <> v_actor_id
     or not public.is_department_question_route_candidate(
       p_tenant_id, v_question.department_id, v_actor_id
     ) then
    raise exception 'department_question_answer_forbidden' using errcode = '42501';
  end if;
  select * into v_ticket
  from public.tickets
  where tenant_id = p_tenant_id and id = v_question.ticket_id
  for update;
  if not found then
    raise exception 'department_question_ticket_missing' using errcode = 'P0002';
  end if;
  update public.ticket_department_questions
  set status = 'answered', answer = v_answer, answered_by = v_actor_id,
      answered_at = timezone('utc', now()), updated_at = timezone('utc', now())
  where id = v_question.id and tenant_id = p_tenant_id and status = 'open'
  returning * into v_question;
  if not found then
    raise exception 'department_question_already_answered' using errcode = 'P0001';
  end if;
  if v_ticket.assigned_agent_id is not null
     and v_ticket.assigned_agent_id <> v_actor_id then
    insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
    values (
      p_tenant_id, v_ticket.assigned_agent_id, v_ticket.id,
      'ticket.department_question.answered',
      jsonb_build_object('ticketNumber', v_ticket.ticket_number, 'questionId', v_question.id)
    );
  end if;
  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  ) values (
    p_tenant_id, v_actor_id, 'ticket.department_question.answered',
    'ticket_department_question', v_question.id, 'info',
    jsonb_build_object('ticketId', v_ticket.id, 'assignedAgentId', v_ticket.assigned_agent_id)
  );
  return query select v_question.id, v_question.ticket_id, v_ticket.assigned_agent_id,
    v_question.recipient_user_id, v_question.status, v_question.answered_at;
end;
$$;
revoke all on function public.answer_ticket_department_question(uuid, uuid, text)
  from public, anon;
grant execute on function public.answer_ticket_department_question(uuid, uuid, text)
  to authenticated;

-- Mail remains a deferred provider integration. The worker resolves a recipient
-- e-mail at delivery time; no private address is stored in question records.
alter table public.mail_messages
  add column if not exists department_question_id uuid,
  add column if not exists recipient_user_id uuid;
alter table public.mail_messages
  drop constraint if exists mail_messages_kind_check;
alter table public.mail_messages
  add constraint mail_messages_kind_check
  check (kind in ('new_ticket', 'reply', 'acknowledgement', 'agent_reply', 'resolution', 'test', 'department_question', 'department_answer'));
alter table public.mail_messages
  add constraint mail_messages_department_question_tenant_fk
  foreign key (department_question_id, tenant_id)
  references public.ticket_department_questions (id, tenant_id) on delete cascade;
alter table public.mail_messages
  add constraint mail_messages_recipient_member_fk
  foreign key (tenant_id, recipient_user_id)
  references public.tenant_memberships (tenant_id, user_id) on delete set null (recipient_user_id);
create unique index mail_messages_department_question_notice_unique
  on public.mail_messages (department_question_id, kind, recipient_user_id)
  where kind in ('department_question', 'department_answer')
    and department_question_id is not null
    and recipient_user_id is not null;

-- Reuse the existing approval preference as the closest explicit internal-work
-- category. APNs still receives a precise event kind and never question text.
create or replace function public.push_notification_category(p_kind text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select case
    when p_kind = 'ticket.assigned' then 'assigned'
    when p_kind = 'ticket.requester_reply' then 'requester_reply'
    when p_kind = 'ticket.support_reply' then 'support_reply'
    when p_kind = 'ticket.mention' then 'mention'
    when p_kind = 'ticket.resolved' then 'resolved'
    when p_kind = 'ticket.approval.requested' then 'approval'
    when p_kind in ('ticket.department_question.asked', 'ticket.department_question.answered') then 'approval'
    when p_kind = 'ticket.escalation_opened' then 'escalation'
    when p_kind = 'ticket.follow_up_due' then 'follow_up'
    when p_kind like 'ticket.sla.%' then 'sla'
    else null
  end;
$$;
revoke all on function public.push_notification_category(text) from public, anon, authenticated;

commit;
