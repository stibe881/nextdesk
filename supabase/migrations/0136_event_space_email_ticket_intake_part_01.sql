begin;

-- E-mail-originated requests can be incomplete on arrival. They are retained as
-- non-reserving clarification cases instead of guessing a room, time or owner.
alter table public.event_space_requests
  alter column space_id drop not null,
  alter column starts_at drop not null,
  alter column ends_at drop not null,
  alter column responsible_user_id drop not null,
  alter column created_by drop not null,
  add column if not exists intake_source text not null default 'manual'
    check (intake_source in ('manual', 'email_ticket')),
  add column if not exists source_ticket_id uuid,
  add column if not exists source_order_number text
    check (source_order_number is null or char_length(btrim(source_order_number)) between 1 and 80),
  add column if not exists requested_space_text text
    check (requested_space_text is null or char_length(btrim(requested_space_text)) between 2 and 160),
  add column if not exists requested_starts_at timestamptz,
  add column if not exists requested_ends_at timestamptz,
  add column if not exists requested_equipment_keys text[] not null default array[]::text[],
  add column if not exists clarification_reasons text[] not null default array[]::text[],
  add column if not exists room_reservation_requested boolean not null default false,
  add column if not exists ict_material_requested boolean not null default false,
  add column if not exists internet_access_requested boolean not null default false,
  add column if not exists sobe_network_access_requested boolean not null default false,
  add column if not exists reception_laptop_requested boolean not null default false,
  add column if not exists remarks text
    check (remarks is null or char_length(remarks) <= 4000),
  add column if not exists sharepoint_url text
    check (sharepoint_url is null or sharepoint_url ~ '^https://[^[:space:]]+$'),
  add column if not exists phone_number text
    check (phone_number is null or char_length(btrim(phone_number)) between 3 and 80);


alter table public.event_space_requests
  drop constraint if exists event_space_requests_status_check,
  add constraint event_space_requests_status_check
    check (status in (
      'planned', 'in_preparation', 'ready', 'conducted', 'completed',
      'clarification_required'
    )),
  add constraint event_space_requests_source_ticket_tenant_fk
    foreign key (source_ticket_id, tenant_id)
    references public.tickets (id, tenant_id)
    on delete restrict,
  add constraint event_space_requests_materialized_time_valid
    check (
      status = 'clarification_required'
      or (
        space_id is not null
        and starts_at is not null
        and ends_at is not null
        and ends_at > starts_at
      )
    ),
  add constraint event_space_requests_manual_identity_valid
    check (
      intake_source = 'email_ticket'
      or (responsible_user_id is not null and created_by is not null)
    );


create unique index if not exists event_space_requests_source_ticket_unique_idx
  on public.event_space_requests (source_ticket_id)
  where source_ticket_id is not null;


create index if not exists event_space_requests_attention_idx
  on public.event_space_requests (tenant_id, created_at desc)
  where status <> 'completed'
    and (responsible_user_id is null or status = 'clarification_required');


alter table public.event_space_request_equipment
  drop constraint if exists event_space_request_equipment_equipment_key_check,
  add constraint event_space_request_equipment_equipment_key_check
    check (equipment_key in (
      'projector', 'connections', 'display', 'audio', 'videocall', 'microphones',
      'screen', 'reception_laptop'
    ));


-- The trigger is an atomic delivery record shared by both existing e-mail
-- ingress paths. It does not parse text, reserve a resource or start a job.
create table if not exists public.event_space_ticket_intake_outbox (
  ticket_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processed', 'ignored', 'failed', 'retrying')),
  last_error_code text,
  manual_retry_count integer not null default 0
    check (manual_retry_count between 0 and 3),
  last_retry_at timestamptz,
  retry_lease_expires_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint event_space_ticket_intake_outbox_retry_lease_valid check (
    (status = 'retrying' and retry_lease_expires_at is not null)
    or (status <> 'retrying' and retry_lease_expires_at is null)
  ),
  constraint event_space_ticket_intake_outbox_ticket_tenant_fk
    foreign key (ticket_id, tenant_id)
    references public.tickets (id, tenant_id)
    on delete cascade
);


create index if not exists event_space_ticket_intake_outbox_pending_idx
  on public.event_space_ticket_intake_outbox (tenant_id, created_at)
  where status in ('pending', 'failed', 'retrying');


create or replace function public.enqueue_event_space_ticket_intake()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.source = 'email' then
    insert into public.event_space_ticket_intake_outbox (ticket_id, tenant_id)
    values (new.id, new.tenant_id)
    on conflict (ticket_id) do nothing;
  end if;
  return new;
end;
$$;


revoke all on function public.enqueue_event_space_ticket_intake() from public, anon, authenticated;

drop trigger if exists event_space_ticket_intake_enqueue on public.tickets;

create trigger event_space_ticket_intake_enqueue
  after insert on public.tickets
  for each row execute function public.enqueue_event_space_ticket_intake();

commit;
