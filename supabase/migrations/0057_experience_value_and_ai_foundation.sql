begin;

set local search_path = pg_catalog, public;

-- Extend the catalogue taxonomy without rewriting historical feature choices.
alter table public.feature_catalog
  drop constraint if exists feature_catalog_category_check;
alter table public.feature_catalog
  add constraint feature_catalog_category_check
  check (category in (
    'ticketing', 'automation', 'knowledge', 'reporting', 'integrations', 'assets',
    'experience', 'portal', 'ai', 'webhooks'
  ));

-- These are the complete 0057 feature entries. Existing tenant-specific flag
-- choices are deliberately never overwritten by the flag backfill below.
insert into public.feature_catalog (key, name, description, category, default_enabled)
values
  ('experience.workspace', 'Arbeitsbereich', 'Persönliche Arbeitsbereichseinstellungen, Wiedervorlagen und Mein Tag.', 'experience', true),
  ('portal.self-service', 'Self-Service', 'Servicekatalog bei der Erfassung und Lösungsbestätigung durch Anfragende.', 'portal', true),
  ('ai.assist', 'KI-Assistenz', 'Vorbereitete KI-Entwürfe unter expliziter Mandantenfreigabe ohne Provideraufruf.', 'ai', false),
  ('webhooks.outbound', 'Ausgehende Webhooks', 'Kontrollierte Auslieferung mandantenbezogener Ereignisse an externe Endpunkte.', 'webhooks', false)
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      category = excluded.category,
      default_enabled = excluded.default_enabled;

-- Future tenants are initialized by initialize_tenant_feature_flags(). This
-- backfill intentionally creates only rows that are currently absent.
insert into public.tenant_feature_flags (tenant_id, feature_key, enabled)
select tenant.id, catalog.key, catalog.default_enabled
from public.tenants tenant
join public.feature_catalog catalog on catalog.key in (
  'experience.workspace', 'portal.self-service', 'ai.assist', 'webhooks.outbound'
)
on conflict (tenant_id, feature_key) do nothing;

-- A bounded object is preferable to an open-ended preference document. The
-- Edge Function validates the only supported keys and value domains.
create table public.workspace_preferences (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,
  preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(preferences) = 'object')
    check (octet_length(preferences::text) <= 4096),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, user_id),
  constraint workspace_preferences_membership_tenant_fk
    foreign key (tenant_id, user_id)
    references public.tenant_memberships (tenant_id, user_id)
    on delete cascade
);

-- Follow-ups are personal reminders. A ticket is optional, but when provided
-- its tenant is constrained by a composite FK. Nothing here changes tickets.
create table public.experience_follow_ups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  owner_id uuid not null,
  ticket_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  description text check (description is null or char_length(description) <= 5000),
  due_at timestamptz,
  priority text not null check (priority in ('low', 'normal', 'high')),
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint experience_follow_ups_id_tenant_unique unique (id, tenant_id),
  constraint experience_follow_ups_owner_tenant_fk
    foreign key (tenant_id, owner_id)
    references public.tenant_memberships (tenant_id, user_id)
    on delete restrict,
  constraint experience_follow_ups_ticket_tenant_fk
    foreign key (ticket_id, tenant_id)
    references public.tickets (id, tenant_id)
    on delete restrict,
  constraint experience_follow_ups_resolved_by_tenant_fk
    foreign key (tenant_id, resolved_by)
    references public.tenant_memberships (tenant_id, user_id)
    on delete restrict,
  constraint experience_follow_ups_resolution_consistency_check check (
    (resolved_at is null and resolved_by is null)
    or (resolved_at is not null and resolved_by is not null)
  )
);

