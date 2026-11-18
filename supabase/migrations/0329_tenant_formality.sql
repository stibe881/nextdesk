begin;

set local search_path = pg_catalog, public;

-- Form of address the tenant uses for all texts (web, mobile app, e-mails,
-- push messages, handbooks): informal «du» (default) or formal «Sie».
alter table public.tenant_settings
  add column if not exists formality text not null default 'du';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tenant_settings_formality_check'
      and conrelid = 'public.tenant_settings'::regclass
  ) then
    alter table public.tenant_settings
      add constraint tenant_settings_formality_check
      check (formality in ('du', 'sie'));
  end if;
end $$;

comment on column public.tenant_settings.formality is
  'Form of address in all texts of the tenant: du (informal, default) or sie (formal).';

commit;
