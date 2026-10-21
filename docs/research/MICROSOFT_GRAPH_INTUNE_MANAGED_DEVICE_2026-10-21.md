# Microsoft Graph: kontrollierter Intune-Geräteabgleich

**Recherchezeitpunkt:** 21. Oktober 2026
**Geltungsbereich:** Manuell ausgelöster, ausschliesslich lesender nextDesk-Assetabgleich mit Intune.

## Offiziell bestätigter Graph-Vertrag

Microsoft Graph stellt verwaltete Intune-Geräte über `GET /deviceManagement/managedDevices` bereit. Für eine App-Only-Integration ist die minimal erforderliche Anwendungsberechtigung `DeviceManagementManagedDevices.Read.All`; `DeviceManagementManagedDevices.ReadWrite.All` wird weder angefordert noch verwendet. Die Berechtigung erfordert einen Microsoft-Admin-Consent. Der Mandant benötigt eine aktive Intune-Lizenz.

Der Request verwendet einen Bearer-Token und `Accept: application/json`. Die Antwort liefert eine paginierte Sammlung; ein Integrationsclient muss Folgeseiten nur von der erwarteten Graph-Herkunft verarbeiten und die Anzahl Seiten begrenzen.

## Datensparsame Feldauswahl

Der spätere Sync beschränkt die Graph-Abfrage per `$select` auf:

- `id` als privater Provider-Identifier;
- `deviceName`, `serialNumber`, `manufacturer`, `model`, `operatingSystem`, `osVersion` für die Inventarisierung;
- `complianceState`, `isEncrypted`, `lastSyncDateTime`, `enrolledDateTime` für reduzierte Betriebsaggregate;
- optional `azureADDeviceId` nur als privater Abgleich-Identifier, nie als Browser- oder Mobile-Feld.

Nicht abgefragt oder gespeichert werden insbesondere Benutzername, E-Mail-Adresse, UPN, Telefon-, IMEI-, MAC-, SIM-, UDID-, Remote-Assistance- oder Health-Attestation-Daten.

## Sicherheits- und Produktgrenzen

- Manuelle Auslösung durch eine berechtigte Person; kein Scheduler, Worker oder Hintergrundlauf.
- Graph wird ausschliesslich serverseitig aufgerufen; App-Credentials verbleiben als Supabase-Edge-Function-Secrets.
- Keine Löschung bei fehlenden Intune-Geräten und keine Schreiboperation an Microsoft Graph.
- Provider-Identifier und vollständige Snapshots bleiben in privaten Service-Role-Relationen.
- Bei unklarer Zuordnung wird kein Asset beliebig überschrieben; die Ausführung protokolliert nur aggregierte Zählwerte und einen allgemeinen Resultatcode.

## Quellen

- Microsoft Graph: [List managedDevices](https://learn.microsoft.com/en-us/graph/api/intune-devices-manageddevice-list?view=graph-rest-1.0) — Endpoint, App-Berechtigung, Lizenzhinweis und HTTP-Vertrag.
- Microsoft Graph: [managedDevice resource type](https://learn.microsoft.com/en-us/graph/api/resources/intune-devices-manageddevice?view=graph-rest-1.0) — Felddefinitionen und Statuswerte.
