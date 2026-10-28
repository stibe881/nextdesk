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

commit;
