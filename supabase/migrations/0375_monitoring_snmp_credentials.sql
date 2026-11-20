-- Überwachung: SNMP-Zugangsdaten pro Gerät und als Standard pro Sonde in
-- nextDesk pflegen.
--
-- Die nicht geheimen Angaben (Version, Benutzer, Protokolle) stehen in
-- monitoring_snmp_credentials. Die Geheimnisse (Community, Schlüssel) liegen
-- verschlüsselt im Supabase Vault; die Tabelle hält nur die ID des Eintrags.
-- Die Sonde holt die Zugangsdaten beim Melden ab; Einträge aus nextDesk haben
-- Vorrang vor der config.json der Sonde. Zugriff nur über die Service-Rolle.

create table if not exists public.monitoring_snmp_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Genau eines von beiden: Gerät oder Sonde (Standard für deren Geräte).
  asset_id uuid references public.assets(id) on delete cascade,
  agent_id uuid references public.ipam_agents(id) on delete cascade,
  version text not null check (version in ('v2c', 'v3')),
  snmp_user text check (snmp_user is null or char_length(snmp_user) between 1 and 64),
  auth_protocol text check (auth_protocol in ('md5', 'sha', 'sha224', 'sha256', 'sha384', 'sha512')),
  priv_protocol text check (priv_protocol in ('des', 'aes', 'aes256b', 'aes256r')),
  secret_id uuid,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint monitoring_snmp_credentials_scope check ((asset_id is null) <> (agent_id is null)),
  constraint monitoring_snmp_credentials_shape check (
    (version = 'v2c' and snmp_user is null and auth_protocol is null and priv_protocol is null)
    or (version = 'v3' and snmp_user is not null and (priv_protocol is null or auth_protocol is not null))
  )
);
create unique index if not exists monitoring_snmp_credentials_asset_unique
  on public.monitoring_snmp_credentials (asset_id) where asset_id is not null;
create unique index if not exists monitoring_snmp_credentials_agent_unique
  on public.monitoring_snmp_credentials (agent_id) where agent_id is not null;
create index if not exists monitoring_snmp_credentials_tenant_idx
  on public.monitoring_snmp_credentials (tenant_id);

alter table public.monitoring_snmp_credentials enable row level security;
revoke all on public.monitoring_snmp_credentials from public, anon, authenticated;
grant select on public.monitoring_snmp_credentials to service_role;

