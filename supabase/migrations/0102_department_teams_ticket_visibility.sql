begin;

-- Teams remain an organisational assignment. They never grant ticket permissions
-- by themselves; team tickets additionally require the existing department
-- permission before a member may read them.
alter table public.team_memberships
  add column if not exists tenant_id uuid;

update public.team_memberships membership
set tenant_id = team.tenant_id
from public.teams team
where team.id = membership.team_id
  and membership.tenant_id is null;

create unique index if not exists teams_id_tenant_department_unique
  on public.teams (id, tenant_id, department_id);
create unique index if not exists tenant_memberships_tenant_user_unique
  on public.tenant_memberships (tenant_id, user_id);

alter table public.team_memberships
  add constraint team_memberships_team_tenant_fk
  foreign key (team_id, tenant_id)
  references public.teams (id, tenant_id)
  on delete cascade
  not valid;
alter table public.team_memberships
  add constraint team_memberships_tenant_user_fk
  foreign key (tenant_id, user_id)
  references public.tenant_memberships (tenant_id, user_id)
  on delete cascade
  not valid;

create index if not exists team_memberships_tenant_user_team_idx
  on public.team_memberships (tenant_id, user_id, team_id);
create index if not exists teams_tenant_department_active_name_idx
  on public.teams (tenant_id, department_id, active, name);
create index if not exists tickets_tenant_assigned_team_updated_idx
  on public.tickets (tenant_id, assigned_team_id, updated_at desc)
  where assigned_team_id is not null;

-- A team without an active department cannot safely scope a ticket. Stop the
-- rollout rather than silently deleting or reassigning historic data.
do $$
begin
  if exists (select 1 from public.teams where department_id is null) then
    raise exception 'teams_without_department_require_manual_resolution';
  end if;
  if exists (
    select 1
    from public.team_memberships membership
    join public.teams team on team.id = membership.team_id
    left join public.department_memberships department_membership
      on department_membership.department_id = team.department_id
     and department_membership.user_id = membership.user_id
     and department_membership.status = 'active'
    where department_membership.user_id is null
  ) then
    raise exception 'team_memberships_without_active_department_require_manual_resolution';
  end if;
end;
$$;

create unique index if not exists departments_id_tenant_unique
  on public.departments (id, tenant_id);
alter table public.teams
  alter column department_id set not null;
alter table public.teams
  drop constraint if exists teams_department_id_fkey;
alter table public.teams
  drop constraint if exists teams_department_tenant_fk;
alter table public.teams
  add constraint teams_department_tenant_fk
  foreign key (department_id, tenant_id)
  references public.departments (id, tenant_id)
  on delete restrict;
alter table public.team_memberships
  validate constraint team_memberships_team_tenant_fk;
alter table public.team_memberships
  validate constraint team_memberships_tenant_user_fk;

create or replace function public.validate_team_membership_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team public.teams%rowtype;
  v_membership_exists boolean;
begin
  select * into v_team from public.teams where id = new.team_id for share;
  if not found or not v_team.active then
    raise exception 'team_membership_team_invalid' using errcode = '23503';
  end if;
  new.tenant_id := v_team.tenant_id;
  select true into v_membership_exists
  from public.tenant_memberships membership
  where membership.tenant_id = new.tenant_id
    and membership.user_id = new.user_id
    and membership.status = 'active'
  for share;
  if not found then
    raise exception 'team_membership_tenant_member_required' using errcode = '23503';
  end if;
  select true into v_membership_exists
  from public.department_memberships membership
  where membership.tenant_id = new.tenant_id
    and membership.department_id = v_team.department_id
    and membership.user_id = new.user_id
    and membership.status = 'active'
  for share;
  if not found then
    raise exception 'team_membership_department_member_required' using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists team_memberships_integrity_trigger on public.team_memberships;
create trigger team_memberships_integrity_trigger
before insert or update of team_id, user_id, tenant_id on public.team_memberships
for each row execute function public.validate_team_membership_integrity();

