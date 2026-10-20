begin;

-- Wiedervorlagen sind persönliche Agentenarbeit. Die Prüfung entspricht exakt
-- der Web-Entscheidung für Ticketarbeit und wird in RLS, Edge Function und
-- globaler Suche gemeinsam verwendet.
create or replace function public.can_work_tickets_in_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select public.is_active_tenant_member(p_tenant_id)
    and exists (
      select 1
      from public.user_role_assignments assignment
      join public.roles role
        on role.id = assignment.role_id
        and role.tenant_id = assignment.tenant_id
        and role.active
        and role.scope in ('tenant', 'department')
      join public.role_permissions permission
        on permission.role_id = role.id
      where assignment.user_id = auth.uid()
        and assignment.tenant_id = p_tenant_id
        and assignment.starts_at <= timezone('utc', now())
        and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
        and permission.permission_code in (
          'ticket.read.department', 'ticket.read.assigned', 'ticket.update'
        )
    );
$$;
revoke all on function public.can_work_tickets_in_tenant(uuid) from public, anon;
grant execute on function public.can_work_tickets_in_tenant(uuid) to authenticated;

-- Direkte PostgREST-Zugriffe unterliegen derselben fail-closed Regel wie die
-- Experience-Hub-Function. Bestehende persönliche Zuordnung bleibt erhalten.
drop policy if exists experience_follow_ups_select_owner on public.experience_follow_ups;
create policy experience_follow_ups_select_owner on public.experience_follow_ups
  for select to authenticated
  using (
    owner_id = auth.uid()
    and public.can_work_tickets_in_tenant(tenant_id)
  );
drop policy if exists experience_follow_ups_insert_owner on public.experience_follow_ups;
create policy experience_follow_ups_insert_owner on public.experience_follow_ups
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and resolved_at is null
    and resolved_by is null
    and public.can_work_tickets_in_tenant(tenant_id)
  );
drop policy if exists experience_follow_ups_update_owner on public.experience_follow_ups;
create policy experience_follow_ups_update_owner on public.experience_follow_ups
  for update to authenticated
  using (
    owner_id = auth.uid()
    and public.can_work_tickets_in_tenant(tenant_id)
  )
  with check (
    owner_id = auth.uid()
    and (resolved_by is null or resolved_by = auth.uid())
    and public.can_work_tickets_in_tenant(tenant_id)
  );

