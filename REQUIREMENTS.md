# Anforderungen und Produktgrenzen

## Verpflichtender Kern

TicketHub ist eine mandantenfähige Plattform für ICT- und Infrastruktur-Support. Sie unterstützt mehrere Organisationen, mehrere Abteilungen pro Organisation, getrennte Agentensichten, Endbenutzer-Self-Service und eine separat geschützte Betreiberadministration. Die gemeinsame Web- und Mobile-Geschäftslogik wird in TypeScript-Paketen gepflegt.

## MVP

Der MVP liefert einen sicheren Wertstrom von Anmeldung bis Ticketabschluss:

- Mandanten, Abteilungen, Mitglieder, Rollen und serverseitige Berechtigungen.
- Tenant- und Department-Isolation inklusive RLS-Tests.
- Web und Expo mit Login, Mandantenwechsel, Ticket erstellen, Listen, Detail, externe Antworten und interne Notizen.
- Konfigurierbare Status, Prioritäten und Kategorien sowie transaktionssichere Ticketnummern.
- Private Anhänge mit Scan-Gate, Audit-Log, Suche, Filter und responsive Navigation.
- Deutsch und Englisch, mit vorbereitetem Französisch und Italienisch.

## Spätere Erweiterungen

Genehmigungen, visuelle Automatisierungen, SLA-Kalender, E-Mail-/Graph-Integration, Push, Teams, Wissensdatenbank, Assets, Zeit, Exporte, Berichte, Custom Domains und erweiterte Offline-Funktionen werden schrittweise ergänzt. Keine dieser Gruppen gilt durch ihre Architekturplanung als implementiert.

## Ergänzende Produktentscheidungen

- **Kommentare:** interne Kommentare sind Standard. Externe Antworten sind eine bewusste, sichtbare Auswahl.
- **Kundenportale:** pro Kundenorganisation kann Ticketzugriff deaktiviert werden. Aktivierte Benutzer haben entweder Zugriff auf eigene Tickets oder auf alle Tickets ihrer Kundenorganisation.
- **Wissensdatenbank:** Agenten können aus einem Ticket einen Lösungsartikel erzeugen und dessen Sichtbarkeit als intern oder extern festlegen. Die KB/FAQ ist für Supporter durchsuchbar.
- **Remote Support:** Ein künftiger Remote-Support-Link öffnet auf Smartphones die App oder den passenden Store; unter Windows startet der EXE-Download, unter macOS der DMG-Download. Die konkreten Ziel-URLs sind Mandanten- bzw. Betreiberkonfigurationen und keine Hardcodes.

## Überprüfbare MVP-Akzeptanzkriterien

1. Ein aktives ICT-Mitglied mit `ticket.read.department` sieht kein Infrastruktur-Ticket desselben Mandanten.
2. Ein Benutzer mit `ticket.read.own` sieht weder fremde Tickets noch interne Kommentare.
3. Ein Request für einen fremden Mandanten liefert keine Daten, auch wenn dessen UUID bekannt ist.
4. Ein Mandantenadministrator kann keine globale Berechtigung vergeben.
5. Ein Ticket erhält pro Abteilung und Kalenderjahr eine eindeutige Nummer und ein Audit-Event.
6. Ein Mandantenwechsel entfernt vorherige Daten aus Cache und Realtime-Abos.
7. Ein nicht verifizierter Hostname erzeugt keinen Mandantenkontext.
8. Ein Attachment kann nur nach der Berechtigungsprüfung über eine kurzlebige signierte URL geladen werden.

Detaillierte Umsetzungsergebnisse stehen in [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).
