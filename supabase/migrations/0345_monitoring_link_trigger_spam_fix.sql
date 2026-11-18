begin;

set local search_path = pg_catalog, public;

-- Korrektur zu 0340: Die Trigger-Funktion monitoring_ticket_link_trigger() hängt
-- nicht nur an public.tickets, sondern auch an public.ticket_assets und
-- public.ticket_services. 0340 hat die Prüfung «new.spam_at is not null» am
-- Funktionsanfang eingefügt; auf ticket_assets und ticket_services gibt es
-- dieses Feld nicht, jedes Verknüpfen eines Assets oder Dienstes mit einem
-- Ticket brach deshalb mit «record "new" has no field "spam_at"» ab.
-- Die Prüfung gilt nur noch für neue Tickets.
create or replace function public.monitoring_ticket_link_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  begin
    if tg_table_name = 'tickets' then
      if new.spam_at is not null then
        return null;
      end if;
      perform public.monitoring_link_ticket(new.id);
    else
      perform public.monitoring_link_ticket(new.ticket_id);
    end if;
  exception when others then
    null;
  end;
  return null;
end;
$$;
revoke all on function public.monitoring_ticket_link_trigger() from public, anon, authenticated;

commit;
