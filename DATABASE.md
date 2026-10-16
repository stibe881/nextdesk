# Datenbankmodell

## Modellierungsregeln

Alle fachlichen Primärschlüssel sind UUIDs. Zeitstempel werden als `timestamptz` in UTC gespeichert. Jeder mandantenbezogene Datensatz führt `tenant_id`; Abteilungstickets führen zusätzlich `department_id`. Fremdschlüssel, eindeutige Constraints und Indizes liegen in versionierten Migrationen. Soft-Deletion wird nur eingesetzt, wenn Audit- oder Aufbewahrungspflichten dies verlangen; ansonsten wird die Löschentscheidung über einen dokumentierten Workflow erzwungen.

## Bereits angelegte Kernmigrationen

| Migration | Inhalt                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `0001`    | PostgreSQL-Erweiterungen, Enums, UTC-`updated_at`-Trigger.                                                               |
| `0002`    | Plattform, Mandanten, Domainverifikation, Branding, Features und Audit-Logs.                                             |
| `0003`    | Profile, Mitgliedschaften, Abteilungen, Teams, Rollen, Berechtigungen und Kundenorganisationen.                          |
| `0004`    | Ticketkonfiguration, transaktionssichere Nummernsequenzen, Tickets, Kommentare, Anhänge und Ereignisse.                  |
| `0005`    | RLS-Hilfsfunktionen und restriktive Lese-Policies für die Kernressourcen.                                                |
| `0006`    | Mandantenkonsistente Fremdschlüssel, berechtigungsgebundene RLS-Härtung, Katalog-Seed und gesperrte direkte Clientpfade. |
| `0007`    | `aal2`-gebundene Mandantenanlage, Einladungszustände, Widerruf und sichere Annahme einer Einladung.                      |
| `0008`    | Mandanteneinstellungen, Teams und Abteilungsmitgliedschaften über berechtigte Verwaltungsfunktionen.                     |
| `0009`    | Lesepolicies für Status, Prioritäten und Kategorien innerhalb einer aktiven Mandantenmitgliedschaft.                     |

Die Tabellen sind ein sicheres Fundament, nicht das vollständige Produktdatenmodell. Keine bisherige Migration verspricht, dass nicht angelegte Funktionen bereits verwendbar sind.

## Logisches Gesamtmodell

**Plattform:** `platform_settings`, `platform_administrators`, `platform_audit_logs`.

**Mandanten:** `tenants`, `tenant_domains`, `tenant_settings`, `tenant_branding`, `tenant_features`.

**Identität und Berechtigungen:** `user_profiles`, `tenant_memberships`, `departments`, `department_memberships`, `teams`, `team_memberships`, `roles`, `permissions`, `role_permissions`, `user_role_assignments`, `sso_configurations`.

**Tickets:** `tickets`, `ticket_statuses`, `ticket_priorities`, `ticket_categories`, `ticket_comments`, `ticket_attachments`, `ticket_events`, `ticket_assignments`, `ticket_watchers`, `ticket_relations`, `ticket_tasks`, `ticket_tags`, `ticket_tag_assignments`, `ticket_custom_fields`, `ticket_custom_field_values`.

**Services und Workflows:** `services`, `service_forms`, `form_fields`, `approval_workflows`, `approval_requests`, `approval_decisions`, `automation_rules`, `automation_executions`.

**SLA:** `sla_policies`, `sla_targets`, `sla_calendars`, `sla_events`.

**Kommunikation:** `notification_preferences`, `notifications`, `push_devices`, `email_connections`, `email_messages`, `email_templates`, `integration_connections`, `webhook_deliveries`.

**Wissen und Assets:** `knowledge_articles`, `knowledge_categories`, `knowledge_revisions`, `assets`, `asset_types`, `asset_assignments`, `locations`.

**Weitere:** `time_entries`, `audit_logs`, `background_jobs`, `export_jobs`.

**Kundenportal-Erweiterung:** `customer_organizations` und `customer_memberships`. Der Zugang kann pro Kundenorganisation deaktiviert sein. Bei aktiviertem Zugang erhält jedes Mitglied entweder `own` (nur eigene Tickets) oder `company` (alle Tickets der Kundenorganisation). Diese fachliche Ergänzung wird in der späteren Ticket-Policy verankert.

