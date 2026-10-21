# Runbook: manueller Intune-Assetabgleich

## Ziel und Grenzen

Dieses Runbook beschreibt einen einmalig ausgelösten, **nur lesenden** Intune-Abgleich. Es gibt keinen zeitgesteuerten Abgleich, keine automatische Wiederholung und keine Microsoft-Schreiboperation. Verwenden Sie den Lauf nur, wenn die Intune-Assetdaten für den betroffenen Mandanten aktuell benötigt werden.

## Vorbedingungen

- `assets.management` ist für den Mandanten aktiv.
- Die handelnde Person besitzt `asset.integration.manage`.
- Die lokale Intune-Konfiguration ist gespeichert.
- Eine aktive tenant-spezifische Azure-SSO-Bindung besteht.
- Die separate Microsoft-Entra-App hat pro Kundenmandant den Admin-Consent für `DeviceManagementManagedDevices.Read.All`.
- Die Secrets `INTUNE_MANAGED_DEVICES_CLIENT_ID` und `INTUNE_MANAGED_DEVICES_CLIENT_SECRET` liegen nur in den Supabase Edge-Function-Secrets vor.

## Ablauf

1. Öffnen Sie **Einstellungen → Funktionen → Asset-Management → Microsoft Intune**.
2. Führen Sie zuerst «Lokalen Preflight ausführen» aus. Er darf keinen Microsoft-Kontakt auslösen.
3. Speichern Sie die separate Freigabe «Manuellen Microsoft-Graph-Abgleich für diesen Mandanten freigeben».
4. Wählen Sie «Datensparsame Vorschau durchführen». Prüfen Sie nur die aggregierten Zähler für Geräte, potenziell neue/aktualisierte, übersprungene und mehrdeutige Einträge.
5. Falls die Übernahme fachlich gewünscht ist, wählen Sie «Intune-Assets abgleichen».
6. Lesen Sie den Bestätigungstext und wählen Sie nur dann «Jetzt einmalig abgleichen», wenn die Übernahme für diesen Mandanten autorisiert ist.
7. Prüfen Sie die Run-Historie. Keine Detaildaten aus Intune dürfen in der Oberfläche erscheinen.

Ein unterbrochener Lauf wird nicht automatisch wiederholt. Nach Ablauf seines zeitlich begrenzten Lease kann eine berechtigte Person bewusst einen neuen Lauf starten. nextDesk schliesst dabei den alten Lauf als `run_expired`, löscht dessen private Staging-Daten und prüft die Voraussetzungen erneut, bevor irgendein neuer Microsoft-Graph-Kontakt erfolgen kann.

## Fehlerbehandlung

- **Serverseitige Intune-Anbindung nicht eingerichtet:** Client-ID, Client-Secret oder Microsoft-Admin-Consent fehlen bzw. sind nicht nutzbar. Secrets niemals in Tickets, Chat oder Browser eintragen.
- **Vorschau/Synchronisation nicht bereit:** Lokale Konfiguration und Azure-SSO-Bindung neu prüfen und speichern.
- **Intune begrenzt den Abgleich / vorübergehend nicht verfügbar:** Erst nach kurzer Wartezeit bewusst «Wiederholen» wählen. Insgesamt sind drei Versuche pro Run-Kette erlaubt.
- **Lauf invalidiert:** Die Konfiguration oder Berechtigung hat sich während des Laufs geändert. Ansicht neu laden und nur bei erneut erfüllten Voraussetzungen neu starten.
- **Mehrdeutig/übersprungen:** Kein Asset wird automatisch ausgewählt, überschrieben oder entkoppelt. Prüfen Sie die Zuordnung später gezielt über die Assetverwaltung.

## Sofortiger Stopp und Rücknahme

Den Schalter für den manuellen Microsoft-Graph-Abgleich im betroffenen Mandanten deaktivieren. Das stoppt neue Läufe, löscht aber weder Assets noch bestehende Verknüpfungen. Es gibt absichtlich keine automatische Rücknahme oder Löschung; fehlerhafte Assets werden einzeln durch berechtigte Personen korrigiert.
