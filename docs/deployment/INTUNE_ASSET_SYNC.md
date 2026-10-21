# Microsoft-Intune-Assetabgleich für nextDesk

## Betriebsmodell

nextDesk bietet einen **bewusst manuellen, ausschliesslich lesenden** Microsoft-Intune-Assetabgleich. Es gibt keinen Scheduler, Worker, Webhook, Delta-Feed, Queue-Run oder automatischen Retry. Jede Person startet jeden Lauf einzeln in **Einstellungen → Funktionen → Asset-Management → Microsoft Intune**; eine übernehmende Synchronisation verlangt zusätzlich eine sichtbare Bestätigung.

Der bisherige lokale Preflight bleibt erhalten und kontaktiert Microsoft nicht. Er prüft nur die serverseitige Mandantenbindung und kann weder Geräte noch Assets ändern.

Der neue Graph-Abgleich ist erst tatsächlich ausführbar, wenn die unten beschriebene separate Microsoft-Anwendung, der Admin-Consent und beide Edge-Function-Secrets eingerichtet sind. Bis dahin blockt nextDesk den Lauf fail-closed; es wird keine Graph-Anfrage ausgelöst.

## Mandanten- und Rechtebindung

Für Konfiguration, Vorschau und Synchronisation gelten kumulativ:

1. Das Feature `assets.management` ist für den Mandanten aktiviert und nicht abgelaufen.
2. Die handelnde Person ist aktive Mandantenmitgliedschaft und besitzt `asset.integration.manage`.
3. Eine aktive, **tenant-spezifische** Azure-SSO-Konfiguration besteht. nextDesk leitet die Entra-Mandanten-ID ausschliesslich serverseitig aus der gespeicherten Issuer-/Discovery-URL ab. Es gibt kein editierbares Tenant-ID-Feld.
4. Die lokale Intune-Konfiguration wurde gespeichert.
5. Der manuelle Microsoft-Graph-Abgleich wurde in der UI separat freigegeben.

Start, vor Tokenbezug, jede Graph-Seite und Commit prüfen diese Voraussetzungen erneut. Ein Mandanten-, Rechte- oder Konfigurationswechsel invalidiert den laufenden Run ohne Teilübernahme. Für den vollständigen Commit werden SSO-, Mitgliedschafts-, Rollen-, Berechtigungs- und Feature-Zustand transaktional gesperrt.

## Einmalige Microsoft-Administration

Für alle Kundenmandanten ist eine **separate mehrmandantenfähige** Microsoft-Entra-App-Registrierung vorgesehen. Sie darf nicht dieselben Credentials wie der nextDesk-Personenabgleich verwenden.

1. In Microsoft Entra ID eine neue App-Registrierung für den manuellen nextDesk-Intune-Assetabgleich erstellen.
2. Unter **API-Berechtigungen → Microsoft Graph → Anwendungsberechtigungen** ausschliesslich `DeviceManagementManagedDevices.Read.All` hinzufügen.
3. Einen Administrator-Consent für jeden Kundenmandanten erteilen, dessen Intune-Inventar synchronisiert werden soll.
4. Ein Client-Secret erzeugen und sowohl die Anwendungs-ID als auch das Secret ausschliesslich als Supabase Edge-Function-Secrets hinterlegen:
   - `INTUNE_MANAGED_DEVICES_CLIENT_ID`
   - `INTUNE_MANAGED_DEVICES_CLIENT_SECRET`

`DeviceManagementManagedDevices.ReadWrite.All` wird nicht benötigt und darf nicht vergeben werden. Weder Client-ID noch Secret gehören in Git, Browsercode, mobile Bundles, Screenshots oder Chatnachrichten.

## Datenvertrag und Datenschutz

Die Edge Function ruft ausschliesslich `GET /v1.0/deviceManagement/managedDevices` auf. Die feste Graph-Feldliste umfasst nur:

- Geräte-ID (nur private technische Verknüpfung),
- Gerätename,
- Seriennummer,
- Hersteller und Modell,
- Betriebssystem und Version,
- Compliance- und Verschlüsselungsstatus,
- letzte Synchronisation und Einschreibung.

Nicht angefragt und nicht gespeichert werden Benutzerdaten, E-Mail-Adressen, UPN, Telefon, IMEI, MAC-Adresse, SIM, UDID, Remote-Assistance- oder Health-Attestation-Daten. Tokens, Entra-Tenant-IDs, Provider-IDs, vollständige Graph-Antworten und Providerfehler erscheinen nie im Browser, in Mobile, Audit oder Logs.

Der Lauf validiert Paging-Herkunft und -Pfad, erlaubt nur HTTPS zu Microsoft Graph, akzeptiert keine Redirects und begrenzt die Seitenzahl. Ergebnisse landen zunächst in einer privaten, service-role-only Staging-Relation. Erst ein vollständig gelesener und weiterhin gültiger Lauf wird atomar übernommen; die Staging-Daten werden danach gelöscht. Läuft ein einmalig gestarteter Prozess ab oder bricht er ab, schliesst der nächste bewusste Start den alten Lauf als `run_expired` und löscht dessen Staging-Daten, bevor ein neuer Providerkontakt möglich ist.

## Zuordnen und Übernehmen

- Eine exakt eindeutige private externe Geräte-ID-Verknüpfung aktualisiert nur die reduzierten technischen Intune-Aggregate des verbundenen Assets.
- Mehrdeutige oder mandantenfremde Verknüpfungen werden nur gezählt; sie überschreiben kein Asset.
- Bisher nicht verknüpfte Geräte können nach der bewussten Synchronisationsbestätigung als neue nextDesk-Assets angelegt werden.
- Besteht bereits ein Asset mit derselben Seriennummer, wird weder verknüpft noch überschrieben; der Fall wird als übersprungen gezählt.
- Ein nicht mehr in Intune gelistetes Gerät löscht, deaktiviert, entkoppelt oder verändert kein vorhandenes Asset.

Die datensparsame Vorschau (`dry_run`) liest Intune und berechnet ausschliesslich aggregierte Zähler. Sie schreibt weder Assets noch einen aktuellen Gerätebestand. Erst «Intune-Assets abgleichen» kann nach der zweiten Bestätigung Assets anlegen oder technische Aggregatfelder aktualisieren.

## Run-Historie, Retry und Recovery

Die UI zeigt nur Zeit, Modus, Status, allgemeine Ergebniskennung und Zähler. Es werden maximal 30 Läufe angezeigt. Nur vorübergehende Fehler (`provider_unavailable`, `provider_rate_limited`) können bewusst manuell wiederholt werden; der ursprüngliche Lauf ist dabei begrenzt auf insgesamt drei Versuche. Es gibt keine Hintergrundwiederholung.

Zum sofortigen Stoppen weiterer Läufe den separaten Schalter «Manuellen Microsoft-Graph-Abgleich für diesen Mandanten freigeben» deaktivieren. Bereits angelegte oder aktualisierte Assets werden bewusst nicht automatisch zurückgesetzt oder gelöscht. Korrekturen erfolgen gezielt über die Assetverwaltung.

## Quellen

- Microsoft Graph `managedDevice`: https://learn.microsoft.com/en-us/graph/api/resources/intune-devices-manageddevice?view=graph-rest-1.0
- Microsoft Graph `managedDevices` auflisten: https://learn.microsoft.com/en-us/graph/api/intune-devices-manageddevice-list?view=graph-rest-1.0
- Microsoft Graph Berechtigungsreferenz: https://learn.microsoft.com/en-us/graph/permissions-reference