## Wichtige Beziehungen

- `tenant_memberships` verbindet authentifizierte Benutzer mit genau dem Mandantenkontext, in dem sie arbeiten dürfen.
- `department_memberships` ist die zusätzliche Grenze für Agentenzugriff auf ICT, Infrastruktur oder weitere Abteilungen.
- `user_role_assignments` trägt Start- und Ablaufzeit sowie optionalen Abteilungs- oder Teamkontext.
- `tickets` referenzieren Mandant, Abteilung, Status, Priorität, Kategorie, Anfragende, Betroffene und Zuweisung.
- `ticket_comments.visibility` ist standardmässig `internal`; externe Kommentare müssen bewusst gewählt werden.
- Anhänge speichern ausschliesslich Metadaten und private Storage-Pfade; keine öffentliche Objekt-URL wird persistiert.

## Ticketnummern

`reserve_ticket_number` verwendet `INSERT … ON CONFLICT … DO UPDATE … RETURNING` auf einer Sequenzzeile pro Mandant, Abteilung und Kalenderjahr. Dadurch ist die Erhöhung innerhalb einer PostgreSQL-Transaktion atomar. Phase 2 kapselt die Funktionsnutzung in einer Ticket-Erstell-RPC, die Prefix, Abteilungszuordnung, Status und Audit-Event gemeinsam festschreibt. Last- und Parallelitätstests sind noch ausstehend.

Die Reservierungsfunktion ist für `anon` und `authenticated` ausdrücklich gesperrt. Sie darf erst aus der zukünftigen, autorisierten Ticket-Erstell-RPC aufgerufen werden. Zusammengesetzte Fremdschlüssel verhindern dabei, dass Ticket, Status, Priorität, Kategorie, Team oder Abteilung aus unterschiedlichen Mandanten verknüpft werden.

## Administrations- und Einladungsabläufe

`provision_tenant` wird ausschliesslich von der user-authentifizierten Edge Function nach einem verifizierten `aal2`-JWT aufgerufen; die Funktion verlangt zusätzlich einen aktuellen Plattformbetreiber-MFA-Nachweis. Sie legt Mandant, Einstellungen, Branding, drei Systemrollen, Abteilungen, Mitgliedschaften und das Audit-Event in einer Transaktion an. `prepare_tenant_invitation`, `record_tenant_invitation_delivery`, `cancel_tenant_invitation` und `accept_current_tenant_invitation` trennen die Berechtigungsprüfung, die Auth-Einladung, den Widerruf und die Aktivierung der Mitgliedschaft. Re-Invites lassen historische Rollenzuweisungen ablaufen, damit nur die Standard-Requester-Rolle nach der Annahme wieder wirksam wird.

`update_tenant_settings`, `create_tenant_team` und `set_department_membership` sind ausschliesslich über serverseitige Funktionen nutzbar. Jede prüft die Mandantenrolle des handelnden Benutzers und schreibt ein Audit-Ereignis.

## Dashboard-Lesepfad

Das Web-Dashboard fragt nach einer Magic-Link-Session zuerst die eigenen aktiven `tenant_memberships` ab und wählt daraus den Mandantenkontext. Für den gewählten Mandanten werden Tickets, Abteilungen, Status, Prioritäten und Ticketereignisse über das Benutzer-JWT gelesen. Die Migration `0009` gibt Status-, Prioritäts- und Kategoriemetadaten nicht pauschal frei, sondern nur dann, wenn `is_active_tenant_member(tenant_id)` wahr ist. Damit bleiben die Labels für ein Ticket sichtbar, ohne einen mandantenübergreifenden Referenzdatenkatalog zu schaffen.

## Offene Datenmodelle

Die folgenden Funktionsgruppen sind absichtlich noch nicht migriert: dynamische Formulare, Genehmigungen, SLA-Kalender, E-Mail-Threading, Push-Geräte, Wissensrevisionen, Assets, Zeiterfassung, Exporte und Jobausführung. Ihre Tabellen werden mit der jeweiligen Produktfunktion ergänzt, damit jedes Schema von tatsächlichen Tests und RLS-Policies begleitet wird.
