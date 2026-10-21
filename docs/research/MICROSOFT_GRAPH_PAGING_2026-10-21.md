# Microsoft Graph: Paging bei Intune-Geräten

**Recherchezeitpunkt:** 21. Oktober 2026

Die Intune-Vorschau ruft ausschliesslich `GET /v1.0/deviceManagement/managedDevices` mit einer begrenzten `$select`-Projektion auf. Microsoft Graph liefert bei weiteren Seiten eine vollständige URL in `@odata.nextLink`. Diese URL kann den `$skiptoken` sowie die ursprünglichen Query-Parameter, etwa `$top` und `$select`, enthalten.

Der Parser folgt Fortsetzungslinks deshalb nur dann, wenn sie weiterhin HTTPS, `graph.microsoft.com` und genau den Endpunkt `/v1.0/deviceManagement/managedDevices` verwenden. Zulässig sind ausschliesslich die erwarteten Parameter `$skiptoken`, `$top` und `$select`; `$top` bleibt auf 1–100 begrenzt und `$select` muss exakt die bereits freigegebene, datensparsame Feldprojektion enthalten. Andere Parameter, Origins oder Pfade bleiben fail-closed gesperrt.

## Offizielle Quellen

- https://learn.microsoft.com/en-us/graph/paging
- https://learn.microsoft.com/en-us/graph/api/resources/intune-devices-manageddevice?view=graph-rest-1.0
