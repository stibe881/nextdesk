-- Role-specific handbooks (docs/handbooks). The content is published as
-- docs/handbooks/handbooks.bundle.json and loaded into these tables from a
-- pinned commit, so the Edge Function stays small. Only the service role
-- (the handbooks Function) reads the tables; the Function decides per role
-- which handbook a person may open.

create table if not exists public.handbook_documents (
  id text primary key
    check (id in ('mitarbeitende', 'agenten', 'administratoren', 'installation')),
  title text not null check (char_length(title) between 1 and 200),
  description text not null check (char_length(description) between 1 and 500),
  audience_label text not null check (char_length(audience_label) between 1 and 80),
  updated_on date not null,
  markdown text not null,
  sort_order smallint not null,
  source_ref text not null check (source_ref ~ '^[0-9a-f]{40}$'),
  synced_at timestamptz not null default now()
);

create table if not exists public.handbook_images (
  name text primary key check (name ~ '^[A-Za-z0-9._-]{1,120}$'),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  data text not null,
  source_ref text not null check (source_ref ~ '^[0-9a-f]{40}$')
);

alter table public.handbook_documents enable row level security;
alter table public.handbook_images enable row level security;
revoke all on public.handbook_documents from anon, authenticated;
revoke all on public.handbook_images from anon, authenticated;

-- Step 1: request the bundle of a commit from the public repository.
create or replace function public.request_handbook_sync(p_ref text)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_ref is null or p_ref !~ '^[0-9a-f]{40}$' then
    raise exception 'Ungültige Commit-ID' using errcode = '22023';
  end if;
  return net.http_get(
    url := 'https://raw.githubusercontent.com/stibe881/nextdesk/' || p_ref
      || '/docs/handbooks/handbooks.bundle.json',
    timeout_milliseconds := 60000
  );
end;
$$;

-- Step 2: validate the downloaded bundle and replace the stored handbooks.
create or replace function public.apply_handbook_sync(
  p_request_id bigint,
  p_ref text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_status integer;
  v_content text;
  v_bundle jsonb;
  v_documents integer;
  v_images integer;
begin
  if p_ref is null or p_ref !~ '^[0-9a-f]{40}$' then
    raise exception 'Ungültige Commit-ID' using errcode = '22023';
  end if;
  select status_code, content
    into v_status, v_content
    from net._http_response
   where id = p_request_id;
  if not found then
    raise exception 'Antwort noch nicht da – in ein paar Sekunden erneut ausführen'
      using errcode = 'P0002';
  end if;
  if v_status is distinct from 200 then
    raise exception 'Download fehlgeschlagen (HTTP %)', v_status;
  end if;

  v_bundle := v_content::jsonb;
  if jsonb_typeof(v_bundle -> 'handbooks') <> 'array'
     or jsonb_typeof(v_bundle -> 'images') <> 'object'
     or jsonb_array_length(v_bundle -> 'handbooks') <> 4 then
    raise exception 'Ungültiges Handbuch-Paket';
  end if;

  delete from public.handbook_documents where true;
  delete from public.handbook_images where true;

  insert into public.handbook_documents (
    id, title, description, audience_label, updated_on, markdown, sort_order,
    source_ref
  )
  select
    item ->> 'id',
    item ->> 'title',
    item ->> 'description',
    item ->> 'audienceLabel',
    (item ->> 'updatedAt')::date,
    item ->> 'markdown',
    (ordinality - 1)::smallint,
    p_ref
  from jsonb_array_elements(v_bundle -> 'handbooks') with ordinality as t(item, ordinality);

  insert into public.handbook_images (name, mime, data, source_ref)
  select key, value ->> 'mime', value ->> 'data', p_ref
  from jsonb_each(v_bundle -> 'images');

  select count(*) into v_documents from public.handbook_documents;
  select count(*) into v_images from public.handbook_images;
  return format('%s Handbücher, %s Bilder aus %s', v_documents, v_images, p_ref);
end;
$$;

revoke all on function public.request_handbook_sync(text)
  from public, anon, authenticated;
revoke all on function public.apply_handbook_sync(bigint, text)
  from public, anon, authenticated;
