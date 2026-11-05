begin;

set local search_path = pg_catalog, public;

-- Serviceaufgaben belong to a department. People see the templates and due
-- tasks of the departments in which the module is on for them
-- (user_feature_departments). A template without a department is visible to
-- everyone with the module, e.g. in tenants without departments.

alter table public.service_task_templates
  add column if not exists department_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'service_task_templates_department_fk'
  ) then
    alter table public.service_task_templates
      add constraint service_task_templates_department_fk
      foreign key (department_id, tenant_id)
      references public.departments(id, tenant_id)
      on delete set null (department_id);
  end if;
end
$$;

create index if not exists service_task_templates_department_idx
  on public.service_task_templates (tenant_id, department_id);

-- Existing templates go to the ICT department of their tenant.
update public.service_task_templates template
set department_id = department.id
from public.departments department
where template.department_id is null
  and department.tenant_id = template.tenant_id
  and department.kind = 'ict';

commit;
