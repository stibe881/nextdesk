begin;

-- Erweiterte Statuskette und kundenbezogener Ticketkontext.
insert into public.ticket_statuses (tenant_id, key, label, is_closed, sort_order)
select tenant.id, defaults.key, defaults.label, defaults.is_closed, defaults.sort_order
from public.tenants tenant
cross join (values
  ('waiting_customer', 'Wartend auf Kunde', false, 31),
  ('waiting_vendor', 'Wartend auf Drittanbieter', false, 32),
  ('closed', 'Geschlossen', true, 50)
) as defaults(key, label, is_closed, sort_order)
on conflict (tenant_id, key) do nothing;

create or replace function public.initialize_tenant_ticket_reference_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ticket_statuses (tenant_id, key, label, is_closed, sort_order)
  values
    (new.id, 'new', 'Neu', false, 10),
    (new.id, 'in_progress', 'In Bearbeitung', false, 20),
    (new.id, 'waiting', 'Wartend', false, 30),
    (new.id, 'waiting_customer', 'Wartend auf Kunde', false, 31),
    (new.id, 'waiting_vendor', 'Wartend auf Drittanbieter', false, 32),
    (new.id, 'resolved', 'Gelöst', true, 40),
    (new.id, 'closed', 'Geschlossen', true, 50)
  on conflict (tenant_id, key) do nothing;

  insert into public.ticket_priorities (tenant_id, key, label, sort_order)
  values
    (new.id, 'low', 'Niedrig', 10),
    (new.id, 'normal', 'Normal', 20),
    (new.id, 'high', 'Hoch', 30),
    (new.id, 'urgent', 'Dringend', 40)
  on conflict (tenant_id, key) do nothing;
  return new;
end;
$$;

alter table public.tickets
  add column if not exists customer_organization_id uuid references public.customer_organizations(id) on delete set null,
  add column if not exists source text not null default 'portal' check (source in ('portal', 'email', 'api', 'automation', 'phone')),
  add column if not exists summary text,
  add column if not exists first_responded_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists response_due_at timestamptz,
  add column if not exists resolution_due_at timestamptz,
  add column if not exists parent_ticket_id uuid references public.tickets(id) on delete set null,
  add column if not exists merged_into_ticket_id uuid references public.tickets(id) on delete set null,
  add column if not exists escalation_level smallint not null default 0 check (escalation_level between 0 and 4),
  add column if not exists waiting_since timestamptz;

create index if not exists tickets_customer_organization_idx on public.tickets (customer_organization_id, updated_at desc);
create index if not exists tickets_open_sla_idx on public.tickets (tenant_id, resolution_due_at) where closed_at is null;

create or replace function public.ensure_default_customer_organization(p_tenant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  organization_id uuid;
  tenant_name text;
begin
  select name into tenant_name from public.tenants where id = p_tenant_id;
  if tenant_name is null then
    raise exception 'tenant_not_found';
  end if;
  insert into public.customer_organizations (tenant_id, name, ticket_access, active)
  values (p_tenant_id, tenant_name, 'disabled', true)
  on conflict (tenant_id, name) do update set active = true
  returning id into organization_id;
  return organization_id;
end;
$$;

create or replace function public.create_default_customer_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_default_customer_organization(new.id);
  return new;
end;
$$;

drop trigger if exists tenant_default_customer_organization on public.tenants;
create trigger tenant_default_customer_organization
  after insert on public.tenants
  for each row execute function public.create_default_customer_organization();

select public.ensure_default_customer_organization(id) from public.tenants;

create table public.ticket_checklist_items (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  description text not null check (char_length(description) between 1 and 1000),
  position integer not null default 0,
  completed_at timestamptz,
  completed_by uuid references public.user_profiles(id) on delete set null,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);
create index ticket_checklist_items_ticket_position_idx on public.ticket_checklist_items (ticket_id, position, created_at);

create table public.ticket_time_entries (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_id uuid not null references public.user_profiles(id) on delete restrict,
  minutes integer not null check (minutes between 1 and 1440),
  billing_kind text not null default 'internal' check (billing_kind in ('internal', 'billable', 'goodwill')),
  note text,
  started_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);
create index ticket_time_entries_ticket_created_idx on public.ticket_time_entries (ticket_id, created_at desc);

create table public.ticket_relations (
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  related_ticket_id uuid not null references public.tickets(id) on delete cascade,
  relation_type text not null check (relation_type in ('duplicates', 'blocks', 'blocked_by', 'relates_to', 'parent', 'child')),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (ticket_id, related_ticket_id, relation_type),
  check (ticket_id <> related_ticket_id)
);

create table public.ticket_drafts (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_id uuid not null references public.user_profiles(id) on delete cascade,
  visibility public.comment_visibility not null default 'internal',
  body text not null default '',
  updated_at timestamptz not null default timezone('utc', now()),
  unique (ticket_id, author_id, visibility)
);

create table public.ticket_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  name text not null,
  subject_template text not null,
  description_template text not null,
  priority_key text,
  active boolean not null default true,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, name)
);

