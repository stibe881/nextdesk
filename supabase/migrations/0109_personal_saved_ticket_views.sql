begin;

-- Gespeicherte Ticketansichten sind ab diesem Stand ausschliesslich persönlich.
-- Bisherige mandantenweite Ansichten bleiben ihren Eigentümer:innen erhalten,
-- werden aber nicht mehr mit anderen aktiven Mitgliedern geteilt.
update public.saved_ticket_views
set visibility = 'private'
where visibility = 'tenant';

alter table public.saved_ticket_views
  drop constraint if exists saved_ticket_views_visibility_valid;
alter table public.saved_ticket_views
  add constraint saved_ticket_views_visibility_valid
  check (visibility = 'private');

drop index if exists public.saved_ticket_views_tenant_name_unique;
drop index if exists public.saved_ticket_views_tenant_visibility_updated_idx;

drop policy if exists saved_ticket_views_select_visible on public.saved_ticket_views;
drop policy if exists saved_ticket_views_insert_owner on public.saved_ticket_views;
drop policy if exists saved_ticket_views_update_owner_or_ticket_manager on public.saved_ticket_views;
drop policy if exists saved_ticket_views_delete_owner_or_ticket_manager on public.saved_ticket_views;

create policy saved_ticket_views_select_owner
  on public.saved_ticket_views
  for select to authenticated
  using (
    public.is_active_tenant_member(tenant_id)
    and owner_id = auth.uid()
  );

create policy saved_ticket_views_insert_owner
  on public.saved_ticket_views
  for insert to authenticated
  with check (
    public.is_active_tenant_member(tenant_id)
    and owner_id = auth.uid()
    and visibility = 'private'
  );

create policy saved_ticket_views_update_owner
  on public.saved_ticket_views
  for update to authenticated
  using (
    public.is_active_tenant_member(tenant_id)
    and owner_id = auth.uid()
  )
  with check (
    public.is_active_tenant_member(tenant_id)
    and owner_id = auth.uid()
    and visibility = 'private'
  );

create policy saved_ticket_views_delete_owner
  on public.saved_ticket_views
  for delete to authenticated
  using (
    public.is_active_tenant_member(tenant_id)
    and owner_id = auth.uid()
  );

comment on table public.saved_ticket_views is
  'Tenant-isolated personal ticket list filters. Each view is readable, mutable and deletable only by its owner.';

commit;
