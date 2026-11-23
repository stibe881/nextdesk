begin;

-- Geschwindigkeit: Die Leseberechtigung für Tickets wurde pro Zeile mit
-- can_read_ticket() berechnet (rund sieben verschachtelte Prüfungen je
-- Ticket). Neu werden die Berechtigungen der angemeldeten Person einmal pro
-- Abfrage ermittelt (ticket_read_context) und pro Ticket nur noch
-- abgeglichen (ticket_readable). Die Regeln entsprechen can_read_ticket()
-- genau; can_read_ticket() bleibt für Einzelprüfungen unverändert.

-- Alle Teilberechtigungen der angemeldeten Person als Schlüssel
-- «<tenant>:<id>» in JSON-Listen.
create or replace function public.ticket_read_context()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  with me as (
    select auth.uid() as uid
  ), my_email as (
    select nullif(lower(btrim(account.email)), '') as email
      from auth.users account, me
     where account.id = me.uid
  )
  select jsonb_build_object(
    'uid', me.uid,
    'email', (select email from my_email),
    -- is_active_tenant_member(): Mitgliedschaft und Mandant aktiv.
    'member', coalesce((
      select jsonb_agg(distinct membership.tenant_id::text)
        from public.tenant_memberships membership
        join public.tenants tenant on tenant.id = membership.tenant_id
       where membership.user_id = me.uid
         and membership.status = 'active'
         and tenant.status = 'active'), '[]'::jsonb),
    -- employee_can_read_ticket_for(): nur die Mitgliedschaft muss aktiv sein.
    'member_any', coalesce((
      select jsonb_agg(distinct membership.tenant_id::text)
        from public.tenant_memberships membership
       where membership.user_id = me.uid
         and membership.status = 'active'), '[]'::jsonb),
    'dept_read', coalesce((
      select jsonb_agg(distinct dm.tenant_id::text || ':' || dm.department_id::text)
        from public.department_memberships dm
       where dm.user_id = me.uid
         and dm.status = 'active'
         and public.has_ticket_permission(dm.tenant_id, dm.department_id, 'ticket.read.department')), '[]'::jsonb),
    'dept_assigned', coalesce((
      select jsonb_agg(distinct dm.tenant_id::text || ':' || dm.department_id::text)
        from public.department_memberships dm
       where dm.user_id = me.uid
         and dm.status = 'active'
         and public.has_ticket_permission(dm.tenant_id, dm.department_id, 'ticket.read.assigned')), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(distinct tm.tenant_id::text || ':' || tm.team_id::text)
        from public.team_memberships tm
       where tm.user_id = me.uid
         and public.is_current_user_team_member(tm.tenant_id, tm.team_id)), '[]'::jsonb),
    -- customer_can_read_ticket()
    'orgs', coalesce((
      select jsonb_agg(distinct organization.tenant_id::text || ':' || organization.id::text)
        from public.customer_memberships membership
        join public.customer_organizations organization
          on organization.id = membership.customer_organization_id
       where membership.user_id = me.uid
         and membership.access = 'company'
         and organization.active
         and organization.ticket_access <> 'disabled'), '[]'::jsonb),
    -- delegate_can_read_ticket_for()
    'delegators', coalesce((
      select jsonb_agg(distinct d.tenant_id::text || ':' || agent_id::text)
        from (select distinct delegation.tenant_id
                from public.agent_delegations delegation
               where delegation.delegate_id = me.uid) d,
             unnest(public.active_delegators_for(d.tenant_id, me.uid)) as agent_id), '[]'::jsonb),
    -- employee_can_read_ticket_for(): eigene Kontakte und Mitarbeitende,
    -- deren vorgesetzte Person man laut Entra ist.
    'contacts', coalesce((
      select jsonb_agg(contact.id::text)
        from public.ticket_requesters contact
       where contact.user_id = me.uid), '[]'::jsonb),
    -- Kontakte mit der eigenen Mailadresse (Anfragende = man selbst).
    'email_contacts', coalesce((
      select jsonb_agg(contact.id::text)
        from public.ticket_requesters contact
       where nullif(lower(btrim(contact.email)), '') = (select email from my_email)), '[]'::jsonb),
    -- Vorgesetzte Person laut Entra: dann gilt die vollständige Prüfung
    -- employee_can_read_ticket() (Mitarbeitende des Teams).
    'is_manager', exists (
      select 1
        from public.tenant_entra_directory_people manager
        join public.tenant_entra_directory_people report
          on report.tenant_id = manager.tenant_id
         and report.manager_entra_object_id = manager.entra_object_id
       where lower(manager.email) = (select email from my_email))
  )
  from me;
$$;

revoke all on function public.ticket_read_context() from public, anon;
grant execute on function public.ticket_read_context() to authenticated, service_role;

