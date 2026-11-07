begin;

set local search_path = pg_catalog, public;

-- A saved ticket view can be shared with one department: its active members
-- see and apply the view, only the owner changes or deletes it.
alter table public.saved_ticket_views
  add column if not exists shared_department_id uuid
    references public.departments(id) on delete set null;
create index if not exists saved_ticket_views_shared_department_idx
  on public.saved_ticket_views (tenant_id, shared_department_id)
  where shared_department_id is not null;

commit;
