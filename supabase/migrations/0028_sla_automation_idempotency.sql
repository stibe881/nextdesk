begin;

-- A scheduler may retry or run concurrently. Each SLA breach is therefore
-- represented at most once per ticket and event type.
create unique index if not exists ticket_sla_events_breach_once_idx
  on public.ticket_sla_events (ticket_id, event_type)
  where event_type in ('response_breached', 'resolution_breached');

create index if not exists tickets_response_sla_automation_idx
  on public.tickets (response_due_at)
  where closed_at is null
    and response_due_at is not null
    and first_responded_at is null;

create index if not exists tickets_resolution_sla_automation_idx
  on public.tickets (resolution_due_at)
  where closed_at is null
    and resolution_due_at is not null;

commit;