-- A confirmation is an immutable response from an affected/requesting person.
-- It is separate from tickets and therefore cannot resolve, close, reassign or
-- otherwise mutate their lifecycle.
create table public.ticket_resolution_confirmations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null,
  confirmed_by uuid not null,
  confirmed boolean not null,
  comment text check (comment is null or char_length(comment) <= 3000),
  confirmed_at timestamptz not null default timezone('utc', now()),
  constraint ticket_resolution_confirmations_id_tenant_unique unique (id, tenant_id),
  constraint ticket_resolution_confirmations_ticket_tenant_fk
    foreign key (ticket_id, tenant_id)
    references public.tickets (id, tenant_id)
    on delete restrict,
  constraint ticket_resolution_confirmations_actor_tenant_fk
    foreign key (tenant_id, confirmed_by)
    references public.tenant_memberships (tenant_id, user_id)
    on delete restrict
);

-- Provider approvals store governance settings only. Provider credentials,
-- endpoints, prompts, input and generated output are never accepted here.
create table public.tenant_ai_provider_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider_key text not null default 'nextdesk-managed'
    check (provider_key = 'nextdesk-managed'),
  enabled boolean not null default false,
  allowed_purposes text[] not null default array[
    'general_draft', 'ticket_reply_draft', 'knowledge_article_draft'
  ]::text[]
    check (cardinality(allowed_purposes) between 1 and 3)
    check (allowed_purposes <@ array[
      'general_draft', 'ticket_reply_draft', 'knowledge_article_draft'
    ]::text[])
    check (array_position(allowed_purposes, null) is null),
  approved_by uuid not null references public.user_profiles(id) on delete restrict,
  approved_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz,
  max_requests_per_hour integer not null default 100
    check (max_requests_per_hour between 1 and 10000),
  max_output_tokens integer not null default 1024
    check (max_output_tokens between 1 and 8192),
  max_cost_cents_per_request integer not null default 50
    check (max_cost_cents_per_request between 1 and 10000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint tenant_ai_provider_approvals_id_tenant_unique unique (id, tenant_id),
  constraint tenant_ai_provider_approvals_tenant_provider_unique unique (tenant_id, provider_key),
  constraint tenant_ai_provider_approvals_dates_check check (
    expires_at is null or expires_at > approved_at
  )
);

-- This is a queue of request metadata, not an AI content store. The object ID
-- is optional only for a general draft; raw input and model output have no
-- column in this table by design.
create table public.ai_draft_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  approval_id uuid not null,
  actor_id uuid not null,
  provider_key text not null check (provider_key = 'nextdesk-managed'),
  purpose text not null check (purpose in (
    'general_draft', 'ticket_reply_draft', 'knowledge_article_draft'
  )),
  object_type text not null check (object_type in ('none', 'ticket', 'knowledge_article')),
  object_id uuid,
  input_character_count integer not null check (input_character_count between 1 and 1200),
  max_output_tokens integer not null check (max_output_tokens between 16 and 1024),
  max_cost_cents integer not null check (max_cost_cents between 1 and 50),
  created_at timestamptz not null default timezone('utc', now()),
  constraint ai_draft_requests_id_tenant_unique unique (id, tenant_id),
  constraint ai_draft_requests_approval_tenant_fk
    foreign key (approval_id, tenant_id)
    references public.tenant_ai_provider_approvals (id, tenant_id)
    on delete restrict,
  constraint ai_draft_requests_actor_tenant_fk
    foreign key (tenant_id, actor_id)
    references public.tenant_memberships (tenant_id, user_id)
    on delete restrict,
  constraint ai_draft_requests_object_consistency_check check (
    (object_type = 'none' and object_id is null and purpose = 'general_draft')
    or (object_type = 'ticket' and object_id is not null and purpose = 'ticket_reply_draft')
    or (object_type = 'knowledge_article' and object_id is not null and purpose = 'knowledge_article_draft')
  )
);

create index workspace_preferences_user_tenant_idx
  on public.workspace_preferences (user_id, tenant_id);
create index experience_follow_ups_owner_open_due_idx
  on public.experience_follow_ups (tenant_id, owner_id, due_at, created_at desc)
  where resolved_at is null;
create index experience_follow_ups_owner_ticket_idx
  on public.experience_follow_ups (tenant_id, owner_id, ticket_id, created_at desc)
  where ticket_id is not null;
create index ticket_resolution_confirmations_ticket_time_idx
  on public.ticket_resolution_confirmations (tenant_id, ticket_id, confirmed_at desc);
