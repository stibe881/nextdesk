begin;

-- Ein Import kann nach dem atomaren Ticket-/Kommentar-Commit beim privaten
-- Anhangsspeichern unterbrochen werden. Der Status bleibt mandantenlokal an der
-- vorhandenen Warteschlangennachricht, damit der Worker nur diese Zuordnung
-- wiederholen kann, ohne ein Ticket oder einen Kommentar ein zweites Mal zu
-- erzeugen.
alter table public.mail_messages
  add column if not exists inline_media_status text not null default 'not_required',
  add column if not exists inline_media_attempt_count integer not null default 0,
  add column if not exists inline_media_next_attempt_at timestamptz,
  add column if not exists inline_media_last_error_code text;

alter table public.mail_messages
  drop constraint if exists mail_messages_inline_media_status_valid,
  add constraint mail_messages_inline_media_status_valid
    check (inline_media_status in ('not_required', 'pending', 'processing', 'completed', 'failed', 'conflict')),
  drop constraint if exists mail_messages_inline_media_attempt_count_valid,
  add constraint mail_messages_inline_media_attempt_count_valid
    check (inline_media_attempt_count between 0 and 6),
  drop constraint if exists mail_messages_inline_media_status_consistent,
  add constraint mail_messages_inline_media_status_consistent
    check (
      (inline_media_status in ('pending', 'processing', 'failed') and inline_media_next_attempt_at is not null)
      or (inline_media_status in ('not_required', 'completed', 'conflict') and inline_media_next_attempt_at is null)
    );

create index if not exists mail_messages_inline_media_recovery_idx
  on public.mail_messages (inline_media_next_attempt_at, created_at)
  where direction = 'inbound'
    and processing_status = 'processed'
    and inline_media_status in ('pending', 'failed');

-- Eine Content-ID ist innerhalb einer importierten Nachricht eindeutig. Das
-- verhindert nach einem unterbrochenen Retry doppelte private Anhänge.
create unique index if not exists ticket_attachments_inline_content_identity_unique
  on public.ticket_attachments (
    ticket_id,
    coalesce(comment_id, '00000000-0000-0000-0000-000000000000'::uuid),
    inline_content_id
  )
  where inline_content_id is not null;

commit;
