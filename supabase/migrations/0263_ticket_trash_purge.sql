begin;
set local search_path = pg_catalog, public;

-- Tickets, die länger als 90 Tage im Papierkorb liegen, endgültig entfernen
-- (wie das frühere Löschen: Anhänge in die Aufräum-Warteschlange, Audit-
-- Eintrag, dann löschen). Mandanten mit «Legal Hold» werden übersprungen.
create or replace function public.purge_expired_deleted_tickets(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ids uuid[];
  v_purged integer := 0;
begin
  select coalesce(array_agg(candidate.id), array[]::uuid[]) into v_ids
  from (
    select ticket.id
    from public.tickets ticket
    where ticket.deleted_at is not null
      and ticket.deleted_at < timezone('utc', now()) - interval '90 days'
      and not exists (
        select 1 from public.tenant_data_retention_policies retention
        where retention.tenant_id = ticket.tenant_id and retention.legal_hold
      )
    order by ticket.deleted_at
    limit greatest(1, least(coalesce(p_limit, 500), 2000))
  ) candidate;

  if cardinality(v_ids) = 0 then
    return 0;
  end if;

  insert into public.ticket_deletion_attachment_cleanup (
    tenant_id, ticket_id, storage_bucket, storage_object_path
  )
  select ticket.tenant_id, attachment.ticket_id, attachment.storage_bucket,
         attachment.storage_object_path
  from public.ticket_attachments attachment
  join public.tickets ticket on ticket.id = attachment.ticket_id
  where attachment.ticket_id = any(v_ids)
  on conflict (storage_object_path) do nothing;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  )
  select ticket.tenant_id, ticket.deleted_by, 'ticket.purged', 'ticket', ticket.id, 'warning',
         jsonb_build_object('ticketNumber', ticket.ticket_number, 'deletedAt', ticket.deleted_at)
  from public.tickets ticket
  where ticket.id = any(v_ids);

  delete from public.tickets ticket where ticket.id = any(v_ids);
  get diagnostics v_purged = row_count;
  return v_purged;
end;
$$;
revoke all on function public.purge_expired_deleted_tickets(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_deleted_tickets(integer) to service_role;

do $$
begin
  if to_regnamespace('cron') is null then
    return;
  end if;
  begin
    perform cron.unschedule('nextdesk-ticket-trash-purge');
  exception when others then
    null;
  end;
  perform cron.schedule(
    'nextdesk-ticket-trash-purge',
    '41 2 * * *',
    'select public.purge_expired_deleted_tickets(500);'
  );
exception when others then
  null;
end;
$$;

commit;