create index tenant_ai_provider_approvals_tenant_enabled_idx
  on public.tenant_ai_provider_approvals (tenant_id, provider_key, expires_at)
  where enabled;
create index ai_draft_requests_tenant_provider_hour_idx
  on public.ai_draft_requests (tenant_id, provider_key, created_at desc);
create index ai_draft_requests_actor_tenant_created_idx
  on public.ai_draft_requests (tenant_id, actor_id, created_at desc);

create or replace function public.enforce_experience_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'Tenant identity is immutable' using errcode = '23514';
  end if;

  if tg_table_name = 'workspace_preferences' then
    if new.user_id is distinct from old.user_id
      or new.created_at is distinct from old.created_at then
      raise exception 'Workspace preference identity is immutable' using errcode = '23514';
    end if;
  elsif tg_table_name = 'experience_follow_ups' then
    if new.id is distinct from old.id
      or new.owner_id is distinct from old.owner_id
      or new.created_at is distinct from old.created_at then
      raise exception 'Follow-up identity is immutable' using errcode = '23514';
    end if;
  elsif tg_table_name = 'tenant_ai_provider_approvals' then
    if new.id is distinct from old.id
      or new.provider_key is distinct from old.provider_key
      or new.created_at is distinct from old.created_at then
      raise exception 'AI provider approval identity is immutable' using errcode = '23514';
    end if;
  else
    raise exception 'Unsupported identity trigger target' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function public.is_active_platform_administrator()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select exists (
    select 1
    from public.platform_administrators administrator
    where administrator.user_id = auth.uid()
      and administrator.enabled
      and administrator.mfa_verified_at >= timezone('utc', now()) - interval '12 hours'
  );
$$;

-- The RPC is the sole persistence path for AI draft intents. It repeats all
-- approval, membership, object and budget checks under an approval-row lock,
-- so simultaneous calls cannot exceed the hourly request ceiling.
create or replace function public.queue_ai_draft_request(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_provider_key text,
  p_purpose text,
  p_object_type text,
  p_object_id uuid,
  p_input_character_count integer,
  p_max_output_tokens integer,
  p_max_cost_cents integer
)
returns table (request_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_approval public.tenant_ai_provider_approvals%rowtype;
  v_request_count integer;
  v_now timestamptz := timezone('utc', now());
begin
  if p_tenant_id is null
    or p_actor_id is null
    or p_provider_key <> 'nextdesk-managed'
    or p_purpose not in ('general_draft', 'ticket_reply_draft', 'knowledge_article_draft')
    or p_object_type not in ('none', 'ticket', 'knowledge_article')
    or p_input_character_count not between 1 and 1200
    or p_max_output_tokens not between 16 and 1024
    or p_max_cost_cents not between 1 and 50
    or (p_object_type = 'none' and (p_object_id is not null or p_purpose <> 'general_draft'))
    or (p_object_type = 'ticket' and (p_object_id is null or p_purpose <> 'ticket_reply_draft'))
    or (p_object_type = 'knowledge_article' and (p_object_id is null or p_purpose <> 'knowledge_article_draft'))
  then
    raise exception 'Invalid AI draft request' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.tenant_memberships membership
    join public.tenants tenant on tenant.id = membership.tenant_id
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_actor_id
      and membership.status = 'active'
      and tenant.status = 'active'
  ) then
    raise exception 'Tenant membership required' using errcode = '42501';
  end if;

  select * into v_approval
  from public.tenant_ai_provider_approvals approval
  where approval.tenant_id = p_tenant_id
    and approval.provider_key = p_provider_key
  for update;

  if not found
    or not v_approval.enabled
    or v_approval.approved_at > v_now
    or (v_approval.expires_at is not null and v_approval.expires_at <= v_now)
    or not (p_purpose = any(v_approval.allowed_purposes))
    or p_max_output_tokens > v_approval.max_output_tokens
    or p_max_cost_cents > v_approval.max_cost_cents_per_request then
    raise exception 'AI provider approval does not permit this request' using errcode = '42501';
  end if;

  if p_object_type = 'ticket' and not exists (
    select 1 from public.tickets ticket
    where ticket.id = p_object_id and ticket.tenant_id = p_tenant_id
  ) then
    raise exception 'AI object is unavailable' using errcode = 'P0002';
  end if;
  if p_object_type = 'knowledge_article' and not exists (
    select 1 from public.knowledge_articles article
    where article.id = p_object_id and article.tenant_id = p_tenant_id
  ) then
    raise exception 'AI object is unavailable' using errcode = 'P0002';
  end if;

  select count(*) into v_request_count
  from public.ai_draft_requests request
  where request.tenant_id = p_tenant_id
    and request.provider_key = p_provider_key
    and request.created_at >= date_trunc('hour', v_now);
  if v_request_count >= v_approval.max_requests_per_hour then
    raise exception 'AI hourly request budget exceeded' using errcode = 'P0001';
  end if;

  insert into public.ai_draft_requests (
    tenant_id, approval_id, actor_id, provider_key, purpose, object_type, object_id,
    input_character_count, max_output_tokens, max_cost_cents, created_at
  ) values (
    p_tenant_id, v_approval.id, p_actor_id, p_provider_key, p_purpose, p_object_type, p_object_id,
    p_input_character_count, p_max_output_tokens, p_max_cost_cents, v_now
  ) returning id into request_id;

  return next;
