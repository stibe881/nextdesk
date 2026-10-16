begin;

create table public.ticket_statuses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  label text not null,
  is_closed boolean not null default false,
  sort_order smallint not null,
  unique (tenant_id, key),
  unique (tenant_id, sort_order)
);

create table public.ticket_priorities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  label text not null,
  sort_order smallint not null,
  unique (tenant_id, key),
  unique (tenant_id, sort_order)
);

create table public.ticket_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  parent_id uuid references public.ticket_categories(id) on delete restrict,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (department_id, name)
);

create table public.ticket_number_sequences (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  calendar_year integer not null check (calendar_year between 2020 and 2100),
  last_value integer not null default 0 check (last_value >= 0),
  primary key (tenant_id, department_id, calendar_year)
);

create or replace function public.reserve_ticket_number(
  p_tenant_id uuid,
  p_department_id uuid,
  p_prefix text,
  p_calendar_year integer default extract(year from timezone('Europe/Zurich', now()))::integer
)
returns text
language plpgsql
set search_path = public
as $$
declare
  next_value integer;
begin
  insert into public.ticket_number_sequences (tenant_id, department_id, calendar_year, last_value)
  values (p_tenant_id, p_department_id, p_calendar_year, 1)
  on conflict (tenant_id, department_id, calendar_year)
  do update set last_value = public.ticket_number_sequences.last_value + 1
  returning last_value into next_value;

  return format('%s-%s-%s', upper(p_prefix), p_calendar_year, lpad(next_value::text, 6, '0'));
end;
$$;

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  department_id uuid not null references public.departments(id) on delete restrict,
  ticket_number text not null unique,
  subject text not null check (char_length(subject) between 3 and 240),
  description text not null check (char_length(description) between 1 and 50000),
  status_id uuid not null references public.ticket_statuses(id) on delete restrict,
  priority_id uuid not null references public.ticket_priorities(id) on delete restrict,
  category_id uuid references public.ticket_categories(id) on delete set null,
  requester_id uuid not null references public.user_profiles(id) on delete restrict,
  affected_user_id uuid references public.user_profiles(id) on delete set null,
  assigned_team_id uuid references public.teams(id) on delete set null,
  assigned_agent_id uuid references public.user_profiles(id) on delete set null,
  due_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  closed_at timestamptz
);
create index tickets_tenant_department_updated_idx on public.tickets (tenant_id, department_id, updated_at desc);
create index tickets_requester_updated_idx on public.tickets (tenant_id, requester_id, updated_at desc);
create index tickets_assignee_updated_idx on public.tickets (tenant_id, assigned_agent_id, updated_at desc);

create table public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_id uuid not null references public.user_profiles(id) on delete restrict,
  visibility public.comment_visibility not null default 'internal',
  body text not null check (char_length(body) between 1 and 50000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create index ticket_comments_ticket_created_idx on public.ticket_comments (ticket_id, created_at);

create table public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  comment_id uuid references public.ticket_comments(id) on delete cascade,
  uploaded_by uuid not null references public.user_profiles(id) on delete restrict,
  storage_bucket text not null default 'ticket-attachments',
  storage_object_path text not null unique,
  original_filename text not null,
  content_type text not null,
  byte_size bigint not null check (byte_size between 1 and 26214400),
  malware_status text not null default 'pending' check (malware_status in ('pending', 'clean', 'infected', 'failed')),
  created_at timestamptz not null default timezone('utc', now())
);

create table public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  actor_id uuid references public.user_profiles(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.ticket_watchers (
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (ticket_id, user_id)
);

create trigger ticket_categories_updated_at before update on public.ticket_categories for each row execute function public.set_updated_at();
create trigger tickets_updated_at before update on public.tickets for each row execute function public.set_updated_at();
create trigger ticket_comments_updated_at before update on public.ticket_comments for each row execute function public.set_updated_at();

commit;
