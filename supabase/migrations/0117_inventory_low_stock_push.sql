begin;

set local search_path = pg_catalog, public;

-- Unterbestand bleibt eine persönliche, standardmässig ausgeschaltete Kategorie.
-- Bestehende Präferenzen und die Standardwerte neuer Präferenzen werden bewusst
-- nicht verändert; ohne einen ausdrücklichen persönlichen Eintrag gibt es keine
-- Zustellung.
create or replace function public.push_delivery_modes_valid(p_modes jsonb)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select jsonb_typeof(p_modes) = 'object'
    and not exists (
      select 1
      from jsonb_each_text(p_modes) as mode(category, delivery_mode)
      where category not in (
        'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
        'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline',
        'inventory_low_stock'
      )
      or delivery_mode not in ('immediate', 'summary', 'off')
    );
$$;
revoke all on function public.push_delivery_modes_valid(jsonb) from public, anon, authenticated;
grant execute on function public.push_delivery_modes_valid(jsonb) to service_role;

alter table public.push_preferences
  drop constraint if exists push_preferences_delivery_modes_valid;
alter table public.push_preferences
  add constraint push_preferences_delivery_modes_valid
  check (public.push_delivery_modes_valid(category_modes));

alter table public.push_preferences
  drop constraint if exists push_preferences_categories_valid;
alter table public.push_preferences
  add constraint push_preferences_categories_valid
  check (
    enabled_categories <@ array[
      'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
      'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline',
      'inventory_low_stock'
    ]::text[]
    and public.push_categories_are_unique(enabled_categories)
  );

