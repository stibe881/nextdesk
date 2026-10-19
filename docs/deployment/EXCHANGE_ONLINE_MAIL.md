# nextDesk E-Mail-Kanäle mit Microsoft 365

nextDesk verbindet **mehrere Support-Postfächer pro Mandant** mit Microsoft 365. Die Verbindung erfolgt über eine einmalig angemeldete Microsoft-365-Connectoridentität und eine **pro Postfach** vergebene Exchange-Delegation. Sie ist deshalb für Kundinnen und Kunden in der nextDesk-Oberfläche bedienbar und benötigt für die normale Einrichtung keine PowerShell.

> **Sicherheitsgrundsatz:** Client-Secret, Refresh-Token und Verschlüsselungsschlüssel gehören nie in Chat, Git, Tickets oder Screenshots. Sie werden ausschliesslich im Supabase Secret Store verarbeitet. Tokens werden verschlüsselt gespeichert und nicht in nextDesk angezeigt.

## Architektur und Grenzen

- Die zentrale App **`nextDesk – Exchange Online`** bleibt mehrmandantenfähig.
- Es werden **keine Microsoft-Graph-Anwendungsberechtigungen `Mail.*`** verwendet. Solche Rechte würden eine Beschränkung auf einzelne Support-Postfächer umgehen.
- Der verbundene Microsoft-365-Benutzer erhält nur delegierte Berechtigungen. Exchange bestimmt zusätzlich, auf welche freigegebenen Postfächer dieses Konto tatsächlich zugreifen und aus welchen es senden darf.
- Die Kundin oder der Kunde kann in nextDesk mehrere eigene Support-Postfächer hinzufügen. Ein Postfach kann aus Sicherheitsgründen nie gleichzeitig zwei nextDesk-Mandanten gehören.
- Ein per E-Mail erstelltes Ticket speichert sein Ursprungs-Postfach. Agentenantworten, Lösungsmitteilungen und Abteilungsrückfragen verwenden anschliessend genau diesen Kanal.
- Eingänge werden mindestens im vorhandenen fünfminütigen Wartungszyklus abgefragt. Für delegierte Shared Mailboxes verwendet nextDesk bewusst kein Graph-Webhook-Abo, da dieses für delegierte Postfachzugriffe nicht zuverlässig mandantenübergreifend bereitstellbar ist.

## 1. Einmalig bei Gross ICT: zentrale Entra-App aktualisieren

Öffnen Sie im Gross-ICT-Entra-Mandanten die App-Registrierung **`nextDesk – Exchange Online`**.

1. Prüfen Sie unter **Authentication**, dass diese Web-Redirect-URI vorhanden ist:

   ```text
   https://ewizsylzrwogsztsthbl.supabase.co/functions/v1/exchange-mail-connect
   ```

2. Unter **API permissions → Microsoft Graph → Delegated permissions** ergänzen Sie nur:

   ```text
   User.Read
   Mail.Read
   Mail.Send
   Mail.Read.Shared
   Mail.Send.Shared
   ```

   `User.Read` prüft die Identität des angemeldeten Connector-Kontos. Die Mailrechte gelten nur delegiert für die Connectoridentität und die ihr in Exchange explizit freigegebenen Postfächer. `offline_access`, `openid` und `profile` fordert nextDesk beim OAuth-Rücksprung als Protokoll-Scopes an; sie müssen nicht als zusätzliche Graph-Berechtigungen im Portal ergänzt werden.

3. **Keine Application permissions `Mail.*` hinzufügen.** Die obigen Rechte müssen ausdrücklich als **Delegated permissions** erscheinen.

4. Unter **Certificates & secrets** muss ein gültiges Client-Secret vorhanden sein.

