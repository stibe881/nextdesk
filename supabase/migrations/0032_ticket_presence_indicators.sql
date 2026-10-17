begin;
set local search_path = pg_catalog, public;

-- Ticket presence is deliberately transient operational metadata. It is kept
-- separate from the immutable ticket event history and is never client-readable
-- directly; the dedicated Edge Function applies the same ticket read boundary.
create table public.ticket_presence_sessions (
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  is_editing boolean not null default false,
  last_seen_at timestamptz not null default timezone('utc', now()),
  primary key (ticket_id, user_id)
);

create index ticket_presence_sessions_active_idx
  on public.ticket_presence_sessions (ticket_id, last_seen_at desc);

create or replace function public.validate_ticket_presence_session()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  ticket_tenant_id uuid;
begin
  select tenant_id
    into ticket_tenant_id
  from public.tickets
  where id = new.ticket_id;

  if ticket_tenant_id is null or ticket_tenant_id <> new.tenant_id then
    raise exception 'Ticket presence must belong to the ticket tenant'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and (
    new.ticket_id is distinct from old.ticket_id
    or new.tenant_id is distinct from old.tenant_id
    or new.user_id is distinct from old.user_id
  ) then
    raise exception 'Ticket presence identity is immutable'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger ticket_presence_sessions_validate
  before insert or update on public.ticket_presence_sessions
  for each row execute function public.validate_ticket_presence_session();

alter table public.ticket_presence_sessions enable row level security;

-- The user-facing API applies ticket-level read permissions before exposing
-- a short-lived display name. No direct browser table access is allowed.
revoke all on table public.ticket_presence_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.ticket_presence_sessions to service_role;
revoke all on function public.validate_ticket_presence_session() from public, anon, authenticated;

comment on table public.ticket_presence_sessions is
  'Short-lived, ticket-scoped presence for authorized collaborators. Entries expire through the presence API and are not audit history.';

commit;
