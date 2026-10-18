# nextDesk – Lieferziele der 90 Vorschläge

- [x] **User Experience.** Befehlspalette mit Tastatursteuerung und Hilfe, gespeicherte Ansichten, sichere Undo-Hinweise für reversible Änderungen, Präsenz, Web-Entwürfe, Listen-Detail-Arbeit, differenzierte Leerzustände, pro Benutzer und Mandant steuerbare Einführung, laufende SLA-Zeit, gleichwertige iOS-Gesten, feldnahe Validierung und Kontexthilfen. Abschlüsse bleiben immer bestätigt.
- [x] **Design.** Gemeinsame semantische Tokens, Dark Mode, Dichte, hoher Kontrast, reduzierte Bewegung, Status mit Text/Symbol/Farbe, Avatar-Fallbacks, Trends, sticky Kontextkopf, Skeletons, Typografie, Branding-Live-Vorschau, globale Meldungen, native iOS-Muster und iPad-Layout ohne Änderung der Berechtigungslogik.
- [x] **Agentenalltag.** Sichere Makros aus bestehenden Vorlagen, Mein Tag, In-App-Benachrichtigungen und Erwähnungen, Zeitbuchung, 360-Grad-Kontext, Assethistorie, Stellvertretung, erklärbare Zuweisungsvorschläge, ähnliche Tickets, Wissensentwürfe mit Review, Wiedervorlage, Team-Warteschlangen, eigene Kennzahlen und manueller Vor-Ort-Modus. Automatisches Zuweisen, Mergen oder Schliessen bleibt ausgeschlossen.
- [x] **Anfragende.** Servicekatalog, externe Statuszeitleiste, Wissensvorschläge, Störungsansicht, SLA-Erwartung, eigene Geräte, Freigabe-Eingang, Vertretung/Kopie, sichere eigene Anhänge, Erreichbarkeit, optionale Abteilungssicht, geführte Erfassung und explizite Lösungsbestätigung/Wiederöffnung. Externe E-Mail-/Push-Zustellung bleibt bis zur Providerfreigabe deaktiviert.
- [~] **Betrieb.** Erweiterte RLS-/Regression-/E2E-Abdeckung, Feedback in iOS, durchsuchbarer Auditexport, Sitzungsverwaltung, Datenschutz-/DSAR-Vorbereitung, Performancebudgets, Lasttests, Backup-Drillnachweis, Health-/Outbox-/Webhook-Grundlagen und CI-Härtung. Keine automatische Löschung, kein Produktionsrestore und kein Scheduler ohne Betriebsfreigabe.
- [~] **KI-Integration.** Feature-Gates, Tenant-Governance, Provider-/Zweck-/Retention-Freigabe, Audit, Datenminimierung, Kosten-/Quotenrahmen und menschlich geprüfte Entwurfsoberflächen. Zusammenfassung, Antwortentwurf, Klassifikation, Wissensentwurf, Suche, Häufungen, Übersetzung, Sprache und Bildanalyse bleiben deaktiviert, bis Provider, Datenschutz und Zugang freigegeben sind.

## Status 18.10.2026, 17:30 Uhr

Legende: [x] im Web und Backend produktiv umgesetzt und automatisiert geprüft. [~] Grundlage umgesetzt, Rest extern blockiert. Angemeldete Oberflächen sind nicht mit einem realen Konto automatisiert getestet. Die iOS-Anteile sind committed, aber erst mit einem neuen, ausdrücklich beauftragten Build in TestFlight.

**Produktiv:**

| Bereich        | Stand                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Migrationen    | 0057, 0058, 0059                                                                                                            |
| Edge Functions | experience-hub, ai-assist, agent-workbench v2, requester-portal v2, tenant-audit-log v6, health v1 (öffentlich, ohne Daten) |
| Web            | Commit 2df3cbb auf app.nextdesk.ch                                                                                          |
| iOS            | Commit 0526b7f, gespiegelt als 2c062cf, noch in keinem Build                                                                |

**Betrieb:** E2E ohne Anmeldung, schonender Lastcheck und lokaler Backup-Restore-Drill sind belegt in docs/operations/QUALITY_AND_RECOVERY_EVIDENCE_2026-10-18.md. Die CI-Härtung (e83a999 auf ci-workflows-pending) ist extern blockiert: Der GitHub-Push-Token hat keine workflows-Berechtigung.

**KI-Integration:** Governance, Feature-Gates, Audit, Quoten und Datenminimierung sind umgesetzt. Alle KI-Funktionen bleiben deaktiviert, bis Provider, Datenschutz und Retention freigegeben sind.

**Weiterhin extern:**

- E-Mail- und Push-Zustellung
- Webhook-Auslieferung (die Outbox ruht)
- Intune
- Entra-Vollabgleich
- SLA-Scheduler
- reale iPhone-Abnahme
