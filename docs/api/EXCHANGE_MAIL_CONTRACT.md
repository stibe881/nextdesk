# nextDesk – Microsoft-365-E-Mail-Kanäle (Vertrag)

Stand: 19.10.2026. Verbindlich für die Migrationen `0061`, `0067` und `0068`, die Functions `exchange-mail-admin`, `exchange-mail-connect`, `exchange-mail-worker` und die E-Mail-Warteschlange. Die generische Function `email-ingress` bleibt unverändert.

## Zielbild

Ein nextDesk-Mandant kann mehrere eigene Support-Postfächer anbinden. Er meldet einmal eine Microsoft-365-Connectoridentität an und kann danach nur die Postfächer konfigurieren, für die diese Identität in Exchange mindestens **Vollzugriff** und **Senden als** besitzt. Jeder aus einer E-Mail entstandene Ticketdatensatz erhält seinen Ursprungskanal; Antworten, Lösungsmitteilungen und Abteilungsrückfragen werden ausschliesslich über diesen Ursprungskanal versendet.

Die zentrale Entra-App **`nextDesk – Exchange Online`** ist mehrmandantenfähig und erhält keine Graph-**Application permissions** `Mail.*`. Sie verwendet ausschliesslich folgende **Delegated permissions**: `User.Read`, `Mail.Read`, `Mail.Send`, `Mail.Read.Shared`, `Mail.Send.Shared`, `offline_access`, `openid`, `profile`.

## Sichere OAuth-Verbindung

- `exchange-mail-admin` ist JWT-geschützt und nur für Mandantenadministrationen mit `tenant.settings.manage` verfügbar.
- `startMicrosoftConnect` legt einen einmaligen, zehn Minuten gültigen Zustand in `mail_private.exchange_mail_oauth_states` an. Gespeichert werden nur SHA-256-Hash von State und Nonce, PKCE-Verifier, Mandant und handelnde Person.
- Der Browser wird zum Entra Authorization-Code-Flow mit PKCE geführt. Rücksprung: `exchange-mail-connect` ohne JWT, aber mit exakt einmal gültigem State, PKCE und signaturgeprüftem Microsoft-ID-Token (`RS256`, `kid` aus Microsoft JWKS, `aud`, `iss`, `exp`, `nonce`, `tid`, `oid`).
- Der erhaltene Refresh-Token wird mit `AES-GCM` und `EXCHANGE_MAIL_TOKEN_ENCRYPTION_KEY` (Base64, exakt 32 Bytes) verschlüsselt. Zugriff auf State und Credentials ist nur über `service_role` möglich. Klartext-Tokens dürfen nicht geloggt, auditiert oder zurückgegeben werden.
- Ist Refresh-Token-Rotation nicht mehr möglich, erhält die Verbindung `reauthorization_required`; alle weiteren Graph-Aktionen sind fail-closed, bis sie erneut angemeldet wurde.

## Datenmodell

`public.exchange_mail_connections`: Mandantenlokale Connectoridentität mit `tenant_id`, Entra-Tenant, Entra-Objekt-ID, sicher anzeigbarem UPN, delegierten Scopes, Status und fehlerfreier Auditspur. RLS ist erzwungen, `anon` und `authenticated` erhalten keinerlei direkten Zugriff.

`mail_private.exchange_mail_connection_credentials`: verschlüsselter Refresh-Token pro Verbindung. `mail_private.exchange_mail_oauth_states`: kurzlebige, verbrauchte PKCE-Zustände. Beide Tabellen sind RLS-erzwungen und nur für `service_role` zugänglich.

`public.exchange_mail_channels` erhält `connection_id` und `access_mode`. Neue Kanäle verwenden zwingend `access_mode='delegated'` mit einer zum gleichen Mandanten gehörenden Verbindung und einer kanonisierten `mailbox_object_id`. Beim Speichern löst nextDesk die eingegebene Postfachadresse einmal über Graph auf und speichert die bestätigte Objekt-ID sowie die kanonische Mailadresse. Ein partieller Unique-Index auf `(entra_tenant_id, mailbox_object_id)` verhindert Alias-Dubletten und mandantenübergreifende Doppelzuordnungen. Bestehende `legacy_rbac`-Kanäle werden mit Migration `0068` pausiert, ihre offenen Warteschlangeneinträge ignoriert und weder von Worker noch Webhook verarbeitet.

`public.tickets.exchange_mail_channel_id` referenziert `(channel_id, tenant_id)`. Der atomare Inbound-Commit schreibt diesen Ursprungskanal bei neuen Tickets und bei autorisierten Antworten auf bisher nicht gebundene Bestands-Tickets.

## Admin-API

