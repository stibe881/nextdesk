begin;

set local search_path = pg_catalog, public;

-- Mehrere Phishing-Meldungen pro Sicherheitsfall: Eine zweite Meldung zur
-- selben Mail wird dem offenen Fall zugeordnet (gleiches Ticket). Die
-- Eindeutigkeit von phishing_reports.ticket_id aus 0235 liess diese Meldung
-- scheitern (phishing_report_finalize_failed) – sie ging verloren.
alter table public.phishing_reports
  drop constraint if exists phishing_reports_ticket_id_key;

create index if not exists phishing_reports_ticket_idx
  on public.phishing_reports (tenant_id, ticket_id, created_at);

commit;
