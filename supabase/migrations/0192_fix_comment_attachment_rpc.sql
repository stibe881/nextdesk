begin;

-- chr(0) raises "null character not permitted" in PostgreSQL, so the payload
-- check of 0112 failed for every call and no message with an image could be
-- saved. Text values cannot contain NUL anyway; the check is dropped.
create or replace function public.create_ticket_comment_with_attachments(
  p_ticket_id uuid,
  p_author_id uuid,
  p_visibility public.comment_visibility,
  p_body text,
  p_attachment_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_comment_id uuid;
  v_attachment_count integer;
  v_updated_attachment_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Ticket comment attachment linking requires service_role'
      using errcode = '42501';
  end if;

  if p_ticket_id is null
     or p_author_id is null
     or p_body is null
     or char_length(p_body) not between 1 and 50000
     or p_attachment_ids is null
     or cardinality(p_attachment_ids) not between 1 and 5 then
    raise exception 'Invalid ticket comment attachment payload'
      using errcode = '22023';
  end if;

  if cardinality(p_attachment_ids) <> (
    select count(distinct attachment_id)
    from unnest(p_attachment_ids) as attachment_id
  ) then
    raise exception 'Ticket comment attachment IDs must be unique'
      using errcode = '22023';
  end if;

  perform 1
  from public.ticket_attachments attachment
  where attachment.ticket_id = p_ticket_id
    and attachment.id = any(p_attachment_ids)
    and attachment.uploaded_by = p_author_id
    and attachment.comment_id is null
    and attachment.visibility = p_visibility
    and attachment.content_type in ('image/png', 'image/jpeg', 'image/webp')
  order by attachment.id
  for update;
  get diagnostics v_attachment_count = row_count;

  if v_attachment_count <> cardinality(p_attachment_ids) then
    raise exception 'Ticket comment attachments are no longer linkable'
      using errcode = '23514';
  end if;

  insert into public.ticket_comments (
    ticket_id,
    author_id,
    visibility,
    body
  )
  values (
    p_ticket_id,
    p_author_id,
    p_visibility,
    p_body
  )
  returning id into v_comment_id;

  update public.ticket_attachments
  set comment_id = v_comment_id
  where ticket_id = p_ticket_id
    and id = any(p_attachment_ids)
    and uploaded_by = p_author_id
    and comment_id is null
    and visibility = p_visibility
    and content_type in ('image/png', 'image/jpeg', 'image/webp');
  get diagnostics v_updated_attachment_count = row_count;

  if v_updated_attachment_count <> cardinality(p_attachment_ids) then
    raise exception 'Ticket comment attachments could not be linked atomically'
      using errcode = '23514';
  end if;

  return v_comment_id;
end;
$$;

commit;
