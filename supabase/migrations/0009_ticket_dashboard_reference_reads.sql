begin;

-- Ticket status, priority and category metadata is safe to expose only inside an active tenant context.
create policy ticket_statuses_select_member on public.ticket_statuses
  for select to authenticated
  using (public.is_active_tenant_member(tenant_id));

create policy ticket_priorities_select_member on public.ticket_priorities
  for select to authenticated
  using (public.is_active_tenant_member(tenant_id));

create policy ticket_categories_select_member on public.ticket_categories
  for select to authenticated
  using (public.is_active_tenant_member(tenant_id));

commit;