-- Speichert Zugangsdaten. p_secret null behält die gespeicherten Geheimnisse
-- (nur bei gleicher Version); sonst {"community": …} bzw. {"authKey": …, "privKey": …}.
create or replace function public.monitoring_snmp_credential_save(
  p_tenant_id uuid,
  p_asset_id uuid,
  p_agent_id uuid,
  p_version text,
  p_user text,
  p_auth_protocol text,
  p_priv_protocol text,
  p_secret jsonb,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.monitoring_snmp_credentials%rowtype;
  v_secret jsonb;
  v_secret_id uuid;
  v_id uuid;
begin
  if to_regnamespace('vault') is null then
    raise exception 'snmp credentials: vault is not available' using errcode = '0A000';
  end if;
  if (p_asset_id is null) = (p_agent_id is null) then
    raise exception 'snmp credentials: exactly one of device and probe' using errcode = '22023';
  end if;
  if p_asset_id is not null and not exists (
    select 1 from public.assets where id = p_asset_id and tenant_id = p_tenant_id
  ) then
    raise exception 'snmp credentials: device not found' using errcode = '23503';
  end if;
  if p_agent_id is not null and not exists (
    select 1 from public.ipam_agents where id = p_agent_id and tenant_id = p_tenant_id
  ) then
    raise exception 'snmp credentials: probe not found' using errcode = '23503';
  end if;

  select * into v_row from public.monitoring_snmp_credentials
   where tenant_id = p_tenant_id
     and ((p_asset_id is not null and asset_id = p_asset_id)
       or (p_agent_id is not null and agent_id = p_agent_id))
   for update;

  -- Bestehende Geheimnisse übernehmen, wo keine neuen kommen.
  v_secret := '{}'::jsonb;
  if v_row.secret_id is not null and v_row.version = p_version then
    execute 'select decrypted_secret::jsonb from vault.decrypted_secrets where id = $1'
      into v_secret using v_row.secret_id;
    v_secret := coalesce(v_secret, '{}'::jsonb);
  end if;
  v_secret := v_secret || coalesce(jsonb_strip_nulls(p_secret), '{}'::jsonb);

  if p_version = 'v2c' then
    v_secret := jsonb_build_object('community', v_secret ->> 'community');
    if coalesce(char_length(v_secret ->> 'community'), 0) not between 1 and 128 then
      raise exception 'snmp credentials: community missing' using errcode = '22023';
    end if;
  elsif p_version = 'v3' then
    v_secret := jsonb_strip_nulls(jsonb_build_object(
      'authKey', case when p_auth_protocol is not null then v_secret ->> 'authKey' end,
      'privKey', case when p_priv_protocol is not null then v_secret ->> 'privKey' end
    ));
    if p_auth_protocol is not null
       and coalesce(char_length(v_secret ->> 'authKey'), 0) not between 8 and 128 then
      raise exception 'snmp credentials: auth key missing' using errcode = '22023';
    end if;
    if p_priv_protocol is not null
       and coalesce(char_length(v_secret ->> 'privKey'), 0) not between 8 and 128 then
      raise exception 'snmp credentials: priv key missing' using errcode = '22023';
    end if;
  else
    raise exception 'snmp credentials: unknown version' using errcode = '22023';
  end if;

  if v_row.secret_id is not null then
    execute 'select vault.update_secret($1, $2)' using v_row.secret_id, v_secret::text;
    v_secret_id := v_row.secret_id;
  else
    execute 'select vault.create_secret($1)' into v_secret_id using v_secret::text;
  end if;

  if v_row.id is not null then
    update public.monitoring_snmp_credentials
       set version = p_version,
           snmp_user = case when p_version = 'v3' then btrim(p_user) end,
           auth_protocol = case when p_version = 'v3' then p_auth_protocol end,
           priv_protocol = case when p_version = 'v3' then p_priv_protocol end,
           secret_id = v_secret_id,
           updated_by = p_actor,
           updated_at = timezone('utc', now())
     where id = v_row.id
     returning id into v_id;
  else
    insert into public.monitoring_snmp_credentials (
      tenant_id, asset_id, agent_id, version, snmp_user, auth_protocol, priv_protocol,
      secret_id, updated_by
    ) values (
      p_tenant_id, p_asset_id, p_agent_id, p_version,
      case when p_version = 'v3' then btrim(p_user) end,
      case when p_version = 'v3' then p_auth_protocol end,
      case when p_version = 'v3' then p_priv_protocol end,
      v_secret_id, p_actor
    ) returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.monitoring_snmp_credential_save(uuid, uuid, uuid, text, text, text, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.monitoring_snmp_credential_save(uuid, uuid, uuid, text, text, text, text, jsonb, uuid)
  to service_role;

-- Entfernt den Vault-Eintrag, sobald die Zugangsdaten gelöscht werden (auch
-- beim Löschen des Geräts, der Sonde oder des Mandanten).
create or replace function public.monitoring_snmp_credentials_drop_secret()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.secret_id is not null and to_regclass('vault.secrets') is not null then
    execute 'delete from vault.secrets where id = $1' using old.secret_id;
  end if;
  return old;
end;
$$;
revoke all on function public.monitoring_snmp_credentials_drop_secret() from public, anon, authenticated;

drop trigger if exists monitoring_snmp_credentials_drop_secret on public.monitoring_snmp_credentials;
create trigger monitoring_snmp_credentials_drop_secret
  after delete on public.monitoring_snmp_credentials
  for each row execute function public.monitoring_snmp_credentials_drop_secret();

create or replace function public.monitoring_snmp_credential_delete(
  p_tenant_id uuid,
  p_asset_id uuid,
  p_agent_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  delete from public.monitoring_snmp_credentials
   where tenant_id = p_tenant_id
     and ((p_asset_id is not null and asset_id = p_asset_id)
       or (p_agent_id is not null and agent_id = p_agent_id));
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
revoke all on function public.monitoring_snmp_credential_delete(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.monitoring_snmp_credential_delete(uuid, uuid, uuid) to service_role;

-- Stand der Zugangsdaten einer Sonde: ändert sich, sobald etwas gespeichert
-- oder gelöscht wird oder ein Gerät eine andere Adresse bekommt. Die Sonde
-- nennt ihren Stand und bekommt die Geheimnisse nur bei einer Änderung.
create or replace function public.monitoring_snmp_revision(p_tenant_id uuid, p_agent_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(md5(string_agg(
    credential.id::text || ':' || credential.updated_at::text || ':'
      || coalesce(infra.ip_address, '') || ':' || coalesce(infra.hostname, ''),
    '|' order by credential.id
  )), 'none')
  from public.monitoring_snmp_credentials credential
  left join public.asset_infrastructure infra
    on infra.asset_id = credential.asset_id and infra.tenant_id = credential.tenant_id
  where credential.tenant_id = p_tenant_id
    and (credential.asset_id is not null or credential.agent_id = p_agent_id);
$$;
revoke all on function public.monitoring_snmp_revision(uuid, uuid) from public, anon, authenticated;
grant execute on function public.monitoring_snmp_revision(uuid, uuid) to service_role;

-- Zugangsdaten für eine Sonde, entschlüsselt: {"default": …, "hosts": {"10.0.0.1": …}}.
create or replace function public.monitoring_snmp_credentials_for_agent(p_tenant_id uuid, p_agent_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row record;
  v_secret jsonb;
  v_entry jsonb;
  v_default jsonb := null;
  v_hosts jsonb := '{}'::jsonb;
  v_host text;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    return jsonb_build_object('default', null, 'hosts', '{}'::jsonb);
  end if;
  for v_row in
    select credential.*, infra.ip_address, infra.hostname
    from public.monitoring_snmp_credentials credential
    left join public.asset_infrastructure infra
      on infra.asset_id = credential.asset_id and infra.tenant_id = credential.tenant_id
    where credential.tenant_id = p_tenant_id
      and (credential.asset_id is not null or credential.agent_id = p_agent_id)
    order by credential.updated_at
    limit 2000
  loop
    execute 'select decrypted_secret::jsonb from vault.decrypted_secrets where id = $1'
      into v_secret using v_row.secret_id;
    if v_secret is null then
      continue;
    end if;
    if v_row.version = 'v2c' then
      v_entry := jsonb_build_object('version', 'v2c', 'community', v_secret ->> 'community');
    else
      v_entry := jsonb_strip_nulls(jsonb_build_object(
        'version', 'v3',
        'user', v_row.snmp_user,
        'authProtocol', v_row.auth_protocol,
        'authKey', case when v_row.auth_protocol is not null then v_secret ->> 'authKey' end,
        'privProtocol', v_row.priv_protocol,
        'privKey', case when v_row.priv_protocol is not null then v_secret ->> 'privKey' end
      ));
    end if;
    if v_row.agent_id is not null then
      v_default := v_entry;
    else
      foreach v_host in array array[v_row.ip_address, v_row.hostname] loop
        if nullif(btrim(v_host), '') is not null then
          v_hosts := v_hosts || jsonb_build_object(lower(btrim(v_host)), v_entry);
        end if;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('default', v_default, 'hosts', v_hosts);
end;
$$;
revoke all on function public.monitoring_snmp_credentials_for_agent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.monitoring_snmp_credentials_for_agent(uuid, uuid) to service_role;

comment on table public.monitoring_snmp_credentials is
  'SNMP credentials per device or as default per probe. Secrets live in the vault. Service role only.';