-- This mirrors the tenant feature resolver: a missing, disabled or expired flag
-- is never sufficient to create a low-stock episode or delivery.
create or replace function public.inventory_management_feature_enabled(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce((
    select flag.enabled = true
      and (
        flag.pilot_ends_at is null
        or flag.pilot_ends_at > timezone('utc', now())
      )
    from public.tenant_feature_flags flag
    where flag.tenant_id = p_tenant_id
      and flag.feature_key = 'inventory.management'
  ), false);
$$;
revoke all on function public.inventory_management_feature_enabled(uuid)
  from public, anon, authenticated;

-- The exact boundary is shared by queue creation, the claim and the Edge
-- dispatcher. A preference row is mandatory: the category can never inherit a
-- historical push default. The central permission helper additionally verifies
-- an active membership, a current tenant-scoped role and an active tenant.
create or replace function public.inventory_low_stock_delivery_authorized(
  p_tenant_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select p_tenant_id is not null
    and p_user_id is not null
    and public.inventory_management_feature_enabled(p_tenant_id)
    and public.push_tenant_feature_enabled(p_tenant_id)
    and exists (
      select 1
      from public.tenant_memberships membership
      where membership.tenant_id = p_tenant_id
        and membership.user_id = p_user_id
        and membership.status = 'active'
    )
    and public.user_has_tenant_permission(
      p_user_id,
      p_tenant_id,
      'inventory.manage'
    )
    and exists (
      select 1
      from public.push_devices device
      where device.tenant_id = p_tenant_id
        and device.user_id = p_user_id
        and device.enabled
    )
    and exists (
      select 1
      from public.push_preferences preference
      where preference.tenant_id = p_tenant_id
        and preference.user_id = p_user_id
        and preference.global_enabled
        and public.push_delivery_mode(
          preference.category_modes,
          preference.enabled_categories,
          'inventory_low_stock'
        ) in ('immediate', 'summary')
    );
$$;
revoke all on function public.inventory_low_stock_delivery_authorized(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.inventory_low_stock_delivery_authorized(uuid, uuid)
  to service_role;

-- An episode represents one uninterrupted interval below or at the item-wide
-- minimum. Availability is never stored here: it is always derived from the
-- authoritative balance projection across every location.
create table public.inventory_low_stock_episodes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id uuid not null,
  opened_by_event_id uuid not null,
  opened_by_actor_id uuid not null references public.user_profiles(id) on delete restrict,
  opened_at timestamptz not null default timezone('utc', now()),
  recovered_by_event_id uuid,
  recovered_by_actor_id uuid references public.user_profiles(id) on delete restrict,
  recovered_at timestamptz,
  constraint inventory_low_stock_episodes_id_tenant_unique unique (id, tenant_id),
  constraint inventory_low_stock_episodes_item_tenant_fk
    foreign key (item_id, tenant_id)
    references public.inventory_items (id, tenant_id) on delete restrict,
  constraint inventory_low_stock_episodes_open_event_tenant_fk
    foreign key (opened_by_event_id, tenant_id)
    references public.inventory_events (id, tenant_id) on delete restrict,
  constraint inventory_low_stock_episodes_recovered_event_tenant_fk
    foreign key (recovered_by_event_id, tenant_id)
    references public.inventory_events (id, tenant_id) on delete restrict,
  constraint inventory_low_stock_episodes_recovery_shape
    check (
      (recovered_at is null and recovered_by_event_id is null and recovered_by_actor_id is null)
      or (
        recovered_at is not null
        and recovered_by_event_id is not null
        and recovered_by_actor_id is not null
      )
    )
);
create unique index inventory_low_stock_episodes_open_item_unique
  on public.inventory_low_stock_episodes (tenant_id, item_id)
  where recovered_at is null;
create index inventory_low_stock_episodes_tenant_item_opened_idx
  on public.inventory_low_stock_episodes (tenant_id, item_id, opened_at desc);

-- Der Schlüssel macht die Benachrichtigungsreferenz in den Empfängerbelegen
-- mandantengebunden. `id` ist zwar bereits global eindeutig, PostgreSQL
-- benötigt für den zusammengesetzten Fremdschlüssel aber einen passenden
-- eindeutigen Elternschlüssel.
alter table public.ticket_notifications
  add constraint ticket_notifications_id_tenant_unique unique (id, tenant_id);

-- The durable recipient receipt is the once-per-person-per-episode fence. The
-- linked notification is intentionally ticket-free and contains opaque IDs
-- only; it uses the existing in-app notification and push outbox triggers.
create table public.inventory_low_stock_episode_recipients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  episode_id uuid not null,
  recipient_user_id uuid not null,
  notification_id uuid not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  constraint inventory_low_stock_episode_recipients_episode_tenant_fk
    foreign key (episode_id, tenant_id)
    references public.inventory_low_stock_episodes (id, tenant_id) on delete cascade,
  constraint inventory_low_stock_episode_recipients_notification_tenant_fk
    foreign key (notification_id, tenant_id)
    references public.ticket_notifications (id, tenant_id) on delete cascade,
  constraint inventory_low_stock_recipient_membership_tenant_fk
    foreign key (tenant_id, recipient_user_id)
    references public.tenant_memberships (tenant_id, user_id) on delete cascade,
  constraint inventory_low_stock_episode_recipients_episode_recipient_unique
    unique (episode_id, recipient_user_id)
);
create index inventory_low_stock_episode_recipients_tenant_recipient_idx
  on public.inventory_low_stock_episode_recipients (
    tenant_id, recipient_user_id, created_at desc
  );

-- Every episode state change and recipient receipt is auditable without placing
-- item names, quantities, locations, supplier data or device tokens in the log.
create or replace function public.audit_inventory_low_stock_episode_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor_id uuid;
  v_action text;
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'inventory_low_stock_episodes' then
    raise exception 'Unsupported inventory low-stock audit target' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    v_actor_id := new.opened_by_actor_id;
    v_action := 'inventory.low_stock.episode.opened';
  elsif tg_op = 'UPDATE'
    and old.recovered_at is null
    and new.recovered_at is not null then
    v_actor_id := new.recovered_by_actor_id;
    v_action := 'inventory.low_stock.episode.recovered';
  else
    return new;
  end if;

  if exists (select 1 from public.tenants where id = new.tenant_id) then
    insert into public.audit_logs (
      tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
    ) values (
      new.tenant_id,
      v_actor_id,
      v_action,
      'inventory_low_stock_episode',
      new.id,
      'info',
      jsonb_build_object('item_id', new.item_id, 'event_id', case
        when tg_op = 'INSERT' then new.opened_by_event_id
        else new.recovered_by_event_id
      end)
    );
  end if;
  return new;
end;
$$;
revoke all on function public.audit_inventory_low_stock_episode_change()
  from public, anon, authenticated;

alter table public.inventory_low_stock_episodes enable row level security;
alter table public.inventory_low_stock_episodes force row level security;
revoke all on table public.inventory_low_stock_episodes from public, anon, authenticated;
grant select, insert, update, delete on table public.inventory_low_stock_episodes to service_role;
create policy inventory_low_stock_episodes_service_role_only
  on public.inventory_low_stock_episodes
  for all to service_role using (true) with check (true);

drop trigger if exists inventory_low_stock_episodes_audit_change
  on public.inventory_low_stock_episodes;
create trigger inventory_low_stock_episodes_audit_change
  after insert or update on public.inventory_low_stock_episodes
  for each row execute function public.audit_inventory_low_stock_episode_change();

create or replace function public.audit_inventory_low_stock_recipient_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor_id uuid;
begin
  if tg_table_schema <> 'public'
    or tg_table_name <> 'inventory_low_stock_episode_recipients'
    or tg_op <> 'INSERT' then
    raise exception 'Unsupported inventory low-stock recipient audit target' using errcode = '22023';
  end if;

  select episode.opened_by_actor_id
  into v_actor_id
  from public.inventory_low_stock_episodes episode
  where episode.id = new.episode_id
    and episode.tenant_id = new.tenant_id;

  if v_actor_id is not null
    and exists (select 1 from public.tenants where id = new.tenant_id) then
    insert into public.audit_logs (
      tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
    ) values (
      new.tenant_id,
      v_actor_id,
      'inventory.low_stock.recipient.recorded',
      'inventory_low_stock_episode_recipient',
      new.id,
      'info',
      jsonb_build_object('episode_id', new.episode_id)
    );
  end if;
  return new;
end;
$$;
revoke all on function public.audit_inventory_low_stock_recipient_change()
  from public, anon, authenticated;

alter table public.inventory_low_stock_episode_recipients enable row level security;
alter table public.inventory_low_stock_episode_recipients force row level security;
revoke all on table public.inventory_low_stock_episode_recipients from public, anon, authenticated;
grant select, insert, update, delete on table public.inventory_low_stock_episode_recipients to service_role;
create policy inventory_low_stock_episode_recipients_service_role_only
  on public.inventory_low_stock_episode_recipients
  for all to service_role using (true) with check (true);

drop trigger if exists inventory_low_stock_episode_recipients_audit_change
  on public.inventory_low_stock_episode_recipients;
create trigger inventory_low_stock_episode_recipients_audit_change
  after insert on public.inventory_low_stock_episode_recipients
  for each row execute function public.audit_inventory_low_stock_recipient_change();

-- The existing enqueue trigger remains the only path into push_outbox. It gets
-- an additional, exact authorization branch for the sole ticket-free kind.
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
    when p_kind = 'ticket.follow_up_due' then 'follow_up'
    when p_kind = 'ticket.escalation_opened' then 'escalation'
    when p_kind like 'ticket.sla.%' then 'sla'
    when p_kind = 'contract.deadline' then 'contract_deadline'
    when p_kind = 'inventory.low_stock' then 'inventory_low_stock'
    else null
  end;
$$;
revoke all on function public.push_notification_category(text) from public, anon, authenticated;

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
  if v_category is null then
    return new;
  end if;

  if new.kind = 'inventory.low_stock' then
    if not public.inventory_low_stock_delivery_authorized(new.tenant_id, new.user_id) then
      return new;
    end if;
  elsif not public.push_tenant_feature_enabled(new.tenant_id)
    or not exists (
      select 1
      from public.tenant_memberships membership
      where membership.tenant_id = new.tenant_id
        and membership.user_id = new.user_id
        and membership.status = 'active'
    )
    or not exists (
      select 1
      from public.push_devices device
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
    'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
    'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline'
  ]::text[]);
  if not v_category = any(v_categories) then
    return new;
  end if;

  insert into public.push_outbox (tenant_id, user_id, notification_id)
  values (new.tenant_id, new.user_id, new.id)
  on conflict (notification_id) do nothing;
  return new;
