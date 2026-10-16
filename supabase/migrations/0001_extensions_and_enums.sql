begin;

create extension if not exists pgcrypto;
create extension if not exists citext;

create type public.tenant_status as enum ('active', 'suspended', 'archived');
create type public.membership_status as enum ('invited', 'active', 'suspended', 'removed');
create type public.role_scope as enum ('platform', 'tenant', 'department', 'team');
create type public.comment_visibility as enum ('internal', 'external');
create type public.domain_status as enum ('pending', 'verified', 'failed', 'disabled');
create type public.audit_severity as enum ('info', 'warning', 'security', 'critical');
create type public.customer_ticket_access as enum ('disabled', 'own', 'company');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

commit;
