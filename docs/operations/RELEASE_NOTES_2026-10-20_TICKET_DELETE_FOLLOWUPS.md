# nextDesk – Release Note: Ticketlöschung mit Wiedervorlagen und Lösungsbestätigungen

- **Commit:** `4a0a99efa875e18d91ad218b3dedd8ac6e09aa05`
- **Migration:** `0087_cascade_ticket_followups_and_confirmations`
- **Umfang:** Kontrollierte Ticketlöschung im Web

## Ursache und Korrektur

Erledigte ticketbezogene Wiedervorlagen oder Lösungsbestätigungen konnten die bewusst bestätigte Ticketlöschung durch eine Fremdschlüsselabhängigkeit blockieren. Die Migration setzt die beiden ausschliesslich ticketbezogenen Abhängigkeiten auf `ON DELETE CASCADE`.

Damit werden Wiedervorlagen und Lösungsbestätigungen nur dann mitgelöscht, wenn eine berechtigte Person das übergeordnete Ticket ausdrücklich bestätigt löscht. Der Legal-Hold-Schutz bleibt unverändert hart blockierend. Der Webdialog enthält keinen technischen Datenbank- oder Berechtigungshinweis mehr; übrige Abhängigkeitskonflikte werden verständlich und ohne interne Details dargestellt.

## Validierung und Rücknahmegrenze

Die Datenbankregression für ein Ticket mit erledigter Wiedervorlage und Lösungsbestätigung sowie die Function- und Webprüfungen waren erfolgreich. Migration `0087` ist additiv an der Fremdschlüsseldefinition; eine Rücknahme stellt keine bereits bewusst gelöschten Daten wieder her.
