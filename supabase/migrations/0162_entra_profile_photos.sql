begin;

-- Profilfotos aus Entra werden beim Verzeichnisabgleich in einen privaten
-- Speicher kopiert. Ausgeliefert werden sie nur über kurzlebige signierte URLs.
alter table public.tenant_entra_directory_people
  add column if not exists photo_path text
    check (photo_path is null or char_length(photo_path) <= 200),
  add column if not exists photo_checked_at timestamptz;

do $$
begin
  if exists (
    select 1
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'storage'
      and c.relname = 'buckets'
      and c.relkind in ('r', 'p')
  ) then
    execute $storage_bucket$
      insert into storage.buckets (
        id, name, public, file_size_limit, allowed_mime_types
      )
      values (
        'entra-avatars', 'entra-avatars', false, 262144,
        array['image/jpeg', 'image/png']::text[]
      )
      on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types
    $storage_bucket$;
  end if;
end;
$$;

-- Wer wurde zuletzt am längsten nicht geprüft? Der Abgleich holt davon einen
-- begrenzten Teil pro Lauf.
create or replace function public.entra_directory_photo_candidates(
  p_tenant_id uuid,
  p_limit integer
)
returns table (entra_object_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select person.entra_object_id
  from public.tenant_entra_directory_people person
  where person.tenant_id = p_tenant_id
    and person.account_enabled
    and person.inactive_at is null
    and (person.photo_checked_at is null
         or person.photo_checked_at < timezone('utc', now()) - interval '7 days')
  order by person.photo_checked_at nulls first, person.entra_object_id
  limit least(greatest(p_limit, 1), 500);
$$;

revoke all on function public.entra_directory_photo_candidates(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.entra_directory_photo_candidates(uuid, integer)
  to service_role;

commit;
