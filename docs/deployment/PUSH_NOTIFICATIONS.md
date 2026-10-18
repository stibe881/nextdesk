# Push-Benachrichtigungen bereitstellen

## Was gebaut ist

nextDesk unterstützt **iOS-Push-Benachrichtigungen** für Ticketzuweisungen, Antworten, Erwähnungen, Lösungen, Freigaben, SLA-Hinweise, Eskalationen und fällige Wiedervorlagen. Die Benachrichtigungen sind mandantenbezogen und standardmässig deaktiviert.

Die Datenflusskette ist ereignisgetrieben:

1. nextDesk erzeugt zuerst eine In-App-Benachrichtigung zu einem Ticketereignis.
2. Bei aktiviertem Mandanten-Feature, aktivem iOS-Gerät und aktivierter Kategorie reiht die Datenbank genau diesen Verweis in eine Push-Outbox ein.
3. Die Outbox ruft intern `push-dispatch` auf.
4. `push-dispatch` sendet die Nachricht **direkt an Apple Push Notification service (APNs)**.

> Push-Inhalte gehen ausserhalb von nextDesk nur an **Apple**. Es gibt keinen Expo Push Service und keinen weiteren Push-Anbieter. Standardmässig enthalten Pushes nur die Ereignisart und Ticketnummer. Der Ticketbetreff wird nur bei der Mandanteneinstellung **Ticketnummer und Betreff** übertragen.

## Fällige Wiedervorlagen

Migration `0063_follow_up_reminders.sql` legt den idempotenten `pg_cron`-Auftrag `nextdesk-follow-up-reminders` an. Er führt jede Minute `select public.follow_up_send_due_reminders();` aus und erzeugt für eine offene, fällige und ticketgebundene Wiedervorlage genau eine In-App-Benachrichtigung und über die bestehende Pipeline einen iOS-Push.

Wiedervorlagen ohne Ticket können nicht sicher auf ein Ticket geöffnet werden und werden deshalb ohne Push als verarbeitet markiert. Ebenso werden Altbestände, die bei der Einführung bereits länger als 24 Stunden überfällig waren, nicht nachträglich gepusht. Fehlt `pg_cron` in einem lokalen Cluster oder ist es beim Anbieter eingeschränkt, bleibt die Migration anwendbar; der Auftrag muss dort nicht manuell angelegt werden.

## Einmalige Schritte für die Inhaberschaft

1. **APNs-Schlüssel bei Apple erstellen**
   - Apple Developer öffnen: **Certificates, Identifiers & Profiles** → **Keys** → **+**.
   - **Apple Push Notifications service (APNs)** aktivieren.
   - Schlüssel erstellen und die `.p8`-Datei **einmalig herunterladen**. Apple stellt sie danach nicht nochmals bereit.
   - Die **Key ID** und die **Team ID** notieren.

2. **Secrets in Supabase setzen**
   In den Supabase Edge-Function-Secrets genau diese Werte hinterlegen:

   | Secret             | Wert                                                                                                         |
   | ------------------ | ------------------------------------------------------------------------------------------------------------ |
   | `APNS_KEY_ID`      | Die 10-stellige Key ID des APNs-Schlüssels                                                                   |
   | `APNS_TEAM_ID`     | Die 10-stellige Apple Developer Team ID                                                                      |
   | `APNS_PRIVATE_KEY` | Vollständiger Inhalt der `.p8`-Datei inklusive `-----BEGIN PRIVATE KEY-----` und `-----END PRIVATE KEY-----` |

   **Nie Secret-Werte in einem Chat, Ticket, Git-Repository oder Screenshot teilen.** Zeilenumbrüche im privaten Schlüssel dürfen als tatsächliche Zeilenumbrüche oder als `\n` gesetzt werden.

3. **Feature pro Mandant aktivieren**
   In den nextDesk-Mandanteneinstellungen den Funktionsschalter **Push-Benachrichtigungen** aktivieren. Dort kann auch die Inhaltsstufe gewählt werden:
   - **Nur Ticketnummer** – empfohlen
   - **Ticketnummer und Betreff**

4. **Auf einem iPhone testen**
   In der iOS-App unter Home → Profil → Benachrichtigungen Push aktivieren, die iOS-Berechtigung erlauben und **Testmitteilung senden** verwenden.

## Wichtiger Release-Hinweis

Für die Registrierung und Nutzung der Push-Benachrichtigungen ist ein **neuer iOS-Build** erforderlich. TestFlight und App Store verwenden die APNs-Produktionsumgebung.
