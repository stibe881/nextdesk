-- Sanitised HTML of the e-mail signature of a ticket created by e-mail.
-- Written only by the mail worker (service role); images are embedded as
-- data: URIs so viewing a ticket never loads anything from a remote server.
create table if not exists public.ticket_email_signatures (
  ticket_id uuid primary key references public.tickets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  html text not null check (char_length(html) between 1 and 1500000),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.ticket_email_signatures enable row level security;

drop policy if exists ticket_email_signatures_select_authorized
  on public.ticket_email_signatures;
create policy ticket_email_signatures_select_authorized
  on public.ticket_email_signatures
  for select
  to authenticated
  using (public.can_read_ticket(ticket_id));

revoke all on public.ticket_email_signatures from anon, authenticated;
grant select on public.ticket_email_signatures to authenticated;
