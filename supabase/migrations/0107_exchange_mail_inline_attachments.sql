begin;

alter table public.ticket_attachments
  add column if not exists inline_content_id text;

alter table public.ticket_attachments
  drop constraint if exists ticket_attachments_inline_content_id_check;

alter table public.ticket_attachments
  add constraint ticket_attachments_inline_content_id_check
  check (
    inline_content_id is null
    or (
      char_length(inline_content_id) between 1 and 255
      and inline_content_id !~ '[[:cntrl:][:space:]<>\[\]{}]'
    )
  );

create index if not exists ticket_attachments_inline_content_lookup_idx
  on public.ticket_attachments (ticket_id, inline_content_id)
  where inline_content_id is not null;

comment on column public.ticket_attachments.inline_content_id is
  'Normalized Exchange Content-ID for a private inbound inline image. It is never rendered directly and is resolved only through the ticket-authorized attachment endpoint.';

commit;
