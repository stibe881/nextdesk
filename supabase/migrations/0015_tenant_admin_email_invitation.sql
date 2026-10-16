begin;

alter table public.tenant_user_invitations
  add column if not exists role_name text not null default 'Requester' check (char_length(role_name) between 2 and 100);

update public.tenant_user_invitations
set role_name = 'Requester'
where role_name is null;

comment on column public.tenant_user_invitations.role_name is 'Systemrollenname, der bei Annahme der Einladung mandantengebunden zugewiesen wird.';

commit;
