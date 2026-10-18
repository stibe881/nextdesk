# nextDesk E-Mail-Kanal über Exchange Online

Diese Anleitung beschreibt die Inbetriebnahme des mandantenfähigen **nextDesk E-Mail-Kanals über Exchange Online**. Der Kanal verarbeitet ausschliesslich den Posteingang eines ausdrücklich konfigurierten Support-Postfachs. Er verwendet eine zentrale Multi-Tenant-App, deren Zugriff je Kundenmandant mit Exchange Online RBAC auf dieses eine Postfach begrenzt wird.

> **Wichtig:** Werte für Secrets gehören weder in Chat-Nachrichten noch in Git, Tickets oder Screenshots. Verwenden Sie ausschliesslich den Secret Store von Supabase.

## 1. Einmalig bei Gross ICT: Entra-App registrieren

1. Öffnen Sie im Gross-ICT-Entra-Mandanten **App registrations** und erstellen Sie eine neue Registrierung:
   - **Name:** `nextDesk – Exchange Online`
   - **Unterstützte Kontotypen:** **Konten in einem beliebigen Organisationsverzeichnis** (Multi-Tenant)
   - **Web-Redirect-URI:** `https://app.nextdesk.ch/`
2. **Fügen Sie keine Microsoft-Graph-Anwendungsberechtigungen `Mail.*` hinzu.** Insbesondere dürfen `Mail.Read`, `Mail.ReadWrite`, `Mail.Send` und `Mail.ReadBasic` nicht im Entra-Consent stehen. Entra-Rechte und Exchange-RBAC addieren sich; eine solche Entra-Freigabe würde die Beschränkung auf das Support-Postfach aufheben.
3. Erstellen Sie unter **Certificates & secrets** ein neues Client-Secret. Kopieren Sie den Secret-Wert sofort in den sicheren Secret Store.
4. Setzen Sie in Supabase Edge Function Secrets:

   ```text
   EXCHANGE_MAIL_CLIENT_ID=<Application (client) ID>
   EXCHANGE_MAIL_CLIENT_SECRET=<Client-Secret-Wert>
   ```

   Die App-ID darf der Mandantenadministration angezeigt werden. Der Client-Secret-Wert ist geheim und darf nie in Git, Chat oder Konfigurationsdateien landen.

5. Die öffentlichen Microsoft-Graph-Webhook-URLs sind:

   ```text
   https://ewizsylzrwogsztsthbl.supabase.co/functions/v1/exchange-mail-webhook
   https://ewizsylzrwogsztsthbl.supabase.co/functions/v1/exchange-mail-webhook?lifecycle=1
   ```

## 2. Pro Kunde: App bereitstellen und Exchange-RBAC begrenzen

### 2.1 Service Principal im Kundenmandanten bereitstellen

Der Kunde muss die Multi-Tenant-App in seinem Entra-Mandanten bereitstellen. Dies ist möglich über den Admin-Consent-Link:

```text
https://login.microsoftonline.com/<EntraTenantId>/adminconsent?client_id=<EXCHANGE_MAIL_CLIENT_ID>
```

Alternativ kann eine berechtigte Person den Service Principal mit Microsoft Graph PowerShell anlegen:

```powershell
New-MgServicePrincipal -AppId <EXCHANGE_MAIL_CLIENT_ID>
```

Verwenden Sie anschliessend den **Object ID des Enterprise Application Service Principals** (nicht den Object ID der App Registration) für Exchange Online.

### 2.2 Exchange Online PowerShell verbinden

Melden Sie sich mit einer Rolle wie **Organization Management** oder **Exchange Administrator** an und führen Sie für das gewünschte Support-Postfach aus:

```powershell
Connect-ExchangeOnline

New-ServicePrincipal `
  -AppId <EXCHANGE_MAIL_CLIENT_ID> `
  -ObjectId <Enterprise-App-ObjectId> `
  -DisplayName "nextDesk – Exchange Online"

New-ManagementScope `
  -Name "nextDesk Support-Postfach" `
  -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'support@kunde.ch'"

New-ManagementRoleAssignment `
  -App <EXCHANGE_MAIL_CLIENT_ID> `
  -Role "Application Mail.Read" `
  -CustomResourceScope "nextDesk Support-Postfach"

New-ManagementRoleAssignment `
  -App <EXCHANGE_MAIL_CLIENT_ID> `
  -Role "Application Mail.Send" `
  -CustomResourceScope "nextDesk Support-Postfach"
```

Prüfen Sie die effektive Berechtigung:

```powershell
Test-ServicePrincipalAuthorization `
  -Identity <EXCHANGE-Mail-Service-Principal-Identität> `
  -Resource support@kunde.ch
