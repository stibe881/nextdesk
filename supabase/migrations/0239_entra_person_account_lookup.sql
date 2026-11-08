begin;

set local search_path = pg_catalog, public;

-- Finds an existing account by e-mail (service role only), so an Entra
-- person who is ordered for before their first sign-in gets exactly one
-- account. Microsoft sign-in later links to it by the verified e-mail.
create or replace function public.find_auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, auth, pg_temp
as $$
  select account.id
  from auth.users account
  where lower(account.email) = lower(btrim(p_email))
  order by account.created_at
  limit 1;
$$;
revoke all on function public.find_auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.find_auth_user_id_by_email(text) to service_role;

commit;
