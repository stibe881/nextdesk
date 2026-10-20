# Microsoft-Graph-Verbindungstest für das Entra-Verzeichnis

Der Verbindungstest verwendet `GET https://graph.microsoft.com/v1.0/users/$count` mit dem Header `ConsistencyLevel: eventual`. Die Antwort ist nur eine Ganzzahl und wird weder geloggt noch an den Browser zurückgegeben.

Die offizielle Microsoft-Graph-Dokumentation führt `User.Read.All` als niedrigste Application Permission zum Auflisten von Benutzern auf. Sie dokumentiert zudem den Count-URL-Segment-Endpunkt sowie die erforderliche Verwendung von `ConsistencyLevel: eventual` für `/$count`. Damit ist weder `Organization.Read.All` noch ein Abruf von Benutzerobjekten für den Test nötig.

Der Test ist nicht für Azure AD B2C vorgesehen, da Microsoft dort `$count` für diese Benutzerabfrage nicht unterstützt. nextDesk akzeptiert für diesen Connector nur eine aktive, mandantenspezifische Azure-SSO-URL mit GUID.

Quellen:

- https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0
- https://learn.microsoft.com/en-us/graph/aad-advanced-queries
- https://learn.microsoft.com/en-us/graph/permissions-reference