end;
$$;

revoke all on function public.enforce_experience_identity() from public, anon, authenticated;
revoke all on function public.is_active_platform_administrator() from public, anon, authenticated;
revoke all on function public.queue_ai_draft_request(uuid, uuid, text, text, text, uuid, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.is_active_platform_administrator() to authenticated;
grant execute on function public.queue_ai_draft_request(uuid, uuid, text, text, text, uuid, integer, integer, integer)
  to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workspace_preferences', 'experience_follow_ups', 'tenant_ai_provider_approvals'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.enforce_experience_identity()',
      table_name || '_enforce_identity', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      table_name || '_updated_at', table_name);
  end loop;
end;
$$;

alter table public.workspace_preferences enable row level security;
alter table public.workspace_preferences force row level security;
alter table public.experience_follow_ups enable row level security;
alter table public.experience_follow_ups force row level security;
alter table public.ticket_resolution_confirmations enable row level security;
alter table public.ticket_resolution_confirmations force row level security;
alter table public.tenant_ai_provider_approvals enable row level security;
alter table public.tenant_ai_provider_approvals force row level security;
alter table public.ai_draft_requests enable row level security;
alter table public.ai_draft_requests force row level security;

-- Browser clients receive only the smallest direct privileges required by the
-- caller-scoped Experience Edge Function. There is deliberately no DELETE
-- grant, and AI request metadata has no browser table access at all.
revoke all on table public.workspace_preferences,
  public.experience_follow_ups,
  public.ticket_resolution_confirmations,
  public.tenant_ai_provider_approvals,
  public.ai_draft_requests
  from public, anon, authenticated;
grant select, insert, update on table public.workspace_preferences,
  public.experience_follow_ups to authenticated;
grant select, insert on table public.ticket_resolution_confirmations to authenticated;
grant select on table public.tenant_ai_provider_approvals to authenticated;

drop policy if exists workspace_preferences_select_self on public.workspace_preferences;
create policy workspace_preferences_select_self on public.workspace_preferences
  for select to authenticated
  using (user_id = auth.uid() and public.is_active_tenant_member(tenant_id));
drop policy if exists workspace_preferences_insert_self on public.workspace_preferences;
create policy workspace_preferences_insert_self on public.workspace_preferences
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_tenant_member(tenant_id));
drop policy if exists workspace_preferences_update_self on public.workspace_preferences;
create policy workspace_preferences_update_self on public.workspace_preferences
  for update to authenticated
  using (user_id = auth.uid() and public.is_active_tenant_member(tenant_id))
  with check (user_id = auth.uid() and public.is_active_tenant_member(tenant_id));

