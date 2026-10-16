begin;
set local search_path = pg_catalog, public;

-- The existing verified email-ingress function stores its accepted sender in the
-- fixed first line of description. This compatibility path keeps that sender as
-- the real requester until the ingress Function is redeployed with an explicit
-- requester_contact_id payload.
create or replace function public.validate_ticket_requester_contact()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_contact_user_id uuid;
  v_sender_email text;
  v_display_name text;
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'tickets' then
    raise exception 'Invalid trigger target' using errcode = '22023';
  end if;

  if new.requester_contact_id is null then
    if tg_op <> 'INSERT' then
      raise exception 'An explicit requester contact is required' using errcode = '23502';
    end if;

    if new.source = 'email' then
      v_sender_email := substring(
        new.description from E'^Eingegangene E-Mail von ([^\\r\\n]+)'
      );
      if v_sender_email is null then
        raise exception 'Email requester is missing' using errcode = '23502';
      end if;
      v_sender_email := public.normalize_ticket_requester_email(v_sender_email);
      v_display_name := nullif(
        btrim(
          left(
            regexp_replace(
              replace(split_part(v_sender_email, '@', 1), '.', ' '),
              '[^[:alnum:] _-]',
              '',
              'g'
            ),
            160
          )
        ),
        ''
      );

      insert into public.ticket_requesters (
        tenant_id, email, display_name, source
      ) values (
        new.tenant_id,
        v_sender_email,
        coalesce(v_display_name, 'E-Mail-Anfragende Person'),
        'email'
      )
      on conflict (tenant_id, email) where email is not null do nothing
      returning id into new.requester_contact_id;

      if new.requester_contact_id is null then
        select contact.id into new.requester_contact_id
        from public.ticket_requesters as contact
        where contact.tenant_id = new.tenant_id
          and contact.email = v_sender_email
        for share;
        if not found then
          raise exception 'Retry email requester resolution' using errcode = '40001';
        end if;
      end if;
    else
      new.requester_contact_id := public.ensure_ticket_user_requester(
        new.tenant_id,
        new.requester_id,
        case when new.source = 'portal' then 'portal' else 'manual' end
      );
    end if;
  end if;

  select contact.user_id into v_contact_user_id
  from public.ticket_requesters as contact
  where contact.id = new.requester_contact_id
    and contact.tenant_id = new.tenant_id
  for share;
  if not found then
    raise exception 'Requester contact must belong to the ticket tenant' using errcode = '23503';
  end if;
  if v_contact_user_id is not null
    and new.requester_id is distinct from v_contact_user_id then
    raise exception 'Ticket requester must match the contact user' using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function public.validate_ticket_requester_contact() is
  'Enforces same-tenant requester contacts and creates a safe email requester contact for verified email-ingress tickets.';

commit;
