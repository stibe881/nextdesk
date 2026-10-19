begin;

set local search_path = pg_catalog, public;

create or replace function public.exchange_mail_create_oauth_state(
  p_state_hash text,
  p_tenant_id uuid,
  p_actor_id uuid,
  p_code_verifier text,
  p_nonce_hash text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, mail_private, pg_temp
as $$
begin
  if coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    ) <> 'service_role' then
    raise exception 'Exchange OAuth state requires service_role' using errcode = '42501';
  end if;

  if p_state_hash is null
     or p_state_hash !~ '^[0-9a-f]{64}$'
     or p_tenant_id is null
     or p_actor_id is null
     or p_code_verifier is null
     or char_length(p_code_verifier) not between 43 and 128
     or p_nonce_hash is null
     or p_nonce_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at is null
     or p_expires_at <= timezone('utc', now())
     or p_expires_at > timezone('utc', now()) + interval '15 minutes' then
    raise exception 'Invalid Exchange OAuth state' using errcode = '22023';
  end if;

  insert into mail_private.exchange_mail_oauth_states (
    state_hash,
    tenant_id,
    actor_id,
    code_verifier,
    nonce_hash,
    expires_at
  ) values (
    p_state_hash,
    p_tenant_id,
    p_actor_id,
    p_code_verifier,
    p_nonce_hash,
    p_expires_at
  );
end;
$$;

create or replace function public.exchange_mail_consume_oauth_state(
  p_state_hash text
)
returns table (
  tenant_id uuid,
  actor_id uuid,
  code_verifier text,
  nonce_hash text
)
language plpgsql
security definer
set search_path = pg_catalog, public, mail_private, pg_temp
as $$
begin
  if coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    ) <> 'service_role' then
    raise exception 'Exchange OAuth state requires service_role' using errcode = '42501';
  end if;

  if p_state_hash is null or p_state_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  return query
  update mail_private.exchange_mail_oauth_states
  set consumed_at = timezone('utc', now())
  where state_hash = p_state_hash
    and consumed_at is null
    and expires_at > timezone('utc', now())
  returning
    exchange_mail_oauth_states.tenant_id,
    exchange_mail_oauth_states.actor_id,
    exchange_mail_oauth_states.code_verifier,
    exchange_mail_oauth_states.nonce_hash;
end;
$$;

create or replace function public.exchange_mail_store_connection_credential(
  p_connection_id uuid,
  p_tenant_id uuid,
  p_refresh_token_ciphertext text,
  p_key_version smallint default 1
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, mail_private, pg_temp
as $$
begin
  if coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    ) <> 'service_role' then
    raise exception 'Exchange credential storage requires service_role' using errcode = '42501';
  end if;

  if p_connection_id is null
     or p_tenant_id is null
     or p_refresh_token_ciphertext is null
     or char_length(p_refresh_token_ciphertext) not between 32 and 16384
     or p_key_version not between 1 and 255
     or not exists (
       select 1
       from public.exchange_mail_connections connection
       where connection.id = p_connection_id
         and connection.tenant_id = p_tenant_id
     ) then
    raise exception 'Invalid Exchange credential target' using errcode = '22023';
  end if;

  insert into mail_private.exchange_mail_connection_credentials (
    connection_id,
    tenant_id,
    refresh_token_ciphertext,
    key_version,
    updated_at
  ) values (
    p_connection_id,
    p_tenant_id,
    p_refresh_token_ciphertext,
    p_key_version,
    timezone('utc', now())
  )
  on conflict (connection_id) do update
  set refresh_token_ciphertext = excluded.refresh_token_ciphertext,
      key_version = excluded.key_version,
      updated_at = excluded.updated_at
  where exchange_mail_connection_credentials.tenant_id = excluded.tenant_id;

  if not found then
    raise exception 'Exchange credential tenant mismatch' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.exchange_mail_read_connection_credential(
  p_connection_id uuid,
  p_tenant_id uuid
)
returns table (
  refresh_token_ciphertext text
)
language plpgsql
security definer
set search_path = pg_catalog, public, mail_private, pg_temp
as $$
begin
  if coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    ) <> 'service_role' then
    raise exception 'Exchange credential access requires service_role' using errcode = '42501';
  end if;

  if p_connection_id is null or p_tenant_id is null then
    return;
  end if;

  return query
  select credential.refresh_token_ciphertext
  from mail_private.exchange_mail_connection_credentials credential
  where credential.connection_id = p_connection_id
    and credential.tenant_id = p_tenant_id
  limit 1;
