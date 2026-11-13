begin;

set local search_path = pg_catalog, public;

-- Handbooks exist in two wordings: informal «du» (docs/handbooks/*.md) and
-- formal «Sie» (docs/handbooks/sie/*.md). The existing columns keep the «du»
-- wording; the new columns hold the «Sie» wording. They stay null until the
-- next handbook sync, and the handbooks Function then falls back to the «du»
-- wording, so existing rows keep working.
alter table public.handbook_documents
  add column if not exists title_sie text
    check (title_sie is null or char_length(title_sie) between 1 and 200),
  add column if not exists description_sie text
    check (description_sie is null or char_length(description_sie) between 1 and 500),
  add column if not exists audience_label_sie text
    check (audience_label_sie is null or char_length(audience_label_sie) between 1 and 80),
  add column if not exists markdown_sie text;

comment on column public.handbook_documents.markdown is
  'Handbook text in the informal form of address (du).';
comment on column public.handbook_documents.markdown_sie is
  'Handbook text in the formal form of address (Sie); null until synced.';

-- Step 2 of the sync (step 1, request_handbook_sync, is unchanged): validate the
-- downloaded bundle and replace the stored handbooks, including the «Sie»
-- wording from the `sie` property of each handbook.
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
  v_sie integer;
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
    source_ref, title_sie, description_sie, audience_label_sie, markdown_sie
  )
  select
    item ->> 'id',
    item ->> 'title',
    item ->> 'description',
    item ->> 'audienceLabel',
    (item ->> 'updatedAt')::date,
    item ->> 'markdown',
    (ordinality - 1)::smallint,
    p_ref,
    item -> 'sie' ->> 'title',
    item -> 'sie' ->> 'description',
    item -> 'sie' ->> 'audienceLabel',
    item -> 'sie' ->> 'markdown'
  from jsonb_array_elements(v_bundle -> 'handbooks') with ordinality as t(item, ordinality);

  insert into public.handbook_images (name, mime, data, source_ref)
  select key, value ->> 'mime', value ->> 'data', p_ref
  from jsonb_each(v_bundle -> 'images');

  select count(*) into v_documents from public.handbook_documents;
  select count(*) into v_sie from public.handbook_documents
   where markdown_sie is not null;
  select count(*) into v_images from public.handbook_images;
  return format(
    '%s Handbücher (%s mit Sie-Fassung), %s Bilder aus %s',
    v_documents, v_sie, v_images, p_ref
  );
end;
$$;

revoke all on function public.apply_handbook_sync(bigint, text)
  from public, anon, authenticated;

commit;