drop policy if exists experience_follow_ups_select_owner on public.experience_follow_ups;
create policy experience_follow_ups_select_owner on public.experience_follow_ups
  for select to authenticated
  using (owner_id = auth.uid() and public.is_active_tenant_member(tenant_id));
drop policy if exists experience_follow_ups_insert_owner on public.experience_follow_ups;
create policy experience_follow_ups_insert_owner on public.experience_follow_ups
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and resolved_at is null
    and resolved_by is null
    and public.is_active_tenant_member(tenant_id)
  );
drop policy if exists experience_follow_ups_update_owner on public.experience_follow_ups;
create policy experience_follow_ups_update_owner on public.experience_follow_ups
  for update to authenticated
  using (owner_id = auth.uid() and public.is_active_tenant_member(tenant_id))
  with check (
    owner_id = auth.uid()
    and (resolved_by is null or resolved_by = auth.uid())
    and public.is_active_tenant_member(tenant_id)
  );

-- Confirmation visibility is intentionally narrower than generic ticket RLS:
-- only requesters/affected users and agents with an actual ticket read grant.
drop policy if exists ticket_resolution_confirmations_select_authorized on public.ticket_resolution_confirmations;
create policy ticket_resolution_confirmations_select_authorized
  on public.ticket_resolution_confirmations
  for select to authenticated
  using (
    public.is_active_tenant_member(tenant_id)
    and exists (
      select 1
      from public.tickets ticket
      where ticket.id = ticket_resolution_confirmations.ticket_id
        and ticket.tenant_id = ticket_resolution_confirmations.tenant_id
        and (
          ticket.requester_id = auth.uid()
          or ticket.affected_user_id = auth.uid()
          or public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.read.department')
          or (
            ticket.assigned_agent_id = auth.uid()
            and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.read.assigned')
          )
        )
    )
  );
drop policy if exists ticket_resolution_confirmations_insert_participant on public.ticket_resolution_confirmations;
create policy ticket_resolution_confirmations_insert_participant
  on public.ticket_resolution_confirmations
  for insert to authenticated
  with check (
    confirmed_by = auth.uid()
    and public.is_active_tenant_member(tenant_id)
    and exists (
      select 1
      from public.tickets ticket
      where ticket.id = ticket_resolution_confirmations.ticket_id
        and ticket.tenant_id = ticket_resolution_confirmations.tenant_id
        and ticket.resolved_at is not null
        and (ticket.requester_id = auth.uid() or ticket.affected_user_id = auth.uid())
    )
  );

-- Governance approvals are readable only by a tenant settings administrator
-- with an active membership, or by a current MFA-verified platform admin.
-- No authenticated INSERT/UPDATE/DELETE privilege is granted.
drop policy if exists tenant_ai_provider_approvals_select_governance_admin on public.tenant_ai_provider_approvals;
create policy tenant_ai_provider_approvals_select_governance_admin
  on public.tenant_ai_provider_approvals
  for select to authenticated
  using (
    (public.is_active_tenant_member(tenant_id)
      and public.has_tenant_permission(tenant_id, 'tenant.settings.manage'))
    or public.is_active_platform_administrator()
  );

comment on table public.workspace_preferences is
  'Tenant-scoped personal settings; only a bounded JSON object is accepted.';
comment on table public.experience_follow_ups is
  'Personal, tenant-scoped follow-ups. This table never changes ticket status or lifecycle.';
comment on table public.ticket_resolution_confirmations is
  'Immutable requester/affected-person solution confirmations. It never changes ticket status or lifecycle.';
comment on table public.tenant_ai_provider_approvals is
  'Tenant AI provider approval metadata only; no credentials, prompts, inputs, outputs or provider endpoints.';
comment on table public.ai_draft_requests is
  'Atomic AI draft queue metadata only: purpose, object identity, input character count, timestamp and actor; no raw content.';
comment on function public.queue_ai_draft_request(uuid, uuid, text, text, text, uuid, integer, integer, integer) is
  'Service-role-only atomic metadata queue for permitted AI draft requests; it never stores raw input, prompts or output.';

commit;
