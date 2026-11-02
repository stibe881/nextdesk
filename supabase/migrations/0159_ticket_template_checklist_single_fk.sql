-- ticket_template_checklist_items had two foreign keys to ticket_templates
-- (template_id alone and template_id + tenant_id). PostgREST cannot pick one
-- for the embedded select, so loading ticket templates failed. The composite
-- key covers the single-column one, which is dropped here.
begin;

alter table public.ticket_template_checklist_items
  drop constraint if exists ticket_template_checklist_items_template_id_fkey;

notify pgrst, 'reload schema';

commit;
