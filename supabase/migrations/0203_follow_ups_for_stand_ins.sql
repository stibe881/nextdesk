-- Stand-ins see and resolve the follow-ups of the agents they represent
-- during an active delegation (in addition to the owner policies).
create policy experience_follow_ups_select_stand_in on public.experience_follow_ups
  for select to authenticated
  using (
    owner_id = any(public.my_delegators(tenant_id))
    and public.can_work_tickets_in_tenant(tenant_id)
    and (ticket_id is null or public.can_read_ticket(ticket_id))
  );

create policy experience_follow_ups_update_stand_in on public.experience_follow_ups
  for update to authenticated
  using (
    owner_id = any(public.my_delegators(tenant_id))
    and public.can_work_tickets_in_tenant(tenant_id)
    and (ticket_id is null or public.can_read_ticket(ticket_id))
  )
  with check (
    owner_id = any(public.my_delegators(tenant_id))
    and (resolved_by is null or resolved_by = auth.uid())
    and public.can_work_tickets_in_tenant(tenant_id)
    and (ticket_id is null or public.can_read_ticket(ticket_id))
  );
