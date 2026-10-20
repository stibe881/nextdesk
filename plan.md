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

## Veranstaltungsräume

Planbare Einrichtungen in Aula und Sitzungszimmern sind keine Störung und gehören deshalb nicht in die Ticketkennzahlen. nextDesk erhält einen eigenständigen Bereich «Veranstaltungsräume», der Raumaufträge mandantenisoliert plant. Ein Auftrag enthält Raum, Anlass, Start und Ende, eine verantwortliche Person, erwartete Teilnehmendenzahl sowie standardisierte Ausstattungswünsche. Die sichtbaren Zustände sind `geplant`, `in Vorbereitung`, `bereit`, `durchgeführt` und `abgeschlossen`.

Die Kalenderansicht zeigt die nächsten sieben Tage als zeitliche Planungsfläche, die Listenansicht alle bevorstehenden Raumaufträge. Wöchentliche und monatliche Wiederholungen werden nur durch die ausdrückliche Benutzeraktion beim Speichern zu einzelnen, begrenzten Aufträgen materialisiert. Der Bereich führt weder einen Scheduler noch einen Hintergrunddienst ein. Er erstellt niemals selbständig ein Ticket: Tritt bei der Einrichtung eine Störung auf, erfasst eine berechtigte Person dafür bewusst ein reguläres Ticket.

Vor der Speicherung prüft der serverseitige Endpunkt mögliche Überlappungen eines Raums sowie identische, zeitgleich gewünschte technische Ressourcen. Die Antwort enthält nur die Anzahl und Art einer Überschneidung, niemals Details eines fremden Auftrags. Die Person kann danach den Zeitraum beziehungsweise die Ausstattung korrigieren oder die Warnung bewusst bestätigen. Pro Auftrag werden aus einer mandantenspezifischen Standardvorlage die Aufgaben «Technik prüfen», «Raum einrichten», «Videocall vorbereiten», «Vor-Ort-Test» und «Nach dem Anlass zurückbauen» erzeugt. Die Vorlage wird bei der Mandantenerstellung und einmalig für bestehende Mandanten angelegt.

Die neue Migration ergänzt den Berechtigungskatalog um `event.spaces.request` und `event.spaces.manage`. Wer Tickets erfassen darf, kann einen Raumauftrag anfragen; wer Tickets bearbeiten oder Mandanteneinstellungen verwalten darf, verwaltet Räume, Verantwortlichkeiten, Zustände und Aufgaben. Alle Planungsdaten sind für direkte Browserzugriffe gesperrt. Die neue JWT-geschützte Edge Function validiert die aktive Mitgliedschaft und diese Berechtigungen vor jeder Abfrage oder Mutation, verwendet den Servicezugriff nur nach dieser Prüfung und erzeugt nachvollziehbare, datensparsame Audit-Einträge mit der handelnden Person.

- `supabase/migrations/0089_event_space_requests.sql`: Räume, Vorlagen, Aufträge, Ausstattungswünsche, Aufgaben, Indizes, Berechtigungen und direkte Zugriffssperre.
- `supabase/functions/event-spaces/`: serverseitige Liste, Konfliktvorschau, Raum- und Auftragsverwaltung ohne Ticket- oder Schedulerpfad.
- `supabase/functions/_shared/event-space-schedule.ts`: begrenzte, testbare Validierung konkreter Terminserien und Konfliktzusammenfassungen.
- `apps/web/src/event-spaces.tsx`: Kalender, Liste, Auftragsformular, bewusste Konfliktbestätigung und Aufgabenfortschritt.
- `apps/web/src/App.tsx`, `apps/web/src/styles.css`: eigenständiger Menüpunkt, Bereichseinbindung und responsive Bedienoberfläche.

## Manuelle Entra-Agentenzuordnung

