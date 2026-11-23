begin;

-- Erwähnungen: Die Mitteilung «ticket.mention» nennt neu auch, wer erwähnt hat
-- und ob es eine interne Notiz oder eine Antwort war («Stefan Gross hat dich
-- erwähnt …»).
create or replace function public.push_notify_ticket_mention()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket record;
  v_author_name text;
  v_visibility text;
begin
  select ticket.tenant_id, ticket.id, ticket.ticket_number
    into v_ticket
    from public.tickets ticket
   where ticket.id = new.ticket_id
     and ticket.tenant_id = new.tenant_id;
  if found then
    select profile.display_name into v_author_name
      from public.user_profiles profile
     where profile.id = new.author_id;
    select comment.visibility::text into v_visibility
      from public.ticket_comments comment
     where comment.id = new.comment_id;
    perform public.push_insert_ticket_notification(
      v_ticket.tenant_id,
      new.mentioned_user_id,
      v_ticket.id,
      'ticket.mention',
      jsonb_strip_nulls(jsonb_build_object(
        'ticketNumber', v_ticket.ticket_number,
        'commentId', new.comment_id,
        'mentionId', new.id,
        'authorName', v_author_name,
        'visibility', v_visibility
      )),
      new.author_id
    );
  end if;
  return new;
exception when others then
  return new;
end;
$$;

commit;