exception when others then
  -- A deferred provider must not change the outcome of the in-app notification.
  return new;
end;
$$;
revoke all on function public.push_enqueue_ticket_notification()
  from public, anon, authenticated;

-- Evaluate after the immutable ledger lines have been inserted as one statement.
-- Transfers therefore expose only their final cross-location item availability,
-- never the debit side of their counterbooking pair.
create or replace function public.inventory_evaluate_low_stock_after_event_lines()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_change record;
  v_episode public.inventory_low_stock_episodes%rowtype;
  v_has_open_episode boolean;
  v_minimum numeric(18,3);
  v_available numeric(18,3);
  v_recipient record;
  v_notification_id uuid;
begin
  for v_change in
    select distinct
      line.tenant_id,
      line.item_id,
      line.event_id,
      event.actor_id
    from new_inventory_event_lines line
    join public.inventory_events event
      on event.id = line.event_id
      and event.tenant_id = line.tenant_id
    order by line.tenant_id, line.item_id, line.event_id
  loop
    -- Serializes episode transitions even when concurrent postings affect
    -- different locations of the same item.
    perform pg_advisory_xact_lock(hashtextextended(
      'nextdesk:inventory-low-stock:' || v_change.tenant_id::text || ':' || v_change.item_id::text,
      0
    ));

    select
      item.minimum_quantity,
      coalesce(sum(balance.physical_quantity - balance.reserved_quantity), 0)
    into v_minimum, v_available
    from public.inventory_items item
    left join public.inventory_stock_balances balance
      on balance.tenant_id = item.tenant_id
      and balance.item_id = item.id
    where item.id = v_change.item_id
      and item.tenant_id = v_change.tenant_id
    group by item.minimum_quantity;
    if not found then
      continue;
    end if;

    select *
    into v_episode
    from public.inventory_low_stock_episodes episode
    where episode.tenant_id = v_change.tenant_id
      and episode.item_id = v_change.item_id
      and episode.recovered_at is null
    for update;
    v_has_open_episode := found;

    if v_available <= v_minimum then
      if not v_has_open_episode then
        if not public.inventory_management_feature_enabled(v_change.tenant_id)
          or not public.push_tenant_feature_enabled(v_change.tenant_id) then
          continue;
        end if;

        insert into public.inventory_low_stock_episodes (
          tenant_id,
          item_id,
          opened_by_event_id,
          opened_by_actor_id
        ) values (
          v_change.tenant_id,
          v_change.item_id,
          v_change.event_id,
          v_change.actor_id
        ) returning * into v_episode;
        v_has_open_episode := true;
      end if;

      -- A recipient can be added later in the same episode only when a new
      -- inventory event occurs. This remains event-driven and is fenced by the
      -- durable unique receipt. The opening actor and the current booking actor
      -- are both excluded, so a booking actor never receives their own alert.
      for v_recipient in
        select membership.user_id
        from public.tenant_memberships membership
        where membership.tenant_id = v_change.tenant_id
          and membership.status = 'active'
          and membership.user_id <> v_change.actor_id
          and membership.user_id <> v_episode.opened_by_actor_id
          and public.inventory_low_stock_delivery_authorized(
            v_change.tenant_id,
            membership.user_id
          )
          and not exists (
            select 1
            from public.inventory_low_stock_episode_recipients recipient
            where recipient.episode_id = v_episode.id
              and recipient.recipient_user_id = membership.user_id
          )
        order by membership.user_id
      loop
        insert into public.ticket_notifications (
          tenant_id,
          user_id,
          ticket_id,
          kind,
          payload
        ) values (
          v_change.tenant_id,
          v_recipient.user_id,
          null,
          'inventory.low_stock',
          jsonb_build_object(
            'inventoryEpisodeId', v_episode.id,
            'inventoryItemId', v_change.item_id
          )
        ) returning id into v_notification_id;

        insert into public.inventory_low_stock_episode_recipients (
          tenant_id,
          episode_id,
          recipient_user_id,
          notification_id
        ) values (
          v_change.tenant_id,
          v_episode.id,
          v_recipient.user_id,
          v_notification_id
        );
      end loop;
    elsif v_has_open_episode then
      update public.inventory_low_stock_episodes
      set recovered_at = timezone('utc', now()),
          recovered_by_event_id = v_change.event_id,
          recovered_by_actor_id = v_change.actor_id
      where id = v_episode.id
        and tenant_id = v_change.tenant_id
        and recovered_at is null;
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function public.inventory_evaluate_low_stock_after_event_lines()
  from public, anon, authenticated;