Synchronisierte Personen bleiben immer normale Personen. In «Personen & Agenten» kann eine Mandantenadministration eine aktive Entra-Person bewusst einer aktiven Ziel-Abteilung als Support-Agent zuordnen oder diese Vormerkung wieder aufheben. Die Datenbank hält die auslösende Mandantenadministration, den Zeitpunkt und ausschliesslich die daraus erzeugte Rollen-Zuweisung fest. Bei bereits aktiver nextDesk-Mitgliedschaft wird diese Rollen-Zuweisung sofort eingerichtet; bei einer Person ohne bisherigen Login nur vorgemerkt und ausschliesslich beim späteren, objektgebundenen Entra-Login angewendet.

Die drei service-role-only Datenbankfunktionen prüfen Mandant, aktive Adminrolle, aktive Entra-Person, Ziel-Abteilung und Rollenbesitz atomar. Sie übernehmen keine vorbestehende fremde Agentenrolle. Bei Entra-Deaktivierung oder Entfernung beendet der nächste Directory-Sync nur die nachweislich über diese Vormerkung geschaffene Rollen-Zuweisung und löscht die Vormerkung. Browserrollen können weder die privaten Verzeichnisdaten noch die Verwaltungsfunktionen direkt aufrufen.

## Ticketakte als PDF – Redesign

Die Ticketakte bleibt eine druckoptimierte, clientseitig erzeugte HTML-PDF mit derselben autorisierten Datenquelle. Die Überarbeitung betrifft ausschliesslich Informationshierarchie und Druck-CSS; Berechtigungsprüfung, Audit-Ereignis und Inhaltssichtbarkeit bleiben unverändert.

Die Gestaltung wird eine ruhige, sachliche Serviceakte statt einer Webansicht im Druck: Ein Kopf priorisiert Ticketnummer, Titel und Status, danach folgen ein luftiger Faktenblock, klar getrennte Inhaltsabschnitte, eine kompakte Checkliste sowie eine zeitlich lesbare Kommunikationschronik. Status, Priorität sowie interne und externe Beiträge erhalten zurückhaltende, semantische Farbakzente. Wiederkehrende Kopfzeilen, Karten und einzelne Kommunikationsbeiträge vermeiden Seitenumbrüche, damit die PDF auf A4 stabil und hochwertig druckt. Es werden keine externen Bilder oder Daten eingebunden.

## Sicherheitskorrektur: abgeschirmter OAuth- und Credential-Speicher

Die privaten Tabellen `mail_private.exchange_mail_oauth_states`, `mail_private.exchange_mail_connection_credentials` und `mail_private.service_identity` bleiben ausserhalb der öffentlich über PostgREST erreichbaren Schemas. Statt direkter Schemaabfragen aus Edge Functions stellen eng validierte `SECURITY DEFINER`-RPCs ausschließlich für `service_role` die nötigen atomaren Operationen bereit: OAuth-Zustand erstellen und einmalig einlösen, verschlüsselte Connection-Credentials lesen und rotieren sowie die E-Mail-Dienstidentität nach einem Race-sicheren Claim auflösen. Alle RPCs begrenzen Eingaben, setzen einen festen `search_path`, vergeben keine Rechte an `anon` oder `authenticated` und geben nie Tokens an den Browser zurück. Dadurch startet der PKCE-Flow wieder, ohne den privaten Credential-Speicher für Browser oder PostgREST freizugeben.

## Funktionen & Integrationen

Die Funktionenverwaltung wird zu einer kompakten, durchsuchbaren Arbeitsfläche statt zu einer langen Schalterliste. Karten sind nach fachlichem Zweck gruppiert und zeigen nur den aktuellen Status, die primäre Schalteraktion sowie bei Bedarf eine aufklappbare Konfiguration. Exchange Online, Intune-Asset-Synchronisation, SLA-Automatisierung und SSO werden direkt auf der jeweils passenden Karte konfiguriert; ein abgelaufenes Pilotkonzept, Eingabefelder und Hinweise dazu erscheinen nicht mehr.

