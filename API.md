# API-Konzept

## Prinzip

Die primäre App-Datenschicht nutzt Supabase mit RLS für sichere Leseoperationen. Komplexe oder privilegierte Schreibvorgänge werden als versionierte Edge Functions oder PostgreSQL-RPCs angeboten. Eine öffentliche REST-API wird unter `/api/v1` dokumentiert, versioniert und mandantenbezogen autorisiert.

## Mindestregeln

- Jede Anfrage trägt Authentifizierung oder einen mandantenbezogenen API-Schlüssel mit begrenzten Scopes.
- Der Mandant wird aus dem autorisierten Principal abgeleitet; `tenant_id` im Body ist nur ein Konsistenzparameter.
- Schreiboperationen verlangen einen Idempotency-Key, wenn Wiederholungen geschäftliche Duplikate erzeugen könnten.
- Listen verwenden cursorbasierte Pagination; Filter und Sortierung liegen auf einer Allowlist.
- Fehler folgen einem stabilen Format mit maschinenlesbarem Code, Request-ID und keinen internen Details.
- Exporte, Integrationen und Webhooks sind Jobs mit Berechtigungsprüfung und Audit-Event.

## Geplante Anfangsoperationen

| Operation                            | Autorisierung                                          | Status  |
| ------------------------------------ | ------------------------------------------------------ | ------- |
| `POST /api/v1/tickets`               | `ticket.create` im tatsächlichen Mandanten             | Phase 4 |
| `GET /api/v1/tickets`                | eigene, zugewiesene oder Abteilungsrechte              | Phase 4 |
| `GET /api/v1/tickets/{id}`           | Ressourcenprüfung via RLS                              | Phase 4 |
| `POST /api/v1/tickets/{id}/comments` | Ticketzugriff; interne Notiz zusätzliches Recht        | Phase 4 |
| `POST /api/v1/tenants`               | aktiver Plattformbetreiber, User-JWT mit `aal2`, Audit | Phase 2 |

OpenAPI wird mit jeder implementierten Operation aktualisiert. Bis dahin ist diese Datei ein Vertrag, kein behaupteter API-Betrieb.