drop trigger if exists inventory_evaluate_low_stock_after_event_lines
  on public.inventory_event_lines;
create trigger inventory_evaluate_low_stock_after_event_lines
  after insert on public.inventory_event_lines
  referencing new table as new_inventory_event_lines
  for each statement execute function public.inventory_evaluate_low_stock_after_event_lines();

-- Queue rows can outlive a role or membership change. Null ticket IDs are only
-- valid for the exact inventory kind and are checked against the same full
-- delivery boundary before every claim.
create or replace function public.push_skip_unauthorized_ticket_outbox()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_skipped integer := 0;
begin
  update public.push_outbox outbox
  set status = 'skipped',
      last_error = 'recipient_not_authorized',
      claimed_at = null
  from public.ticket_notifications notification
  where outbox.source_type = 'ticket'
    and outbox.notification_id = notification.id
    and outbox.tenant_id = notification.tenant_id
    and outbox.status in ('pending', 'sending')
    and not coalesce(
      case
        when notification.ticket_id is not null then
          public.ticket_notification_recipient_authorized(
            outbox.tenant_id,
            notification.ticket_id,
            outbox.user_id
          )
        when notification.ticket_id is null
          and notification.kind = 'inventory.low_stock' then
          public.inventory_low_stock_delivery_authorized(
            outbox.tenant_id,
            outbox.user_id
          )
        else false
      end,
      false
    );
  get diagnostics v_skipped = row_count;
  return v_skipped;
