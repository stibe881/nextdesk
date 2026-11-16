begin;

set local search_path = pg_catalog, public;

-- Lizenzen gehören optional zu einem Vertrag (z. B. mehrere Microsoft-365-
-- Lizenzen zu einem Enterprise Agreement). Ein Vertrag kann mehrere Lizenzen
-- umfassen, eine Lizenz gehört zu höchstens einem Vertrag. Gepflegt wird die
-- Verknüpfung über die Edge Functions «contracts» und «licenses».
alter table public.licenses
  add column if not exists contract_id uuid;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'licenses_contract_same_tenant'
      and conrelid = 'public.licenses'::regclass
  ) then
    alter table public.licenses
      add constraint licenses_contract_same_tenant
      foreign key (contract_id, tenant_id)
      references public.contracts (id, tenant_id)
      on delete set null (contract_id);
  end if;
end;
$migration$;

create index if not exists licenses_tenant_contract_idx
  on public.licenses (tenant_id, contract_id)
  where contract_id is not null;

comment on column public.licenses.contract_id is
  'Optional contract this license belongs to (same tenant). One contract can cover several licenses.';

commit;
