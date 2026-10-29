begin;

-- Optionale Erinnerung vor Ablauf: Ab "ends_on - reminder_days_before" erzeugt
-- ein täglicher Job genau einmal pro Ablaufdatum ein Ticket. Die Person, die für
-- den Eintrag verantwortlich ist (sonst die erfassende Person), wird zur
-- anfragenden Person des Tickets.
alter table public.contracts
  add column if not exists reminder_days_before integer
    check (reminder_days_before between 1 and 3650),
  add column if not exists reminder_ticket_id uuid references public.tickets(id) on delete set null,
  add column if not exists reminder_sent_for date;

do $$
begin
  if to_regclass('public.licenses') is not null then
    alter table public.licenses
      add column if not exists reminder_days_before integer
        check (reminder_days_before between 1 and 3650),
      add column if not exists reminder_ticket_id uuid references public.tickets(id) on delete set null,
      add column if not exists reminder_sent_for date;
  end if;
end;
$$;

create or replace function public.create_expiry_reminder_ticket(
  p_tenant_id uuid,
  p_requester_id uuid,
  p_subject text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_department record;
  v_status_id uuid;
  v_priority_id uuid;
  v_number text;
  v_ticket_id uuid;
begin
  select department.id, department.key
  into v_department
  from public.departments department
  where department.tenant_id = p_tenant_id
    and department.active
  order by (department.kind = 'ict') desc, department.key
  limit 1;
  select status.id into v_status_id
  from public.ticket_statuses status
  where status.tenant_id = p_tenant_id and status.key = 'new';
  select priority.id into v_priority_id
  from public.ticket_priorities priority
  where priority.tenant_id = p_tenant_id and priority.key = 'normal';
  if v_department.id is null or v_status_id is null or v_priority_id is null then
    return null;
  end if;

  v_number := public.reserve_ticket_number(
    p_tenant_id, v_department.id, left(v_department.key, 8)
  );
  insert into public.tickets (
    tenant_id, department_id, ticket_number, subject, description,
    status_id, priority_id, requester_id, source
  ) values (
    p_tenant_id, v_department.id, v_number, left(p_subject, 240),
    left(p_description, 50000), v_status_id, v_priority_id, p_requester_id,
    'automation'
  )
  returning id into v_ticket_id;

  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (
    v_ticket_id, p_requester_id, 'ticket.created',
    jsonb_build_object('source', 'expiry_reminder')
  );
  return v_ticket_id;
end;
$$;
revoke all on function public.create_expiry_reminder_ticket(uuid, uuid, text, text)
  from public, anon, authenticated;

create or replace function public.create_due_expiry_reminders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_record record;
  v_today date := timezone('Europe/Zurich', now())::date;
  v_ticket_id uuid;
  v_created integer := 0;
  v_kind text;
  v_cancel_on date;
  v_description text;
begin
  for v_kind in select unnest(array['contract', 'license']) loop
    if v_kind = 'license' and to_regclass('public.licenses') is null then
      continue;
    end if;
    for v_record in execute format($q$
      select item.id, item.tenant_id, item.title, item.ends_on,
             item.notice_period_days, item.reference_number,
             item.%1$s as party, item.reminder_days_before,
             coalesce(item.responsible_user_id, item.created_by) as requester_id
      from public.%2$I item
      where item.status = 'active'
        and item.archived_at is null
        and item.ends_on is not null
        and item.reminder_days_before is not null
        and $1 >= item.ends_on - item.reminder_days_before
        and item.reminder_sent_for is distinct from item.ends_on
        and exists (
          select 1 from public.tenant_feature_flags flag
          where flag.tenant_id = item.tenant_id
            and flag.feature_key = 'contracts.management'
            and flag.enabled
            and (flag.pilot_ends_at is null or flag.pilot_ends_at > timezone('utc', now()))
        )
      order by item.ends_on, item.id
      for update of item skip locked
      limit 100
    $q$, case when v_kind = 'contract' then 'counterparty_name' else 'vendor_name' end,
         case when v_kind = 'contract' then 'contracts' else 'licenses' end)
      using v_today
    loop
      v_cancel_on := case
        when v_record.notice_period_days is null then null
        else v_record.ends_on - v_record.notice_period_days
      end;
      v_description := format(
        E'%s läuft am %s aus.\n\n%s: %s%s%s\n\nBitte rechtzeitig prüfen, verlängern oder kündigen.',
        case when v_kind = 'contract' then 'Der Vertrag' else 'Die Lizenz' end,
        to_char(v_record.ends_on, 'DD.MM.YYYY'),
        case when v_kind = 'contract' then 'Gegenpartei' else 'Hersteller' end,
        v_record.party,
        case when v_record.reference_number is null then ''
             else E'\nNummer: ' || v_record.reference_number end,
        case when v_cancel_on is null then ''
             else E'\nKündigungsfrist: ' || v_record.notice_period_days
               || ' Tage (spätestens bis ' || to_char(v_cancel_on, 'DD.MM.YYYY') || ')' end
      );
      v_ticket_id := public.create_expiry_reminder_ticket(
        v_record.tenant_id,
        v_record.requester_id,
        format('%s läuft bald aus: %s (%s)',
               case when v_kind = 'contract' then 'Vertrag' else 'Lizenz' end,
               v_record.title, to_char(v_record.ends_on, 'DD.MM.YYYY')),
        v_description
      );
      if v_ticket_id is null then
        continue;
      end if;
      execute format(
        'update public.%I set reminder_ticket_id = $1, reminder_sent_for = $2 where id = $3',
        case when v_kind = 'contract' then 'contracts' else 'licenses' end
      ) using v_ticket_id, v_record.ends_on, v_record.id;
      v_created := v_created + 1;
    end loop;
  end loop;
  return v_created;
end;
$$;
revoke all on function public.create_due_expiry_reminders()
  from public, anon, authenticated;
grant execute on function public.create_due_expiry_reminders() to service_role;

-- pg_cron fehlt in einigen lokalen Clustern. Wo es verfügbar ist, bleibt genau
-- ein benannter Zeitplan erhalten.
do $$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  for v_job_id in select jobid from cron.job where jobname = 'nextdesk-expiry-reminders'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'nextdesk-expiry-reminders',
    '15 5 * * *',
    'select public.create_due_expiry_reminders();'
  );
exception when others then
  null;
end;
$$;

commit;