-- Changing a team's department must not leave its existing members outside the
-- new department. The Edge Function adds the corresponding department
-- memberships first; this trigger is the final database fence against direct
-- or concurrent writes.
create or replace function public.validate_team_department_change_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.department_id is not distinct from old.department_id then
    return new;
  end if;

  if exists (
    select 1
    from public.tickets ticket
    where ticket.assigned_team_id = old.id
      and ticket.tenant_id = old.tenant_id
      and ticket.department_id is distinct from new.department_id
  ) then
    raise exception 'team_department_ticket_conflict' using errcode = '23503';
  end if;

  if exists (
    select 1
    from public.team_memberships team_membership
    where team_membership.team_id = old.id
      and not exists (
        select 1
        from public.department_memberships department_membership
        where department_membership.department_id = new.department_id
          and department_membership.user_id = team_membership.user_id
          and department_membership.status = 'active'
      )
  ) then
    raise exception 'team_department_member_required' using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists teams_department_change_integrity_trigger on public.teams;
create trigger teams_department_change_integrity_trigger
before update of department_id on public.teams
for each row execute function public.validate_team_department_change_integrity();

-- An archive request locks the team before testing its open-ticket invariant.
-- Ticket writes take a compatible shared lock below, so a ticket cannot become
-- open or be assigned to this team between that test and the archive update.
create or replace function public.validate_team_archive_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.active and not new.active and exists (
    select 1
    from public.tickets ticket
    where ticket.tenant_id = old.tenant_id
      and ticket.assigned_team_id = old.id
      and ticket.closed_at is null
  ) then
    raise exception 'team_archive_open_tickets' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists teams_archive_integrity_trigger on public.teams;
create trigger teams_archive_integrity_trigger
before update of active on public.teams
for each row execute function public.validate_team_archive_integrity();

create or replace function public.validate_ticket_assigned_team_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team public.teams%rowtype;
begin
  if new.assigned_team_id is null then return new; end if;
  select * into v_team
  from public.teams team
  where team.id = new.assigned_team_id
    and team.tenant_id = new.tenant_id
  for share;
  if not found
    or v_team.department_id is distinct from new.department_id
    or (
      not v_team.active
      and not (
        tg_op = 'UPDATE'
        and new.assigned_team_id is not distinct from old.assigned_team_id
        and old.closed_at is not null
        and new.closed_at is not null
      )
    ) then
    raise exception 'ticket_assigned_team_invalid' using errcode = '23514';
  end if;
  if new.assigned_agent_id is not null
    and (
      tg_op = 'INSERT'
      or new.closed_at is null
      or new.assigned_agent_id is distinct from old.assigned_agent_id
      or new.assigned_team_id is distinct from old.assigned_team_id
    )
    and not exists (
    select 1
    from public.team_memberships membership
    join public.teams team
      on team.id = membership.team_id
     and team.tenant_id = membership.tenant_id
     and team.active
    join public.tenant_memberships tenant_membership
      on tenant_membership.tenant_id = membership.tenant_id
     and tenant_membership.user_id = membership.user_id
     and tenant_membership.status = 'active'
    join public.department_memberships department_membership
      on department_membership.department_id = new.department_id
     and department_membership.user_id = membership.user_id
     and department_membership.status = 'active'
    where membership.tenant_id = new.tenant_id
      and membership.team_id = new.assigned_team_id
      and membership.user_id = new.assigned_agent_id
  ) then
    raise exception 'ticket_assigned_agent_team_invalid' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_assigned_team_integrity_trigger on public.tickets;
create trigger tickets_assigned_team_integrity_trigger
before insert or update of assigned_team_id, assigned_agent_id, department_id, tenant_id, closed_at on public.tickets
for each row execute function public.validate_ticket_assigned_team_integrity();

create or replace function public.is_current_user_team_member(
  p_tenant_id uuid,
  p_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.team_memberships membership
    join public.teams team on team.id = membership.team_id
    join public.tenant_memberships tenant_membership
      on tenant_membership.tenant_id = membership.tenant_id
     and tenant_membership.user_id = membership.user_id
    join public.department_memberships department_membership
      on department_membership.department_id = team.department_id
     and department_membership.user_id = membership.user_id
    where membership.tenant_id = p_tenant_id
      and membership.team_id = p_team_id
      and membership.user_id = auth.uid()
      and team.tenant_id = p_tenant_id
      and team.active
      and tenant_membership.status = 'active'
      and department_membership.status = 'active'
  );
$$;