end;
$$;

create or replace function public.exchange_mail_get_service_identity()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, mail_private, pg_temp
as $$
declare
  v_user_id uuid;
begin
  if coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    ) <> 'service_role' then
    raise exception 'Exchange service identity requires service_role' using errcode = '42501';
  end if;

  select identity.user_id
  into v_user_id
  from mail_private.service_identity identity
  where identity.singleton;

  return v_user_id;
end;
$$;

create or replace function public.exchange_mail_claim_service_identity(
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, mail_private, pg_temp
as $$
declare
  v_user_id uuid;
begin
  if coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    ) <> 'service_role' then
    raise exception 'Exchange service identity requires service_role' using errcode = '42501';
  end if;

  if p_user_id is null
     or not exists (
       select 1 from public.user_profiles profile where profile.id = p_user_id
     ) then
    raise exception 'Invalid Exchange service identity' using errcode = '22023';
  end if;

  insert into mail_private.service_identity (singleton, user_id)
  values (true, p_user_id)
  on conflict (singleton) do update
  set user_id = mail_private.service_identity.user_id
  returning user_id into v_user_id;

  return v_user_id;
end;
$$;

revoke all on function public.exchange_mail_create_oauth_state(text, uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.exchange_mail_consume_oauth_state(text)
  from public, anon, authenticated;
revoke all on function public.exchange_mail_store_connection_credential(uuid, uuid, text, smallint)
  from public, anon, authenticated;
revoke all on function public.exchange_mail_read_connection_credential(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.exchange_mail_get_service_identity()
  from public, anon, authenticated;
revoke all on function public.exchange_mail_claim_service_identity(uuid)
  from public, anon, authenticated;

grant execute on function public.exchange_mail_create_oauth_state(text, uuid, uuid, text, text, timestamptz)
  to service_role;
grant execute on function public.exchange_mail_consume_oauth_state(text)
  to service_role;
grant execute on function public.exchange_mail_store_connection_credential(uuid, uuid, text, smallint)
  to service_role;
grant execute on function public.exchange_mail_read_connection_credential(uuid, uuid)
  to service_role;
grant execute on function public.exchange_mail_get_service_identity()
  to service_role;
grant execute on function public.exchange_mail_claim_service_identity(uuid)
  to service_role;

comment on function public.exchange_mail_create_oauth_state(text, uuid, uuid, text, text, timestamptz) is
  'Service-role-only creation of a short-lived, PKCE-bound Microsoft 365 OAuth state.';
comment on function public.exchange_mail_consume_oauth_state(text) is
  'Service-role-only atomic consumption of a Microsoft 365 OAuth state.';
comment on function public.exchange_mail_store_connection_credential(uuid, uuid, text, smallint) is
  'Service-role-only upsert of an already encrypted Microsoft 365 refresh token.';
comment on function public.exchange_mail_read_connection_credential(uuid, uuid) is
  'Service-role-only retrieval of an encrypted Microsoft 365 refresh token for server-side rotation.';
comment on function public.exchange_mail_get_service_identity() is
  'Service-role-only lookup of the internal Exchange mail service identity.';
comment on function public.exchange_mail_claim_service_identity(uuid) is
  'Service-role-only atomic claim of the internal Exchange mail service identity.';

commit;
