# nextDesk: Umsetzungsprogramm für die 80 zusätzlichen Vorschläge

**Start:** 16. Oktober 2026
**Quelle:** `NEXTDESK_80_WEITERE_VORSCHLAEGE.md`

## Arbeitsprinzip

Die 80 Vorschläge werden als **kleine, produktiv testbare Lieferpakete** umgesetzt. Jede Datenmutation erhält Mandantentrennung, RLS-/Berechtigungsprüfung, Auditierbarkeit und eine klare Fehlerdarstellung. Pakete ohne externe Voraussetzungen werden fortlaufend implementiert und veröffentlicht.

Externe Systeme, neue Secrets, echte E-Mail-Zustellung, Kalender, Teams/Slack, Telefonie, Monitoring und KI-Verarbeitung werden technisch vorbereitet, aber erst nach Mandantenfreigabe, Datenschutzprüfung und Bereitstellung der nötigen Zugangsdaten aktiviert.

## Lieferlinien

| Linie                                                 | Inhalt                                                                                                    | Status                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1. Tägliche Bedienbarkeit                             | Suchsyntax, Filter-Chips, erklärende Leerzustände, Fokusmodus, Startansicht, Befehlsmenü, Dialogsystem    | **gestartet**                                   |
| 2. Ticket- und Prozessfunktionen                      | Tags, freie Felder, Platzhalter, Freigaben, Import/Export, Vergleich, Link-Vorschau, PDF-Akte             | geplant                                         |
| 3. Automatisierungsgrundlage                          | validierte Regeln, Alterungswarnungen, Qualitätschecks, Nachfassaufgaben, Eskalationsmatrix, Datenhygiene | geplant                                         |
| 4. Mandantenreife                                     | Datenschutz, Begriffe, Onboarding, Vorlagenbibliothek, Feature-Piloten, Konfigurationsqualität            | geplant                                         |
| 5. Betriebsqualität                                   | Vertrags- und Rechte-Regressionen, Fehlerreferenzen, Performance- und Abfragebudgets, Release-Notizen     | geplant                                         |
| 6. Integrationen und fortgeschrittene Automatisierung | E-Mail, Kalender, Teams/Slack, Monitoring, KI, API-Schlüssel/Webhooks, Aufbewahrung                       | vorbereitet; Freigabe/Zugangsdaten erforderlich |

## Reihenfolge der nächsten Lieferpakete

1. **Leistungsfähige Ticketfindung:** Suchsyntax, Filter-Chips, Filterrücksetzung und erklärende Leerzustände.
2. **Persönlicher Arbeitsbereich:** Startansicht, Fokusmodus, Dichtegrad, Kontrast-/Bewegungseinstellungen und Tastenkürzel.
3. **Sichere Ticketdaten:** Tags, eigene Felder, Vorlagen-Platzhalter und Nachvollziehbarkeit im Ticketverlauf.
4. **Regelbasierte Prozessqualität:** Lösungs- und Zeitbuchungschecks, Alterungswarnungen, Qualitätschecklisten und Eskalationsmatrix.
5. **Mandantenkonfiguration und Betrieb:** Datenschutz, Onboarding, Konfigurationshinweise, Feature-Piloten und Release-Notizen.
6. **Freigabepflichtige Erweiterungen:** Kommunikation, Identitäts-/Kalender-/Chat-Integrationen, Aufbewahrungsläufe und KI-Unterstützung.

## Verbindliche Schutzplanken

- Keine Mandanten-, Abteilungs- oder Ticketdaten werden über RLS-/Berechtigungsgrenzen sichtbar.
- Automatisierte Änderungen bleiben auditierbar und werden dort, wo fachlich nötig, erst als Vorschlag oder Entwurf erstellt.
- Keine neuen Secrets, Provider-Accounts oder externen Benachrichtigungen ohne die dafür nötige Nutzerfreigabe.
- Aufbewahrung, endgültige Löschung und externe Kommunikation bleiben freigabepflichtig und werden nicht mit Platzhalterdaten aktiviert.
