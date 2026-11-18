begin;
set local search_path = pg_catalog, public;

-- «Wie mache ich …?»-Artikel aus den Handbüchern (docs/handbooks). Jeder
-- «###»-Abschnitt unter «## Wie mache ich …?» wird beim Handbuch-Sync
-- (apply_handbook_sync) in jedem Mandanten als veröffentlichter
-- Wissensartikel angelegt oder aktualisiert: intern für die Handbücher der
-- Agenten, Administratoren und die Installationsanleitung, extern für das
-- Handbuch für Mitarbeitende. Das Handbuch bleibt die einzige Quelle.

-- Globale Quelle der Artikel (nur Service Role, wie handbook_documents).
create table if not exists public.handbook_articles (
  slug text primary key check (slug ~ '^hb-[a-z0-9-]{1,117}$'),
  handbook_id text not null
    check (handbook_id in ('mitarbeitende', 'agenten', 'administratoren', 'installation')),
  visibility public.comment_visibility not null,
  title text not null check (char_length(title) between 3 and 240),
  body text not null check (char_length(body) between 1 and 60000),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{32}$'),
  sort_order integer not null check (sort_order >= 0),
  source_ref text not null check (source_ref ~ '^[0-9a-f]{40}$'),
  synced_at timestamptz not null default now()
);

alter table public.handbook_articles enable row level security;
revoke all on public.handbook_articles from anon, authenticated;

-- Markierung der aus dem Handbuch verwalteten Artikel je Mandant.
alter table public.knowledge_articles
  add column if not exists handbook_slug text,
  add column if not exists handbook_hash text;
alter table public.knowledge_articles
  drop constraint if exists knowledge_articles_handbook_slug_check;
alter table public.knowledge_articles
  add constraint knowledge_articles_handbook_slug_check
  check (
    (handbook_slug is null and handbook_hash is null)
    or (handbook_slug ~ '^hb-[a-z0-9-]{1,117}$' and handbook_hash ~ '^[0-9a-f]{32}$')
  );
create unique index if not exists knowledge_articles_handbook_slug_unique
  on public.knowledge_articles (tenant_id, handbook_slug)
  where handbook_slug is not null;

