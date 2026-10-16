begin;

-- The composite foreign key below already enforces both the role reference and
-- tenant isolation. Removing the older single-column FK makes the PostgREST
-- relation unambiguous for nested role/permission selects in Edge Functions.
alter table public.user_role_assignments
  drop constraint if exists user_role_assignments_role_id_fkey;

commit;