end;
$$;
revoke all on function public.push_skip_unauthorized_ticket_outbox()
  from public, anon, authenticated;
grant execute on function public.push_skip_unauthorized_ticket_outbox()
  to service_role;

create or replace function public.push_claim_outbox_v2(p_limit integer default 50)
returns table (
  outbox_id uuid,
  tenant_id uuid,
  user_id uuid,
  notification_id uuid,
  source_type text,
  ticket_id uuid,
  contract_id uuid,
  kind text,
  ticket_number text,
  subject text,
  delivery_mode text,
  devices jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row record;
  v_kind text;
  v_ticket_id uuid;
  v_contract_id uuid;
  v_ticket_number text;
  v_subject text;
  v_ticket_available boolean;
  v_category text;
  v_mode text;
  v_global_enabled boolean;
  v_modes jsonb;
  v_enabled_categories text[];
  v_summary_hour smallint;
  v_timezone text;
  v_local_hour integer;
  v_quiet_enabled boolean;
  v_quiet_start smallint;
  v_quiet_end smallint;
  v_quiet boolean;
  v_devices jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'invalid_push_claim_limit' using errcode = '22023';
  end if;

  update public.push_outbox
  set status = 'failed', last_error = 'attempt_limit'
  where status in ('pending', 'sending') and attempts >= 3;

  for v_row in
    select outbox.*
    from public.push_outbox outbox
    where outbox.attempts < 3
      and outbox.available_at <= timezone('utc', now())
      and (outbox.status = 'pending' or (
        outbox.status = 'sending'
        and outbox.claimed_at < timezone('utc', now()) - interval '5 minutes'
      ))
    order by outbox.available_at, outbox.created_at, outbox.id
    for update skip locked
    limit p_limit
  loop
    if not public.push_tenant_feature_enabled(v_row.tenant_id) then
      update public.push_outbox set status = 'skipped', last_error = 'feature_disabled'
      where id = v_row.id;
      continue;
    end if;
    if not exists (
      select 1
      from public.tenant_memberships membership
      where membership.tenant_id = v_row.tenant_id
        and membership.user_id = v_row.user_id
        and membership.status = 'active'
    ) then
      update public.push_outbox set status = 'skipped', last_error = 'membership_inactive'
      where id = v_row.id;
      continue;
    end if;

    v_kind := null;
    v_ticket_id := null;
    v_contract_id := null;
    v_ticket_number := null;
    v_subject := null;
    v_ticket_available := false;
    if v_row.source_type = 'ticket' then
      select
        notification.kind,
        notification.ticket_id,
        ticket.id is not null,
        ticket.ticket_number,
        case
          when feature.configuration ->> 'contentLevel' = 'subject'
            then ticket.subject
          else null
        end
      into
        v_kind,
        v_ticket_id,
        v_ticket_available,
        v_ticket_number,
        v_subject
      from public.ticket_notifications notification
      join public.tenant_feature_flags feature
        on feature.tenant_id = notification.tenant_id
        and feature.feature_key = 'notifications.push'
      left join public.tickets ticket
        on ticket.id = notification.ticket_id
        and ticket.tenant_id = notification.tenant_id
      where notification.id = v_row.notification_id
        and notification.tenant_id = v_row.tenant_id;
      if not found then
        update public.push_outbox set status = 'skipped', last_error = 'ticket_unavailable'
        where id = v_row.id;
        continue;
      end if;

      if v_ticket_id is null then
        if v_kind <> 'inventory.low_stock'
          or not public.inventory_low_stock_delivery_authorized(
            v_row.tenant_id,
            v_row.user_id
          ) then
          update public.push_outbox set status = 'skipped', last_error = 'recipient_not_authorized'
          where id = v_row.id;
          continue;
        end if;
      elsif not v_ticket_available
        or not public.ticket_notification_recipient_authorized(
          v_row.tenant_id,
          v_ticket_id,
          v_row.user_id
        ) then
        update public.push_outbox set status = 'skipped', last_error = 'recipient_not_authorized'
        where id = v_row.id;
        continue;
      end if;
    else
      select event.contract_id, 'contract.deadline'::text
      into v_contract_id, v_kind
      from public.contract_deadline_push_events event
      where event.id = v_row.contract_event_id
        and event.tenant_id = v_row.tenant_id
        and event.recipient_user_id = v_row.user_id;
      if not found or not public.push_contract_delivery_authorized(
        v_row.tenant_id,
        v_row.user_id,
        v_contract_id
      ) then
        update public.push_outbox set status = 'skipped', last_error = 'recipient_not_authorized'
        where id = v_row.id;
        continue;
      end if;
    end if;

    v_category := public.push_notification_category(v_kind);
    if v_category is null then
      update public.push_outbox set status = 'skipped', last_error = 'unsupported_kind'
      where id = v_row.id;
      continue;
    end if;

    select preference.global_enabled, preference.category_modes, preference.enabled_categories,
           preference.summary_hour, preference.quiet_hours_enabled, preference.quiet_start,
           preference.quiet_end, preference.timezone
    into v_global_enabled, v_modes, v_enabled_categories, v_summary_hour,
         v_quiet_enabled, v_quiet_start, v_quiet_end, v_timezone
    from public.push_preferences preference
    where preference.tenant_id = v_row.tenant_id
      and preference.user_id = v_row.user_id;
    v_global_enabled := coalesce(v_global_enabled, true);
    v_modes := coalesce(v_modes, '{}'::jsonb);
    v_enabled_categories := coalesce(v_enabled_categories, array[
      'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
      'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline'
    ]::text[]);
    v_summary_hour := coalesce(v_summary_hour, 8);
    v_quiet_enabled := coalesce(v_quiet_enabled, false);
    v_quiet_start := coalesce(v_quiet_start, 22);
    v_quiet_end := coalesce(v_quiet_end, 7);
    v_timezone := coalesce(v_timezone, 'Europe/Zurich');
    if not v_global_enabled then
      update public.push_outbox set status = 'skipped', last_error = 'global_disabled'
      where id = v_row.id;
      continue;
    end if;
    v_mode := public.push_delivery_mode(v_modes, v_enabled_categories, v_category);
    if v_mode = 'off' then
      update public.push_outbox set status = 'skipped', last_error = 'preference_disabled'
      where id = v_row.id;
      continue;
    end if;

    begin
      v_local_hour := extract(hour from timezone(v_timezone, now()))::integer;
    exception when others then
      v_timezone := 'Europe/Zurich';
      v_local_hour := extract(hour from timezone(v_timezone, now()))::integer;
    end;
    v_quiet := v_quiet_enabled and v_quiet_start <> v_quiet_end and case
      when v_quiet_start < v_quiet_end then v_local_hour >= v_quiet_start and v_local_hour < v_quiet_end
      else v_local_hour >= v_quiet_start or v_local_hour < v_quiet_end
    end;
    if v_quiet or not coalesce((public.push_work_state(v_row.tenant_id, v_row.user_id) ->> 'active')::boolean, false) then
      update public.push_outbox
      set status = 'pending', claimed_at = null, available_at = timezone('utc', now()) + interval '15 minutes',
          last_error = case when v_quiet then 'deferred_quiet_hours' else 'deferred_off_shift' end
      where id = v_row.id;
      continue;
    end if;
    if v_mode = 'summary' and v_local_hour <> v_summary_hour then
      update public.push_outbox
      set status = 'pending', claimed_at = null, available_at = timezone('utc', now()) + interval '15 minutes',
          last_error = 'deferred_summary'
      where id = v_row.id;
      continue;
    end if;

    select jsonb_agg(jsonb_build_object(
      'id', device.id, 'token', device.apns_token, 'environment', device.apns_environment
    ) order by device.created_at)
    into v_devices
    from public.push_devices device
    where device.tenant_id = v_row.tenant_id
      and device.user_id = v_row.user_id
      and device.enabled;
    if v_devices is null then
      update public.push_outbox set status = 'skipped', last_error = 'no_active_devices'
      where id = v_row.id;
      continue;
    end if;

    update public.push_outbox
    set status = 'sending', attempts = attempts + 1,
        claimed_at = timezone('utc', now()), last_error = null
    where id = v_row.id;
    outbox_id := v_row.id;
    tenant_id := v_row.tenant_id;
    user_id := v_row.user_id;
    notification_id := v_row.notification_id;
    source_type := v_row.source_type;
    ticket_id := v_ticket_id;
    contract_id := v_contract_id;
    kind := v_kind;
    ticket_number := v_ticket_number;
    subject := v_subject;
    delivery_mode := v_mode;
    devices := v_devices;
    return next;
  end loop;
end;
$$;
revoke all on function public.push_claim_outbox_v2(integer)
  from public, anon, authenticated;
grant execute on function public.push_claim_outbox_v2(integer) to service_role;

comment on table public.inventory_low_stock_episodes is
  'Private, auditable Unterbestandsepisoden je Mandant und Artikel; Mengen und Standorte werden nicht gespeichert.';
comment on table public.inventory_low_stock_episode_recipients is
  'Private, auditable Empfängerbelege: höchstens eine Benachrichtigung pro berechtigter Person und Unterbestandsepisode.';
comment on function public.inventory_low_stock_delivery_authorized(uuid, uuid) is
  'Service-only Zustellgrenze für Unterbestand: Featureflags, aktive Mitgliedschaft/Rolle, aktives Gerät und explizites persönliches Opt-in.';
comment on function public.inventory_evaluate_low_stock_after_event_lines() is
  'Bewertet Artikelgesamtverfügbarkeit erst nach vollständigen Ledgerzeilen eines Events und erzeugt transaktionale Unterbestandsepisoden.';

commit;
