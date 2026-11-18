-- E-mail tickets no longer keep the sender's signature. For external senders
-- (domain not used by the tenant) the worker stores the phone numbers and
-- e-mail addresses found in the signature instead; the ticket overview shows
-- them under «Anfragende Person». The HTML signature is no longer stored.
alter table public.ticket_email_signatures
  alter column html drop not null;

alter table public.ticket_email_signatures
  drop constraint if exists ticket_email_signatures_html_check;

alter table public.ticket_email_signatures
  add constraint ticket_email_signatures_html_check
  check (html is null or char_length(html) between 1 and 1500000);

alter table public.ticket_email_signatures
  add column if not exists phones text[] not null default '{}'::text[],
  add column if not exists emails text[] not null default '{}'::text[];

alter table public.ticket_email_signatures
  drop constraint if exists ticket_email_signatures_contacts_check;

alter table public.ticket_email_signatures
  add constraint ticket_email_signatures_contacts_check
  check (cardinality(phones) <= 10 and cardinality(emails) <= 10);

-- Signatures stored so far are no longer shown.
update public.ticket_email_signatures set html = null where html is not null;
