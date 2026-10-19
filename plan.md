# Microsoft 365 verbinden: Mehrpostfach-E-Mail-Kanal

nextDesk ersetzt die manuelle Exchange-RBAC-Einrichtung durch einen Mandantenassistenten «Mit Microsoft 365 verbinden». Eine Mandantenadministration verbindet ein bewusst gewähltes Connector-Konto über Microsoft Entra. Anschliessend können mehrere Support-Postfächer als einzelne, klar abgegrenzte Kanäle desselben nextDesk-Mandanten hinzugefügt werden.

## Produktverhalten

Die Einstellung zeigt zuerst die vorhandenen Microsoft-365-Verbindungen und die zugehörigen Support-Postfächer. «Mit Microsoft 365 verbinden» startet einen Microsoft-Authorization-Code-Flow. Nach der Rückkehr zeigt nextDesk den bestätigten Entra-Mandanten und erlaubt das Hinzufügen mehrerer Postfächer per Adresse. Jedes Postfach wird serverseitig gegen Microsoft Graph geprüft und erhält separat Abteilung, Eingangsbestaetigung, Agentenantwort und Lösungsmitteilung sowie seinen eigenen Status.

Das Connector-Konto muss in Microsoft 365 nur Zugriff auf die tatsächlich angebundenen Postfächer haben. Für ein freigegebenes Support-Postfach verlangt der Test lesenden Zugriff sowie zum Versenden `Send As` oder `Send on Behalf`; für das Speichern gesendeter Nachrichten im Support-Postfach wird zusätzlich `Full Access` vorausgesetzt. nextDesk zeigt dafür klare Hinweise, führt aber keine fremden Exchange-Berechtigungsänderungen automatisch durch.

Mehrere angeschlossene Shared Mailboxes werden alle fünf Minuten sicher abgefragt. Microsoft erlaubt mit delegierten Shared-Mailbox-Rechten keine Change-Notification-Webhooks auf fremden oder freigegebenen Postfächern; nextDesk verwendet daher dort bewusst Polling statt einen unzuverlässigen Webhook vorzutäuschen. Für das eigene Postfach einer Connector-Identität bleibt eine spätere Webhook-Optimierung möglich, ist aber nicht Voraussetzung für die funktionierende Mehrpostfach-Anbindung.

## Sicherheit und Datenmodell

Der Authorization-Code-Flow läuft nur serverseitig über eine fest registrierte Callback-URL mit PKCE S256, kryptografischem einmaligem State, Nonce, kurzer Ablaufzeit und Bindung an die startende nextDesk-Mandantenadministration. Tenant und Connector-Identität stammen aus den verifizierten Microsoft-Claims, nie aus frei editierbaren Formulardaten. Der Browser erhält weder Access- noch Refresh-Tokens.

Eine neue `exchange_mail_connections`-Entität bindet einen Entra-Mandanten und ein Connector-Konto an einen nextDesk-Mandanten. Private, service-role-only Tabellen speichern rotierende Refresh-Tokens verschlüsselt sowie kurzlebige OAuth-State-Datensätze. Bei fehlender Zustimmung oder Refresh-Fehler wird die betroffene Verbindung als erneute Anmeldung erforderlich markiert; sie liest und versendet dann keine E-Mails.

`exchange_mail_channels` wird von einem auf mehrere Kanäle pro Mandant erweitert. Jeder Kanal referenziert exakt eine Verbindung und bleibt global auf das konkrete Mailboxobjekt begrenzt. Bestehende Queue-, Abo-, Konfigurationsversions- und Idempotenzmechanismen bleiben bestehen. Tickets aus E-Mails speichern die Ursprungs-Kanal-ID, damit Antworten, Bestätigungen und Lösungen immer über dasselbe Support-Postfach laufen. Manuell erstellte Tickets haben keinen automatischen Mail-Absender, bis eine Person bewusst einen Kanal wählt.

## Umsetzung

Eine additive Migration führt Connections, private Credentials und OAuth-State ein, hebt die Ein-Postfach-Einschränkung auf und erweitert Kanäle, Nachrichten, Abos und Tickets um die Connection-/Ursprungsbindung. Alle neuen Tabellen erzwingen RLS, entziehen Browserrollen sämtliche Rechte und erlauben direkten Zugriff ausschliesslich dem `service_role`.

Eine neue Connect-Function startet und schliesst OAuth ab. Die bestehende Exchange-Admin-Function wird zur Listen- und Kanal-API mit `channelId` für Speichern, Prüfen, Aktivieren, Pausieren, Testmail und Trennen. Gemeinsame Graph-Hilfen laden ein kurzlebiges Access Token über die kanalgebundene Connection, rotieren Refresh-Tokens und validieren Scope, Zielmandant und Postfachzugriff fail-closed.

Der Worker verarbeitet die bestehende Queue kanalgebunden mit delegierten Tokens. Shared Mailboxes werden im Maintenance-Lauf seitenweise abgefragt; Webhooks bleiben nur dort aktiv, wo Microsoft sie für die jeweilige Connector-Identität zulässt. Bestehende Body-/Anhangslimits, Loop-Schutz, atomare Inbound-Verarbeitung, Retry/Backoff und Konfigurationsrevisionen werden beibehalten.

