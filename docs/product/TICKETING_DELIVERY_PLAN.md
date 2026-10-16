# nextDesk Ticketing: vollständiger Umsetzungsplan

**Auftrag:** Alle 50 beschlossenen Ticketing-Erweiterungen werden als zusammenhängendes Produktprogramm umgesetzt. Die Implementierung erfolgt in Releases, damit jeder Zwischenstand sicher, testbar und produktiv nutzbar bleibt.

## Lieferprinzipien

- **Mandantentrennung zuerst:** Jede neue Tabelle, Abfrage, Mutation und Dateioperation ist an `tenant_id`, Rollen und RLS gebunden.
- **Serverseitige Mutationen:** Status, Zuweisung, Kommentare, Zeit, Kundenrechte und Automatisierungen laufen ausschliesslich über user-authentifizierte Edge Functions oder klar abgesicherte RPCs.
- **Interne Kommunikation standardmässig:** Kommentare beginnen intern; externe Kundenkommunikation wird aktiv gewählt und auditierbar gespeichert.
- **Kein Pseudo-Fortschritt:** Integrationen mit externen Diensten erhalten einen realen Adapter, einen Konfigurationsstatus und klaren Betriebshinweise – keine nur optisch wirkenden Schalter.

## Release-Plan

| Release                     |          Vorschläge | Schwerpunkt                                                                     | Ergebnis                                       |
| --------------------------- | ------------------: | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| R1 – Ticket-Operations      |   1–9, 15–17, 23–26 | Detailansicht, Kommentare, Status, Zuweisung, Queue und Kundenrechte            | Alltägliche Ticketbearbeitung über reale Daten |
| R2 – Service-Workflow       | 10–14, 18–21, 27–30 | Beziehungen, Vorlagen, Checklisten, Zeit, Entwürfe, Übergaben und Zufriedenheit | Teamfähige Bearbeitungsabläufe                 |
| R3 – SLA & Automatisierung  |               31–38 | SLA-Profile, Kalender, Eskalationen, Routing und Benachrichtigungen             | Steuerbare Servicequalität                     |
| R4 – Wissen & Problemlösung |               39–43 | Wissensartikel, Freigaben, Suche, Problem-Management                            | Wiederverwendbare Lösungen                     |
| R5 – Reporting & Export     |               44–48 | Kunden-/Support-Dashboard, Berichte, Qualität und sichere Exporte               | Messbarer Servicebetrieb                       |
| R6 – Integrationen & Assets |               49–50 | E-Mail-to-Ticket, Threading, Services und Assets                                | Vernetzter Service Desk                        |

## R1: konkrete Reihenfolge

1. Datenmodell für Ticketdetail, Kommentare, Statusübergänge, Zuweisung, Kundenorganisation und Sichtbarkeit erweitern.
2. `ticket-actions` zu einer auditierten Ticket-Operations-API ausbauen.
3. RLS und serverseitige Berechtigungsprüfungen für **eigene Tickets**, **Firmentickets**, interne Notizen und Agentenzugriff härten.
4. Ticket-Detailansicht mit Timeline, Statuswechsel, Priorität, Zuweisung, Beobachten und Kommentar-Composer bauen.
5. Queue- und persönliche Listen auf reale Ticketdaten ausrichten.
6. Eine testbare Kundenbenutzer-Verwaltung mit Zugriffsebene pro Kundenorganisation hinzufügen.
7. Lokale PostgreSQL-Integrationstests und Deno-/TypeScript-Prüfungen erweitern.

## Externe Voraussetzungen späterer Releases

| Bereich               | Voraussetzung                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------- |
| E-Mail-to-Ticket      | Mandantenspezifische Inbound-Adresse oder Microsoft-Graph-Postfach, DNS/Graph-Berechtigungen |
| Microsoft 365 / Entra | Kundenspezifische Entra-App-Registrierung, Consent und OIDC/SAML-Metadaten                   |
| SLA-Automatisierung   | geplanter Scheduler/Trigger und verbindliche Servicezeitvereinbarungen                       |
| Malware-Prüfung       | Scanner-Service und private Supabase-Storage-Bucket-Konfiguration                            |
| Push                  | Expo-Projekt, APNs/FCM-Konfiguration und Nutzerzustimmung                                    |
| Export/Reports        | definierte Vorlagen, Aufbewahrung und Empfängerkreis                                         |

## Abnahmekriterium

Jedes Release gilt erst als umgesetzt, wenn die Datenbankmigration, Edge Functions, Weboberfläche, RLS-/Integrationstests, TypeScript-/Deno-Prüfungen und die Hetzner-Auslieferung gemeinsam erfolgreich sind.
