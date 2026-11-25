begin;

set local search_path = pg_catalog, public;

-- Pro Nachricht bis zu 10 Anhänge (statt 5): Screenshots werden jetzt direkt
-- in den Text eingefügt und zählen als Anhänge der Nachricht.

do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  where p.proname = 'create_ticket_comment_with_attachments'
    and p.pronamespace = 'public'::regnamespace;
  v_new := replace(
    v_def,
    'cardinality(p_attachment_ids) not between 1 and 5',
    'cardinality(p_attachment_ids) not between 1 and 10'
  );
  if v_new = v_def then
    raise exception 'create_ticket_comment_with_attachments: Muster nicht gefunden';
  end if;
  execute v_new;
end;
$$;

commit;