-- This is the central RLS rule used by web and mobile ticket lists as well as
-- ticket-adjacent rows. Requester/customer and direct-agent access remain
-- unchanged; team membership gates only broad department visibility.
create or replace function public.can_read_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.tickets ticket
    where ticket.id = p_ticket_id
      and public.is_active_tenant_member(ticket.tenant_id)
      and (
        ticket.requester_id = auth.uid()
        or ticket.affected_user_id = auth.uid()
        or public.customer_can_read_ticket(ticket.id)
        or (
          ticket.assigned_agent_id = auth.uid()
          and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.read.assigned')
          and (
            ticket.assigned_team_id is null
            or public.is_current_user_team_member(ticket.tenant_id, ticket.assigned_team_id)
          )
        )
        or (
          public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.read.department')
          and (
            ticket.assigned_team_id is null
            or public.is_current_user_team_member(ticket.tenant_id, ticket.assigned_team_id)
          )
        )
      )
  );
$$;



-- Ticket mutations which already have their own permission check use this
-- second, narrow gate to prevent a department-level permission from bypassing
-- an assigned team.
create or replace function public.can_access_ticket_team(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.tickets ticket
    where ticket.id = p_ticket_id
      and public.is_active_tenant_member(ticket.tenant_id)
      and (
        ticket.requester_id = auth.uid()
        or ticket.affected_user_id = auth.uid()
        or public.customer_can_read_ticket(ticket.id)
        or ticket.assigned_team_id is null
        or public.is_current_user_team_member(ticket.tenant_id, ticket.assigned_team_id)
      )
  );
$$;



-- Service-role ticket mutations carry an explicit verified actor instead of
-- auth.uid(). They must receive the same active team boundary.
create or replace function public.can_user_access_ticket_team(
  p_ticket_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tickets ticket
    where ticket.id = p_ticket_id
      and (
        ticket.assigned_team_id is null
        or exists (
          select 1
          from public.team_memberships membership
          join public.teams team on team.id = membership.team_id
          join public.tenant_memberships tenant_membership
            on tenant_membership.tenant_id = membership.tenant_id
           and tenant_membership.user_id = membership.user_id
          join public.department_memberships department_membership
            on department_membership.department_id = team.department_id
           and department_membership.user_id = membership.user_id
          where membership.tenant_id = ticket.tenant_id
            and membership.team_id = ticket.assigned_team_id
            and membership.user_id = p_user_id
            and team.active
            and tenant_membership.status = 'active'
            and department_membership.status = 'active'
        )
      )
  );
$$;

