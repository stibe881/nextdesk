set local search_path = pg_catalog, public;

-- Hinweise für Anfragende: Text bis 300 Zeichen, Abstand in Mails standardmässig 0.
do $$
declare
  v_name text;
begin
  select constraint_row.conname
    into v_name
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'public.requester_notices'::regclass
    and constraint_row.contype = 'c'
    and pg_get_constraintdef(constraint_row.oid) like '%char_length(body)%';
  if v_name is not null then
    execute format('alter table public.requester_notices drop constraint %I', v_name);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.requester_notices'::regclass
      and conname = 'requester_notices_body_length_check'
  ) then
    alter table public.requester_notices
      add constraint requester_notices_body_length_check
      check (char_length(body) between 1 and 300);
  end if;
end;
$$;

alter table public.requester_notice_settings
  alter column frequency_days set default 0;
