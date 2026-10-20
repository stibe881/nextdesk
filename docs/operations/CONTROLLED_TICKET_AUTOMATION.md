# Kontrollierte Ticketautomationen

Stand: 20. Oktober 2026

## Zweck und bewusst enge Grenze

Dieser Lieferstand ermöglicht pro Mandant eine **manuell angestossene**, prüfbare Automationsausführung für die bestehende Regel `auto_close`. Er ersetzt keine Betriebsfreigabe für zeitgesteuerte Automationen.

Ein Lauf kann nur über **Einstellungen → Automatisierungen** durch eine Person mit einer aktiven, mandantenweiten Rolle und der Berechtigung `automation.manage` vorbereitet und nach einer zweiten, ausdrücklichen Bestätigung ausgeführt werden. Die Funktion `automation.sla` muss für den Mandanten aktiv und nicht abgelaufen sein.

Nicht aktiviert sind:

- kein Cronjob, Scheduler oder unbeaufsichtigter Worker;
- keine automatische Schliessung ohne die aktuelle Bestätigung einer berechtigten Person;
- keine neue Benachrichtigungs-, Kalender-, Teams-, Slack-, Monitoring-, Webhook-, KI- oder Intune-Integration;
- keine Retention- oder Löschautomatik.

## Bedienablauf

1. Unter **Einstellungen → Automatisierungen** die Einstellung für «Automatisches Schliessen» bewusst speichern. Der Wert beschreibt die Wartezeit nach der Lösung; die Regel bleibt dennoch manuell auszuführen.
2. Bei der Regel **Vorschau erstellen** wählen. Die Vorschau zeigt höchstens acht aktuell passende Tickets und nur für diese Browseransicht.
3. Die angezeigte Anzahl und die bevorstehende Statusänderung prüfen.
4. Mit **Ausführung verbindlich bestätigen** den zweiten Schritt auslösen.

Beim Vorbereiten wird eine nicht browserlesbare Bestätigung für genau diese Person, diesen Mandanten, diese Regelversion und diese Ticketmenge angelegt. Ihre interne Kennung wird weder an den Browser gesendet noch vom Browser zurückgegeben. Für jede Person, jeden Mandanten und die Regel `auto_close` gibt es höchstens eine offene Bestätigung; eine neue Vorschau ersetzt die vorherige. Sie ist höchstens 15 Minuten gültig. Bei der Ausführung prüft nextDesk nochmals:

- aktive Mitgliedschaft und mandantenweite `automation.manage`-Berechtigung;
- aktuellen Feature-Status;
- unveränderte Regel und Konfiguration;
- den unveränderten Kandidatenstatus jedes Tickets.

Hat sich eine dieser Bedingungen geändert, wird nichts ausgeführt. Die Person erstellt zuerst eine neue Vorschau. Es gibt keine Teilmutation.

## Nachvollziehbarkeit und Datenschutz

Die dauerhafte Laufhistorie enthält nur Mandant, Regel, Ausführungsart, Status, angeforderte und verarbeitete Anzahl sowie Zeit- und Rollenbezug. Ticketnummern, Inhalte und interne Bestätigungskennungen werden weder in Automation-Audits noch über Browserrollen oder PostgREST offengelegt. Die Bestätigung wird nach Ausführung oder Ablauf unbrauchbar.

Die tatsächliche Ticketmutation verwendet die bestehende autorisierte und auditierte Sammelschliessung. Der vorhandene Ticketverlauf bleibt damit die fachliche Detailspur; die Automationshistorie liefert nur Aggregate.

## Fehlermeldungen

- **Vorschau abgelaufen oder inzwischen geändert:** Neue Vorschau erstellen.
- **Automatisierung ist momentan nicht verfügbar:** Feature-Status, Ablaufdatum und die eigene mandantenweite Berechtigung prüfen.
- **Automationslauf konnte nicht vollständig ausgeführt werden:** Keine Einzeltickets aus der fehlerhaften Ausführung übernehmen; aktuelle Vorschau neu erzeugen.

Keine technische Datenbank-, Provider- oder Berechtigungsdetails werden im Browser angezeigt.

## Betrieb und Rückfall

`ticket-automation` verlangt ein verifiziertes JWT. Die Funktionen zum Vorbereiten und Ausführen sind ausschliesslich für `service_role` verfügbar und werden durch die Edge Function nach der Benutzer- und Mandantenprüfung aufgerufen.

Migration `0086_controlled_ticket_automation_execution.sql` ist additiv. Ein Rückfall bedeutet, die Funktionenverwaltung `automation.sla` für den betroffenen Mandanten zu deaktivieren; dadurch sind Vorschau, Vorbereitung und Ausführung sofort serverseitig gesperrt. Bereits geschlossene Tickets werden dadurch nicht automatisch zurückgesetzt und müssen wie jede andere fachliche Statusänderung bewusst bearbeitet werden.
