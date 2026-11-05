begin;

set local search_path = pg_catalog, public;

-- Assets created by system jobs (Intune sync, no signed-in person) get the
-- tenant's ICT department, so they follow the department scope of 0177.
create or replace function public.assets_default_department()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.department_id is null and auth.uid() is null then
    select department.id
      into new.department_id
    from public.departments department
    where department.tenant_id = new.tenant_id
      and department.kind = 'ict'
      and department.active
    order by department.created_at
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists assets_default_department on public.assets;
create trigger assets_default_department
  before insert on public.assets
  for each row
  execute function public.assets_default_department();

revoke all on function public.assets_default_department() from public, anon, authenticated;

commit;
