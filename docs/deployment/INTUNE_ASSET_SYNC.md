# Intune-Assetstatus für nextDesk

## Aktueller Betriebsstand: lokale Vorbereitung, keine Synchronisation

nextDesk führt derzeit **keinen** Microsoft-Intune- oder Microsoft-Graph-Abgleich aus. Das P1.5-Paket stellt ausschliesslich einen auditierbaren lokalen Preflight und eine Run-Historie bereit. Eine ausgelöste Prüfung bleibt innerhalb von nextDesk und ist kein Test gegen Microsoft.

Der lokale Preflight:

- fordert kein Graph-Token an;
- ruft keinen Microsoft-Endpunkt auf;
- liest, erstellt, aktualisiert oder löscht keine Intune-Geräte und keine Assets;
- aktiviert weder `sync_enabled` noch einen Worker oder Scheduler;
- protokolliert nur einen allgemeinen Ergebniscode und aggregierte Nullzähler;
- zeigt weder Entra-Tenant-ID, Geräte-ID, Token, Providerfehler noch Personendaten im Browser.

Der frühere Endpoint `intune-asset-sync` ist JWT-geschützt und bis zu einer separaten fachlichen und sicherheitlichen Freigabe fail-closed. Er kann keine Secrets lesen, keine Graph-Anfrage erzeugen und keine Providersynchronisation starten.

## Mandantenadministration

Die Bedienung erfolgt unter **Einstellungen → Funktionen → Asset-Management → Microsoft Intune**:

1. Asset-Management muss bewusst aktiviert sein und darf nicht abgelaufen sein.
2. Die handelnde Person benötigt `asset.integration.manage`.
3. Für eine aktivierte lokale Vorbereitung muss eine aktive, **tenant-spezifische** Azure-SSO-Konfiguration bestehen. nextDesk leitet die Bindung nur serverseitig aus der bereits gespeicherten Microsoft-URL ab; es gibt kein frei editierbares Entra-Tenant-ID-Feld.
4. Die lokale Konfiguration kann gespeichert, anschliessend vor Ort geprüft und bei Bedarf mit einer neuen Request-ID wiederholt werden.

Details zu Audit, Wiederholung und Recovery stehen im [lokalen Preflight-Runbook](../operations/INTUNE_LOCAL_PREFLIGHT_RUNBOOK.md).

## Datenzugriff und QR-/Barcode-Lookup

Assetlisten liefern nur den für die Inventararbeit notwendigen Datenvertrag. Externe Intune-Gerätekennungen, Geräte-Snapshots und zugeordnete Personen liegen in privaten Tabellen und sind weder über die Browser- noch über die Mobile-API direkt lesbar. Migration 0083 entfernt rekursiv bekannte private Providerfelder, einschliesslich der historischen JSON-Metadatenkopie `external_device_id`, aus browserlesbaren Assetzeilen und weist neue solche Metadaten ab. Fallunterschiede in alten Kennungen bleiben als private, mehrdeutige Zuordnungen erhalten und führen beim Scan nicht zu einer beliebigen Auswahl. Der mandantengebundene Lookup verarbeitet Assetkennungen, Inventar- und Seriennummern sowie bereits vorhandene externe Gerätekennungen ausschliesslich im autorisierten Serverpfad und gibt danach nur das berechtigte Assetresultat zurück.

Die Datenbankpolicies kontrollieren die Assetdomäne zusätzlich mit der Feature- und Pilotprüfung. Damit gibt es bei deaktiviertem oder abgelaufenem Asset-Management keinen direkten PostgREST-Bypass.

## Erst nach separater Freigabe

Für einen zukünftigen echten, weiterhin nur lesenden Intune-Abgleich braucht es vor jeder Implementierung eine neue Entscheidung zu Datenschutz, Datenvertrag, Aufbewahrung, Admin-Consent, Secretverwaltung, Retry-Verhalten und einem möglichen Scheduler. Erst dann wäre als minimale Microsoft-Graph-Anwendungsberechtigung `DeviceManagementManagedDevices.Read.All` zu bewerten und pro Kundenmandant ausdrücklich durch eine Administration freizugeben. `DeviceManagementManagedDevices.ReadWrite.All` wird nicht benötigt und darf nicht vergeben werden.

Secrets gehören ausschliesslich in Supabase Edge-Function-Secrets – nie in Git, Browsercode, mobile Bundles oder Chatnachrichten.

## Quellen für eine spätere, separat freigegebene Integration

- Microsoft Graph `managedDevice`: https://learn.microsoft.com/en-us/graph/api/resources/intune-devices-manageddevice?view=graph-rest-1.0
- Microsoft Graph Berechtigungsreferenz: https://learn.microsoft.com/en-us/graph/permissions-reference
- Expo Camera und Barcode-Scanning: https://docs.expo.dev/versions/latest/sdk/camera/
