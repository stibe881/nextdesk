# Entra-Personenverzeichnis synchronisieren

## Ziel und Sicherheitsmodell

nextDesk kann die Personen eines Kundenmandanten aus Microsoft Entra als **normale Personen** spiegeln, noch bevor diese sich erstmals bei nextDesk anmelden. Die Datensätze sind strikt pro Mandant getrennt, verleihen keine Ticket- oder Agentenrechte und sind nicht direkt über die Datenbank für Browser zugänglich.

Eine als Agent vorgemerkte Person wird erst nach einer eigenen verifizierten Entra-Anmeldung und einer Mandanten-Zuordnung zu einem wirksamen Support-Agenten. So kann kein Microsoft-Graph-Datensatz allein Rechte erzeugen.

## Einmalig für die zentrale App `nextDesk – Kunden SSO`

1. Öffnen Sie **Microsoft Entra admin center → App registrations → nextDesk – Kunden SSO → API permissions**.
2. Wählen Sie **Add a permission → Microsoft Graph → Application permissions**.
3. Suchen und aktivieren Sie ausschließlich **`User.Read.All`**.
4. Klicken Sie als berechtigte Gross-ICT-Administration auf **Grant admin consent**.
5. Erstellen Sie unter **Certificates & secrets** bei Bedarf ein neues Client Secret. Der Secret Value wird nie in Git oder im Browsercode gespeichert.

## Secrets in Supabase

Unter **Supabase → Project Settings → Edge Functions → Secrets** hinterlegen Sie:

- `ENTRA_DIRECTORY_CLIENT_ID`: Application (client) ID von `nextDesk – Kunden SSO`
- `ENTRA_DIRECTORY_CLIENT_SECRET`: Secret Value dieser App
- `ENTRA_DIRECTORY_SYNC_SECRET`: eigener zufälliger Wert für den späteren automatischen Scheduler

Der identische Wert von `ENTRA_DIRECTORY_SYNC_SECRET` wird später außerhalb von `public_html` auf Hetzner gespeichert. Keine dieser Werte darf in der Web-App, in Git oder in Nachrichten geteilt werden.

## Je Kundenmandant (z. B. Sonnenberg-Baar)

1. Ermitteln Sie die **Directory (tenant) ID** des Kundenmandanten.
2. Eine Kunden-Administration bestätigt die Microsoft-Graph-Berechtigung für genau ihren Mandanten über:

   ```text
   https://login.microsoftonline.com/<KUNDEN-TENANT-ID>/adminconsent?client_id=<NEXTDESK-KUNDEN-SSO-CLIENT-ID>
   ```

3. In nextDesk wird für den Kundenmandanten die Tenant-ID hinterlegt und die Verzeichnissynchronisation aktiviert.
4. Erst dann kann eine erste manuelle Synchronisation ausgeführt werden. Der anschließend aktivierte Scheduler übernimmt neue, geänderte und deaktivierte Personen regelmäßig.

## Datenschutz und Betrieb

- Synchronisiert werden ausschließlich Entra-Objekt-ID, Name, E-Mail/UPN, Funktion, Quellabteilung und Aktivstatus.
- Es werden keine Mailinhalte, Kalender, Dateien, Gruppen oder Passwörter abgefragt.
- Die Berechtigung `User.Read.All` ist die minimale Microsoft-Graph-Anwendungsberechtigung für den geplanten Benutzerabgleich.
- Eine Deaktivierung oder Entfernung in Entra wird im nächsten Abgleich als inaktiv markiert; bestehende nextDesk-Historie bleibt nachvollziehbar.
