begin;

do $$
begin
  if exists (
    select 1
    from pg_namespace
    where nspname = 'storage'
  )
  and exists (
    select 1
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'storage'
      and c.relname = 'buckets'
      and c.relkind in ('r', 'p')
  ) then
    execute $storage_bucket$
      insert into storage.buckets (
        id,
        name,
        public,
        file_size_limit,
        allowed_mime_types
      )
      values (
        'ticket-attachments',
        'ticket-attachments',
        false,
        26214400,
        array[
          'application/pdf',
          'text/plain',
          'text/csv',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'image/png',
          'image/jpeg',
          'image/webp'
        ]::text[]
      )
      on conflict (id) do update
      set
        name = excluded.name,
        public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types
    $storage_bucket$;
  end if;
end;
$$;

commit;
