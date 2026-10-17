begin;

set local search_path = pg_catalog, public;

-- A domain may bind to only one enabled customer SSO configuration. The ledger
-- makes the routing decision deterministic and prevents two tenants from
-- claiming the same company domain.
create table public.tenant_sso_allowed_domains (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  domain text collate "C" not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (tenant_id, domain),
  constraint tenant_sso_allowed_domains_domain_unique unique (domain),
  constraint tenant_sso_allowed_domains_domain_valid check (
    domain ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
  )
);

create index tenant_sso_allowed_domains_tenant_idx
  on public.tenant_sso_allowed_domains (tenant_id, domain);

create or replace function public.normalize_tenant_sso_domain(p_domain text)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_domain text;
begin
  if p_domain collate "C" ~ '[[:cntrl:]]' then
    raise exception 'Invalid SSO email domain' using errcode = '23514';
  end if;

  v_domain := lower(btrim(p_domain) collate "C");
  if octet_length(v_domain) not between 3 and 253
     or v_domain collate "C" !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
  then
    raise exception 'Invalid SSO email domain' using errcode = '23514';
  end if;

  return v_domain;
end;
$$;

create or replace function public.normalize_tenant_sso_configuration()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_domain text;
  v_domains text[] := '{}';
begin
  foreach v_domain in array coalesce(new.allowed_email_domains, '{}') loop
    v_domains := array_append(v_domains, public.normalize_tenant_sso_domain(v_domain));
  end loop;

  select coalesce(array_agg(distinct domain order by domain), '{}')
    into new.allowed_email_domains
  from unnest(v_domains) as normalized(domain);

  if new.enforce_sso and not new.enabled then
    raise exception 'SSO enforcement requires enabled SSO' using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.sync_tenant_sso_allowed_domains()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  delete from public.tenant_sso_allowed_domains
  where tenant_id = new.tenant_id;

  if new.enabled then
    insert into public.tenant_sso_allowed_domains (tenant_id, domain)
    select new.tenant_id, domain
    from unnest(new.allowed_email_domains) as configured(domain);
  end if;

  return new;
end;
$$;

create trigger tenant_sso_configurations_normalize
before insert or update of provider, enabled, allowed_email_domains, enforce_sso
on public.tenant_sso_configurations
for each row execute function public.normalize_tenant_sso_configuration();

create trigger tenant_sso_configurations_sync_domains
before insert or update of enabled, allowed_email_domains
on public.tenant_sso_configurations
for each row execute function public.sync_tenant_sso_allowed_domains();

-- Backfill the ledger after the triggers exist so malformed historical input is
-- normalized once and duplicate enabled domains fail closed during migration.
update public.tenant_sso_configurations
set allowed_email_domains = allowed_email_domains;

alter table public.tenant_sso_allowed_domains enable row level security;
revoke all on table public.tenant_sso_allowed_domains from public, anon, authenticated;
grant select, insert, update, delete on table public.tenant_sso_allowed_domains to service_role;

revoke all on function public.normalize_tenant_sso_domain(text) from public, anon, authenticated;
revoke all on function public.normalize_tenant_sso_configuration() from public, anon, authenticated;
revoke all on function public.sync_tenant_sso_allowed_domains() from public, anon, authenticated;
grant execute on function public.normalize_tenant_sso_domain(text) to service_role;

comment on table public.tenant_sso_allowed_domains is
  'Private, unique-domain routing ledger for enabled tenant SSO configurations. It prevents cross-tenant domain ambiguity.';

commit;