-- Gleicht die Handbuchartikel eines Mandanten (oder aller Mandanten) mit
-- handbook_articles ab:
--   * neuer Artikel          → angelegt und veröffentlicht (Revision 1)
--   * geänderter Inhalt      → neue Revision, veröffentlicht
--   * Sichtbarkeit/Titel neu → übernommen
--   * nicht mehr im Handbuch → archiviert
--   * unverändert            → nichts (auch nicht, wenn ein Mandant den Artikel
--                              archiviert hat; nur Inhaltsänderungen holen ihn
--                              zurück)
--   * wieder im Handbuch     → erneut veröffentlicht
-- Von Mandanten manuell gepflegte Artikel (handbook_slug is null) bleiben
-- unberührt. Änderungen an Handbuchartikeln selbst werden beim nächsten
-- Inhaltswechsel im Handbuch überschrieben.
create or replace function public.sync_handbook_articles(
  p_tenant_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tenant uuid;
  v_source public.handbook_articles%rowtype;
  v_existing public.knowledge_articles%rowtype;
  v_article_id uuid;
  v_revision integer;
  v_changed integer := 0;
begin
  for v_tenant in
    select tenant.id
    from public.tenants tenant
    where p_tenant_id is null or tenant.id = p_tenant_id
    order by tenant.id
  loop
    for v_source in
      select * from public.handbook_articles order by sort_order, slug
    loop
      select * into v_existing
      from public.knowledge_articles article
      where article.tenant_id = v_tenant
        and article.handbook_slug = v_source.slug
      for update;

      if not found then
        insert into public.knowledge_articles (
          tenant_id, title, slug, visibility, status, current_revision,
          published_revision, published_at, handbook_slug, handbook_hash
        ) values (
          v_tenant, v_source.title, v_source.slug, v_source.visibility,
          'published', 1, 1, now(), v_source.slug, v_source.content_hash
        )
        returning id into v_article_id;
        insert into public.knowledge_article_revisions (
          article_id, revision, body, summary, title_snapshot
        ) values (
          v_article_id, 1, v_source.body, 'Aus dem Handbuch übernommen',
          v_source.title
        );
        v_changed := v_changed + 1;
      elsif v_existing.handbook_hash is distinct from v_source.content_hash
        or v_existing.title is distinct from v_source.title
        or v_existing.visibility is distinct from v_source.visibility
      then
        v_revision := v_existing.current_revision + 1;
        update public.knowledge_articles
        set title = v_source.title,
            visibility = v_source.visibility,
            status = 'published',
            current_revision = v_revision,
            published_revision = v_revision,
            published_at = now(),
            handbook_hash = v_source.content_hash,
            updated_at = timezone('utc', now())
        where id = v_existing.id;
        insert into public.knowledge_article_revisions (
          article_id, revision, body, summary, title_snapshot
        ) values (
          v_existing.id, v_revision, v_source.body,
          'Aus dem Handbuch aktualisiert', v_source.title
        );
        v_changed := v_changed + 1;
      end if;
    end loop;

    -- Aus dem Handbuch entfernte Artikel archivieren, nicht löschen.
    -- Der Null-Hash sorgt dafür, dass ein später wieder aufgenommener Artikel
    -- erneut veröffentlicht wird.
    update public.knowledge_articles article
    set status = 'archived',
        handbook_hash = '00000000000000000000000000000000',
        updated_at = timezone('utc', now())
    where article.tenant_id = v_tenant
      and article.handbook_slug is not null
      and article.status <> 'archived'
      and not exists (
        select 1
        from public.handbook_articles source
        where source.slug = article.handbook_slug
      );
  end loop;
  return v_changed;
end;
$$;

revoke all on function public.sync_handbook_articles(uuid)
  from public, anon, authenticated;
grant execute on function public.sync_handbook_articles(uuid) to service_role;

-- Neue Mandanten erhalten die Handbuchartikel sofort.
create or replace function public.sync_handbook_articles_for_new_tenant()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.sync_handbook_articles(new.id);
  return new;
end;
$$;
revoke all on function public.sync_handbook_articles_for_new_tenant()
  from public, anon, authenticated;

drop trigger if exists tenants_sync_handbook_articles on public.tenants;
create trigger tenants_sync_handbook_articles
after insert on public.tenants
for each row execute function public.sync_handbook_articles_for_new_tenant();

-- Schritt 2 des Handbuch-Syncs: zusätzlich zu Handbüchern und Bildern werden
-- die «Wie mache ich …?»-Artikel geladen und in alle Mandanten verteilt.
-- Ältere Pakete ohne «articles» laden weiterhin nur Handbücher und Bilder.
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
  v_articles integer := 0;
  v_changed integer := 0;
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
  if v_bundle ? 'articles'
     and jsonb_typeof(v_bundle -> 'articles') <> 'array' then
    raise exception 'Ungültiges Handbuch-Paket (Artikel)';
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

  if v_bundle ? 'articles' then
    delete from public.handbook_articles where true;
    insert into public.handbook_articles (
      slug, handbook_id, visibility, title, body, content_hash, sort_order,
      source_ref
    )
    select
      item ->> 'slug',
      item ->> 'handbook',
      (item ->> 'visibility')::public.comment_visibility,
      item ->> 'title',
      item ->> 'markdown',
      md5(
        (item ->> 'title') || E'\n' || (item ->> 'visibility') || E'\n'
        || (item ->> 'markdown')
      ),
      (item ->> 'sortOrder')::integer,
      p_ref
    from jsonb_array_elements(v_bundle -> 'articles') as t(item);
    select count(*) into v_articles from public.handbook_articles;
    v_changed := public.sync_handbook_articles();
  end if;

  select count(*) into v_documents from public.handbook_documents;
  select count(*) into v_images from public.handbook_images;
  return format(
    '%s Handbücher, %s Bilder, %s Wissensartikel (%s Mandantenartikel neu oder geändert) aus %s',
    v_documents, v_images, v_articles, v_changed, p_ref
  );
end;
$$;

revoke all on function public.apply_handbook_sync(bigint, text)
  from public, anon, authenticated;

commit;
