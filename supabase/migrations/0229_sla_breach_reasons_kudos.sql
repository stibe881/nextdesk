begin;

set local search_path = pg_catalog, public;

-- 1) Ursachen für SLA-Verletzungen
-- One reason per ticket and breached target (first response / resolution).
-- Breaches themselves stay in tickets (*_due_at vs. first_responded_at /
-- resolved_at) and ticket_sla_events; this table only adds the cause.
-- Written and read exclusively through the edge functions
-- sla-breach-reasons and team-supervision.

create table if not exists public.ticket_sla_breach_reasons (
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  breach_kind text not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reason_code text not null,
  note text,
  recorded_by uuid references public.user_profiles(id) on delete set null,
  recorded_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (ticket_id, breach_kind)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ticket_sla_breach_reasons_kind_check'
      and conrelid = 'public.ticket_sla_breach_reasons'::regclass
  ) then
    alter table public.ticket_sla_breach_reasons
      add constraint ticket_sla_breach_reasons_kind_check
      check (breach_kind in ('response', 'resolution'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'ticket_sla_breach_reasons_code_check'
      and conrelid = 'public.ticket_sla_breach_reasons'::regclass
  ) then
    alter table public.ticket_sla_breach_reasons
      add constraint ticket_sla_breach_reasons_code_check
      check (reason_code in (
        'third_party', 'wrong_routing', 'missing_requester_info',
        'capacity', 'complexity', 'other'
      ));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'ticket_sla_breach_reasons_note_check'
      and conrelid = 'public.ticket_sla_breach_reasons'::regclass
  ) then
    alter table public.ticket_sla_breach_reasons
      add constraint ticket_sla_breach_reasons_note_check
      check (
        (note is null or (char_length(note) between 1 and 500 and btrim(note) <> ''))
        and (reason_code <> 'other' or note is not null)
      );
  end if;
end;
$$;

create index if not exists ticket_sla_breach_reasons_tenant_idx
  on public.ticket_sla_breach_reasons (tenant_id, recorded_at desc);

alter table public.ticket_sla_breach_reasons enable row level security;
revoke all on public.ticket_sla_breach_reasons from public, anon, authenticated;
grant select, insert, update on public.ticket_sla_breach_reasons to service_role;

comment on table public.ticket_sla_breach_reasons is
  'Ursache pro SLA-Verletzung (Erstreaktion/Lösung) eines Tickets. Nur Service-Rolle; Erfassung über die Edge Function sla-breach-reasons, Auswertung über team-supervision.';

-- 2) Lob von Kund:innen
-- A satisfaction rating counts as praise when it is in the top band (5) or a
-- 4 with a written comment. Mirrored in supabase/functions/_shared/sla-breach-causes.ts.
create or replace function public.ticket_satisfaction_is_praise(
  p_score smallint,
  p_comment text
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select coalesce(p_score, 0) = 5
    or (coalesce(p_score, 0) = 4 and nullif(btrim(coalesce(p_comment, '')), '') is not null);
$function$;

create table if not exists public.ticket_kudos (
  ticket_id uuid primary key references public.tickets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid references public.user_profiles(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  requester_id uuid references public.user_profiles(id) on delete set null,
  score smallint not null,
  has_comment boolean not null default false,
  notified_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ticket_kudos_score_check'
      and conrelid = 'public.ticket_kudos'::regclass
  ) then
    alter table public.ticket_kudos
      add constraint ticket_kudos_score_check check (score between 1 and 5);
  end if;
end;
$$;

create index if not exists ticket_kudos_department_idx
  on public.ticket_kudos (tenant_id, department_id, created_at desc)
  where withdrawn_at is null;
create index if not exists ticket_kudos_agent_idx
  on public.ticket_kudos (tenant_id, agent_id, created_at desc)
  where withdrawn_at is null;

alter table public.ticket_kudos enable row level security;
revoke all on public.ticket_kudos from public, anon, authenticated;
grant select, insert, update on public.ticket_kudos to service_role;

comment on table public.ticket_kudos is
  'Positives Feedback aus der Zufriedenheitsumfrage, zugeordnet an die bearbeitende Person. Kommentar und Name werden beim Lesen aus ticket_satisfaction bzw. user_profiles.display_name geholt (keine E-Mail). Nur Service-Rolle.';

create or replace function public.record_ticket_kudos()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_ticket record;
  v_requester_name text;
  v_comment text := nullif(btrim(coalesce(new.comment, '')), '');
  v_kudos public.ticket_kudos%rowtype;
begin
  begin
    select ticket.id, ticket.tenant_id, ticket.ticket_number,
           ticket.assigned_agent_id, ticket.department_id, ticket.assigned_team_id
    into v_ticket
    from public.tickets ticket
    where ticket.id = new.ticket_id;
    if not found then
      return new;
    end if;

    if not public.ticket_satisfaction_is_praise(new.score, new.comment) then
      update public.ticket_kudos
      set withdrawn_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
      where ticket_id = new.ticket_id
        and withdrawn_at is null;
      return new;
    end if;

    insert into public.ticket_kudos (
      ticket_id, tenant_id, agent_id, department_id, team_id, requester_id,
      score, has_comment
    )
    values (
      v_ticket.id, v_ticket.tenant_id, v_ticket.assigned_agent_id,
      v_ticket.department_id, v_ticket.assigned_team_id, new.submitted_by,
      new.score, v_comment is not null
    )
    on conflict (ticket_id) do update
      set score = excluded.score,
          has_comment = excluded.has_comment,
          requester_id = coalesce(excluded.requester_id, public.ticket_kudos.requester_id),
          withdrawn_at = null,
          updated_at = timezone('utc', now())
    returning * into v_kudos;

    -- Notify the handling agent once per ticket (not on later edits).
    if v_kudos.notified_at is null
       and v_kudos.agent_id is not null
       and v_kudos.agent_id is distinct from new.submitted_by then
      select nullif(btrim(profile.display_name), '')
      into v_requester_name
      from public.user_profiles profile
      where profile.id = new.submitted_by;
      -- Privacy: never pass on something that looks like an e-mail address.
      if v_requester_name like '%@%' then
        v_requester_name := null;
      end if;

      insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
      values (
        v_ticket.tenant_id,
        v_kudos.agent_id,
        v_ticket.id,
        'ticket.kudos',
        jsonb_strip_nulls(jsonb_build_object(
          'ticketNumber', v_ticket.ticket_number,
          'score', new.score,
          'requesterName', left(v_requester_name, 120),
          'excerpt', case when v_comment is null then null
                          when char_length(v_comment) > 160 then left(v_comment, 157) || '…'
                          else v_comment end
        ))
      );

      update public.ticket_kudos
      set notified_at = timezone('utc', now())
      where ticket_id = v_ticket.id;
    end if;
  exception when others then
    -- Praise is a bonus: never block the satisfaction survey.
    raise warning 'record_ticket_kudos failed: %', sqlerrm;
  end;
  return new;
end;
$function$;

revoke all on function public.record_ticket_kudos() from public, anon, authenticated;

create or replace trigger ticket_satisfaction_record_kudos
  after insert or update of score, comment on public.ticket_satisfaction
  for each row execute function public.record_ticket_kudos();

-- Push: ticket.kudos is delivered in the «resolved» category (feedback on
-- solved tickets). All rows of 0223 plus ticket.kudos.
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
    when p_kind = 'ticket.kudos' then 'resolved'
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

commit;
