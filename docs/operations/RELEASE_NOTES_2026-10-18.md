# nextDesk – Release Notes, 18. Oktober 2026

## Ausgeliefert

- Mandantenfähiger Assets-Bereich in Web und iOS mit QR-/Barcode-Lookup, sicherem serverseitigem Intune-Synchronisationsdienst als **deaktivierter** Integrationsbaustein sowie einer Rollout-Anleitung für die erforderliche Microsoft-Graph-Freigabe.
- Mobile Arbeitsbeschleunigung: globale Ticket-/Assetsuche, direkte Ticketbearbeitung, sichere Fotoanhänge, Entwürfe, eine eigene Favoritenwarteschlange mit erneuter Serverautorisierung, Kontaktaktion, Wissenssuche, dezente Haptik und optionaler lokaler Geräteschutz.
- Wissensverwaltung mit mandantenspezifischen Kategorien, Revisionen, Freigabeprozess, sichtbarem Versionsstand und mobiler Suche. Die App zeigt dazu ausschliesslich bereits autorisierte Sammlungen sowie Version und Aktualität an.
- Ticketprozesse mit kontrolliertem CSV-Import/-Export, Ticketvergleich, Freigaben, PDF-Ticketakte und reversibler Vorlagenarchivierung.
- Mandantenadministration mit exklusiven Einstellungsreitern, zentraler Funktionskonfiguration, zeitlich begrenzten Feature-Piloten, Datenschutz-/Retention-Richtlinien, Onboarding-Checkliste, Logo-Upload und direkter Übernahme der Mandantenmarke.
- Betriebsregeln mit Vorschau für Nachfassen, Duplikate, Datenqualität, Qualitätschecks, Compliancehinweise und Berichte. Von Regeln vorgeschlagene Schliesskandidaten können nur nach aktueller serverseitiger Kandidatenprüfung und sichtbarer Bestätigung manuell geschlossen werden. Der Lauf wird separat auditiert.
- Ticketabschluss mit auffindbaren Abschlussbewertungen, klaren Hinweisen vor dem Schliessen, zugänglichen Erfolgsmeldungen und einer direkten Statusauswahl, die geschlossene Status ohne entsprechende Abschlussberechtigung nicht anbietet. Qualitätskennzahlen und eigene Qualitätsnotizen bleiben zusätzlich serverseitig auf berechtigte Mitarbeitende beschränkt.
- Qualitätsgates für Typen, Schema, Datenbank-Migrationen, Edge Functions, Formatierung und Web-Bundlebudget; dokumentierter Rücknahme- und Recoveryablauf.
- Sicherheitsnachlieferung: Externe Wissensartikel aus einem Ticket erfordern nun zusätzlich ausdrücklich `knowledge.publish`. Der Datenbank-Trigger verhindert den Entzug der letzten aktiven Mandantenadministration. Mandanten-SSO prüft den Entra-Mandantenbezug gegen den gespeicherten Issuer und die eindeutig zugeordnete Unternehmensdomain; eine passend verifizierte Person wird beim ersten Login nur als normale anfragende Person im eigenen Mandanten angelegt. Rollen oder Agentenrechte entstehen weiterhin ausschließlich über die Rollenverwaltung oder eine explizite Einladung. Die Rollenverwaltung reserviert sensible Rollen und Berechtigungen für effektive Mandantenadministratoren.
- Funktionsschalter für Ticketdetail, Checklisten und Zeiterfassung werden nun nicht nur in der Oberfläche ausgeblendet, sondern in der Ticket-Operations-Function mandantenbezogen und fail-closed geprüft. Abgelaufene Piloten zählen als deaktiviert; direkte Aufrufe liefern keine versteckten Checklisten- oder Arbeitszeitdaten und können keine entsprechenden Mutationen auslösen.
- Die serverseitige Durchsetzung der Funktionsschalter umfasst jetzt auch Ticketvorlagen, Kategorien, Anfragendenkontext, Anhänge, Agentenzuweisung, Abteilungswechsel, Freigaben, Wissen, Übergaben, Kundenfeedback, Qualitätsprüfung, Präsenz und Ticket-Attributwerte. Asset-Management wird ebenfalls vor jedem Serverzugriff gegen den Mandantenschalter geprüft. Fehlende, fehlerhafte oder abgelaufene Schalter werden fail-closed behandelt. Ein Merge darf ein Ticket nur dann automatisch auf «gelöst» setzen, wenn die handelnde Person zusätzlich die Abschlussberechtigung besitzt.

## Sicherheits- und Betriebsgrenzen

Die Integration mit Microsoft Intune, der vollständige Entra-Personenabgleich, E-Mail/Kalender/Teams/Slack, Webhooks/API-Schlüssel, produktives Monitoring sowie zeitgesteuerte Regelruns bleiben bewusst deaktiviert, bis die je erforderlichen Provider- und Datenschutzfreigaben, Secrets und Einwilligungen vorliegen. Sie sind nicht als aktiv ausgegeben.

Automatische Datenlöschung und unbeaufsichtigte Ticket-Schliessungen sind nicht aktiv. Retentionswerte sind zunächst Richtlinien; ein kontrollierter, separat freigegebener Lösch- oder Schedulerbetrieb ist nötig.

## Prüfungen

Für die Sicherheitsnachlieferung zusätzlich erfolgreich ausgeführt: Typecheck, Schema- und Berechtigungskatalogprüfung mit 55 Migrationen, lokale Postgres-/RLS-Migrationstests inklusive Wissensfreigabe und letztem Mandantenadministrator, Edge-Function-Prüfung, Formatprüfung und Diff-Prüfung.