Die Weboberfläche ersetzt PowerShell und RBAC-Hinweise durch den Connect-Assistenten, eine Postfachliste und klare Zustände für verbunden, Prüfbedarf, aktiv, pausiert und erneute Anmeldung erforderlich. Die bisherige Einzelkanal-Konfiguration bleibt während der Datenmigration lesbar, aktiviert sich aber nie automatisch.

## Externe Microsoft-Konfiguration vor dem ersten Connect

Die vorhandene zentrale mehrmandantenfähige App `nextDesk – Exchange Online` erhält eine serverseitige Callback-URL und ausschliesslich die minimalen delegierten Microsoft-Graph-Scopes `Mail.Read`, `Mail.Send`, `Mail.Read.Shared`, `Mail.Send.Shared`, `offline_access`, `openid`, `profile` und `User.Read`. Es werden keine Microsoft-Graph-Application-`Mail.*`-Berechtigungen vergeben. Das bereits sichere Server-Secret bleibt im Supabase Secret Store.

Nach dem Code-Rollout führt eine Kundin oder ein Kunde die erste Verbindung als gewähltes Connector-Konto durch. In Exchange Admin Center erhält dieses Konto nur für die einzubindenden Shared Mailboxes `Full Access` und `Send As` oder `Send on Behalf`.

## Projektstruktur

- `supabase/migrations/`: additive Mehrpostfach-, Connection-, Credential- und Routing-Sicherung.
- `supabase/functions/exchange-mail-connect/`: OAuth-Start und serverseitiger Callback.
- `supabase/functions/_shared/exchange-graph.ts`: delegierte Tokenrotation und kanalgebundene Graph-Aufrufe.
- `supabase/functions/exchange-mail-admin/`, `exchange-mail-worker/`, `exchange-mail-webhook/`: kanal- und verbindungsgebundene Verwaltung, Verarbeitung und Zustellung.
- `apps/web/src/exchange-mail-settings.tsx`: Connect-Assistent und Mehrpostfachliste.
- `docs/deployment/`: kundenverständliche, PowerShell-freie Einrichtung und Einschränkungen.

## Manuelle Entra-Agentenzuordnung

Synchronisierte Personen bleiben immer normale Personen. In «Personen & Agenten» kann eine Mandantenadministration eine aktive Entra-Person bewusst einer aktiven Ziel-Abteilung als Support-Agent zuordnen oder diese Vormerkung wieder aufheben. Die Datenbank hält die auslösende Mandantenadministration, den Zeitpunkt und ausschliesslich die daraus erzeugte Rollen-Zuweisung fest. Bei bereits aktiver nextDesk-Mitgliedschaft wird diese Rollen-Zuweisung sofort eingerichtet; bei einer Person ohne bisherigen Login nur vorgemerkt und ausschliesslich beim späteren, objektgebundenen Entra-Login angewendet.

Die drei service-role-only Datenbankfunktionen prüfen Mandant, aktive Adminrolle, aktive Entra-Person, Ziel-Abteilung und Rollenbesitz atomar. Sie übernehmen keine vorbestehende fremde Agentenrolle. Bei Entra-Deaktivierung oder Entfernung beendet der nächste Directory-Sync nur die nachweislich über diese Vormerkung geschaffene Rollen-Zuweisung und löscht die Vormerkung. Browserrollen können weder die privaten Verzeichnisdaten noch die Verwaltungsfunktionen direkt aufrufen.

## Ticketakte als PDF – Redesign

Die Ticketakte bleibt eine druckoptimierte, clientseitig erzeugte HTML-PDF mit derselben autorisierten Datenquelle. Die Überarbeitung betrifft ausschliesslich Informationshierarchie und Druck-CSS; Berechtigungsprüfung, Audit-Ereignis und Inhaltssichtbarkeit bleiben unverändert.

Die Gestaltung wird eine ruhige, sachliche Serviceakte statt einer Webansicht im Druck: Ein Kopf priorisiert Ticketnummer, Titel und Status, danach folgen ein luftiger Faktenblock, klar getrennte Inhaltsabschnitte, eine kompakte Checkliste sowie eine zeitlich lesbare Kommunikationschronik. Status, Priorität sowie interne und externe Beiträge erhalten zurückhaltende, semantische Farbakzente. Wiederkehrende Kopfzeilen, Karten und einzelne Kommunikationsbeiträge vermeiden Seitenumbrüche, damit die PDF auf A4 stabil und hochwertig druckt. Es werden keine externen Bilder oder Daten eingebunden.

## Sicherheitskorrektur: abgeschirmter OAuth- und Credential-Speicher

Die privaten Tabellen `mail_private.exchange_mail_oauth_states`, `mail_private.exchange_mail_connection_credentials` und `mail_private.service_identity` bleiben ausserhalb der öffentlich über PostgREST erreichbaren Schemas. Statt direkter Schemaabfragen aus Edge Functions stellen eng validierte `SECURITY DEFINER`-RPCs ausschließlich für `service_role` die nötigen atomaren Operationen bereit: OAuth-Zustand erstellen und einmalig einlösen, verschlüsselte Connection-Credentials lesen und rotieren sowie die E-Mail-Dienstidentität nach einem Race-sicheren Claim auflösen. Alle RPCs begrenzen Eingaben, setzen einen festen `search_path`, vergeben keine Rechte an `anon` oder `authenticated` und geben nie Tokens an den Browser zurück. Dadurch startet der PKCE-Flow wieder, ohne den privaten Credential-Speicher für Browser oder PostgREST freizugeben.