-- Abgleich eines Tickets mit dem Kontext; entspricht can_read_ticket().
create or replace function public.ticket_readable(p_ticket public.tickets, p_context jsonb)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(p_ticket.deleted_at is null
    and coalesce(p_context -> 'member' ? p_ticket.tenant_id::text, false)
    and (
      p_ticket.requester_id = (p_context ->> 'uid')::uuid
      or p_ticket.affected_user_id = (p_context ->> 'uid')::uuid
      or (
        p_ticket.customer_organization_id is not null
        and p_context -> 'orgs' ? (p_ticket.tenant_id::text || ':' || p_ticket.customer_organization_id::text)
      )
      or (
        p_ticket.assigned_agent_id = (p_context ->> 'uid')::uuid
        and p_context -> 'dept_assigned' ? (p_ticket.tenant_id::text || ':' || p_ticket.department_id::text)
        and (
          p_ticket.assigned_team_id is null
          or p_context -> 'teams' ? (p_ticket.tenant_id::text || ':' || p_ticket.assigned_team_id::text)
        )
      )
      or (
        p_context -> 'dept_read' ? (p_ticket.tenant_id::text || ':' || p_ticket.department_id::text)
        and (
          p_ticket.assigned_team_id is null
          or p_context -> 'teams' ? (p_ticket.tenant_id::text || ':' || p_ticket.assigned_team_id::text)
        )
      )
      or (
        p_context -> 'member_any' ? p_ticket.tenant_id::text
        and (
          (
            p_ticket.requester_contact_id is not null
            and (
              p_context -> 'contacts' ? p_ticket.requester_contact_id::text
              or p_context -> 'email_contacts' ? p_ticket.requester_contact_id::text
            )
          )
          -- Ohne Kontakt-Mailadresse gilt die des Kontos: gleich der eigenen
          -- nur bei requester_id = man selbst (oben abgedeckt).
          or (
            coalesce((p_context ->> 'is_manager')::boolean, false)
            and public.employee_can_read_ticket(p_ticket.id)
          )
        )
      )
      or (
        p_ticket.assigned_agent_id is not null
        and p_context -> 'delegators' ? (p_ticket.tenant_id::text || ':' || p_ticket.assigned_agent_id::text)
      )
    ), false);
$$;

revoke all on function public.ticket_readable(public.tickets, jsonb) from public, anon;
grant execute on function public.ticket_readable(public.tickets, jsonb) to authenticated, service_role;

alter policy tickets_select_authorized on public.tickets
  using (public.ticket_readable(tickets, (select public.ticket_read_context())));

-- Tabellen rund ums Ticket: «gehört zu einem lesbaren Ticket» über die
-- Ticket-Richtlinie (ein Kontext pro Abfrage statt can_read_ticket pro Zeile).
alter policy ticket_events_select_authorized on public.ticket_events
  using (exists (select 1 from public.tickets ticket where ticket.id = ticket_events.ticket_id));
alter policy ticket_checklist_items_select_authorized on public.ticket_checklist_items
  using (exists (select 1 from public.tickets ticket where ticket.id = ticket_checklist_items.ticket_id));
alter policy ticket_relations_select_authorized on public.ticket_relations
  using (exists (select 1 from public.tickets ticket where ticket.id = ticket_relations.ticket_id));
alter policy ticket_satisfaction_select_authorized on public.ticket_satisfaction
  using (exists (select 1 from public.tickets ticket where ticket.id = ticket_satisfaction.ticket_id));
alter policy ticket_form_answers_select_authorized on public.ticket_form_answers
  using (exists (select 1 from public.tickets ticket where ticket.id = ticket_form_answers.ticket_id));
alter policy ticket_knowledge_links_select_authorized on public.ticket_knowledge_links
  using (exists (select 1 from public.tickets ticket where ticket.id = ticket_knowledge_links.ticket_id));
alter policy ticket_email_signatures_select_authorized on public.ticket_email_signatures
  using (exists (select 1 from public.tickets ticket where ticket.id = ticket_email_signatures.ticket_id));
alter policy ticket_watchers_select_self_or_agent on public.ticket_watchers
  using (user_id = auth.uid() or exists (select 1 from public.tickets ticket where ticket.id = ticket_watchers.ticket_id));
alter policy ticket_comments_select_authorized on public.ticket_comments
  using (
    exists (select 1 from public.tickets ticket where ticket.id = ticket_comments.ticket_id)
    and (visibility = 'external'::public.comment_visibility or public.can_read_internal_note(ticket_id))
  );
alter policy ticket_attachments_select_authorized on public.ticket_attachments
  using (
    exists (select 1 from public.tickets ticket where ticket.id = ticket_attachments.ticket_id)
    and (visibility = 'external'::public.comment_visibility or public.can_read_internal_note(ticket_id))
  );

commit;
