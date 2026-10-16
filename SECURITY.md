# Sicherheit und Row Level Security

## Schutzprinzipien

TicketHub verwendet **deny by default**. Der Client besitzt nur den Supabase-Publishable-Key; Service-Role-Schlüssel bleiben in serverseitigen Geheimnissen. Jede Grenze wird mehrfach geprüft: Eingabevalidierung, serverseitige Geschäftsregel, RLS und Audit-Log. Eine `tenant_id` aus URL, Token-Claim oder Request-Body ist nie allein ausreichend.

## RLS-Modell im Kern

Die Migration `0005_rls_core.sql` etabliert RLS für Mandanten, Mitglieder, Abteilungen, Tickets, Kommentare, Anhänge, Events und Watcher. Die Härtungsmigration `0006_harden_tenant_integrity_and_rbac.sql` erweitert RLS auf alle sensiblen Kern- und RBAC-Tabellen, sperrt direkte Clientzugriffe auf Rollen- und Nummernsequenzpfade und erzwingt konsistente Tenant-Fremdschlüssel. Die Funktionen `is_active_tenant_member`, `has_tenant_permission`, `has_ticket_permission`, `can_read_ticket` und `can_read_internal_note` lesen die tatsächliche Mitgliedschaft sowie zeitlich gültige Rollenzuweisungen.

- Ein Benutzer kann nur aktive Mandantenmitgliedschaften sehen.
- Agenten benötigen sowohl eine passende Berechtigung als auch den korrekten Abteilungskontext.
- Anfragende sehen mit `ticket.read.own` nur eigene oder sie betreffende Tickets.
- `internal`-Kommentare sind zusätzlich durch `ticket.internal_notes.read` geschützt; diese Sichtbarkeit ist Standard.
- Clientseitige Schreib-Policies auf Tickets fehlen bewusst, bis die geprüften RPCs/Edge Functions der Phase 2 umgesetzt sind.

## Privilegierter Zugriff

Plattformbetreiberrechte existieren getrennt von Mandantenrollen. Ein Supportzugriff auf Mandantendaten wird als temporäre, lesende Session mit MFA-Nachweis, Zweckbegründung und Ablaufzeit modelliert. Das System protokolliert Anforderung, Freigabe, verwendete Ressourcen und Ablauf. Mandantenadministratoren können weder `platform.*` vergeben noch Systemrollen verändern.

Die Mandantenanlage verlangt in der user-authentifizierten Edge Function einen verifizierten Supabase-User-JWT mit `aal2`; erst danach wird der aktuelle MFA-Nachweis des Plattformbetreibers als zusätzliche Datenbankkontrolle gespeichert. Einladungen werden zunächst als nicht aktive Mitgliedschaften abgelegt. Erst der authentifizierte eingeladene Benutzer darf die zu seiner Benutzer-ID passende Einladung annehmen; danach wird die Standard-Requester-Rolle vergeben. Re-Invites lassen historische Rollen ablaufen, und ein Widerruf entfernt die gestagte Mitgliedschaft. Die zugehörigen Security-Definer-Funktionen sind für `anon` und `authenticated` gesperrt, ausser der explizit benutzergebundenen Annahmefunktion.

## Storage und Realtime

Anhänge werden in privaten Buckets unter einem mandanten- und ticketgebundenen Objektpfad gespeichert. Upload, Malware-Scan, Metadatensatz und Freigabe sind ein Workflow; erst ein `clean`-Resultat darf eine signierte Download-URL ermöglichen. Realtime-Kanäle erhalten einen Mandanten- und Ressourcenscope und dürfen niemals eine Ticket-Payload an nicht berechtigte Abonnements übermitteln. Caches werden beim Mandantenwechsel gelöscht und nach Rechteentzug invalidiert.

## Datenschutz und Aufbewahrung

Der Datenminimierungsgrundsatz gilt für Formulare, Audit-Events, Push-Texte und Analyse. Push-Nachrichten enthalten keine vertraulichen Ticketinhalte. Export- und Löschanfragen sind Jobs mit Berechtigungsprüfung, Audit-Event und Aufbewahrungsentscheidung. Auftragsbearbeitung, Transfer Impact Assessment und die Datenübermittlung von Expo, Microsoft, Mail-, Monitoring- und Malware-Diensten werden vor Produktionsfreigabe dokumentiert.

## Sicherheitsprüfungen pro Lieferphase

1. Mandant A erhält keine Daten von Mandant B.
2. ICT-Agenten erhalten keine Infrastruktur-Tickets und umgekehrt.
3. Normale Benutzer sehen keine internen Notizen.
4. Manipulierte Anfragen erzeugen keine fremde Zuweisung oder Rollenaufwertung.
5. Abgelaufene und gesperrte Mitgliedschaften verlieren Zugriff sofort.
6. Nicht verifizierte Domains führen zu keinem Tenant-Context.
7. Fremde Anhänge sind weder über Storage noch über signierte URLs abrufbar.
8. Realtime, Exporte und Offline-Synchronisation respektieren den aktuellen Rechteentzug.
9. SSO erzeugt keine Mitgliedschaft ohne erlaubte Zuordnung.
10. Jeder privilegierte Zugriff und jede kritische Konfigurationsänderung ist auditierbar.

Die TypeScript-Unit-Tests prüfen den gemeinsamen Referenzkern für Cross-Tenant-, Cross-Department-, eigene Ticket-, interne Kommentar- und Plattformrechte. Ergänzend startet `pnpm test:db` ein isoliertes PostgreSQL-16-Cluster mit minimalem Auth-Shim, spielt alle Migrationen ein und prüft Tenant-A/B-Isolation, ICT/Infrastruktur-Trennung, eigene Tickets, interne Kommentare, RLS-Aktivierung, Fremdschlüssel, Service-Role-ACLs, Provisionierung, Einladungen, Re-Invites und Widerrufe. Storage, Realtime, echtes Supabase Auth, Gateway-CORS und Mailzustellung sind noch nicht gegen eine Cloud-Umgebung geprüft.