Die Bedienoberfläche lädt eine Spezialkonfiguration nur bei tatsächlich aktivem Feature. Dieselbe Quelle wird serverseitig erzwungen: Der Intune-Worker lässt deaktiviertes Asset-Management ohne Microsoft-Graph-Aufruf aus, und alle Ticketautomationsaktionen sowie der nicht öffentliche SLA-Scheduler scheitern oder überspringen Mandanten bei deaktivierter SLA-Automatisierung kontrolliert. Der Scheduler prüft die Freigabe pro Mandant vor jeder möglichen Ticketmutation; Lookup-Fehler werden wie deaktiviert behandelt und im Ergebnis nur als aggregierte Anzahl ausgewiesen. Bestehende globale Einstellungen und historische Pilotdaten werden nicht automatisch aktiviert; eine bewusste Schalteraktion entfernt nur den veralteten Ablaufwert für genau diese Funktion.

Die relevanten Module liegen in `apps/web/src/tenant-admin-settings.tsx` und `apps/web/src/styles.css`; die serverseitige Durchsetzung befindet sich in `supabase/functions/intune-asset-sync/`, `supabase/functions/ticket-automation/` sowie der gemeinsamen Feature-Auflösung `supabase/functions/_shared/tenant-features.ts`.

## SLA-Backlog-Zuverlässigkeit

Die SLA-Automation lässt die Datenbank pro Breach-Art nur noch offene, fällige Tickets auswählen, die kein gleichartiges Breach-Ereignis besitzen und deren Mandant `automation.sla` wirksam freigegeben hat. Damit können frühere, bereits protokollierte Ereignisse sowie inaktive Mandanten den begrenzten Worker-Batch nicht belegen. Auswahl- und Breach-RPC sind ausschließlich für `service_role` ausführbar. Die Datenbankzeit bestimmt Fälligkeit und Pilotablauf; die atomare Breach-RPC sperrt den zugehörigen Funktionsschalter und prüft ihn unmittelbar vor den Folgeschreibvorgängen nochmals. Sie bleibt damit zugleich letzte Freigabe- und Idempotenzsicherung bei parallelen Läufen.

## Konsolidierung offener Webpunkte vom 19. Oktober

Die auf dem lokalen Hauptarbeitsbaum gesicherten, aber nicht ausgelieferten Webänderungen werden nicht als Dateiübernahme verwendet, weil dieser Arbeitsbaum hinter den heutigen Produktionsreleases liegt. Stattdessen werden die fachlich noch fehlenden Punkte auf der aktuellen Hauptlinie neu und selektiv umgesetzt: Services, Assets und Fälle erhalten klar getrennte Ansichten derselben autorisierten Katalogdaten; die SLA-Regelverwaltung zieht von Services in die Mandanteneinstellungen um; und die Ticketarbeitsfläche wird in eine ruhigere Reihenfolge von Kontext, Vorbereitung, Nachbereitung und Steuerung gegliedert. Die pausierte Wissensdatenbank bleibt dabei unverändert.

Weil der bestehende gemeinsame Katalog-Endpunkt bereits serverseitig durch `assets.management` geschützt ist, erscheinen Services, Assets und Fälle konsistent nur bei aktivem Asset-Management. Dies verhindert sichtbare Navigation zu einem bewusst gesperrten Endpunkt. Die SLA-Verwaltung ist nach dem Umzug bewusst ein Bereich der bereits vorhandenen Mandantenadministration und wird ausschliesslich bei aktivem `automation.sla` angezeigt; beim Deaktivieren fällt die aktive Einstellung zurück auf die Funktionsübersicht. Es werden keine neuen Provider, Scheduler oder automatischen Aktivierungen eingeführt.

Die Portierung berührt gezielt `App.tsx`, `service-assets.tsx`, `sla-management.tsx`, `tenant-admin-settings.tsx`, `ticket-detail.tsx`, `ticket-workbench.tsx`, `ticket-workbench.css` und die zugehörigen lokalen Stile. Das bestehende Onboarding, der optionale Portalname, alle heutigen Ticketfilter/-sortierungen, die bestätigte Ticketlöschung, Entra-Agentenzuordnung und E-Mail-Integration bleiben unverändert.

## Mitarbeitenden-Onboarding

