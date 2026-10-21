# Microsoft Graph: Primäre Person eines Intune-Geräts

**Geprüft am:** 21. Oktober 2026
**Offizielle Quelle:** https://learn.microsoft.com/en-us/graph/api/resources/intune-devices-manageddevice?view=graph-rest-1.0

Die offizielle Microsoft-Graph-Dokumentation beschreibt bei `managedDevice` das schreibgeschützte Feld `userId` als «Unique Identifier for the user associated with the device». Dieselbe Ressource führt getrennte, personenbezogene Felder wie `userPrincipalName`, `userDisplayName` und `emailAddress` auf.

nextDesk verwendet ausschliesslich `userId` in der bestehenden, minimalen `$select`-Projektion. Der Wert wird nur akzeptiert, wenn er als UUID vorliegt, und nur mit der vorhandenen Entra-Verzeichnisspiegelung desselben Mandanten abgeglichen. Es werden weder UPN, E-Mail noch Graph-Anzeigenamen angefragt oder gespeichert. Die sichtbare «Primäre Person (Intune)» stammt ausschliesslich aus dem aktuellen lokalen, aktiven Entra-Verzeichniseintrag.

Weitere offizielle Vertragsquelle für den Listenendpunkt: https://learn.microsoft.com/en-us/graph/api/intune-devices-manageddevice-list?view=graph-rest-1.0
