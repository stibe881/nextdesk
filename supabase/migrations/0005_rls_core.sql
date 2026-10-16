begin;

create or replace function public.is_active_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.tenant_memberships membership
    join public.tenants tenant on tenant.id = membership.tenant_id
    where membership.tenant_id = p_tenant_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and tenant.status = 'active'
  );
$$;

create or replace function public.has_ticket_permission(
  p_tenant_id uuid,
  p_department_id uuid,
  p_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.is_active_tenant_member(p_tenant_id)
    and exists (
      select 1
      from public.user_role_assignments assignment
      join public.roles role on role.id = assignment.role_id and role.active
      join public.role_permissions role_permission on role_permission.role_id = role.id
      where assignment.user_id = auth.uid()
        and assignment.tenant_id = p_tenant_id
        and role_permission.permission_code = p_permission_code
        and assignment.starts_at <= timezone('utc', now())
        and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
        and (assignment.department_id is null or assignment.department_id = p_department_id)
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
        or (ticket.assigned_agent_id = auth.uid() and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.read.assigned'))
        or public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.read.department')
      )
  );
$$;

create or replace function public.can_read_internal_note(p_ticket_id uuid)
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
      and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.internal_notes.read')
  );
$$;

revoke all on function public.is_active_tenant_member(uuid) from public;
revoke all on function public.has_ticket_permission(uuid, uuid, text) from public;
revoke all on function public.can_read_ticket(uuid) from public;
revoke all on function public.can_read_internal_note(uuid) from public;
grant execute on function public.is_active_tenant_member(uuid) to authenticated;
grant execute on function public.has_ticket_permission(uuid, uuid, text) to authenticated;
grant execute on function public.can_read_ticket(uuid) to authenticated;
grant execute on function public.can_read_internal_note(uuid) to authenticated;

alter table public.tenants enable row level security;
alter table public.tenant_domains enable row level security;
alter table public.tenant_settings enable row level security;
alter table public.tenant_branding enable row level security;
alter table public.user_profiles enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.departments enable row level security;
alter table public.department_memberships enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_comments enable row level security;
alter table public.ticket_attachments enable row level security;
alter table public.ticket_events enable row level security;
alter table public.ticket_watchers enable row level security;

create policy tenants_select_member on public.tenants for select to authenticated using (public.is_active_tenant_member(id));
create policy tenant_domains_select_member on public.tenant_domains for select to authenticated using (public.is_active_tenant_member(tenant_id));
create policy tenant_settings_select_member on public.tenant_settings for select to authenticated using (public.is_active_tenant_member(tenant_id));
create policy tenant_branding_select_member on public.tenant_branding for select to authenticated using (public.is_active_tenant_member(tenant_id));
create policy user_profiles_select_self on public.user_profiles for select to authenticated using (id = auth.uid());
create policy memberships_select_self on public.tenant_memberships for select to authenticated using (user_id = auth.uid());
create policy departments_select_member on public.departments for select to authenticated using (public.is_active_tenant_member(tenant_id));
create policy department_memberships_select_self on public.department_memberships for select to authenticated using (user_id = auth.uid());
create policy tickets_select_authorized on public.tickets for select to authenticated using (public.can_read_ticket(id));
create policy ticket_comments_select_authorized on public.ticket_comments for select to authenticated using (
  public.can_read_ticket(ticket_id)
  and (visibility = 'external' or public.can_read_internal_note(ticket_id))
);
create policy ticket_attachments_select_authorized on public.ticket_attachments for select to authenticated using (public.can_read_ticket(ticket_id));
create policy ticket_events_select_authorized on public.ticket_events for select to authenticated using (public.can_read_ticket(ticket_id));
create policy ticket_watchers_select_self_or_agent on public.ticket_watchers for select to authenticated using (
  user_id = auth.uid() or public.can_read_ticket(ticket_id)
);

comment on table public.tickets is 'Direct client writes are intentionally denied. Mutations use audited Edge Functions or RPCs added in Phase 2.';
comment on table public.ticket_attachments is 'Storage object policies and signed URLs are added with the attachment workflow in Phase 4.';

commit;
