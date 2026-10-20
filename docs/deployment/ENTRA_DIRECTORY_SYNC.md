# Microsoft-Entra-Personenverzeichnis

## Ziel und Sicherheitsmodell

nextDesk kann Personen eines Kundenmandanten aus Microsoft Entra als **normale Personen** spiegeln. Die Datensätze sind mandantengetrennt, verleihen keine Ticket- oder Agentenrechte und sind für Browserrollen nicht direkt lesbar.

Eine als Agent vorgemerkte Person erhält ihre Rolle erst nach einer eigenen verifizierten Entra-Anmeldung und einer bewussten Mandanten-Zuordnung. Ein Graph-Datensatz allein kann niemals Agentenrechte erzeugen.

Die Entra-Verzeichniskonfiguration ist ausschliesslich an eine aktive, mandantenspezifische Azure-SSO-Konfiguration gebunden. nextDesk akzeptiert weder ein frei eingegebenes Tenant-ID-Feld noch die SSO-Endpunkte `common` oder `organizations`.

## Einmalig für die zentrale App `nextDesk – Kunden SSO`

1. Öffnen Sie **Microsoft Entra admin center → App registrations → nextDesk – Kunden SSO → API permissions**.
2. Wählen Sie **Add a permission → Microsoft Graph → Application permissions**.
3. Aktivieren Sie ausschliesslich **`User.Read.All`**.
4. Erteilen Sie als berechtigte Gross-ICT-Administration den **Admin consent**.
5. Erstellen Sie unter **Certificates & secrets** bei Bedarf ein neues Client Secret.

Die zentrale App braucht für den Verzeichnisabgleich weder `Organization.Read.All` noch Directory-Berechtigungen. Der technische Verbindungstest verwendet den personenbezugsfreien Graph-Endpunkt `GET /v1.0/users/$count` mit `ConsistencyLevel: eventual`. Die Anzahl bleibt ausschliesslich serverseitig und wird nicht an den Browser zurückgegeben.

## Secrets in Supabase

Unter **Supabase → Project Settings → Edge Functions → Secrets** hinterlegen Sie:

- `ENTRA_DIRECTORY_CLIENT_ID`: Application (client) ID der zentralen App.
- `ENTRA_DIRECTORY_CLIENT_SECRET`: Secret Value dieser App.

Diese Werte dürfen nie in Git, Browsercode, Logs oder Nachrichten erscheinen.

`ENTRA_DIRECTORY_SYNC_SECRET` ist für einen möglichen späteren Scheduler reserviert. Für den hier beschriebenen manuellen Abgleich ist kein Scheduler aktiv und kein zusätzlicher Secret-Wert nötig.

## Je Kundenmandant

1. Aktivieren und speichern Sie unter **Einstellungen → Funktionen → SSO** eine Azure-SSO-Konfiguration mit einer tenant-spezifischen Issuer- oder Discovery-URL in der Form `https://login.microsoftonline.com/<GUID>/...`.
2. Eine berechtigte Kundenadministration erteilt der zentralen App für genau diesen Mandanten den Graph-Admin-Consent:

   ```text
   https://login.microsoftonline.com/<KUNDEN-TENANT-ID>/adminconsent?client_id=<NEXTDESK-KUNDEN-SSO-CLIENT-ID>
   ```

3. Öffnen Sie **Einstellungen → Personen & Agenten → Microsoft Entra-Verzeichnis**. Die aus dem aktiven SSO abgeleitete Tenant-ID wird nur lesend angezeigt.
4. Aktivieren oder deaktivieren Sie den Connector nach Bedarf und klicken Sie auf **Konfiguration speichern**. Der Connector kann gespeichert und deaktiviert bleiben.
5. Klicken Sie auf **Verbindung testen**. Dieser Schritt ist auch bei deaktiviertem Connector möglich und protokolliert nur Erfolg oder Fehlschlag.
6. Erst nach erfolgreichem Test aktivieren Sie den Connector und wählen bewusst **Manuellen Abgleich starten**. Die Oberfläche zeigt nur aggregierte Zahlen, keine Graph-Antworten oder Personenlisten aus dem Test.

Ein fehlender tenant-spezifischer SSO-Bezug sperrt Speichern, Test und Abgleich fail-closed. Wird der SSO-Tenant später geändert, muss die Konfiguration neu gespeichert werden.

## Datenschutz und Betrieb

- Synchronisiert werden nur Entra-Objekt-ID, Name, E-Mail/UPN, Funktion, Quellabteilung und Aktivstatus.
- Es werden keine Mailinhalte, Kalender, Dateien, Gruppen oder Passwörter abgefragt.
- Der Konfigurations- und Teststatus ist auditiert. Auditmetadaten enthalten weder Tenant-ID-Kopien, Personen, Tokens noch Graph-Antworten.
- Ein Testerfolg gilt nur für genau die beim Start gelesene Tenant-Bindung und Konfigurationsgeneration. Ändert sich SSO oder Connector während des Tests, wird dessen Ergebnis verworfen und ein neuer Test ist erforderlich.
- Ein Abgleich verwendet pro Mandant einen zeitlich begrenzten, während des Paginierens erneuerten Lease. Ein paralleler Lauf wird abgewiesen; ein abgelaufener Lease ist kontrolliert nachholbar.
- Vor jedem Datenbankbatch sowie vor dem Abschluss prüft nextDesk atomar Run-ID, Konfigurationsgeneration, aktuelle SSO-Bindung und Lease. Eine Konfigurationsänderung ist während eines aktiven Abgleichs gesperrt; ein parallel geänderter SSO-Bezug kann keine alten Verzeichnisdaten schreiben.
- Ein regelmässiger Scheduler ist **nicht aktiviert** und braucht eine separate ausdrückliche Freigabe.