5. Im Supabase Secret Store müssen diese drei Secrets gesetzt sein:

   ```text
   EXCHANGE_MAIL_CLIENT_ID=<Application (client) ID>
   EXCHANGE_MAIL_CLIENT_SECRET=<Client-Secret-Wert>
   EXCHANGE_MAIL_TOKEN_ENCRYPTION_KEY=<zufälliger Base64-Schlüssel mit genau 32 Bytes>
   ```

   Der dritte Wert verschlüsselt ausschliesslich die gespeicherten OAuth-Refresh-Tokens. Einen bestehenden Schlüssel niemals nachträglich ersetzen, solange noch aktive Verbindungen bestehen; andernfalls müssten diese sicher erneut angemeldet werden.

6. Falls die Entra-Richtlinien dies verlangen, erteilt eine Gross-ICT-Administration die Zustimmung für die delegierten Berechtigungen. Für Kundenmandanten erfolgt die Zustimmung beim jeweiligen Microsoft-365-Connect.

## 2. Pro Kundin oder Kunde: ohne PowerShell einrichten

### 2.1 Connector-Konto und Postfachdelegation in Exchange Admin Center

Die Kundin oder der Kunde bestimmt ein vorhandenes Microsoft-365-Konto als Connector. Dieses Konto muss nicht das Support-Postfach selbst sein. Es braucht aber pro zu verbindendem Postfach:

1. Exchange Admin Center öffnen: **Recipients → Mailboxes**.
2. Das gewünschte Support-Postfach öffnen.
3. Im Bereich **Mailbox delegation** beim Connector-Konto hinzufügen:
   - **Full Access / Vollzugriff**
   - **Send As / Senden als**
4. Speichern und für jedes zusätzliche Support-Postfach wiederholen.

Die Delegationen gelten nur für die ausgewählten Postfächer. Ohne **Vollzugriff** kann nextDesk Eingänge nicht lesen; ohne **Senden als** kann nextDesk aus diesem Postfach keine Antworten oder Lösungsmitteilungen senden.

### 2.2 Microsoft 365 direkt in nextDesk verbinden

1. Als Mandantenadministratorin oder -administrator zu **Einstellungen → Funktionen → E-Mail-Kanäle** wechseln.
2. Den Funktionsschalter `integrations.email` aktivieren, falls er noch deaktiviert ist.
3. **Microsoft 365 verbinden** wählen und sich mit dem Connector-Konto anmelden.
4. Den angezeigten Microsoft-Dialog abschliessen. Bei eingeschränkten Consent-Richtlinien kann die Kundin oder der Kunde die Freigabe durch eine Microsoft-365-Administration bestätigen lassen.
5. Nach dem sicheren Rücksprung zeigt nextDesk die Verbindung mit dem angemeldeten Connector-Konto an.

### 2.3 Support-Postfach hinzufügen und aktivieren

1. **Postfach hinzufügen** wählen.
2. Die vorhandene Microsoft-365-Verbindung auswählen.
3. Support-Postfach und Ziel-Abteilung erfassen; Eingangsbestätigung, Agentenantworten und Lösungsmitteilung nach Bedarf einstellen. nextDesk speichert die Adresse zunächst als Entwurf; dafür braucht das Connector-Konto keinen zusätzlichen Zugriff auf das Entra-Verzeichnis.
4. **Postfach speichern**.
5. **Prüfen** wählen. nextDesk prüft das Postfach über die eingegebene Adresse, führt eine Leseabfrage des Eingangskorbs aus und versendet eine kurze Berechtigungs-Bestätigung an das verbundene Microsoft-365-Konto. Damit wird auch **Senden als** vor der Aktivierung nachgewiesen.
6. Erst nach erfolgreicher Prüfung **Aktivieren** wählen.
7. **Testmail** wählen. Sie wird an die E-Mail-Adresse der aktuell angemeldeten nextDesk-Person in die Versandwarteschlange gestellt.
8. Einen echten kontrollierten Test durchführen: neue E-Mail an das Support-Postfach, Ticketentstehung, Agentenantwort, Zustellstatus und bei Bedarf Anhang.

## 3. Fehlerbilder