create table public.ticket_template_checklist_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.ticket_templates(id) on delete cascade,
  description text not null,
  position integer not null default 0
);

create table public.ticket_sla_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  timezone text not null default 'Europe/Zurich',
  service_hours jsonb not null default '{"weekdays":[1,2,3,4,5],"start":"08:00","end":"17:00"}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, name)
);

create table public.ticket_sla_rules (
  id uuid primary key default gen_random_uuid(),
  sla_profile_id uuid not null references public.ticket_sla_profiles(id) on delete cascade,
  priority_key text not null,
  response_minutes integer not null check (response_minutes between 1 and 525600),
  resolution_minutes integer not null check (resolution_minutes between 1 and 525600),
  unique (sla_profile_id, priority_key)
);

create table public.ticket_sla_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  event_type text not null check (event_type in ('started', 'paused', 'resumed', 'first_response', 'response_breached', 'resolution_breached', 'resolved')),
  occurred_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb
);

create table public.ticket_escalations (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  level smallint not null check (level between 1 and 4),
  kind text not null check (kind in ('technical', 'organizational', 'sla')),
  reason text not null check (char_length(reason) between 3 and 2000),
  opened_by uuid references public.user_profiles(id) on delete set null,
  resolved_by uuid references public.user_profiles(id) on delete set null,
  opened_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz
);

create table public.ticket_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  ticket_id uuid references public.tickets(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);
create index ticket_notifications_user_unread_idx on public.ticket_notifications (user_id, created_at desc) where read_at is null;

create table public.knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 240),
  slug text not null,
  visibility public.comment_visibility not null default 'internal',
  customer_organization_id uuid references public.customer_organizations(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'review', 'published', 'archived')),
  current_revision integer not null default 1,
  created_by uuid references public.user_profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, slug)
);

create table public.knowledge_article_revisions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  revision integer not null,
  body text not null,
  summary text,
  author_id uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (article_id, revision)
);

create table public.ticket_knowledge_links (
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  linked_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (ticket_id, article_id)
);

create table public.ticket_satisfaction (
  ticket_id uuid primary key references public.tickets(id) on delete cascade,
  score smallint check (score between 1 and 5),
  comment text check (char_length(comment) <= 3000),
  submitted_by uuid references public.user_profiles(id) on delete set null,
  submitted_at timestamptz not null default timezone('utc', now())
);

create table public.ticket_quality_reviews (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  reviewer_id uuid not null references public.user_profiles(id) on delete restrict,
  score smallint not null check (score between 1 and 5),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (ticket_id, reviewer_id)
);

