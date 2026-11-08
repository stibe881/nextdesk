# Apple Watch

nextDesk läuft auf der Apple Watch auf drei Wegen:

1. **Mitteilungen mit Antwort-Knöpfen** – Ticket-Mitteilungen tragen die
   Kategorie `NEXTDESK_TICKET` (Notiz, Mir zuweisen, In Bearbeitung),
   Serviceaufgaben `NEXTDESK_SERVICE_TASK` (Erledigt). Die iPhone-App führt die
   Aktion im Hintergrund aus (`mobile/lib/notification-actions.ts`), die Watch
   spiegelt die Knöpfe automatisch. Voraussetzung: `push-dispatch` ist mit dem
   aktuellen `_shared/apns.ts` deployt.
2. **Eigene Watch-App** (`mobile/targets/watch`, SwiftUI, watchOS 10):
   Ticket per Sprache erfassen (mit Bestätigung), Meine Tickets, Nicht
   zugewiesen, Ticket zuweisen, Status ändern, interne Notiz diktieren,
   Wiedervorlagen und Serviceaufgaben erledigen.
3. **Komplikation** (`mobile/targets/watch-widget`): offene Tickets auf dem
   Zifferblatt (rund, rechteckig, Zeile, Ecke).

## Anmeldung und Berechtigungen

Die Watch meldet sich nicht selbst an. Die iPhone-App schickt über
WatchConnectivity nur das kurzlebige Access-Token des angemeldeten Kontos
(`mobile/lib/watch-bridge.ts`); das Refresh-Token bleibt auf dem iPhone. Läuft
das Token ab, fragt die Watch das iPhone nach einem neuen. Alle Aufrufe gehen an
dieselben Edge Functions wie Web und iPhone, es gelten also exakt dieselben
Rechte. Abmelden auf dem iPhone meldet auch die Watch ab.

Die Komplikation liest nur Zahlen aus der App Group
`group.ch.grossict.nextdesk.watch`, kein Token.

## Build

Die Targets werden beim Prebuild von `@bacons/apple-targets` erzeugt
(`ios.appleTeamId` = `QF59FHQ44R`). Beim ersten EAS-Build mit Watch braucht EAS
Zugangsdaten für die neuen Bundle IDs:

- `ch.grossict.nextdesk.watch`
- `ch.grossict.nextdesk.watch.widget`

und die App Group `group.ch.grossict.nextdesk.watch`. Am einfachsten einmal
interaktiv bauen, dann legt EAS Profile und App Group an:

```bash
cd mobile && eas build -p ios --profile production
```
