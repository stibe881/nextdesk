# Intune-Assetabgleich für nextDesk

## Zweck

nextDesk kann pro Mandant die über Microsoft Intune verwalteten Geräte in den mandantenisolierten Assetbestand übernehmen. Der Abgleich ist **lesend**: nextDesk führt keine Remoteaktionen wie Löschen, Sperren oder Zurücksetzen von Geräten aus.

## Minimale Microsoft-Berechtigung

Die zentrale mehrmandantenfähige Entra-Anwendung benötigt ausschließlich die Microsoft-Graph-**Anwendungsberechtigung** `DeviceManagementManagedDevices.Read.All`.

- Sie erlaubt das Lesen der Eigenschaften von durch Microsoft Intune verwalteten Geräten ohne angemeldete Benutzerperson.
- Sie verlangt eine Administratorzustimmung in jedem Kundenmandanten.
- Der jeweilige Mandant benötigt eine aktive Intune-Lizenz.
- Die stärkere Berechtigung `DeviceManagementManagedDevices.ReadWrite.All` wird für nextDesk nicht benötigt und darf nicht vergeben werden.

Die Berechtigung ergänzen wir erst gemeinsam, wenn die technische Datenbasis und Datenschutzfreigabe bereitstehen. Geheimwerte gehören ausschließlich in Supabase Edge-Function-Secrets – nie in Git, Browsercode, mobile Bundles oder Chatnachrichten.

## Mandantenablauf

1. Ein Mandantenadministrator aktiviert die Intune-Integration in **Einstellungen → Assets & Intune** und trägt ausschließlich die Entra-Verzeichnis-ID des eigenen Kundenmandanten ein.
2. Gross-ICT hinterlegt den zentralen Client-ID-/Client-Secret-Satz als Edge-Function-Secrets.
3. Eine Kundenadministration erteilt für genau diesen Kundenmandanten die Zustimmnung zu `DeviceManagementManagedDevices.Read.All`.
4. nextDesk führt zunächst einen lesenden Test- beziehungsweise Dry-Run aus. Erst danach werden Geräte in den Assetbestand übernommen.
5. Der Abgleich verwendet die eindeutige Graph-Geräte-ID sowie Seitenfortsetzung. Er protokolliert nur technische Laufdaten und keine Zugangsdaten.

## Verarbeitete Felder

Die Graph-Ressource `managedDevice` stellt unter anderem Anzeigename, Betriebssystem, Hersteller, Modell, Seriennummer, Benutzeranzeige/-UPN, Compliance, Verschlüsselungsstatus, Speicherwerte, letzte Synchronisierung und Intune-Geräte-ID bereit. nextDesk normalisiert für Suche und Scanner nur die erforderlichen Identitäten und Betriebsfelder; vollständige Providerdaten bleiben als versionierter, mandantenisolierter Snapshot zugriffsbeschränkt.

Nicht jede Graph-Eigenschaft erscheint in der Listenabfrage. Einzelne optionale Werte, etwa IMEI, UDID oder Ethernet-MAC-Adresse, werden laut Microsoft erst über einen gezielten Einzelabruf mit `$select` zurückgegeben. Diese zusätzlichen Felder werden nur nach expliziter Datenschutzfreigabe aktiviert.

## QR- und Barcode-Scanner

Der Scanner verarbeitet QR-Codes und Barcodes ausschließlich lokal, normalisiert den Scanwert und fragt danach einen mandantenautorisierten Lookup-Endpunkt ab. Geeignete Werte sind nextDesk-Assetkennungen, Seriennummern, Intune-Geräte-IDs und Inventarnummern. Der Scanner gibt bei unbekannten oder mehrdeutigen Werten keine Informationen anderer Mandanten preis.

Die native iOS-/Android-Kamera benötigt das Expo-Modul `expo-camera` sowie eine eindeutige Kameraberechtigungsbeschreibung. Ein neuer nativer TestFlight-Build ist erforderlich, sobald der Scanner in die App aufgenommen wird.

## Quellen

- Microsoft Graph `managedDevice`: https://learn.microsoft.com/en-us/graph/api/resources/intune-devices-manageddevice?view=graph-rest-1.0
- Microsoft Graph Berechtigungsreferenz: https://learn.microsoft.com/en-us/graph/permissions-reference
- Expo Camera und Barcode-Scanning: https://docs.expo.dev/versions/latest/sdk/camera/
