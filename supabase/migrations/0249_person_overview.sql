-- People search (global search) and person overview for agents.
--
-- * search_directory_people: people from the Entra directory sync, plus
--   ticket contacts that are not in the directory (tenants without Entra).
-- * person_overview: everything an agent needs about one person: profile,
--   tickets (also closed ones), devices, licences, orders, key figures and
--   the average satisfaction. Individual ratings and comments are never
--   returned; the average is only shown from three ratings on.
--
-- Both functions only answer ticket agents of the tenant. Tickets are always
-- filtered with can_read_ticket, so agents only see what they may read.

create or replace function public.person_search_pattern(p_token text)
returns text
language sql
immutable
set search_path to 'pg_catalog'
as $$
  select '%' || replace(replace(replace(p_token, '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

revoke all on function public.person_search_pattern(text) from public;

create or replace function public.search_directory_people(
  p_tenant_id uuid,
  p_query text,
  p_limit integer default 8
)
returns table (
  person_kind text,
  person_id uuid,
  display_name text,
  email text,
  job_title text,
  department text,
  account_enabled boolean,
  open_ticket_count integer
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'auth'
as $$
declare
  v_tokens text[];
  v_limit integer;
begin
  if p_tenant_id is null or char_length(btrim(coalesce(p_query, ''))) not between 2 and 120 then
    raise exception 'Invalid people search query' using errcode = '22023';
  end if;
  if not public.is_tenant_ticket_agent(p_tenant_id) then
    raise exception 'Ticket agent required' using errcode = '42501';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 8), 25));
  select coalesce(array_agg(token), array[]::text[])
    into v_tokens
    from unnest(regexp_split_to_array(lower(btrim(p_query)), '\s+')) token
   where token <> '';

  return query
  with directory as (
    select
      'entra'::text as kind,
      person.entra_object_id as id,
      coalesce(nullif(btrim(person.display_name), ''), person.email, 'Unbenannt') as name,
      person.email as mail,
      person.job_title as job,
      person.source_department_name as dept,
      (coalesce(person.account_enabled, true) and person.inactive_at is null) as enabled,
      person.local_user_id as user_id
    from public.tenant_entra_directory_people person
    where person.tenant_id = p_tenant_id
  ),
  contacts as (
    select distinct on (lower(coalesce(contact.email, contact.id::text)))
      'requester'::text as kind,
      contact.id,
      coalesce(nullif(btrim(contact.display_name), ''), contact.email, 'Unbenannt') as name,
      contact.email as mail,
      null::text as job,
      null::text as dept,
      null::boolean as enabled,
      contact.user_id
    from public.ticket_requesters contact
    where contact.tenant_id = p_tenant_id
      and not exists (
        select 1 from directory where directory.user_id = contact.user_id
      )
      and not exists (
        select 1 from directory where lower(directory.mail) = lower(contact.email)
      )
    order by lower(coalesce(contact.email, contact.id::text)), contact.user_id nulls last, contact.updated_at desc
  ),
  people as (
    select * from directory
    union all
    select * from contacts
  ),
  matches as (
    select people.*
    from people
    where not exists (
      select 1
      from unnest(v_tokens) token
      where lower(concat_ws(' ', people.name, people.mail, people.job, people.dept))
        not like public.person_search_pattern(token)
    )
    order by
      (lower(people.name) like lower(btrim(p_query)) || '%') desc,
      coalesce(people.enabled, true) desc,
      people.name,
      people.id
    limit v_limit
  )
  select
    matches.kind,
    matches.id,
    matches.name,
    matches.mail,
    matches.job,
    matches.dept,
    matches.enabled,
    (
      select count(*)::integer
      from public.tickets ticket
      join public.ticket_statuses status on status.id = ticket.status_id
      where ticket.tenant_id = p_tenant_id
        and not status.is_closed
        and ticket.merged_into_ticket_id is null
        and (
          (matches.user_id is not null and ticket.affected_user_id = matches.user_id)
          or (matches.user_id is not null and ticket.requester_contact_id is null and ticket.requester_id = matches.user_id)
          or ticket.requester_contact_id in (
            select contact.id
            from public.ticket_requesters contact
            where contact.tenant_id = p_tenant_id
              and (
                (matches.user_id is not null and contact.user_id = matches.user_id)
                or (matches.mail is not null and lower(contact.email) = lower(matches.mail))
                or (matches.kind = 'requester' and contact.id = matches.id)
              )
          )
        )
        and public.can_read_ticket(ticket.id)
    )
  from matches;
end;
$$;

revoke all on function public.search_directory_people(uuid, text, integer) from public, anon;
grant execute on function public.search_directory_people(uuid, text, integer) to authenticated;

create or replace function public.person_overview(
  p_tenant_id uuid,
  p_entra_object_id uuid default null,
  p_requester_contact_id uuid default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'auth'
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_entra public.tenant_entra_directory_people%rowtype;
  v_has_entra boolean := false;
  v_user_id uuid := p_user_id;
  v_email text;
  v_name text;
  v_contact_ids uuid[];
  v_ticket_ids uuid[];
  v_department text;
  v_job_title text;
  v_manager_name text;
  v_is_member boolean := false;
  v_features jsonb;
  v_can_devices boolean;
  v_can_licenses boolean;
  v_can_orders boolean;
  v_rating_count integer;
  v_rating_avg numeric;
  v_rating_positive integer;
  v_recent_count integer;
  v_recent_avg numeric;
  v_earlier_count integer;
  v_earlier_avg numeric;
  v_tenant_avg numeric;
  v_trend text;
  v_result jsonb;
begin
  if p_tenant_id is null
     or (p_entra_object_id is null and p_requester_contact_id is null and p_user_id is null) then
    raise exception 'Invalid person reference' using errcode = '22023';
  end if;
  if not public.is_tenant_ticket_agent(p_tenant_id) then
    raise exception 'Ticket agent required' using errcode = '42501';
  end if;

  -- Resolve the person from whichever reference was given.
  if p_requester_contact_id is not null then
    select coalesce(v_user_id, contact.user_id), contact.email, nullif(btrim(contact.display_name), '')
      into v_user_id, v_email, v_name
      from public.ticket_requesters contact
     where contact.tenant_id = p_tenant_id
       and contact.id = p_requester_contact_id;
    if not found then
      raise exception 'Person not found' using errcode = 'P0002';
    end if;
  end if;

  if p_entra_object_id is not null then
    select * into v_entra
      from public.tenant_entra_directory_people person
     where person.tenant_id = p_tenant_id
       and person.entra_object_id = p_entra_object_id;
    if not found then
      raise exception 'Person not found' using errcode = 'P0002';
    end if;
    v_has_entra := true;
  elsif v_user_id is not null or v_email is not null then
    select * into v_entra
      from public.tenant_entra_directory_people person
     where person.tenant_id = p_tenant_id
       and (
         (v_user_id is not null and person.local_user_id = v_user_id)
         or (v_email is not null and lower(person.email) = lower(v_email))
       )
     order by (person.local_user_id = v_user_id) desc nulls last, person.inactive_at nulls first
     limit 1;
    v_has_entra := found;
  end if;

  if v_has_entra then
    v_user_id := coalesce(v_user_id, v_entra.local_user_id);
    v_email := coalesce(v_entra.email, v_email);
    v_name := coalesce(nullif(btrim(v_entra.display_name), ''), v_name);
    v_job_title := v_entra.job_title;
    v_department := v_entra.source_department_name;
  end if;

  if v_user_id is null and v_email is not null then
    select membership.user_id into v_user_id
      from public.tenant_memberships membership
      join auth.users account on account.id = membership.user_id
     where membership.tenant_id = p_tenant_id
       and lower(account.email) = lower(v_email)
     limit 1;
  end if;

  if v_user_id is not null then
    select exists (
      select 1 from public.tenant_memberships membership
       where membership.tenant_id = p_tenant_id and membership.user_id = v_user_id
    ) into v_is_member;
    if v_email is null then
      select account.email into v_email from auth.users account where account.id = v_user_id;
    end if;
    if v_name is null then
      select nullif(btrim(profile.display_name), '') into v_name
        from public.user_profiles profile where profile.id = v_user_id;
    end if;
    select
      coalesce(v_job_title, (
        select directory.job_title
        from public.tenant_member_directory directory
        where directory.tenant_id = p_tenant_id and directory.user_id = v_user_id
      )),
      coalesce(v_department, (
        select department.name
        from public.tenant_member_directory directory
        join public.departments department
          on department.id = directory.department_id and department.tenant_id = directory.tenant_id
        where directory.tenant_id = p_tenant_id and directory.user_id = v_user_id
      ))
      into v_job_title, v_department;
  end if;

  if p_user_id is not null and p_entra_object_id is null and p_requester_contact_id is null
     and not v_has_entra and not v_is_member
     and not exists (
       select 1 from public.ticket_requesters contact
        where contact.tenant_id = p_tenant_id and contact.user_id = p_user_id
     ) then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;

  if v_has_entra and v_entra.manager_entra_object_id is not null then
    select nullif(btrim(manager.display_name), '') into v_manager_name
      from public.tenant_entra_directory_people manager
     where manager.tenant_id = p_tenant_id
       and manager.entra_object_id = v_entra.manager_entra_object_id;
  end if;
  if v_manager_name is null and v_user_id is not null then
    select nullif(btrim(profile.display_name), '') into v_manager_name
      from public.tenant_member_directory directory
      join public.user_profiles profile on profile.id = directory.manager_user_id
     where directory.tenant_id = p_tenant_id and directory.user_id = v_user_id;
  end if;

  select coalesce(array_agg(contact.id), array[]::uuid[])
    into v_contact_ids
    from public.ticket_requesters contact
   where contact.tenant_id = p_tenant_id
     and (
       contact.id = p_requester_contact_id
       or (v_user_id is not null and contact.user_id = v_user_id)
       or (v_email is not null and lower(contact.email) = lower(v_email))
     );

  select coalesce(array_agg(ticket.id), array[]::uuid[])
    into v_ticket_ids
    from public.tickets ticket
   where ticket.tenant_id = p_tenant_id
     and ticket.merged_into_ticket_id is null
     and (
       -- requester_id can be the agent who recorded the ticket for someone
       -- else; the requester contact names the real person.
       ticket.requester_contact_id = any(v_contact_ids)
       or (v_user_id is not null and ticket.requester_contact_id is null and ticket.requester_id = v_user_id)
       or (v_user_id is not null and ticket.affected_user_id = v_user_id)
     )
     and public.can_read_ticket(ticket.id);

  -- Satisfaction: only aggregates, never single ratings or comments.
  select count(*)::integer, avg(rating.score), count(*) filter (where rating.score >= 4)::integer
    into v_rating_count, v_rating_avg, v_rating_positive
    from public.ticket_satisfaction rating
   where rating.ticket_id = any(v_ticket_ids);
  select count(*)::integer, avg(rating.score)
    into v_recent_count, v_recent_avg
    from public.ticket_satisfaction rating
   where rating.ticket_id = any(v_ticket_ids)
     and rating.submitted_at >= v_now - interval '180 days';
  select count(*)::integer, avg(rating.score)
    into v_earlier_count, v_earlier_avg
    from public.ticket_satisfaction rating
   where rating.ticket_id = any(v_ticket_ids)
     and rating.submitted_at < v_now - interval '180 days'
     and rating.submitted_at >= v_now - interval '540 days';
  select avg(rating.score)
    into v_tenant_avg
    from public.ticket_satisfaction rating
    join public.tickets ticket on ticket.id = rating.ticket_id
   where ticket.tenant_id = p_tenant_id
     and rating.submitted_at >= v_now - interval '365 days';
  if v_recent_count >= 3 and v_earlier_count >= 3 then
    v_trend := case
      when v_recent_avg - v_earlier_avg >= 0.2 then 'up'
      when v_earlier_avg - v_recent_avg >= 0.2 then 'down'
      else 'stable'
    end;
  end if;

  v_features := public.user_feature_states(
    p_tenant_id,
    auth.uid(),
    array['assets.management', 'contracts.management']
  );
  v_can_devices := coalesce((v_features ->> 'assets.management')::boolean, false)
    and public.can_work_tickets_in_tenant(p_tenant_id);
  v_can_licenses := coalesce((v_features ->> 'contracts.management')::boolean, false)
    and public.has_contracts_management_permission(p_tenant_id, auth.uid());
  v_can_orders := public.shop_feature_enabled(p_tenant_id)
    and (
      public.shop_has_permission(auth.uid(), p_tenant_id, 'shop.fulfill')
      or public.shop_has_permission(auth.uid(), p_tenant_id, 'shop.manage')
    );

  select jsonb_build_object(
    'person', jsonb_build_object(
      'entraObjectId', case when v_has_entra then v_entra.entra_object_id end,
      'userId', v_user_id,
      'requesterContactId', coalesce(p_requester_contact_id, v_contact_ids[1]),
      'displayName', coalesce(v_name, v_email, 'Unbekannte Person'),
      'email', v_email,
      'jobTitle', v_job_title,
      'department', v_department,
      'source', case when v_has_entra then 'entra' else 'local' end,
      'accountEnabled', case when v_has_entra then coalesce(v_entra.account_enabled, true) and v_entra.inactive_at is null end,
      'removedFromDirectory', v_has_entra and v_entra.inactive_at is not null,
      'managerName', v_manager_name,
      'lastSignInAt', case when v_has_entra then v_entra.last_sign_in_at end,
      'isMember', v_is_member
    ),
    'stats', (
      select jsonb_build_object(
        'openTickets', count(*) filter (where not status.is_closed),
        'waitingOnPerson', count(*) filter (where status.key in ('waiting', 'waiting_customer')),
        'ticketsLast12Months', count(*) filter (where ticket.created_at >= v_now - interval '365 days'),
        'ticketsPrevious12Months', count(*) filter (
          where ticket.created_at < v_now - interval '365 days'
            and ticket.created_at >= v_now - interval '730 days'
        ),
        'totalTickets', count(*),
        'avgResolutionHours', round((avg(extract(epoch from (ticket.resolved_at - ticket.created_at)) / 3600)
          filter (where ticket.resolved_at is not null and ticket.resolved_at >= v_now - interval '365 days'))::numeric, 1),
        'tenantAvgResolutionHours', (
          select round((avg(extract(epoch from (other.resolved_at - other.created_at)) / 3600))::numeric, 1)
          from public.tickets other
          where other.tenant_id = p_tenant_id
            and other.resolved_at is not null
            and other.resolved_at >= v_now - interval '365 days'
        )
      )
      from public.tickets ticket
      join public.ticket_statuses status on status.id = ticket.status_id
      where ticket.id = any(v_ticket_ids)
    ),
    'satisfaction', jsonb_build_object(
      'ratingCount', v_rating_count,
      'minimumRatings', 3,
      'average', case when v_rating_count >= 3 then round(v_rating_avg, 1) end,
      'positiveShare', case when v_rating_count >= 3 then round(100.0 * v_rating_positive / v_rating_count) end,
      'tenantAverage', round(v_tenant_avg, 1),
      'trend', v_trend
    ),
    'topics', coalesce((
      select jsonb_agg(jsonb_build_object('name', topic.name, 'count', topic.total) order by topic.total desc, topic.name)
      from (
        select category.name, count(*)::integer as total
        from public.tickets ticket
        join public.ticket_categories category on category.id = ticket.category_id
        where ticket.id = any(v_ticket_ids)
        group by category.name
        order by count(*) desc, category.name
        limit 5
      ) topic
    ), '[]'::jsonb),
    'tickets', coalesce((
      select jsonb_agg(item.value order by item.sort_at desc, item.value ->> 'id')
      from (
        select
          ticket.updated_at as sort_at,
          jsonb_build_object(
            'id', ticket.id,
            'ticketNumber', ticket.ticket_number,
            'subject', ticket.subject,
            'statusKey', status.key,
            'statusLabel', status.label,
            'isClosed', status.is_closed,
            'priorityKey', priority.key,
            'priorityLabel', priority.label,
            'categoryName', category.name,
            'assignedAgentName', agent.display_name,
            'createdAt', ticket.created_at,
            'updatedAt', ticket.updated_at,
            'closedAt', coalesce(ticket.closed_at, ticket.resolved_at)
          ) as value
        from public.tickets ticket
        join public.ticket_statuses status on status.id = ticket.status_id
        left join public.ticket_priorities priority on priority.id = ticket.priority_id
        left join public.ticket_categories category on category.id = ticket.category_id
        left join public.user_profiles agent on agent.id = ticket.assigned_agent_id
        where ticket.id = any(v_ticket_ids)
        order by ticket.updated_at desc
        limit 300
      ) item
    ), '[]'::jsonb),
    'devices', case when v_can_devices then coalesce((
      select jsonb_agg(device.value order by device.value ->> 'name')
      from (
        select distinct on (asset.id)
          jsonb_build_object(
            'id', asset.id,
            'name', asset.name,
            'assetTag', asset.asset_tag,
            'kind', asset.kind,
            'manufacturer', asset.manufacturer,
            'model', asset.model,
            'operatingSystem', asset.operating_system,
            'complianceState', asset.intune_compliance_state,
            'lastSyncAt', asset.intune_last_sync_at,
            'assignedAt', link.assigned_at,
            'source', link.source
          ) as value
        from (
          select assignment.asset_id, assignment.assigned_at, 'assignment'::text as source, 1 as rank
          from public.asset_assignments assignment
          where assignment.tenant_id = p_tenant_id
            and assignment.returned_at is null
            and assignment.requester_id = any(v_contact_ids)
          union all
          select primary_link.asset_id, primary_link.resolved_at, 'intune'::text, 2
          from public.asset_intune_primary_person_links primary_link
          where primary_link.tenant_id = p_tenant_id
            and v_has_entra
            and primary_link.entra_object_id = v_entra.entra_object_id
        ) link
        join public.assets asset on asset.id = link.asset_id and asset.tenant_id = p_tenant_id
        where asset.active
        order by asset.id, link.rank
      ) device
    ), '[]'::jsonb) end,
    'licenses', case when v_can_licenses then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', assignment.id,
        'licenseId', license.id,
        'title', license.title,
        'vendorName', license.vendor_name,
        'assignedAt', assignment.assigned_at
      ) order by license.title)
      from public.license_assignments assignment
      join public.licenses license on license.id = assignment.license_id and license.tenant_id = p_tenant_id
      where assignment.tenant_id = p_tenant_id
        and assignment.released_at is null
        and license.archived_at is null
        and (
          (v_user_id is not null and assignment.user_id = v_user_id)
          or (v_has_entra and assignment.entra_object_id = v_entra.entra_object_id)
        )
    ), '[]'::jsonb) end,
    'orders', case when v_can_orders and v_user_id is not null then coalesce((
      select jsonb_agg(item.value order by item.sort_at desc)
      from (
        select
          shop_order.created_at as sort_at,
          jsonb_build_object(
            'id', shop_order.id,
            'orderNumber', shop_order.order_number,
            'status', shop_order.status,
            'createdAt', shop_order.created_at,
            'items', (
              select string_agg(
                case when line.quantity > 1 then line.quantity || ' × ' || line.item_name else line.item_name end,
                ', ' order by line.created_at
              )
              from public.shop_order_lines line
              where line.order_id = shop_order.id and line.tenant_id = p_tenant_id
            )
          ) as value
        from public.shop_orders shop_order
        where shop_order.tenant_id = p_tenant_id
          and shop_order.requester_id = v_user_id
        order by shop_order.created_at desc
        limit 50
      ) item
    ), '[]'::jsonb) end
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.person_overview(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.person_overview(uuid, uuid, uuid, uuid) to authenticated;
