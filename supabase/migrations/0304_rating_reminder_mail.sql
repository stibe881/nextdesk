-- Erinnerung an die Bewertung: drei Tage nach der «Ticket gelöst»-Mail, wenn
-- das Ticket noch nicht bewertet wurde (einmal pro Ticket, nur für Mails ab
-- Einführung der Sternlinks).

alter table public.mail_messages
  drop constraint if exists mail_messages_kind_check;
alter table public.mail_messages
  add constraint mail_messages_kind_check
  check (kind in (
    'new_ticket', 'reply', 'acknowledgement', 'agent_reply', 'resolution', 'test',
    'department_question', 'department_answer', 'ticket_copy', 'notification',
    'security_notice', 'status_confirmation', 'status_change', 'rating_reminder'
  ));

create unique index if not exists mail_messages_rating_reminder_unique
  on public.mail_messages (ticket_id)
  where kind = 'rating_reminder' and ticket_id is not null;

create or replace function public.enqueue_rating_reminders(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer := 0;
  v_row record;
begin
  for v_row in
    select m.tenant_id, m.channel_id, m.exchange_configuration_version,
           m.ticket_id, m.from_address, m.to_addresses, m.subject
    from public.mail_messages m
    join public.tickets t on t.id = m.ticket_id and t.tenant_id = m.tenant_id
    join public.ticket_statuses s on s.id = t.status_id
    where m.direction = 'outbound'
      and m.kind = 'resolution'
      and m.processing_status = 'processed'
      -- Nur Gelöst-Mails mit Sternlinks (ab Einführung), nicht rückwirkend.
      and m.created_at >= timestamptz '2026-11-11 14:00:00+00'
      and m.created_at <= timezone('utc', now()) - interval '3 days'
      and m.created_at > timezone('utc', now()) - interval '10 days'
      and t.deleted_at is null
      and (s.key = 'resolved' or s.is_closed)
      and public.exchange_mail_feature_enabled(m.tenant_id)
      and not exists (
        select 1 from public.ticket_satisfaction rating
        where rating.ticket_id = t.id
      )
      and not exists (
        select 1 from public.mail_messages reminder
        where reminder.ticket_id = m.ticket_id
          and reminder.kind = 'rating_reminder'
      )
    order by m.created_at
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  loop
    insert into public.mail_messages (
      tenant_id, channel_id, exchange_configuration_version, direction, kind,
      ticket_id, from_address, to_addresses, subject
    )
    values (
      v_row.tenant_id, v_row.channel_id, v_row.exchange_configuration_version,
      'outbound', 'rating_reminder', v_row.ticket_id, v_row.from_address,
      v_row.to_addresses, v_row.subject
    )
    on conflict do nothing;
    if found then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.enqueue_rating_reminders(integer)
  from public, anon, authenticated;
grant execute on function public.enqueue_rating_reminders(integer)
  to service_role;

do $$
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  begin
    perform cron.unschedule('nextdesk-rating-reminders');
  exception when others then
    null;
  end;
  perform cron.schedule(
    'nextdesk-rating-reminders',
    '37 * * * *',
    'select public.enqueue_rating_reminders(200);'
  );
exception when others then
  null;
end;
$$;
