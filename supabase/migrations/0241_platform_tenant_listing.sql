-- Owner console: lists every tenant (no 200 row cap) with its kind and, for
-- self-registered personal workspaces, the owner's e-mail address. Only the
-- service role may call it; the owner-console edge function checks that the
-- caller is an enabled platform administrator before using it.

create or replace function public.platform_list_tenants()
returns table (
  id uuid,
  slug text,
  name text,
  status text,
  workspace_kind text,
  owner_email text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    t.id,
    t.slug::text,
    t.name::text,
    t.status::text,
    t.workspace_kind,
    owner_account.email::text,
    t.created_at,
    t.updated_at
  from public.tenants t
  left join auth.users owner_account
    on owner_account.id = t.owner_user_id
  order by t.created_at desc
$$;

revoke all on function public.platform_list_tenants()
  from public, anon, authenticated;
grant execute on function public.platform_list_tenants() to service_role;