Neue Mitarbeitende werden als eigenständige operative Eintrittsvorgänge geführt, nicht als offene Tickets. Der neue Bereich «Eintritte» erfasst Name, Eintrittsdatum, Organisation/Angebot, Standort, Führungsperson, ICT-Verantwortung und eine Onboarding-Vorlage. Die vier mandantenspezifisch gespeicherten Vorlagen «Standard», «ICT», «Schule» und «Verwaltung» erzeugen beim bewussten Anlegen konkrete, datumsrelative Aufgaben. Als Standardaufgaben werden Gerätebereitstellung, Konto- und Zugriffsbereitstellung, Gruppen- und Berechtigungszuordnung, Arbeitsplatzvorbereitung, Telefonie/E-Mail/Drucker/Software sowie Einführung und Übergabebestätigung vorgegeben. Jede Aufgabe erhält eine verantwortliche Person, ein Fälligkeitsdatum sowie den Status offen, in Arbeit, blockiert oder erledigt.

Der Prozess wird beim Anlegen einmalig materialisiert: Es gibt keinen Scheduler, keine automatische nachträgliche Terminverschiebung und keine automatische Ticketanlage. Führungspersonen sehen ihre ihnen zugeordneten Eintritte, ICT-Verantwortliche ausschliesslich die eigenen technischen Aufgaben; Personen mit Verwaltungsberechtigung sehen und verwalten den Mandantenbestand. Ein Ausnahmeticket kann nur über eine sichtbare, bewusste Aktion erzeugt und danach serverseitig mit dem Eintritt beziehungsweise einer Aufgabe verknüpft werden. Der normale Ticketendpunkt prüft dabei weiterhin seine eigenen Ticketberechtigungen; die Onboarding-API akzeptiert nur Tickets desselben Mandanten und protokolliert die Verknüpfung.

Die additive Migration 0090 legt Vorlagen, Vorlagenaufgaben, Eintrittsvorgänge, konkrete Aufgaben und Ausnahmeverknüpfungen an. Direktzugriffe für Browserrollen werden widerrufen; eine JWT-geschützte `onboarding`-Function prüft aktive Mandantenmitgliedschaft und die neuen Berechtigungen `onboarding.request` beziehungsweise `onboarding.manage` vor jeder Operation. Sie verwendet eine service-role-only Datenbankprozedur für atomare Anlage, Terminierung und Audit. Die Weboberfläche bleibt eine klare Arbeitsansicht mit Fortschritt, Fälligkeiten, Zuständigkeiten und Ausnahmeaktion.

## Wissensdatenbank: Volltextsuche

Die Wissensdatenbank erhält eine serverseitige PostgreSQL-Volltextsuche. Ein GIN-Index auf den Inhalten der Artikelrevisionen durchsucht Zusammenfassungen und Markdown-Inhalte; ein separater gewichteter Titelindex priorisiert passende Artikeltitel. Der Edge-Endpunkt bestimmt den zulässigen Suchumfang weiterhin vor der Datenbankabfrage. Interne Personen durchsuchen die aktuelle Revision, externe Personen ausschliesslich die bereits veröffentlichte Revision sowie ausschliesslich die für ihre Kundenorganisation zulässigen Artikel. Die Browseroberfläche behält das bestehende Suchformular bei, benennt es jedoch klar als Volltextsuche und zeigt Ergebnisse in Relevanzreihenfolge.

## Globale zugriffsgesicherte Volltextsuche

Das Suchfeld in der Kopfzeile wird zur globalen Volltextsuche des aktiven Mandanten. Sie durchsucht Tickets, die persönlichen Wiedervorlagen, zugängliche Wissensartikel, Veranstaltungsräume und Eintritte. Jede Abfrage ist serverseitig auf die aktive Mandantenmitgliedschaft, die bestehende Fachberechtigung und die einschlägigen Funktionsschalter begrenzt; die Ergebnisantwort enthält nur einen minimalen Navigationsvertrag ohne Rohbeschreibungen, Aufgabenlisten oder interne Detaildaten. Wissen respektiert weiterhin interne/externe Revisionen und aktive Kundenorganisationen, Wiedervorlagen bleiben ausschliesslich persönlich sichtbar. Veranstaltungsräume werden bewusst auf das im Planungsbereich navigierbare Zeitfenster begrenzt.