```

Die Exchange-RBAC-Caches benötigen nach Änderungen typischerweise **30 Minuten bis 2 Stunden**. Ein unmittelbarer `ErrorAccessDenied` nach einer korrekten Zuweisung kann daher vorübergehend sein.

Für eine möglichst robuste Graph-Anbindung wird die Postfach-Objekt-ID verwendet. Lesen Sie die `ExternalDirectoryObjectId` aus:

```powershell
Get-Mailbox support@kunde.ch | Format-List ExternalDirectoryObjectId,PrimarySmtpAddress
```

> Der Management Scope muss auf genau das konfigurierte Support-Postfach zeigen. Keine Entra-Graph-`Mail.*`-Berechtigung hinzufügen.

## 3. In nextDesk konfigurieren und aktivieren

1. Melden Sie sich als Mandantenadministrator an und öffnen Sie die Mandanteneinstellungen für **E-Mail-Kanal (Exchange Online)**.
2. Prüfen Sie, ob die Funktion `integrations.email` für den Mandanten aktiviert ist.
3. Erfassen Sie:
   - Entra-Mandanten-ID des Kunden
   - Support-Postfach, beispielsweise `support@kunde.ch`
   - optional die `ExternalDirectoryObjectId` des Postfachs
   - optional die Standardabteilung für neue E-Mail-Tickets
   - Optionen für Eingangsbestätigung, Agentenantworten und Lösungsmitteilung
4. Klicken Sie auf **Verbindung prüfen**. Der Test prüft Token, Postfach und Leseberechtigung.
5. Klicken Sie auf **Aktivieren**. nextDesk setzt die Abfrage-Wasserlinie auf den Aktivierungszeitpunkt; ältere Nachrichten werden nicht importiert. Ein Graph-Abo wird angelegt. Falls das Abo vorübergehend nicht möglich ist, bleibt der Kanal aktiv und wird mindestens alle fünf Minuten abgefragt.
6. Klicken Sie auf **Testmail senden**. Die Testmail geht an die E-Mail-Adresse der handelnden Person.
7. Senden Sie eine Testmail an das Support-Postfach und prüfen Sie Ticket, Chat, Anhänge und gegebenenfalls die automatische Eingangsbestätigung.

Eine Warnung zu `overBroadPermissions` bedeutet, dass das erhaltene Token eine zu breite `Mail.*`-Rolle enthält. Das ist keine normale Zielkonfiguration: prüfen Sie Entra-Consent und entfernen Sie unbeabsichtigte Graph-Anwendungsberechtigungen.

## 4. Häufige Fehlerbilder

| Fehlercode                         | Bedeutung                                                                                               | Massnahme                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exchange_platform_not_configured` | App-ID oder Client-Secret fehlt in den Supabase Edge Function Secrets.                                  | Beide Secrets im sicheren Secret Store setzen, niemals in Git oder Chat.                                                                                 |
| `feature_disabled`                 | Der Funktionsschalter `integrations.email` ist nicht aktiv.                                             | Funktion für den betroffenen Mandanten aktivieren.                                                                                                       |
| `forbidden`                        | Die handelnde Person ist keine berechtigte Mandantenadministration.                                     | Aktive Mandantenmitgliedschaft und Berechtigung `tenant.settings.manage` prüfen.                                                                         |
| `invalid_settings`                 | Postfach, Entra-ID, Abteilung oder Aktivierungszustand ist ungültig.                                    | E-Mail-Adresse, UUIDs, aktive Abteilung und gespeicherte Kanaleinstellungen prüfen.                                                                      |
| `mailbox_in_use`                   | Das Postfach ist bereits einem anderen nextDesk-Mandanten zugeordnet.                                   | Nur einen Mandanten pro Support-Postfach konfigurieren.                                                                                                  |
| `exchange_app_not_consented`       | Die App ist im Kundenmandanten nicht vorhanden oder nicht freigegeben (`AADSTS700016`/`AADSTS7000229`). | Admin-Consent ausführen oder Service Principal im Kundenmandanten bereitstellen.                                                                         |
| `exchange_mailbox_not_found`       | Das konfigurierte Postfach oder dessen Objekt-ID wurde nicht gefunden.                                  | `PrimarySmtpAddress` und `ExternalDirectoryObjectId` mit `Get-Mailbox` prüfen.                                                                           |
| `exchange_access_denied`           | Exchange Online RBAC erlaubt den Zugriff nicht.                                                         | `New-ServicePrincipal`, Management Scope, beide Rollen und `Test-ServicePrincipalAuthorization` prüfen. Nach Änderungen 30 Minuten bis 2 Stunden warten. |
| `exchange_throttled`               | Microsoft Graph drosselt Anfragen.                                                                      | Nicht manuell wiederholen; nextDesk verwendet Retry-After und Wiederholungen.                                                                            |
| `exchange_unavailable`             | Microsoft Graph oder Exchange Online ist vorübergehend nicht verfügbar.                                 | Später erneut prüfen; ausstehende Nachrichten werden wiederholt verarbeitet.                                                                             |

## 5. Datenschutz und Betrieb

- nextDesk speichert in `mail_messages` **keine E-Mail-Körper**. Es werden nur für die Verarbeitung notwendige Metadaten, Zustände und Message-Referenzen gespeichert.
- E-Mail-Inhalte werden als Ticketbeschreibung oder externer Ticketkommentar gespeichert, damit sie im Ticket bearbeitet werden können.
- Der Kanal liest nur den **Posteingang des einen konfigurierten Support-Postfachs**. Die Exchange-RBAC-Zuweisung muss genau auf dieses Postfach begrenzt bleiben.
- Anhänge werden ausschliesslich im bestehenden nextDesk-Ticketanhang-Speicher abgelegt. Es gelten die Ticketanhang-Typen und -Grössenlimiten.
- Das Laufzeitkonto **nextDesk E-Mail-Dienst** ist eine globale, gesperrte Dienstidentität ohne Mandantenmitgliedschaft. Es wird einmalig bei Bedarf erstellt und dient nur als technischer Autor für importierte Tickets und E-Mail-Kommentare.
- Webhooks validieren `clientState` gehasht und zeitkonstant. Mailinhalte, Tokens und Secrets dürfen weder geloggt noch in Audit-Metadaten abgelegt werden.
