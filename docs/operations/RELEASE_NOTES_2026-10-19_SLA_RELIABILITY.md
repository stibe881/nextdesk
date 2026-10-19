# Release-Notiz: SLA-Zuverlässigkeit

**Datum:** 19. Oktober 2026  
**Produkt:** nextDesk  
**Produktionscommit:** `173a277` – `fix: harden SLA breach backlog processing`

## Ausgeliefert

Die SLA-Automation wählt fällige Breaches nun direkt datenbankseitig aus. Bereits protokollierte Breaches, geschlossene Tickets, bereits beantwortete Response-Tickets sowie Mandanten ohne wirksame SLA-Freigabe können keinen begrenzten Worker-Batch mehr belegen. Dadurch bleiben spätere, tatsächlich ausstehende Tickets nicht mehr hinter historischem Backlog liegen.

Die Auswahl verwendet ausschliesslich die Datenbankzeit. Die atomare Mutation `apply_sla_breach` prüft den Mandantenschalter `automation.sla` unter Sperre unmittelbar vor dem Schreiben nochmals. Eine Deaktivierung oder ein Pilotablauf kann deshalb weder über einen Zwischenraum zwischen Auswahl und Mutation noch durch den direkten service-role-Pfad umgangen werden.

## Produktive Änderungen

- Migration `0079_list_pending_sla_breaches`: private Auswahl-RPC für noch ausstehende Response- und Resolution-Breaches.
- Migration `0080_harden_sla_breach_feature_gate`: atomare, sperrgeschützte Freigabeprüfung in `apply_sla_breach`.
- Edge Function `sla-automation` Version 9: nutzt die neue Auswahl-RPC und behält den vorhandenen Scheduler-Secret-Schutz bei (`verify_jwt: false`).

Es wurde kein Schedulerlauf ausgelöst und keine SLA-Freigabe aktiviert oder verändert.

## Sicherheits- und Qualitätsnachweis

- Lokale PostgreSQL-/RLS-Regression bestanden, einschliesslich Starvation, Response- und Resolution-Breach, Wiederholungsschutz, Eskalation, abgelaufenem Pilot, deaktiviertem Feature sowie anon-/authenticated-Sperren.
- Schema- und Berechtigungskatalog bestanden.
- Edge-Function-Typprüfung und fokussierte Deno-Regressionen bestanden.
- Vollständige Qualitätssuite `pnpm check` bestanden.
- Produktionsprüfung bestätigt: beide RPCs sind `SECURITY DEFINER`, nur `service_role` kann sie ausführen, und der ausgerollte Worker läuft als Version 9.

## Rücknahme

Die Migrationen sind additiv. Bei einem späteren fachlichen Problem wird nicht zurückmigriert: Eine geprüfte Folgemigration stellt die vorherige Funktionsdefinition wieder her, und der SLA-Worker kann gezielt auf die vorherige Function-Version zurückgesetzt werden. Die aktuelle Umsetzung verändert weder bestehende SLA-Ereignisse noch Mandanten-Funktionsschalter.
