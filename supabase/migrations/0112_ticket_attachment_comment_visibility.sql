begin;

-- Existing attachments retain their established ticket-level accessibility.
-- New composer uploads explicitly inherit their internal/external comment mode.
alter table public.ticket_attachments
  add column if not exists visibility public.comment_visibility;

-- Preserve the known visibility of historical attachments that were already
-- linked to a ticket comment. Only truly unlinked legacy attachments keep the
-- prior ticket-wide external behavior.
update public.ticket_attachments attachment
set visibility = comment.visibility
from public.ticket_comments comment
where attachment.comment_id = comment.id
  and attachment.visibility is null;

update public.ticket_attachments
set visibility = 'external'
where visibility is null;

alter table public.ticket_attachments
  alter column visibility set default 'external',
  alter column visibility set not null;

create index if not exists ticket_attachments_ticket_visibility_created_idx
  on public.ticket_attachments (ticket_id, visibility, created_at desc);

-- Direct PostgREST reads must enforce the same internal-note boundary as the
-- Edge Function. Otherwise an internal image could be retrieved outside the
-- ticket detail UI.
drop policy if exists ticket_attachments_select_authorized
  on public.ticket_attachments;

create policy ticket_attachments_select_authorized
  on public.ticket_attachments
  for select
  to authenticated
  using (
    public.can_read_ticket(ticket_id)
    and (
      visibility = 'external'
      or public.can_read_internal_note(ticket_id)
    )
  );

-- The Edge Function authorizes ticket access and the requested comment mode.
-- This RPC only performs the final database transaction: it refuses attachment
-- IDs that do not belong to the same ticket, were not uploaded by the actor,
-- have a different visibility or are already linked to another comment.
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
     or position(chr(0) in p_body) > 0
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

revoke all on function public.create_ticket_comment_with_attachments(
  uuid,
  uuid,
  public.comment_visibility,
  text,
  uuid[]
) from public, anon, authenticated;

grant execute on function public.create_ticket_comment_with_attachments(
  uuid,
  uuid,
  public.comment_visibility,
  text,
  uuid[]
) to service_role;

comment on column public.ticket_attachments.visibility is
  'Matches the creating ticket comment visibility. Internal attachments require ticket.internal_notes.read.';

comment on function public.create_ticket_comment_with_attachments(
  uuid,
  uuid,
  public.comment_visibility,
  text,
  uuid[]
) is
  'Service-role-only atomic creation of a ticket comment and links to its already uploaded, actor-owned attachments.';

commit;