-- The Edge Function is the authorization boundary. This procedure is the
-- transaction boundary: it locks the team, validates the requested complete
-- set, and only deletes memberships that have actually left that set.
create or replace function public.replace_team_memberships(
  p_tenant_id uuid,
  p_team_id uuid,
  p_user_ids uuid[]
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team public.teams%rowtype;
begin
  if p_tenant_id is null or p_team_id is null or p_user_ids is null
    or cardinality(p_user_ids) > 200
    or exists (
      select 1
      from unnest(p_user_ids) requested(user_id)
      where requested.user_id is null
    )
    or (
      select count(distinct requested.user_id)
      from unnest(p_user_ids) requested(user_id)
    ) <> cardinality(p_user_ids) then
    return 'team_member_invalid';
  end if;

  select * into v_team
  from public.teams team
  where team.id = p_team_id
    and team.tenant_id = p_tenant_id
  for update;
  if not found or not v_team.active then
    return 'team_not_available';
  end if;

  if exists (
    select 1
    from unnest(p_user_ids) requested(user_id)
    left join public.tenant_memberships membership
      on membership.tenant_id = p_tenant_id
     and membership.user_id = requested.user_id
     and membership.status = 'active'
    where membership.user_id is null
  ) then
    return 'team_member_invalid';
  end if;

  if exists (
    select 1
    from unnest(p_user_ids) requested(user_id)
    left join public.department_memberships membership
      on membership.tenant_id = p_tenant_id
     and membership.department_id = v_team.department_id
     and membership.user_id = requested.user_id
     and membership.status = 'active'
    where membership.user_id is null
  ) then
    return 'team_department_members_required';
  end if;

  perform 1
  from public.team_memberships membership
  where membership.tenant_id = p_tenant_id
    and membership.team_id = p_team_id
  for update;

  delete from public.team_memberships membership
  where membership.tenant_id = p_tenant_id
    and membership.team_id = p_team_id
    and not (membership.user_id = any(p_user_ids));

  insert into public.team_memberships (team_id, user_id, tenant_id)
  select p_team_id, requested.user_id, p_tenant_id
  from unnest(p_user_ids) requested(user_id)
  on conflict (team_id, user_id) do nothing;

  return 'updated';
end;
$$;

-- This is deliberately one lock/check/update operation. validate_ticket_*
-- takes FOR SHARE on the same team row, so concurrent assignment or reopening
-- attempts either become visible to this check or observe the archived team.
create or replace function public.archive_team_if_no_open_tickets(
  p_tenant_id uuid,
  p_team_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team public.teams%rowtype;
begin
  select * into v_team
  from public.teams team
  where team.id = p_team_id
    and team.tenant_id = p_tenant_id
  for update;
  if not found or not v_team.active then
    return 'team_not_available';
  end if;

  if exists (
    select 1
    from public.tickets ticket
    where ticket.tenant_id = p_tenant_id
      and ticket.assigned_team_id = p_team_id
      and ticket.closed_at is null
  ) then
    return 'team_has_open_tickets';
  end if;

  update public.teams
     set active = false
   where id = p_team_id
     and tenant_id = p_tenant_id
     and active;
  return 'archived';
end;
$$;

create or replace function public.unassign_ticket_agent_after_team_membership_loss()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'team_memberships' then
    update public.tickets
       set assigned_agent_id = null,
           updated_at = timezone('utc', now())
     where tenant_id = old.tenant_id
       and assigned_team_id = old.team_id
       and assigned_agent_id = old.user_id
       and closed_at is null;
  elsif tg_table_name = 'tenant_memberships'
    and coalesce(to_jsonb(old)->>'status', '') = 'active'
    and coalesce(to_jsonb(new)->>'status', '') <> 'active' then
    update public.tickets ticket
       set assigned_agent_id = null,
           updated_at = timezone('utc', now())
     where ticket.tenant_id = new.tenant_id
       and ticket.assigned_team_id is not null
       and ticket.assigned_agent_id = new.user_id
       and ticket.closed_at is null;
  elsif tg_table_name = 'teams'
    and coalesce(to_jsonb(old)->>'active', 'false') = 'true'
    and coalesce(to_jsonb(new)->>'active', 'false') <> 'true' then
    update public.tickets ticket
       set assigned_agent_id = null,
           updated_at = timezone('utc', now())
     where ticket.tenant_id = old.tenant_id
       and ticket.assigned_team_id = old.id
       and ticket.closed_at is null;
  end if;
  return coalesce(new, old);
end;
$$;

-- Loss of a department membership invalidates every matching team membership.
-- Deleting those rows uses the single membership-loss trigger above, which in
-- turn clears only the now-invalid assignments on open tickets.
create or replace function public.cleanup_team_memberships_after_department_membership_loss()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE'
    or (
      old.status = 'active'
      and new.status <> 'active'
    ) then
    delete from public.team_memberships membership
    using public.teams team
    where membership.team_id = team.id
      and membership.tenant_id = old.tenant_id
      and team.tenant_id = old.tenant_id
      and team.department_id = old.department_id
      and membership.user_id = old.user_id;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists team_memberships_unassign_ticket_agent_trigger on public.team_memberships;
create trigger team_memberships_unassign_ticket_agent_trigger
  after delete on public.team_memberships
  for each row execute function public.unassign_ticket_agent_after_team_membership_loss();
drop trigger if exists department_memberships_unassign_ticket_agent_trigger on public.department_memberships;
drop trigger if exists department_memberships_cleanup_team_memberships_trigger on public.department_memberships;
create trigger department_memberships_cleanup_team_memberships_trigger
  after delete or update of status on public.department_memberships
  for each row execute function public.cleanup_team_memberships_after_department_membership_loss();
drop trigger if exists tenant_memberships_unassign_team_ticket_agent_trigger on public.tenant_memberships;
create trigger tenant_memberships_unassign_team_ticket_agent_trigger
  after update of status on public.tenant_memberships
  for each row execute function public.unassign_ticket_agent_after_team_membership_loss();
drop trigger if exists teams_unassign_ticket_agent_trigger on public.teams;
create trigger teams_unassign_ticket_agent_trigger
  after update of active on public.teams
  for each row execute function public.unassign_ticket_agent_after_team_membership_loss();

alter table public.teams enable row level security;
alter table public.teams force row level security;
alter table public.team_memberships enable row level security;
alter table public.team_memberships force row level security;
revoke all on public.teams, public.team_memberships from public, anon, authenticated;
revoke all on function public.is_current_user_team_member(uuid, uuid) from public, anon;
grant execute on function public.is_current_user_team_member(uuid, uuid) to authenticated;
revoke all on function public.can_access_ticket_team(uuid) from public, anon;
grant execute on function public.can_access_ticket_team(uuid) to authenticated;
revoke all on function public.can_user_access_ticket_team(uuid, uuid) from public, anon, authenticated;
revoke all on function public.unassign_ticket_agent_after_team_membership_loss() from public, anon, authenticated;
revoke all on function public.cleanup_team_memberships_after_department_membership_loss() from public, anon, authenticated;
revoke all on function public.validate_team_membership_integrity() from public, anon, authenticated;
revoke all on function public.validate_team_department_change_integrity() from public, anon, authenticated;
revoke all on function public.validate_team_archive_integrity() from public, anon, authenticated;
revoke all on function public.validate_ticket_assigned_team_integrity() from public, anon, authenticated;
revoke all on function public.replace_team_memberships(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.replace_team_memberships(uuid, uuid, uuid[]) to service_role;
revoke all on function public.archive_team_if_no_open_tickets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.archive_team_if_no_open_tickets(uuid, uuid) to service_role;

-- Every ticket-adjacent mutation must use the same active team membership
-- boundary as the ticket APIs. These replacements keep the public RPC contract
-- unchanged while closing the direct SECURITY DEFINER path.
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
  select ticket.* into v_ticket
  from public.tickets ticket
  where ticket.tenant_id = p_tenant_id and ticket.id = p_ticket_id
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
  if not public.can_access_ticket_team(v_ticket.id) then
    raise exception 'department_question_team_membership_required' using errcode = '42501';
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
  select question.* into v_question
  from public.ticket_department_questions question
  where question.tenant_id = p_tenant_id and question.id = p_question_id
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
  select ticket.* into v_ticket
  from public.tickets ticket
  where ticket.tenant_id = p_tenant_id and ticket.id = v_question.ticket_id
  for update;
  if not found then
    raise exception 'department_question_ticket_missing' using errcode = 'P0002';
  end if;
  if not public.can_access_ticket_team(v_ticket.id) then
    raise exception 'department_question_team_membership_required' using errcode = '42501';
  end if;
  update public.ticket_department_questions
  set status = 'answered', answer = v_answer, answered_by = v_actor_id,
      answered_at = timezone('utc', now()), updated_at = timezone('utc', now())
  where ticket_department_questions.id = v_question.id
    and ticket_department_questions.tenant_id = p_tenant_id
    and ticket_department_questions.status = 'open'
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


-- Follow-ups must disappear as soon as their ticket leaves an agent's team.
drop policy if exists experience_follow_ups_select_owner on public.experience_follow_ups;
create policy experience_follow_ups_select_owner on public.experience_follow_ups
  for select to authenticated
  using (
    owner_id = auth.uid()
    and public.can_work_tickets_in_tenant(tenant_id)
    and (ticket_id is null or public.can_access_ticket_team(ticket_id))
  );
drop policy if exists experience_follow_ups_insert_owner on public.experience_follow_ups;
create policy experience_follow_ups_insert_owner on public.experience_follow_ups
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and resolved_at is null
    and resolved_by is null
    and public.can_work_tickets_in_tenant(tenant_id)
    and (ticket_id is null or public.can_access_ticket_team(ticket_id))
  );
drop policy if exists experience_follow_ups_update_owner on public.experience_follow_ups;
create policy experience_follow_ups_update_owner on public.experience_follow_ups
  for update to authenticated
  using (
    owner_id = auth.uid()
    and public.can_work_tickets_in_tenant(tenant_id)
    and (ticket_id is null or public.can_access_ticket_team(ticket_id))
  )
  with check (
    owner_id = auth.uid()
    and (resolved_by is null or resolved_by = auth.uid())
    and public.can_work_tickets_in_tenant(tenant_id)
    and (ticket_id is null or public.can_access_ticket_team(ticket_id))
  );


-- Rebind older SECURITY DEFINER ticket mutations to the team fence.
create or replace function public.bulk_update_ticket_statuses(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_ticket_ids uuid[],
  p_status_key text,
  p_confirm_close boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_status record;
  v_updated integer := 0;
  v_now timestamptz := timezone('utc', now());
  v_requested integer;
begin
  v_requested := coalesce(cardinality(p_ticket_ids), 0);
  if p_actor_id is null
    or p_tenant_id is null
    or p_confirm_close is null
    or p_status_key !~ '^[a-z][a-z0-9_]{0,63}$'
    or v_requested < 1
    or v_requested > 50
    or (select count(distinct ticket_id) from unnest(p_ticket_ids) as ticket_id) <> v_requested then
    raise exception 'Invalid bulk ticket status request' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.tenant_memberships membership
    join public.tenants tenant on tenant.id = membership.tenant_id and tenant.status = 'active'
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_actor_id
      and membership.status = 'active'
  ) then
    raise exception 'Tenant membership required' using errcode = '42501';
  end if;

  select status.id, status.key, status.is_closed
  into v_status
  from public.ticket_statuses status
  where status.tenant_id = p_tenant_id
    and status.key = p_status_key;
  if not found then
    raise exception 'Ticket status not found' using errcode = 'P0002';
  end if;

  if v_status.is_closed and not p_confirm_close then
    raise exception 'Bulk ticket close confirmation required' using errcode = 'P0001';
  end if;

  if (
    select count(*)
    from public.tickets ticket
    where ticket.tenant_id = p_tenant_id
      and ticket.id = any(p_ticket_ids)
  ) <> v_requested then
    raise exception 'One or more tickets are unavailable' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.tickets ticket
    where ticket.tenant_id = p_tenant_id
      and ticket.id = any(p_ticket_ids)
      and (
        not public.can_user_access_ticket_team(ticket.id, p_actor_id)
        or not exists (
          select 1
          from public.department_memberships department_membership
          where department_membership.user_id = p_actor_id
            and department_membership.tenant_id = p_tenant_id
            and department_membership.department_id = ticket.department_id
            and department_membership.status = 'active'
        )
        or not exists (
          select 1
          from public.user_role_assignments assignment
          join public.roles role
            on role.id = assignment.role_id
            and role.tenant_id = assignment.tenant_id
            and role.active
            and role.scope in ('tenant', 'department')
          join public.role_permissions role_permission
            on role_permission.role_id = role.id
          where assignment.user_id = p_actor_id
            and assignment.tenant_id = p_tenant_id
            and role_permission.permission_code = 'ticket.update'
            and assignment.starts_at <= v_now
            and (assignment.expires_at is null or assignment.expires_at > v_now)
            and (role.scope = 'tenant' or assignment.department_id = ticket.department_id)
        )
      )
  ) then
    raise exception 'Ticket update permission required for every selected ticket'
      using errcode = '42501';
  end if;

  if v_status.is_closed and exists (
    select 1
    from public.tickets ticket
    where ticket.tenant_id = p_tenant_id
      and ticket.id = any(p_ticket_ids)
      and ticket.status_id is distinct from v_status.id
      and not exists (
        select 1
        from public.user_role_assignments assignment
        join public.roles role
          on role.id = assignment.role_id
          and role.tenant_id = assignment.tenant_id
          and role.active
          and role.scope in ('tenant', 'department')
        join public.role_permissions role_permission
          on role_permission.role_id = role.id
        where assignment.user_id = p_actor_id
          and assignment.tenant_id = p_tenant_id
          and role_permission.permission_code = 'ticket.close'
          and assignment.starts_at <= v_now
          and (assignment.expires_at is null or assignment.expires_at > v_now)
          and (role.scope = 'tenant' or assignment.department_id = ticket.department_id)
      )
  ) then
    raise exception 'Ticket close permission required for every selected ticket'
      using errcode = '42501';
  end if;

  with changed_tickets as (
    update public.tickets ticket
    set status_id = v_status.id,
        closed_at = case when v_status.is_closed then v_now else null end,
        resolved_at = case
          when v_status.key = 'resolved' then v_now
          else ticket.resolved_at
        end,
        waiting_since = case
          when v_status.key like 'waiting%' then v_now
          else null
        end
    where ticket.tenant_id = p_tenant_id
      and ticket.id = any(p_ticket_ids)
      and ticket.status_id is distinct from v_status.id
    returning ticket.id
  ), inserted_events as (
    insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
    select
      changed_ticket.id,
      p_actor_id,
      'ticket.bulk_status_updated',
      jsonb_build_object(
        'changedFields', jsonb_build_array('status'),
        'statusKey', v_status.key,
        'confirmedClose', v_status.is_closed,
        'source', 'bulk'
      )
    from changed_tickets changed_ticket
    returning ticket_id
  )
  select count(*) into v_updated from inserted_events;

  return jsonb_build_object(
    'requested', v_requested,
    'updated', v_updated,
    'statusKey', v_status.key
  );
end;
$$;

create or replace function public.apply_ticket_category_selection(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_category_id uuid,
  p_subcategory_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket public.tickets%rowtype;
  v_category_name text;
  v_subcategory_name text;
  v_authorized boolean;
  v_changed boolean;
begin
  select ticket.*
    into v_ticket
    from public.tickets as ticket
   where ticket.id = p_ticket_id
     and ticket.tenant_id = p_tenant_id
   for update;

  if not found then
    raise exception 'ticket_not_found' using errcode = 'P0002';
  end if;
  if not public.can_user_access_ticket_team(v_ticket.id, p_actor_id) then
    raise exception 'ticket_category_change_denied' using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.tenant_memberships as membership
     where membership.tenant_id = p_tenant_id
       and membership.user_id = p_actor_id
       and membership.status = 'active'
  ) then
    raise exception 'ticket_category_change_denied' using errcode = '42501';
  end if;

  select exists (
    select 1
      from public.user_role_assignments as assignment
      join public.roles as role
        on role.id = assignment.role_id
       and role.tenant_id = assignment.tenant_id
       and role.active
      join public.role_permissions as role_permission
        on role_permission.role_id = role.id
     where assignment.user_id = p_actor_id
       and assignment.tenant_id = p_tenant_id
       and role_permission.permission_code = 'ticket.update'
       and assignment.starts_at <= timezone('utc', now())
       and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
       and (assignment.department_id is null or assignment.department_id = v_ticket.department_id)
  ) into v_authorized;

  if not v_authorized then
    raise exception 'ticket_category_change_denied' using errcode = '42501';
  end if;

  if p_subcategory_id is not null and p_category_id is null then
    raise exception 'invalid_ticket_category' using errcode = '22023';
  end if;

  if p_category_id is not null then
    select category.name
      into v_category_name
      from public.ticket_categories as category
     where category.id = p_category_id
       and category.tenant_id = p_tenant_id
       and category.department_id = v_ticket.department_id
       and category.parent_id is null
       and category.active
     for share;

    if not found then
      raise exception 'invalid_ticket_category' using errcode = '22023';
    end if;
  end if;

  if p_subcategory_id is not null then
    select subcategory.name
      into v_subcategory_name
      from public.ticket_categories as subcategory
     where subcategory.id = p_subcategory_id
       and subcategory.tenant_id = p_tenant_id
       and subcategory.department_id = v_ticket.department_id
       and subcategory.parent_id = p_category_id
       and subcategory.active
     for share;

    if not found then
      raise exception 'invalid_ticket_category' using errcode = '22023';
    end if;
  end if;

  v_changed := v_ticket.category_id is distinct from p_category_id
    or v_ticket.subcategory_id is distinct from p_subcategory_id;

  if not v_changed then
    return jsonb_build_object(
      'changed', false,
      'categoryId', p_category_id,
      'subcategoryId', p_subcategory_id
    );
  end if;

  update public.tickets
     set category_id = p_category_id,
         subcategory_id = p_subcategory_id,
         updated_at = timezone('utc', now())
   where id = v_ticket.id;

  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (
    v_ticket.id,
    p_actor_id,
    'ticket.category_changed',
    jsonb_build_object(
      'previous_category_id', v_ticket.category_id,
      'previous_subcategory_id', v_ticket.subcategory_id,
      'category_id', p_category_id,
      'category_name', v_category_name,
      'subcategory_id', p_subcategory_id,
      'subcategory_name', v_subcategory_name
    )
  );

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity,
    before_data, after_data, metadata
  ) values (
    p_tenant_id,
    p_actor_id,
    'ticket.category.update',
    'ticket',
    v_ticket.id,
    'info',
    jsonb_build_object(
      'category_id', v_ticket.category_id,
      'subcategory_id', v_ticket.subcategory_id
    ),
    jsonb_build_object(
      'category_id', p_category_id,
      'subcategory_id', p_subcategory_id
    ),
    jsonb_build_object('department_id', v_ticket.department_id)
  );

  return jsonb_build_object(
    'changed', true,
    'categoryId', p_category_id,
    'subcategoryId', p_subcategory_id
  );
end;
$$;

-- All team tables, RLS policies and RPC replacements apply atomically.
commit;
