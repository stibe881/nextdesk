set local search_path = pg_catalog, public;

-- Spam: Ein Ticket lässt sich als Spam einstufen. Es kommt wie ein gelöschtes
-- Ticket aus allen Ansichten, Regeln, Benachrichtigungen und Statistiken
-- (deleted_at), ist aber über den Filter «Spam» auffindbar. Der Absender wird
-- gesperrt: künftige Tickets von ihm entstehen sofort als Spam, ohne Regeln,
-- SLA, KI-Triage, Bestätigungsmail und Mitteilungen.

alter table public.tickets
  add column if not exists spam_at timestamptz,
  add column if not exists spam_by uuid references public.user_profiles(id) on delete set null;

create index if not exists tickets_spam_idx
  on public.tickets (tenant_id, spam_at)
  where spam_at is not null;

create table if not exists public.spam_senders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sender_email text not null check (sender_email = lower(sender_email) and char_length(sender_email) between 3 and 254),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  hit_count integer not null default 0,
  last_hit_at timestamptz,
  unique (tenant_id, sender_email)
);

-- Verlauf für den Spam-Bericht. Bewusst ohne Verweis auf das Ticket: Der
-- Bericht bleibt vollständig, auch wenn der Papierkorb geleert wird.
create table if not exists public.spam_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid,
  ticket_number text,
  sender_email text,
  department_id uuid references public.departments(id) on delete set null,
  source text not null check (source in ('manual', 'auto')),
  marked_by uuid references public.user_profiles(id) on delete set null,
  occurred_at timestamptz not null default timezone('utc', now())
);
create index if not exists spam_events_tenant_idx
  on public.spam_events (tenant_id, occurred_at desc);

alter table public.spam_senders enable row level security;
alter table public.spam_senders force row level security;
alter table public.spam_events enable row level security;
alter table public.spam_events force row level security;
revoke all on table public.spam_senders from public, anon, authenticated;
revoke all on table public.spam_events from public, anon, authenticated;
grant select, insert, update, delete on table public.spam_senders to service_role;
grant select, insert, update, delete on table public.spam_events to service_role;
create policy spam_senders_service_role_only on public.spam_senders
  for all to service_role using (true) with check (true);
create policy spam_events_service_role_only on public.spam_events
  for all to service_role using (true) with check (true);

-- Absender eines Tickets: E-Mail-Kontakt, sonst das Konto der anfragenden Person.
create or replace function public.ticket_sender_email(
  p_tenant_id uuid,
  p_requester_contact_id uuid,
  p_requester_id uuid
)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
  select lower(nullif(btrim(coalesce(
    (select contact.email from public.ticket_requesters contact
      where contact.id = p_requester_contact_id and contact.tenant_id = p_tenant_id),
    case when p_requester_contact_id is null
      then (select account.email from auth.users account where account.id = p_requester_id)
    end
  )), ''));