| Fehlercode                          | Bedeutung                                                                                              | Massnahme                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `exchange_platform_not_configured`  | Zentrale App-, Secret- oder Verschlüsselungsschlüsselkonfiguration fehlt.                              | Gross ICT setzt bzw. prüft die drei Supabase Secrets und die Redirect-URI.                                            |
| `feature_disabled`                  | Der E-Mail-Funktionsschalter ist für den Mandanten nicht aktiv.                                        | In **Einstellungen → Funktionen** aktivieren.                                                                         |
| `connection_not_found`              | Die gewählte Microsoft-365-Verbindung gehört nicht zum Mandanten oder ist nicht verfügbar.             | Eine vorhandene Verbindung wählen oder Microsoft 365 erneut verbinden.                                                |
| `exchange_reauthorization_required` | Die Microsoft-Anmeldung wurde widerrufen, ist nicht mehr verwendbar oder der Schlüssel wurde geändert. | Mit **Microsoft 365 verbinden** erneut anmelden.                                                                      |
| `exchange_mailbox_not_found`        | Die Support-Postfachadresse ist nicht erreichbar.                                                      | Adresse im Exchange Admin Center prüfen.                                                                              |
| `exchange_access_denied`            | Das Connector-Konto darf das ausgewählte Postfach nicht lesen oder daraus senden.                      | In Exchange Admin Center für genau dieses Postfach **Vollzugriff** und **Senden als** vergeben; danach erneut prüfen. |
| `exchange_verification_required`    | Das Postfach wurde seit dem Speichern noch nicht erfolgreich geprüft.                                  | Erst **Prüfen**, danach **Aktivieren**.                                                                               |
| `mailbox_in_use`                    | Das Postfach ist bereits einem anderen nextDesk-Mandanten zugeordnet.                                  | Nur den korrekten Mandanten verwenden oder die bestehende Zuordnung prüfen.                                           |
| `exchange_throttled`                | Microsoft Graph drosselt Anfragen.                                                                     | Nicht mehrfach klicken; nextDesk berücksichtigt Wiederholungszeiten.                                                  |

## 4. Datenschutz und Betrieb

- nextDesk speichert in `mail_messages` keine vollständigen E-Mail-Körper. Ticketbeschreibungen und externe Ticketkommentare enthalten die für die Bearbeitung benötigten Inhalte.
- Refresh-Tokens werden nur verschlüsselt in einer service-role-geschützten Tabelle verarbeitet; sie sind weder über RLS für Mandantenmitglieder lesbar noch in der Benutzeroberfläche sichtbar.
- Anhänge bleiben im bestehenden mandantenisolierten nextDesk-Ticketanhang-Speicher und unterliegen dessen Dateityp- und Grössenlimits.
- Pausieren eines Kanals beendet die weitere Verarbeitung dieses Postfachs; bereits offene Queue-Einträge des Kanals werden fail-closed verworfen.
- Wird ein Postfach geändert, muss es erneut geprüft werden. Dadurch kann keine alte Queue-Nachricht versehentlich über eine neue Postfachkonfiguration versandt werden.
- Beim Wechsel auf den delegierten Microsoft-365-Connect werden ältere Application-RBAC-Kanäle automatisch pausiert, ihre alten Warteschlangeneinträge verworfen und vorhandene Graph-Abos lokal stillgelegt. Sie können erst nach dem sicheren Microsoft-365-Connect wieder aktiviert werden.

## Offizielle Microsoft-Referenzen

- [OAuth 2.0 Authorization Code Flow mit PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Zugriff auf freigegebene Outlook-Postfächer](https://learn.microsoft.com/en-us/graph/outlook-share-messages-folders)
- [Senden aus einem anderen Postfach](https://learn.microsoft.com/en-us/graph/outlook-send-mail-from-other-user)
- [Exchange-Mailboxdelegation](https://learn.microsoft.com/en-us/exchange/recipients/mailbox-permissions)
