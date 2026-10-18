begin;

alter table public.ticket_requesters
  drop constraint ticket_requesters_source_valid,
  add constraint ticket_requesters_source_valid
    check (source in ('portal', 'manual', 'email', 'entra'));

comment on column public.ticket_requesters.source is
  'Origin of the requester identity: portal, manual, email, or an Entra directory selection.';

commit;