$$;
revoke all on function public.ticket_sender_email(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ticket_sender_email(uuid, uuid, uuid) to service_role;

-- Ist die Adresse eine aktive Person des Arbeitsbereichs? Diese Absender
-- werden nie gesperrt (nur das einzelne Ticket geht in den Spam).
create or replace function public.spam_sender_is_member(p_tenant_id uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
  select exists (
    select 1
      from auth.users account
      join public.tenant_memberships membership
        on membership.user_id = account.id
       and membership.tenant_id = p_tenant_id
       and membership.status = 'active'
     where lower(account.email) = lower(p_email)
  );
$$;
revoke all on function public.spam_sender_is_member(uuid, text) from public, anon, authenticated;
grant execute on function public.spam_sender_is_member(uuid, text) to service_role;

-- Neues Ticket eines gesperrten Absenders: sofort Spam (läuft vor allen anderen
-- Triggern, deshalb der Namensanfang «0_»).
create or replace function public.tickets_spam_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_email text;
begin
  if new.deleted_at is not null or new.spam_at is not null then
    return new;
  end if;
  v_email := public.ticket_sender_email(new.tenant_id, new.requester_contact_id, new.requester_id);
  if v_email is null then
    return new;
  end if;
  if exists (
    select 1 from public.spam_senders sender
     where sender.tenant_id = new.tenant_id and sender.sender_email = v_email
  ) then
    new.deleted_at := timezone('utc', now());
    new.spam_at := new.deleted_at;
    update public.spam_senders sender
       set hit_count = sender.hit_count + 1,
           last_hit_at = new.deleted_at
     where sender.tenant_id = new.tenant_id and sender.sender_email = v_email;
    insert into public.spam_events (
      tenant_id, ticket_id, ticket_number, sender_email, department_id, source
    ) values (
      new.tenant_id, new.id, new.ticket_number, v_email, new.department_id, 'auto'
    );
  end if;
  return new;
end;
$$;
revoke all on function public.tickets_spam_guard() from public, anon, authenticated;

create or replace trigger "0_tickets_spam_guard"
  before insert on public.tickets
  for each row execute function public.tickets_spam_guard();

-- Bei Spam-Tickets nichts weiter auslösen: Regeln, SLA, KI-Triage,
-- Raumplanung und Monitoring-Verknüpfung überspringen sie.
do $$
declare
  v_name text;
  v_def text;
  v_new text;
begin
  foreach v_name in array array[
    'enqueue_event_space_ticket_intake',
    'monitoring_ticket_link_trigger',
    'ticket_rules_apply_before_insert',
    'apply_ticket_sla_on_insert',
    'ticket_triage_enqueue',
    'ticket_rules_apply_after_insert'
  ] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name and p.pronargs = 0;
    if v_def is null or position('language plpgsql' in lower(v_def)) = 0 then
      raise exception 'Trigger-Funktion % nicht gefunden oder nicht plpgsql', v_name;
    end if;
    if position('new.spam_at is not null' in v_def) = 0 then
      v_new := regexp_replace(
        v_def,
        E'\nbegin\n',
        E'\nbegin\n  -- Spam-Tickets lösen nichts aus.\n  if new.spam_at is not null then\n    return new;\n  end if;\n',
        ''
      );
      if v_new = v_def then
        raise exception 'Trigger-Funktion %: Muster nicht gefunden', v_name;
      end if;
      execute v_new;
    end if;
  end loop;
end;
$$;

-- Wer Spam verwalten darf: Berechtigung «ticket.delete» (in irgendeiner Abteilung).
create or replace function public.spam_manage_allowed(p_actor_id uuid, p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
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
       and role_permission.permission_code = 'ticket.delete'
       and assignment.starts_at <= timezone('utc', now())
       and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
  );
$$;
revoke all on function public.spam_manage_allowed(uuid, uuid) from public, anon, authenticated;
grant execute on function public.spam_manage_allowed(uuid, uuid) to service_role;

-- Tickets als Spam einstufen und die Absender sperren.
create or replace function public.mark_tickets_spam(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_ticket_ids uuid[],
  p_confirm boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_requested integer;
  v_ticket record;
  v_email text;
  v_marked integer := 0;
  v_blocked integer := 0;
  v_skipped_members integer := 0;
  v_no_sender integer := 0;
begin
  v_requested := coalesce(cardinality(p_ticket_ids), 0);
  if p_actor_id is null or p_tenant_id is null or p_confirm is null
    or v_requested < 1 or v_requested > 50
    or (select count(distinct ticket_id) from unnest(p_ticket_ids) as ticket_id) <> v_requested then
    raise exception 'Invalid spam request' using errcode = '22023';
  end if;
  if not p_confirm then
    raise exception 'Spam confirmation required' using errcode = 'P0001';
  end if;
  perform public.ticket_trash_require_member(p_actor_id, p_tenant_id);
  if exists (
    select 1 from public.tenant_data_retention_policies retention
     where retention.tenant_id = p_tenant_id and retention.legal_hold
  ) then
    raise exception 'Ticket deletion blocked by legal hold' using errcode = 'P0001';
  end if;
  if (
    select count(*) from public.tickets ticket
     where ticket.tenant_id = p_tenant_id
       and ticket.id = any(p_ticket_ids)
       and ticket.deleted_at is null
  ) <> v_requested then
    raise exception 'One or more tickets are unavailable' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.tickets ticket
     where ticket.tenant_id = p_tenant_id
       and ticket.id = any(p_ticket_ids)
       and not public.ticket_trash_allowed(p_actor_id, p_tenant_id, ticket.department_id)
  ) then
    raise exception 'Ticket delete permission required for every selected ticket'
      using errcode = '42501';
  end if;

  for v_ticket in
    select ticket.id, ticket.ticket_number, ticket.department_id,
           ticket.requester_contact_id, ticket.requester_id
      from public.tickets ticket
     where ticket.tenant_id = p_tenant_id and ticket.id = any(p_ticket_ids)
  loop
    v_email := public.ticket_sender_email(p_tenant_id, v_ticket.requester_contact_id, v_ticket.requester_id);
    update public.tickets
       set deleted_at = v_now, deleted_by = p_actor_id,
           spam_at = v_now, spam_by = p_actor_id
     where id = v_ticket.id;
    v_marked := v_marked + 1;
    insert into public.spam_events (
      tenant_id, ticket_id, ticket_number, sender_email, department_id, source, marked_by
    ) values (
      p_tenant_id, v_ticket.id, v_ticket.ticket_number, v_email, v_ticket.department_id, 'manual', p_actor_id
    );
    if v_email is null then
      v_no_sender := v_no_sender + 1;
    elsif public.spam_sender_is_member(p_tenant_id, v_email) then
      v_skipped_members := v_skipped_members + 1;
    else
      insert into public.spam_senders (tenant_id, sender_email, created_by)
      values (p_tenant_id, v_email, p_actor_id)
      on conflict (tenant_id, sender_email) do nothing;
      v_blocked := v_blocked + 1;
    end if;
    insert into public.audit_logs (
      tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
    ) values (
      p_tenant_id, p_actor_id, 'ticket.spam_marked', 'ticket', v_ticket.id, 'warning',
      jsonb_build_object('ticketNumber', v_ticket.ticket_number, 'senderBlocked', v_email is not null)
    );
  end loop;

  return jsonb_build_object(
    'requested', v_requested,
    'marked', v_marked,
    'blockedSenders', v_blocked,
    'skippedMembers', v_skipped_members,
    'withoutSender', v_no_sender
  );
end;
$$;
revoke all on function public.mark_tickets_spam(uuid, uuid, uuid[], boolean) from public, anon, authenticated;
grant execute on function public.mark_tickets_spam(uuid, uuid, uuid[], boolean) to service_role;

-- «Kein Spam»: Tickets wiederherstellen und (auf Wunsch) die Absender freigeben.
create or replace function public.unmark_tickets_spam(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_ticket_ids uuid[],
  p_release_senders boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_requested integer;
  v_restored integer := 0;
  v_released integer := 0;
begin
  v_requested := coalesce(cardinality(p_ticket_ids), 0);
  if p_actor_id is null or p_tenant_id is null
    or v_requested < 1 or v_requested > 50
    or (select count(distinct ticket_id) from unnest(p_ticket_ids) as ticket_id) <> v_requested then
    raise exception 'Invalid spam restore request' using errcode = '22023';
  end if;
  perform public.ticket_trash_require_member(p_actor_id, p_tenant_id);
  if (
    select count(*) from public.tickets ticket
     where ticket.tenant_id = p_tenant_id and ticket.id = any(p_ticket_ids)
       and ticket.spam_at is not null
  ) <> v_requested then
    raise exception 'One or more tickets are not spam' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.tickets ticket
     where ticket.tenant_id = p_tenant_id and ticket.id = any(p_ticket_ids)
       and not public.ticket_trash_allowed(p_actor_id, p_tenant_id, ticket.department_id)
  ) then
    raise exception 'Ticket delete permission required for every selected ticket'
      using errcode = '42501';
  end if;

  if p_release_senders then
    delete from public.spam_senders sender
     where sender.tenant_id = p_tenant_id
       and sender.sender_email in (
         select public.ticket_sender_email(ticket.tenant_id, ticket.requester_contact_id, ticket.requester_id)
           from public.tickets ticket
          where ticket.tenant_id = p_tenant_id and ticket.id = any(p_ticket_ids)
       );
    get diagnostics v_released = row_count;
  end if;

  update public.tickets ticket
     set deleted_at = null, deleted_by = null, spam_at = null, spam_by = null
   where ticket.tenant_id = p_tenant_id
     and ticket.id = any(p_ticket_ids)
     and ticket.spam_at is not null;
  get diagnostics v_restored = row_count;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  )
  select p_tenant_id, p_actor_id, 'ticket.spam_released', 'ticket', ticket.id, 'info',
         jsonb_build_object('ticketNumber', ticket.ticket_number, 'sendersReleased', p_release_senders)
    from public.tickets ticket
   where ticket.tenant_id = p_tenant_id and ticket.id = any(p_ticket_ids);

  return jsonb_build_object('requested', v_requested, 'restored', v_restored, 'releasedSenders', v_released);
end;
$$;
revoke all on function public.unmark_tickets_spam(uuid, uuid, uuid[], boolean) from public, anon, authenticated;
grant execute on function public.unmark_tickets_spam(uuid, uuid, uuid[], boolean) to service_role;

-- Liste der Spam-Tickets (wie der Papierkorb, mit Absender).
create or replace function public.list_spam_tickets(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_limit integer default 200
)
returns table (
  id uuid,
  ticket_number text,
  subject text,
  department_id uuid,
  sender_email text,
  created_at timestamptz,
  spam_at timestamptz,
  spam_by uuid,
  purge_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.ticket_trash_require_member(p_actor_id, p_tenant_id);
  return query
    select ticket.id, ticket.ticket_number, ticket.subject, ticket.department_id,
           public.ticket_sender_email(ticket.tenant_id, ticket.requester_contact_id, ticket.requester_id),
           ticket.created_at, ticket.spam_at, ticket.spam_by,
           ticket.deleted_at + interval '90 days'
      from public.tickets ticket
     where ticket.tenant_id = p_tenant_id
       and ticket.spam_at is not null
       and public.ticket_trash_allowed(p_actor_id, p_tenant_id, ticket.department_id)
     order by ticket.spam_at desc
     limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;
revoke all on function public.list_spam_tickets(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.list_spam_tickets(uuid, uuid, integer) to service_role;

-- Der Papierkorb zeigt keinen Spam; «Wiederherstellen» löscht die Spam-Markierung.
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public.list_deleted_tickets(uuid,uuid,integer)'::regprocedure) into v_def;
  v_new := replace(v_def, 'and ticket.deleted_at is not null' || E'\n', 'and ticket.deleted_at is not null' || E'\n      and ticket.spam_at is null' || E'\n');
  if v_new = v_def then raise exception 'list_deleted_tickets: Muster nicht gefunden'; end if;
  execute v_new;

  select pg_get_functiondef('public.restore_deleted_tickets(uuid,uuid,uuid[])'::regprocedure) into v_def;
  v_new := replace(v_def, 'deleted_by = null' || E'\n', 'deleted_by = null,' || E'\n         spam_at = null,' || E'\n         spam_by = null' || E'\n');
  if v_new = v_def then raise exception 'restore_deleted_tickets: Muster nicht gefunden'; end if;
  execute v_new;
end;
$$;

-- Gesperrte Absender und Spam-Bericht.
create or replace function public.list_spam_senders(p_actor_id uuid, p_tenant_id uuid)
returns table (id uuid, sender_email text, created_at timestamptz, hit_count integer, last_hit_at timestamptz)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.ticket_trash_require_member(p_actor_id, p_tenant_id);
  if not public.spam_manage_allowed(p_actor_id, p_tenant_id) then
    raise exception 'Spam permission required' using errcode = '42501';
  end if;
  return query
    select sender.id, sender.sender_email, sender.created_at, sender.hit_count, sender.last_hit_at
      from public.spam_senders sender
     where sender.tenant_id = p_tenant_id
     order by coalesce(sender.last_hit_at, sender.created_at) desc
     limit 500;
end;
$$;
revoke all on function public.list_spam_senders(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_spam_senders(uuid, uuid) to service_role;

create or replace function public.remove_spam_sender(p_actor_id uuid, p_tenant_id uuid, p_sender_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_email text;
begin
  perform public.ticket_trash_require_member(p_actor_id, p_tenant_id);
  if not public.spam_manage_allowed(p_actor_id, p_tenant_id) then
    raise exception 'Spam permission required' using errcode = '42501';
  end if;
  delete from public.spam_senders sender
   where sender.id = p_sender_id and sender.tenant_id = p_tenant_id
  returning sender.sender_email into v_email;
  if v_email is null then
    return false;
  end if;
  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  ) values (
    p_tenant_id, p_actor_id, 'ticket.spam_sender_released', 'spam_sender', p_sender_id, 'info',
    jsonb_build_object('sender', v_email)
  );
  return true;
end;
$$;
revoke all on function public.remove_spam_sender(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_spam_sender(uuid, uuid, uuid) to service_role;

create or replace function public.spam_report(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.ticket_trash_require_member(p_actor_id, p_tenant_id);
  if not (
    public.spam_manage_allowed(p_actor_id, p_tenant_id)
    or exists (
      select 1
        from public.user_role_assignments assignment
        join public.roles role on role.id = assignment.role_id and role.tenant_id = assignment.tenant_id and role.active
        join public.role_permissions role_permission on role_permission.role_id = role.id
       where assignment.user_id = p_actor_id
         and assignment.tenant_id = p_tenant_id
         and role_permission.permission_code = 'report.read'
         and assignment.starts_at <= timezone('utc', now())
         and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
    )
  ) then
    raise exception 'Report permission required' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'Invalid report period' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'total', (select count(*) from public.spam_events e
               where e.tenant_id = p_tenant_id and e.occurred_at >= p_from and e.occurred_at < p_to),
    'auto', (select count(*) from public.spam_events e
              where e.tenant_id = p_tenant_id and e.occurred_at >= p_from and e.occurred_at < p_to and e.source = 'auto'),
    'manual', (select count(*) from public.spam_events e
                where e.tenant_id = p_tenant_id and e.occurred_at >= p_from and e.occurred_at < p_to and e.source = 'manual'),
    'blockedSenders', (select count(*) from public.spam_senders s where s.tenant_id = p_tenant_id),
    'perDay', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'auto', d.auto, 'manual', d.manual) order by d.day)
        from (
          select (timezone('Europe/Zurich', e.occurred_at))::date as day,
                 count(*) filter (where e.source = 'auto') as auto,
                 count(*) filter (where e.source = 'manual') as manual
            from public.spam_events e
           where e.tenant_id = p_tenant_id and e.occurred_at >= p_from and e.occurred_at < p_to
           group by 1
        ) d
    ), '[]'::jsonb),
    'topSenders', coalesce((
      select jsonb_agg(jsonb_build_object('sender', t.sender_email, 'count', t.cnt, 'lastAt', t.last_at) order by t.cnt desc, t.last_at desc)
        from (
          select e.sender_email, count(*) as cnt, max(e.occurred_at) as last_at
            from public.spam_events e
           where e.tenant_id = p_tenant_id and e.occurred_at >= p_from and e.occurred_at < p_to
             and e.sender_email is not null
           group by e.sender_email
           order by count(*) desc, max(e.occurred_at) desc
           limit 15
        ) t
    ), '[]'::jsonb),
    'byDepartment', coalesce((
      select jsonb_agg(jsonb_build_object('departmentId', x.department_id, 'name', x.name, 'count', x.cnt) order by x.cnt desc)
        from (
          select e.department_id, coalesce(dep.name, 'Ohne Abteilung') as name, count(*) as cnt
            from public.spam_events e
            left join public.departments dep on dep.id = e.department_id
           where e.tenant_id = p_tenant_id and e.occurred_at >= p_from and e.occurred_at < p_to
           group by e.department_id, dep.name
        ) x
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.spam_report(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.spam_report(uuid, uuid, timestamptz, timestamptz) to service_role;
