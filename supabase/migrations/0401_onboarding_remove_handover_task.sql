begin;

set local search_path = pg_catalog, public;

-- «Einführung und Übergabe bestätigen» entfällt aus den Eintrittsvorlagen.
update public.onboarding_template_tasks
   set active = false
 where task_key = 'handover'
   and active;

-- Offene Aufgaben bestehender Eintritte entfernen (erledigte bleiben als Verlauf).
delete from public.onboarding_tasks task
 using public.onboarding_template_tasks template
 where task.template_task_id = template.id
   and template.task_key = 'handover'
   and task.status = 'open';

-- Neue Mandanten erhalten die Aufgabe nicht mehr.
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public.seed_onboarding_templates()'::regprocedure)
    into v_def;
  v_new := replace(
    v_def,
    E'''ict''),\n    (''handover'', ''Einführung und Übergabe bestätigen'', 60, 0, ''manager'')',
    E'''ict'')'
  );
  if v_new <> v_def then
    execute v_new;
  end if;
end;
$$;

commit;
