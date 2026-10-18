# nextDesk – Release Notes, 18. Oktober 2026

## Ausgeliefert

- Mandantenfähiger Assets-Bereich in Web und iOS mit QR-/Barcode-Lookup, sicherem serverseitigem Intune-Synchronisationsdienst als **deaktivierter** Integrationsbaustein sowie einer Rollout-Anleitung für die erforderliche Microsoft-Graph-Freigabe.
- Mobile Arbeitsbeschleunigung: globale Ticket-/Assetsuche, direkte Ticketbearbeitung, sichere Fotoanhänge, Entwürfe, Favoriten, Kontaktaktion, Wissenssuche, dezente Haptik und optionaler lokaler Geräteschutz.
- Wissensverwaltung mit mandantenspezifischen Kategorien, Revisionen, Freigabeprozess, sichtbarem Versionsstand und mobiler Suche.
- Ticketprozesse mit kontrolliertem CSV-Import/-Export, Ticketvergleich, Freigaben, PDF-Ticketakte und reversibler Vorlagenarchivierung.
- Mandantenadministration mit exklusiven Einstellungsreitern, zentraler Funktionskonfiguration, zeitlich begrenzten Feature-Piloten, Datenschutz-/Retention-Richtlinien, Onboarding-Checkliste, Logo-Upload und direkter Übernahme der Mandantenmarke.
- Betriebsregeln mit Vorschau für Nachfassen, Duplikate, Datenqualität, Qualitätschecks, Compliancehinweise und Berichte. Geschlossene Tickets können nur nach aktueller serverseitiger Kandidatenprüfung und sichtbarer Bestätigung manuell geschlossen werden. Der Lauf wird separat auditiert.
- Qualitätsgates für Typen, Schema, Datenbank-Migrationen, Edge Functions, Formatierung und Web-Bundlebudget; dokumentierter Rücknahme- und Recoveryablauf.

## Sicherheits- und Betriebsgrenzen

Die Integration mit Microsoft Intune, der vollständige Entra-Personenabgleich, E-Mail/Kalender/Teams/Slack, Webhooks/API-Schlüssel, produktives Monitoring sowie zeitgesteuerte Regelruns bleiben bewusst deaktiviert, bis die je erforderlichen Provider- und Datenschutzfreigaben, Secrets und Einwilligungen vorliegen. Sie sind nicht als aktiv ausgegeben.

Automatische Datenlöschung und unbeaufsichtigte Ticket-Schliessungen sind nicht aktiv. Retentionswerte sind zunächst Richtlinien; ein kontrollierter, separat freigegebener Lösch- oder Schedulerbetrieb ist nötig.

## Prüfungen

Vor dieser Notiz erfolgreich ausgeführt: Typecheck, Schema- und Berechtigungskatalogprüfung, lokale Postgres-/RLS-Migrationstests, Edge-Function-Prüfung, Web-Build, Formatprüfung, Bundlebudget und Produktions-Smoke-Test.