-- Der bestehende globale Suchvertrag bleibt unverändert; allein der
-- Wiedervorlagenzweig erhält die neue serverseitige Agentensperre.
create or replace function public.search_global_workspace(
  p_tenant_id uuid,
  p_query text,
  p_limit integer default 40
)
returns table(
  result_type text,
  entity_id uuid,
  title text,
  detail text,
  section text,
  ticket_id uuid,
  rank real
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_query tsquery;
  v_knowledge_feature_enabled boolean;
  v_experience_feature_enabled boolean;
  v_can_read_knowledge boolean;
  v_can_work_tickets boolean;
  v_customer_organization_ids uuid[];
  v_can_read_event_spaces boolean;
  v_can_request_onboarding boolean;
  v_can_manage_onboarding boolean;
  v_limit integer;
begin
  if p_tenant_id is null or char_length(btrim(coalesce(p_query, ''))) not between 2 and 120 then
    raise exception 'Invalid global search query' using errcode = '22023';
  end if;
  if not public.is_active_tenant_member(p_tenant_id) then
    raise exception 'Active tenant membership required' using errcode = '42501';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 40), 50));
  v_query := websearch_to_tsquery('german'::regconfig, btrim(p_query));
  if numnode(v_query) = 0 then
    return;
  end if;

  select
    coalesce(bool_or(
      feature.feature_key = 'knowledge.base'
      and feature.enabled
      and (feature.pilot_ends_at is null or feature.pilot_ends_at > timezone('utc', now()))
    ), false),
    coalesce(bool_or(
      feature.feature_key = 'experience.workspace'
      and feature.enabled
      and (feature.pilot_ends_at is null or feature.pilot_ends_at > timezone('utc', now()))
    ), false)
  into v_knowledge_feature_enabled, v_experience_feature_enabled
  from public.tenant_feature_flags feature
  where feature.tenant_id = p_tenant_id
    and feature.feature_key in ('knowledge.base', 'experience.workspace');

  v_can_work_tickets := public.can_work_tickets_in_tenant(p_tenant_id);
  v_can_read_knowledge := public.has_tenant_permission(
    p_tenant_id,
    'knowledge.read'
  );
  select coalesce(array_agg(membership.customer_organization_id), array[]::uuid[])
    into v_customer_organization_ids
    from public.customer_memberships membership
    join public.customer_organizations organization
      on organization.id = membership.customer_organization_id
     and organization.tenant_id = p_tenant_id
     and organization.active
   where membership.user_id = auth.uid()
     and membership.access = 'company';
  v_can_read_event_spaces :=
    public.has_event_space_permission(p_tenant_id, 'event.spaces.request')
    or public.has_event_space_permission(p_tenant_id, 'event.spaces.manage');
  v_can_request_onboarding := public.has_onboarding_permission(
    p_tenant_id,
    'onboarding.request'
  );
  v_can_manage_onboarding := public.has_onboarding_permission(
    p_tenant_id,
    'onboarding.manage'
  );

  return query
  with results as (
    select
      'ticket'::text as result_type,
      ticket.id as entity_id,
      ticket.subject as title,
      concat_ws(' · ', ticket.ticket_number, status.label) as detail,
      'Tickets'::text as section,
      ticket.id as ticket_id,
      ts_rank_cd(
        setweight(to_tsvector('german'::regconfig, coalesce(ticket.ticket_number, '')), 'A')
        || setweight(to_tsvector('german'::regconfig, coalesce(ticket.subject, '')), 'A')
        || setweight(to_tsvector('german'::regconfig, coalesce(ticket.description, '')), 'B'),
        v_query,
        32
      ) as rank
    from public.tickets ticket
    join public.ticket_statuses status on status.id = ticket.status_id
    where ticket.tenant_id = p_tenant_id
      and public.can_read_ticket(ticket.id)
      and (
        setweight(to_tsvector('german'::regconfig, coalesce(ticket.ticket_number, '')), 'A')
        || setweight(to_tsvector('german'::regconfig, coalesce(ticket.subject, '')), 'A')
        || setweight(to_tsvector('german'::regconfig, coalesce(ticket.description, '')), 'B')
      ) @@ v_query

    union all

    select
      'follow_up'::text,
      follow_up.id,
      follow_up.title,
      concat_ws(
        ' · ',
        case when follow_up.resolved_at is null then 'Offen' else 'Erledigt' end,
        case when follow_up.due_at is null then null else to_char(follow_up.due_at at time zone 'Europe/Zurich', 'DD.MM.YYYY HH24:MI') end
      ),
      'Wiedervorlagen'::text,
      case when follow_up.ticket_id is not null and public.can_read_ticket(follow_up.ticket_id) then follow_up.ticket_id else null end,
      ts_rank_cd(
        setweight(to_tsvector('german'::regconfig, coalesce(follow_up.title, '')), 'A')
        || setweight(to_tsvector('german'::regconfig, coalesce(follow_up.description, '')), 'B'),
        v_query,
        32
      )
    from public.experience_follow_ups follow_up
    where follow_up.tenant_id = p_tenant_id
      and v_experience_feature_enabled
      and v_can_work_tickets
      and follow_up.owner_id = auth.uid()
      and (
        setweight(to_tsvector('german'::regconfig, coalesce(follow_up.title, '')), 'A')
        || setweight(to_tsvector('german'::regconfig, coalesce(follow_up.description, '')), 'B')
      ) @@ v_query

    union all

    select
      'knowledge'::text,
      article.id,
      revision.title_snapshot,
      'Wissensartikel'::text,
      'Wissen'::text,
      null::uuid,
      knowledge_match.rank
    from public.search_knowledge_article_ids(
      p_tenant_id,
      p_query,
      v_can_read_knowledge,
      v_customer_organization_ids
    ) knowledge_match
    join public.knowledge_articles article on article.id = knowledge_match.article_id
    join public.knowledge_article_revisions revision
      on revision.article_id = article.id
     and revision.revision = case
       when v_can_read_knowledge then article.current_revision
       else article.published_revision
     end
    where v_knowledge_feature_enabled

    union all

    select
      'event_space'::text,
      request.id,
      request.title,
      concat_ws(' · ', space.name, to_char(request.starts_at at time zone 'Europe/Zurich', 'DD.MM.YYYY HH24:MI')),
      'Veranstaltungsräume'::text,
      null::uuid,
      greatest(
        ts_rank_cd(
          setweight(to_tsvector('german'::regconfig, coalesce(request.title, '')), 'A')
          || setweight(to_tsvector('german'::regconfig, coalesce(request.organizer, '')), 'B'),
          v_query,
          32
        ),
        ts_rank_cd(
          setweight(to_tsvector('german'::regconfig, coalesce(space.name, '')), 'A')
          || setweight(to_tsvector('german'::regconfig, coalesce(space.location, '')), 'B'),
          v_query,
          32
        )
      )
    from public.event_space_requests request
    join public.event_spaces space on space.id = request.space_id and space.tenant_id = request.tenant_id
    where request.tenant_id = p_tenant_id
      and v_can_read_event_spaces
      and request.starts_at >= timezone('utc', now()) - interval '48 hours'
      and request.starts_at < timezone('utc', now()) + interval '400 days'
      and (
        (setweight(to_tsvector('german'::regconfig, coalesce(request.title, '')), 'A')
          || setweight(to_tsvector('german'::regconfig, coalesce(request.organizer, '')), 'B')) @@ v_query
        or (setweight(to_tsvector('german'::regconfig, coalesce(space.name, '')), 'A')
          || setweight(to_tsvector('german'::regconfig, coalesce(space.location, '')), 'B')) @@ v_query
      )

    union all

    select
      'onboarding'::text,
      entry.id,
      entry.employee_name,
      concat_ws(' · ', 'Eintritt', to_char(entry.starts_on, 'DD.MM.YYYY')),
      'Eintritte'::text,
      null::uuid,
      greatest(
        ts_rank_cd(
          setweight(to_tsvector('german'::regconfig, coalesce(entry.employee_name, '')), 'A')
          || setweight(to_tsvector('german'::regconfig, coalesce(entry.organisation_unit, '')), 'B')
          || setweight(to_tsvector('german'::regconfig, coalesce(entry.location, '')), 'B'),
          v_query,
          32
        ),
        coalesce((
          select max(ts_rank_cd(to_tsvector('german'::regconfig, task.title), v_query, 32))
          from public.onboarding_tasks task
          where task.tenant_id = entry.tenant_id
            and task.entry_id = entry.id
            and to_tsvector('german'::regconfig, task.title) @@ v_query
        ), 0)::real
      )
    from public.onboarding_entries entry
    where entry.tenant_id = p_tenant_id
      and (
        v_can_manage_onboarding
        or entry.created_by = auth.uid()
        or entry.manager_user_id = auth.uid()
        or entry.ict_responsible_user_id = auth.uid()
      )
      and (
        (setweight(to_tsvector('german'::regconfig, coalesce(entry.employee_name, '')), 'A')
          || setweight(to_tsvector('german'::regconfig, coalesce(entry.organisation_unit, '')), 'B')
          || setweight(to_tsvector('german'::regconfig, coalesce(entry.location, '')), 'B')) @@ v_query
        or exists (
          select 1
          from public.onboarding_tasks task
          where task.tenant_id = entry.tenant_id
            and task.entry_id = entry.id
            and to_tsvector('german'::regconfig, task.title) @@ v_query
        )
      )
  )
  select *
  from results
  order by rank desc, result_type, title, entity_id
  limit v_limit;
end;
$$;

revoke all on function public.search_global_workspace(uuid, text, integer)
  from public, anon;
grant execute on function public.search_global_workspace(uuid, text, integer)
  to authenticated, service_role;

commit;