`POST exchange-mail-admin` akzeptiert `{ action, tenantId, ... }` und gibt ausschliesslich `{ data }` oder `{ error: { code, message } }` zurück.

- `getStatus`: Verbindungen, Kanäle, aktive Abteilungen und 24-Stunden-Kennzahlen.
- `startMicrosoftConnect`: erzeugt PKCE-State und gibt eine Microsoft-Autorisierungs-URL zurück.
- `saveMailbox`: `{ channelId|null, connectionId, mailboxAddress, mailboxObjectId|null, defaultDepartmentId|null, sendAcknowledgement, sendAgentReplies, sendResolution }`; die optionale Objekt-ID wird ausschliesslich als Server-Eingabe akzeptiert. Die Kundenoberfläche benötigt sie nicht, weil der Server die finale Graph-Objekt-ID selbst ermittelt und abspeichert. Jede Änderung erhöht `configuration_version`. Ein geändertes Ziel setzt den Kanal auf `draft` und verwirft noch ausstehende Ausgangsqueue-Einträge fail-closed.
- `verifyConnection`: prüft für den ausgewählten Kanal `/users/{mailbox}/mailFolders/inbox`, eine minimale Nachrichtenliste und sendet eine kurze Berechtigungs-Bestätigung an das verbundene Connector-Konto. Damit werden Vollzugriff und **Senden als** vor Aktivierung nachgewiesen. Erfolg setzt `verified`.
- `activate`: verlangt `verified` und eine verbundene Connectoridentität, setzt Wasserzeichen und aktiviert den Kanal. Es wird kein Delegated-Webhook angelegt.
- `pause`: erhöht `configuration_version`, pausiert den Kanal und verwirft nicht versandte Queue-Einträge des Kanals.
- `sendTestMail`: erstellt eine `kind='test'`-Queue-Nachricht an die E-Mail-Adresse der handelnden Person.

## Worker und Verarbeitung

- Alle neuen Kanäle holen OAuth-Access-Tokens durch Refresh der konkreten `connection_id`; Tokens leben nur im Function-Speicher und werden fünf Minuten vor Ablauf erneuert.
- Alle Graph-Aufrufe für Abruf, Nachrichtendetails, Anhänge, Antworten und `sendMail` verwenden die Verbindung des konkreten Kanals.
- Der Wartungsjob pollt jeden aktiven delegierten Kanal mindestens alle fünf Minuten ab `poll_watermark - 10 Minuten`, verarbeitet höchstens 50 Kandidaten pro Lauf, dedupliziert über `(channel_id, graph_message_id)` und aktualisiert das Wasserzeichen nur für diese Konfigurationsrevision.
- Delegierte Kanäle erzeugen keine Graph-Subscription. Vorbestehende Application-RBAC-Abos werden mit dem Legacy-Cutover lokal stillgelegt; der öffentliche frühere Webhook nimmt danach nur noch Provider-Validierungen an und verarbeitet keine Benachrichtigungen.
- Inbound- und Outbound-Verarbeitung bleibt revisionsgebunden und fail-closed. Referenzheader, Ticketnummern, Conversation-IDs und der Reply-Thread werden immer zusätzlich auf `channel_id` beziehungsweise `tickets.exchange_mail_channel_id` eingeschränkt; ein Ticket wird deshalb nie über ein anderes Support-Postfach fortgesetzt. Alle fachlichen Anti-Loop-, Absender-, Anhänge-, Rate-Limit- und Wiederholungsregeln der bestehenden Verarbeitung gelten unverändert.

## Fehlercodes

Zusätzlich zu `feature_disabled`, `forbidden`, `invalid_settings`, `mailbox_in_use`, `exchange_mailbox_not_found`, `exchange_access_denied`, `exchange_throttled` und `exchange_unavailable` gelten:

- `exchange_platform_not_configured`: Client-ID, Client-Secret oder Verschlüsselungsschlüssel fehlen.
- `connection_not_found`: Verbindung gehört nicht zum Mandanten oder existiert nicht.
- `exchange_reauthorization_required`: der sichere Token-Refresh ist nicht mehr möglich; erneute Microsoft-Anmeldung nötig.
- `exchange_verification_required`: Kanal muss vor Aktivierung erneut erfolgreich geprüft werden.

## Datenschutz

`mail_messages` enthält keine vollständigen E-Mail-Körper; Ticketbeschreibung und externer Ticketkommentar enthalten die fachlich notwendigen Inhalte. Audit-Einträge enthalten weder Token, E-Mail-Inhalte noch Microsoft-Fehlertexte. Connector-Refresh-Tokens, OAuth-States und Verschlüsselungsmaterialien verlassen nie den serverseitigen Secret-/Service-Role-Pfad.
