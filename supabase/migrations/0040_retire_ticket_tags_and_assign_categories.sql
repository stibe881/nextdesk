begin;
set local search_path = pg_catalog, public;

-- Tags are retired from the product. Historical records remain private for
-- audit purposes, but neither authenticated clients nor future APIs may read
-- or mutate them.
drop policy if exists ticket_tags_select_member on public.ticket_tags;
drop policy if exists ticket_tag_assignments_select_readable_ticket on public.ticket_tag_assignments;
revoke all on table public.ticket_tags, public.ticket_tag_assignments from public, anon, authenticated;
grant select, insert, update, delete on table public.ticket_tags, public.ticket_tag_assignments to service_role;

comment on table public.ticket_tags is
  'Retired nextDesk tag records retained only for historical audit continuity.';
comment on table public.ticket_tag_assignments is
  'Retired nextDesk tag assignments retained only for historical audit continuity.';

-- The actor is passed explicitly because this function is callable only by the
-- service-role Edge Function. The function repeats membership, role and
-- department checks before changing a ticket, so a privileged API client can
-- never bypass tenant or department boundaries.
create or replace function public.apply_ticket_category_selection(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_category_id uuid,
  p_subcategory_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket public.tickets%rowtype;
  v_category_name text;
  v_subcategory_name text;
  v_authorized boolean;
  v_changed boolean;
begin
  select ticket.*
    into v_ticket
    from public.tickets as ticket
   where ticket.id = p_ticket_id
     and ticket.tenant_id = p_tenant_id
   for update;

  if not found then
    raise exception 'ticket_not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
      from public.tenant_memberships as membership
     where membership.tenant_id = p_tenant_id
       and membership.user_id = p_actor_id
       and membership.status = 'active'
  ) then
    raise exception 'ticket_category_change_denied' using errcode = '42501';
  end if;

  select exists (
    select 1
      from public.user_role_assignments as assignment
      join public.roles as role
        on role.id = assignment.role_id
       and role.tenant_id = assignment.tenant_id
       and role.active
      join public.role_permissions as role_permission
        on role_permission.role_id = role.id
     where assignment.user_id = p_actor_id
       and assignment.tenant_id = p_tenant_id
       and role_permission.permission_code = 'ticket.update'
       and assignment.starts_at <= timezone('utc', now())
       and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
       and (assignment.department_id is null or assignment.department_id = v_ticket.department_id)
  ) into v_authorized;

  if not v_authorized then
    raise exception 'ticket_category_change_denied' using errcode = '42501';
  end if;

  if p_subcategory_id is not null and p_category_id is null then
    raise exception 'invalid_ticket_category' using errcode = '22023';
  end if;

  if p_category_id is not null then
    select category.name
      into v_category_name
      from public.ticket_categories as category
     where category.id = p_category_id
       and category.tenant_id = p_tenant_id
       and category.department_id = v_ticket.department_id
       and category.parent_id is null
       and category.active
     for share;

    if not found then
      raise exception 'invalid_ticket_category' using errcode = '22023';
    end if;
  end if;

  if p_subcategory_id is not null then
    select subcategory.name
      into v_subcategory_name
      from public.ticket_categories as subcategory
     where subcategory.id = p_subcategory_id
       and subcategory.tenant_id = p_tenant_id
       and subcategory.department_id = v_ticket.department_id
       and subcategory.parent_id = p_category_id
       and subcategory.active
     for share;

    if not found then
      raise exception 'invalid_ticket_category' using errcode = '22023';
    end if;
  end if;

  v_changed := v_ticket.category_id is distinct from p_category_id
    or v_ticket.subcategory_id is distinct from p_subcategory_id;

  if not v_changed then
    return jsonb_build_object(
      'changed', false,
      'categoryId', p_category_id,
      'subcategoryId', p_subcategory_id
    );
  end if;

  update public.tickets
     set category_id = p_category_id,
         subcategory_id = p_subcategory_id,
         updated_at = timezone('utc', now())
   where id = v_ticket.id;

  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (
    v_ticket.id,
    p_actor_id,
    'ticket.category_changed',
    jsonb_build_object(
      'previous_category_id', v_ticket.category_id,
      'previous_subcategory_id', v_ticket.subcategory_id,
      'category_id', p_category_id,
      'category_name', v_category_name,
      'subcategory_id', p_subcategory_id,
      'subcategory_name', v_subcategory_name
    )
  );

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity,
    before_data, after_data, metadata
  ) values (
    p_tenant_id,
    p_actor_id,
    'ticket.category.update',
    'ticket',
    v_ticket.id,
    'info',
    jsonb_build_object(
      'category_id', v_ticket.category_id,
      'subcategory_id', v_ticket.subcategory_id
    ),
    jsonb_build_object(
      'category_id', p_category_id,
      'subcategory_id', p_subcategory_id
    ),
    jsonb_build_object('department_id', v_ticket.department_id)
  );

  return jsonb_build_object(
    'changed', true,
    'categoryId', p_category_id,
    'subcategoryId', p_subcategory_id
  );
end;
$$;

revoke all on function public.apply_ticket_category_selection(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.apply_ticket_category_selection(uuid, uuid, uuid, uuid, uuid) to service_role;

commit;