Treffer werden nach Relevanz gruppiert angezeigt und per Tastatur oder Klick geöffnet. Tickets öffnen direkt den Ticketkontext. Wissensartikel laden den Artikel, Eintritte und persönliche Wiedervorlagen laden den gezielt gefundenen, weiterhin berechtigten Eintrag zusätzlich zur Arbeitsliste nach, und Raumaufträge laden innerhalb des Planungsjahres kontrolliert weitere Seiten bis zum Treffer nach. Die Suche legt keine Daten an, startet keine Hintergrundabläufe und aktiviert keine Integrationen.

Die nachgelagerten Zielansichten halten dieselben Zugriffsgrenzen ein: Der Veranstaltungsräume-Arbeitsbereich verweigert jede Liste ohne `event.spaces.request` oder `event.spaces.manage`. Ein Eintritt bleibt für Ersteller:in, Führungsperson und ICT-verantwortliche Person sichtbar, auch wenn diese Beteiligten keine Verwaltungsrolle haben. Verknüpfte Ausnahme-Tickets werden nur nach einer erneuten, benutzergebundenen Ticketleseprüfung angenommen und angezeigt.

## Ticketbereich: Volltextsuche und Listenfilter

Die globale Kopfsuche bleibt unverändert als mandantenweite Navigation bestehen. Im Bereich «Tickets» wird zusätzlich direkt oberhalb der vorhandenen Auswahlfelder eine eigene Ticket-Suche angezeigt. Sie durchsucht ausschliesslich Tickets, nicht Wissen, Wiedervorlagen oder andere Module. Die Suche kombiniert die Volltextbegriffe mit den vorhandenen Auswahlfiltern für zuständige Person, Status, Ticketabteilung, Priorität sowie der bestehenden Sortierung; eine Suche erweitert dabei niemals die bereits berechtigte Ticketmenge.

Die globale Suche hat bereits einen gewichteten deutschen GIN-Volltextindex über Ticketnummer, Betreff und Beschreibung angelegt. Eine additive Datenbankmigration stellt die bestehende sicherheitsdefinierte Listen-RPC auf genau diesen Index um; `can_read_ticket`, aktive Mandantenbindung, Auswahlfilter, Queue, Kennzahlenfilter und Sortierung bleiben innerhalb derselben Abfrage wirksam. Der Webclient übergibt Freitext nur an diese serverseitige Listen-RPC. Leere oder zu kurze Begriffe führen keine Volltextfilterung aus; Fehler werden verständlich gezeigt. Es gibt keine Mutation, keinen Scheduler und keine neue Integration.

Die Umsetzung ergänzt `supabase/migrations/0093_ticket_fulltext_filter_search.sql`, die Such- und Filterverdrahtung in `apps/web/src/App.tsx` sowie gezielte Datenbank- und Webregressionen. Das vorhandene `ticket-search`-Modul bleibt für die Filtersyntax zuständig; die Datenbank wendet sämtliche Such-, Auswahl- und Sortierkriterien vor der Pagination an.

## Kontextabhängige Ansichtssteuerung

Der Button «Ansicht» ist kein allgemeines Einstellungsmenü. Er erscheint nur in Bereichen, in denen mindestens eine angebotene Option die aktive Seite unmittelbar verändert. Im Ticketbereich zeigt er ausschliesslich die listenbezogenen Optionen für Dichte sowie die nur bei aktivem Ticketdetail wirksame Listen-Detail-Ansicht. Globale persönliche Einstellungen wie Farbschema, Kontrast, Bewegungsreduktion und Startseite bleiben in den persönlichen Einstellungen und erscheinen nicht im seitenbezogenen Ansichtsmenü. Auf Seiten ohne eine wirksame Ansichtseinstellung wird der Button ausgeblendet.
