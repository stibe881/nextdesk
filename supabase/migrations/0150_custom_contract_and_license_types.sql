begin;

-- Arten können frei ergänzt werden. Die bisherigen Schlüssel (z. B. 'service')
-- bleiben gültig; eigene Arten werden als bereinigter Text gespeichert.
do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.contracts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%contract_type%'
  loop
    execute format('alter table public.contracts drop constraint %I', v_constraint.conname);
  end loop;

  alter table public.contracts
    add constraint contracts_contract_type_valid check (
      char_length(btrim(contract_type)) between 1 and 60
      and contract_type = btrim(contract_type)
      and contract_type !~ '[[:cntrl:]]'
    );

  if to_regclass('public.licenses') is not null then
    for v_constraint in
      select conname
      from pg_constraint
      where conrelid = 'public.licenses'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) like '%license_type%'
    loop
      execute format('alter table public.licenses drop constraint %I', v_constraint.conname);
    end loop;

    alter table public.licenses
      add constraint licenses_license_type_valid check (
        char_length(btrim(license_type)) between 1 and 60
        and license_type = btrim(license_type)
        and license_type !~ '[[:cntrl:]]'
      );
  end if;
end;
$$;

commit;
