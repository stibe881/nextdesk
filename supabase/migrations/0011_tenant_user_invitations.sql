begin;

create table public.tenant_user_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email citext not null,
  invited_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'sent' check (status in ('sent', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null default (timezone('utc', now()) + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (expires_at > created_at),
  check ((status <> 'accepted') or accepted_at is not null)
);

create unique index tenant_user_invitations_open_email_unique
  on public.tenant_user_invitations (tenant_id, email)
  where status = 'sent';
create index tenant_user_invitations_email_status_idx
  on public.tenant_user_invitations (email, status, expires_at);
create trigger tenant_user_invitations_updated_at
  before update on public.tenant_user_invitations
  for each row execute function public.set_updated_at();

alter table public.tenant_user_invitations enable row level security;
revoke all on table public.tenant_user_invitations from anon, authenticated;

commit;
