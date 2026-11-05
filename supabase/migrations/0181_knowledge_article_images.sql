begin;

set local search_path = pg_catalog, public;

-- Images in knowledge articles. Files live in a private bucket; the article
-- Markdown references them as kb-image:<id> and the knowledge-base function
-- hands out short-lived signed URLs when an article is shown.

create table if not exists public.knowledge_article_images (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  storage_path text not null unique,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  byte_size integer not null check (byte_size between 1 and 5242880),
  uploaded_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists knowledge_article_images_tenant_idx
  on public.knowledge_article_images (tenant_id, created_at);

alter table public.knowledge_article_images enable row level security;
revoke all on public.knowledge_article_images from anon, authenticated;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $storage_bucket$
      insert into storage.buckets (
        id, name, public, file_size_limit, allowed_mime_types
      )
      values (
        'knowledge-article-images', 'knowledge-article-images', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
      )
      on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types
    $storage_bucket$;
  end if;
end;
$$;

commit;
