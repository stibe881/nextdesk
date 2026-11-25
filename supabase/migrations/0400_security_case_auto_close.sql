-- Automatisch abgeschlossene Phishing-/Junk-Fälle mit frei wählbarem Urteil:
-- Phishing-Simulationen («Phishing») und «Kein Junk»-Meldungen aus Outlook
-- («Harmlos»). Wie bei security_case_close_simulation (0378) darf das Ticket
-- dabei «Neu» ohne zuständige Person verlassen; die Ausnahme gilt nur in
-- dieser Funktion.
create or replace function public.security_case_close_auto(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_verdict text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_status uuid;
begin
  if p_verdict not in ('harmless', 'spam', 'phishing') then
    raise exception 'Invalid verdict' using errcode = '22023';
  end if;
  update public.security_cases
     set verdict = p_verdict, verdict_at = timezone('utc', now()),
         state = 'closed', closed_at = timezone('utc', now())
   where tenant_id = p_tenant_id and ticket_id = p_ticket_id and state <> 'closed';
  if not found then
    return false;
  end if;
  select id into v_status from public.ticket_statuses
   where tenant_id = p_tenant_id and key = 'closed';
  if v_status is not null then
    perform set_config('nextdesk.simulation_close', p_ticket_id::text, true);
    update public.tickets set status_id = v_status
     where id = p_ticket_id and tenant_id = p_tenant_id;
    perform set_config('nextdesk.simulation_close', '', true);
  end if;
  return true;
end;
$$;
revoke all on function public.security_case_close_auto(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.security_case_close_auto(uuid, uuid, text) to service_role;