insert into public.permissions (code, description, is_sensitive)
values
  ('ticket.comment.external', 'Kundenantworten verfassen', false),
  ('ticket.watch', 'Tickets beobachten', false),
  ('ticket.time.track', 'Arbeitszeit erfassen', false),
  ('ticket.template.manage', 'Ticketvorlagen verwalten', false),
  ('ticket.sla.manage', 'SLA-Profile verwalten', true),
  ('ticket.escalate', 'Tickets eskalieren', false),
  ('knowledge.read', 'Wissensartikel lesen', false),
  ('knowledge.publish', 'Wissensartikel veröffentlichen', false),
  ('ticket.quality.review', 'Ticketqualität bewerten', false)
on conflict (code) do nothing;

create or replace function public.customer_can_read_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.tickets ticket
    join public.customer_memberships membership on membership.user_id = auth.uid()
    join public.customer_organizations organization on organization.id = membership.customer_organization_id
    where ticket.id = p_ticket_id
      and ticket.customer_organization_id = organization.id
      and organization.tenant_id = ticket.tenant_id
      and organization.active
      and organization.ticket_access <> 'disabled'
      and membership.access = 'company'
  );
$$;

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
        or (ticket.assigned_agent_id = auth.uid() and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.read.assigned'))
        or public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.read.department')
      )
  );
$$;

revoke all on function public.customer_can_read_ticket(uuid) from public;
grant execute on function public.customer_can_read_ticket(uuid) to authenticated;

alter table public.customer_organizations enable row level security;
alter table public.customer_memberships enable row level security;
alter table public.ticket_checklist_items enable row level security;
alter table public.ticket_time_entries enable row level security;
alter table public.ticket_relations enable row level security;
alter table public.ticket_drafts enable row level security;
alter table public.ticket_templates enable row level security;
alter table public.ticket_template_checklist_items enable row level security;
alter table public.ticket_sla_profiles enable row level security;
alter table public.ticket_sla_rules enable row level security;
alter table public.ticket_sla_events enable row level security;
alter table public.ticket_escalations enable row level security;
alter table public.ticket_notifications enable row level security;
alter table public.knowledge_articles enable row level security;
alter table public.knowledge_article_revisions enable row level security;
alter table public.ticket_knowledge_links enable row level security;
alter table public.ticket_satisfaction enable row level security;
alter table public.ticket_quality_reviews enable row level security;

create policy customer_memberships_select_self on public.customer_memberships for select to authenticated using (user_id = auth.uid());
create policy customer_organizations_select_member on public.customer_organizations for select to authenticated using (public.is_active_tenant_member(tenant_id));
create policy ticket_notifications_select_self on public.ticket_notifications for select to authenticated using (user_id = auth.uid());
create policy ticket_checklist_items_select_authorized on public.ticket_checklist_items for select to authenticated using (public.can_read_ticket(ticket_id));
create policy ticket_time_entries_select_internal on public.ticket_time_entries for select to authenticated using (public.can_read_internal_note(ticket_id));
create policy ticket_relations_select_authorized on public.ticket_relations for select to authenticated using (public.can_read_ticket(ticket_id));
create policy ticket_drafts_select_self on public.ticket_drafts for select to authenticated using (author_id = auth.uid());
create policy knowledge_articles_select_authorized on public.knowledge_articles for select to authenticated using (
  public.is_active_tenant_member(tenant_id)
  and (visibility = 'external' or public.has_ticket_permission(tenant_id, null, 'knowledge.read'))
);
create policy knowledge_revisions_select_authorized on public.knowledge_article_revisions for select to authenticated using (
  exists (select 1 from public.knowledge_articles article where article.id = article_id and public.is_active_tenant_member(article.tenant_id))
);
create policy ticket_knowledge_links_select_authorized on public.ticket_knowledge_links for select to authenticated using (public.can_read_ticket(ticket_id));
create policy ticket_satisfaction_select_authorized on public.ticket_satisfaction for select to authenticated using (public.can_read_ticket(ticket_id));

commit;
