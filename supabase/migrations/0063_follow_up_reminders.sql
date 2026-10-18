begin;

set local search_path = pg_catalog, public;

alter table public.experience_follow_ups
  add column if not exists reminder_sent_at timestamptz;

create index if not exists experience_follow_ups_due_reminder_idx
  on public.experience_follow_ups (due_at, id)
  where resolved_at is null
    and reminder_sent_at is null
    and due_at is not null;

create or replace function public.experience_follow_ups_reset_reminder()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.due_at is distinct from old.due_at
     or (old.resolved_at is not null and new.resolved_at is null) then
    new.reminder_sent_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.experience_follow_ups_reset_reminder() from public, anon, authenticated;
drop trigger if exists experience_follow_ups_reset_reminder on public.experience_follow_ups;
create trigger experience_follow_ups_reset_reminder
  before update on public.experience_follow_ups
  for each row execute function public.experience_follow_ups_reset_reminder();

create or replace function public.follow_up_send_due_reminders()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_follow_up public.experience_follow_ups%rowtype;
  v_now timestamptz := now();
  v_notifications integer := 0;
begin
  for v_follow_up in
    select follow_up.*
    from public.experience_follow_ups follow_up
    where follow_up.resolved_at is null
      and follow_up.reminder_sent_at is null
      and follow_up.due_at is not null
      and follow_up.due_at <= v_now
    order by follow_up.due_at, follow_up.id
    for update skip locked
    limit 500
  loop
    -- Ticketlose Wiedervorlagen können vom bestehenden Push-Dispatcher nicht
    -- sicher geöffnet werden und werden deshalb ohne Push als erinnert markiert.
    if v_follow_up.due_at < v_now - interval '24 hours'
       or v_follow_up.ticket_id is null then
      update public.experience_follow_ups
      set reminder_sent_at = v_now
      where id = v_follow_up.id;
      continue;
    end if;

    perform public.push_insert_ticket_notification(
      v_follow_up.tenant_id,
      v_follow_up.owner_id,
      v_follow_up.ticket_id,
      'ticket.follow_up_due',
      jsonb_build_object(
        'followUpId', v_follow_up.id,
        'title', v_follow_up.title,
        'dueAt', v_follow_up.due_at
      ),
      null
    );

    update public.experience_follow_ups
    set reminder_sent_at = v_now
    where id = v_follow_up.id;

    if exists (
      select 1
      from public.tenant_memberships membership
      where membership.tenant_id = v_follow_up.tenant_id
        and membership.user_id = v_follow_up.owner_id
        and membership.status = 'active'
    ) then
      v_notifications := v_notifications + 1;
    end if;
  end loop;

  return v_notifications;
end;
$$;
revoke all on function public.follow_up_send_due_reminders() from public, anon, authenticated;

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
    when p_kind = 'ticket.escalation_opened' then 'escalation'
    when p_kind = 'ticket.follow_up_due' then 'follow_up'
    when p_kind like 'ticket.sla.%' then 'sla'
    else null
  end;
$$;
revoke all on function public.push_notification_category(text) from public, anon, authenticated;

alter table public.push_preferences
  alter column enabled_categories set default array[
    'assigned', 'requester_reply', 'support_reply', 'mention',
    'resolved', 'sla', 'escalation', 'approval', 'follow_up'
  ]::text[];
alter table public.push_preferences
  drop constraint if exists push_preferences_categories_valid;
alter table public.push_preferences
  add constraint push_preferences_categories_valid
  check (
    enabled_categories <@ array[
      'assigned', 'requester_reply', 'support_reply', 'mention',
      'resolved', 'sla', 'escalation', 'approval', 'follow_up'
    ]::text[]
    and public.push_categories_are_unique(enabled_categories)
  );

update public.push_preferences
set enabled_categories = array_append(enabled_categories, 'follow_up')
where not ('follow_up' = any(enabled_categories));

create or replace function public.push_enqueue_ticket_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_category text;
  v_categories text[];
begin
  v_category := public.push_notification_category(new.kind);
  if v_category is null
     or not public.push_tenant_feature_enabled(new.tenant_id)
     or not exists (
       select 1 from public.tenant_memberships membership
       where membership.tenant_id = new.tenant_id
         and membership.user_id = new.user_id
         and membership.status = 'active'
     )
     or not exists (
       select 1 from public.push_devices device
       where device.tenant_id = new.tenant_id
         and device.user_id = new.user_id
         and device.enabled
     ) then
    return new;
  end if;

  select preference.enabled_categories
  into v_categories
  from public.push_preferences preference
  where preference.tenant_id = new.tenant_id
    and preference.user_id = new.user_id;
  v_categories := coalesce(v_categories, array[
    'assigned', 'requester_reply', 'support_reply', 'mention',
    'resolved', 'sla', 'escalation', 'approval', 'follow_up'
  ]::text[]);
  if not v_category = any(v_categories) then
    return new;
  end if;

  insert into public.push_outbox (tenant_id, user_id, notification_id)
  values (new.tenant_id, new.user_id, new.id)
  on conflict (notification_id) do nothing;
  return new;
exception when others then
  -- Ein verzögerter Anbieter darf die In-App-Benachrichtigung nie verhindern.
  return new;
end;
$$;
revoke all on function public.push_enqueue_ticket_notification() from public, anon, authenticated;

-- pg_cron fehlt in einigen lokalen Clustern. Wo es verfügbar ist, bleibt genau
-- ein benannter Zeitplan erhalten, damit wiederholte Anwendungen sicher sind.
do $$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  for v_job_id in select jobid from cron.job where jobname = 'nextdesk-follow-up-reminders'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'nextdesk-follow-up-reminders',
    '* * * * *',
    'select public.follow_up_send_due_reminders();'
  );
exception when others then
  -- Eine eingeschränkte Cron-Installation darf die Migration nicht verhindern.
  null;
end;
$$;

comment on column public.experience_follow_ups.reminder_sent_at is
  'Zeitpunkt, zu dem die fällige Wiedervorlage verarbeitet wurde; eine neue Fälligkeit oder Wiedereröffnung setzt den Wert zurück.';
comment on function public.follow_up_send_due_reminders() is
  'Verarbeitet fällige Wiedervorlagen mit SKIP LOCKED, erzeugt für ticketgebundene Einträge eine In-App-Benachrichtigung und markiert Altbestände ohne Push als verarbeitet.';

commit;
