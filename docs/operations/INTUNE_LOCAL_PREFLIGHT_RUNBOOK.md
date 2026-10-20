# Intune: lokaler Preflight und Run-Historie

**Stand:** 20. Oktober 2026
**Geltungsbereich:** nextDesk P1.5, Asset-Management

## Zweck

Der lokale Intune-Preflight prüft ausschliesslich die nextDesk-seitige Voraussetzung für eine künftige, kontrolliert freigegebene Intune-Integration. Er dokumentiert den Lauf mit Mandant, auslösender Person, Zeitpunkt, Ergebniscode und Wiederholungsbeziehung.

Der Preflight ist ausdrücklich **kein** Intune-Sync und **keine** externe Verbindung.

- Er fordert **kein** Graph-Token an.
- Er ruft **keinen** Microsoft-Graph-Endpunkt auf.
- Er liest, erstellt, aktualisiert oder löscht **keine** Geräte- oder Assetdaten.
- Er aktiviert keine Providersynchronisation, keinen Worker und keinen Scheduler.
- Er zeigt keine Entra-Tenant-ID, Tokens, Providerfehler oder Personendaten im Browser an.

Mit Migration 0083 werden auch bereits gespeicherte Provider-Sync-Schalter mandantenübergreifend auf deaktiviert gesetzt. Der ältere Endpoint `intune-asset-sync` ist JWT-geschützt und antwortet bis zu einer separaten Freigabe ausschliesslich fail-closed; er fordert keine Secrets an und kann weder Graph noch einen Provider aufrufen.

## Voraussetzungen pro Mandant

1. Asset-Management ist für den Mandanten bewusst aktiviert.
2. Die handelnde Person besitzt `asset.integration.manage`.
3. Für eine aktivierte lokale Konfiguration besteht eine aktive, **tenant-spezifische** Azure-SSO-Konfiguration. Die Mandantenbindung wird serverseitig aus deren Microsoft-URL abgeleitet. Im Browser wird keine Tenant-ID erfasst.

## Bedienung

1. In nextDesk zu **Einstellungen → Funktionen → Asset-Management → Microsoft Intune** wechseln.
2. Den Schalter «Lokale Intune-Konfiguration für diesen Mandanten vorbereiten» bewusst aktivieren und speichern.
3. Erst danach «Lokalen Preflight ausführen» wählen.
4. Das Ergebnis erscheint als allgemeiner Status und in der lokalen Preflight-Historie:
   - **Lokale Konfiguration ist bereit:** Die interne Voraussetzung ist erfüllt; es wurde weiterhin kein Provider kontaktiert.
   - **Konfiguration deaktiviert:** Den Schalter bewusst speichern und nochmals prüfen.
   - **Azure-SSO-Bindung fehlt:** Zuerst eine aktive tenant-spezifische Azure-SSO-Konfiguration hinterlegen.
   - **Bindung erneut speichern:** Nach einer SSO-Änderung die lokale Intune-Konfiguration erneut speichern und erst dann prüfen.
5. Einen abgeschlossenen lokalen Lauf nur über «Wiederholen» erneut auslösen. Der Folgelauf erhält eine überprüfbare Versuchs- und Elternlaufbeziehung.

## Sicherheit und Recovery

- Alle Konfigurationsänderungen sowie erfolgreichen oder blockierten Preflights werden mandantenbezogen auditiert.
- Der Browser hat keinen Tabellenzugriff auf Intune-Konfigurationen, -Läufe, Geräte-Snapshots, Gerätekennungen oder Identifier. Der JWT-geschützte `asset-registry`-Endpunkt autorisiert jede Aktion zusätzlich serverseitig und führt QR-/Barcode-Lookups nur innerhalb des aktiven Mandanten aus.
- Migration 0083 verschiebt bestehende Gerätekennungen in eine private Service-Role-Relation, entfernt sie aus der browserlesbaren `assets`-Tabelle und löscht historische, öffentliche Identifier-Kopien sowie rekursiv alle bekannten privaten Providerfelder aus Asset-Metadaten. Künftige Asset-Metadaten mit solchen Feldern werden datenbankseitig abgewiesen. Fallunterschiede in alten Gerätekennungen bleiben als private, mehrdeutige Zuordnungen erhalten; der Scan zeigt dann keine beliebige Auswahl. Microsoft-Graph-Snapshots und zugeordnete Personen bleiben ebenfalls privat. Berechtigte Assetverantwortliche erhalten höchstens reduzierte Compliance-, Verschlüsselungs- und Zeitstatusaggregate.
- Die Datenbankpolicies prüfen `assets.management` einschliesslich eines allfälligen Pilotendes. Damit können direkte PostgREST-Zugriffe die Funktionssperre weder lesen noch ändern oder über Ticketverknüpfungen umgehen.
- Wiederholte technische Anfragen mit derselben Client-Request-ID liefern denselben Lauf statt eines Duplikats.
- Eine Konfigurationsänderung setzt das Ergebnis einer früheren lokalen Prüfung zurück und erhöht eine Konfigurationsgeneration.
- Eine direkte oder neue Fallverantwortung ist nur für aktive Mandantenmitglieder zulässig. Historische, inzwischen deaktivierte Verantwortliche bleiben erkennbar und können durch eine aktive Person ersetzt oder entfernt werden.

## Bewusst nicht freigegeben

Eine echte Intune-/Graph-Synchronisation, ein App-Secret, Microsoft-Admin-Consent, ein periodischer Scheduler sowie ein Geräte- oder Compliance-Abgleich gehören **nicht** zu diesem P1.5-Preflight. Sie dürfen erst nach separater fachlicher und sicherheitlicher Freigabe geplant und aktiviert werden.
