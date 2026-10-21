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

## Zentrales Erfassungsmenü

Der bisherige breite Header-Button «Ticket erfassen» wird auf allen Arbeitsseiten durch einen kompakten Plus-Auslöser ersetzt. Er öffnet ein zugängliches Menü mit Ticket, Fall, Wiedervorlage und Wissensartikel. Jede Auswahl schliesst das Menü, wechselt direkt in den passenden bereits berechtigten Bereich und öffnet dessen bestehendes Erfassungsformular. Die neue Steuerung nutzt keine zusätzlichen Datenendpunkte und umgeht keine Berechtigung oder Funktionsfreigabe: Fall-, Wiedervorlagen- und Wissensartikelaktionen erscheinen nur, wenn der zugehörige Bereich im aktuellen Kontext verfügbar ist.

## Navigation für reine Anfragende

Für Personen ohne Ticketarbeitsberechtigung wird die sichtbare und clientseitig erreichbare Arbeitsnavigation auf «Übersicht», «Tickets» und – bei aktivierter Portal-Funktion – «Mein Portal» begrenzt. Direkte Zustandswechsel in andere Arbeitsbereiche fallen kontrolliert auf die Übersicht zurück; dies ergänzt die bestehenden serverseitigen Zugriffsprüfungen und ersetzt sie nicht. «Mein Portal» verlässt die Hauptnavigation und erscheint im unteren, bereits durch eine Trennlinie abgegrenzten Benutzerbereich unmittelbar oberhalb des Namens. Für berechtigte Agent:innen bleibt das übrige Arbeitsmenü unverändert; ihr gegebenenfalls verfügbares «Mein Portal» folgt derselben konsistenten unteren Platzierung.

## Kategoriefreie Wissensoberfläche

Die Wissensdatenbank zeigt keine Kategorien oder Unterkategorien mehr: weder auf Artikelkarten, in der Detailansicht und Vorschau noch im Artikel-Editor. Die Schaltfläche und das Formular zur Kategorienverwaltung entfallen ebenfalls. Bestehende Zuordnungen und Kategorien bleiben unverändert in der Datenbank erhalten, werden bei künftigen Artikelbearbeitungen weiterhin ohne Änderung mitgeführt und werden nicht gelöscht. Diese reine Weboberflächenbereinigung benötigt keine Datenbankmigration, keine Function-Änderung und keine neue Funktionsaktivierung.

## Dialogbasierter Wissenseditor

Das Anlegen und Bearbeiten eines Wissensartikels öffnet den bestehenden Editor nicht mehr unterhalb der Artikelliste. Stattdessen erscheint er als fokussierter, viewport-fester Dialog über der Wissensdatenbank. Titel, Sichtbarkeit, Markdown-Eingabe, Live-Vorschau und Speichern bleiben unverändert verfügbar; nur innerhalb des Dialogs wird bei langem Inhalt gescrollt. Der Dialog fokussiert beim Öffnen den Titel, lässt sich kontrolliert über eine sichtbare Schaltfläche oder Escape schliessen und hält die Tastaturnavigation innerhalb des Dialogs. Es werden keine Datenmodelle, Berechtigungen oder Speicherabläufe verändert.

## Wiedervorlagen im Arbeitsplatz

Wiedervorlagen werden nicht mehr als eigener Eintrag in der Hauptnavigation geführt. Sie werden als eigener Registerbereich «Wiedervorlagen» im Arbeitsplatz angezeigt und verwenden dabei unverändert den bestehenden, mandantengebundenen Daten- und Speicherpfad.

Direkte Zugänge aus «Mein Tag», der globalen Suche und dem zentralen Plus-Menü navigieren in den Arbeitsplatz und öffnen dort gezielt den Registerbereich «Wiedervorlagen». Bestehende persönliche Startseiten, die noch auf «Wiedervorlagen» zeigen, werden beim Laden sicher auf «Arbeitsplatz» umgestellt. Der Arbeitsplatz bleibt erreichbar, sofern mindestens Agentenwerkbank oder Wiedervorlagen für den Mandanten freigegeben ist; ohne Agentenwerkbank zeigt er ausschliesslich den Wiedervorlagenbereich.

### Autorisierte Startnavigation und Wiedervorlagenzugriff

Gespeicherte Startansichten werden erst nach abgeschlossener Sitzungs-, Mandanten-, Ticketarbeits- und Funktionsprüfung angewendet. Eine frühere Startansicht «Wiedervorlagen» wird strukturiert zu «Arbeitsplatz» plus Registerziel «Wiedervorlagen» migriert; beim bewussten Ändern der Startansicht entfällt dieses Altziel. Dadurch kann ein anfänglicher Standardwert während des Ladens keinen geschützten Arbeitsbereich verdrängen.

Wiedervorlagen bleiben persönliche Agentenarbeit: Die gemeinsame Datenbankfunktion `can_work_tickets_in_tenant` prüft eine aktive Mandantenmitgliedschaft und mindestens eine effektive Ticketarbeitsberechtigung. Die Experience-Hub-Function verlangt sie für Listen, Erstellen und Erledigen; RLS sperrt direkte Lese- und Schreibzugriffe, und die globale Suchfunktion liefert Wiedervorlagen nur nach derselben Prüfung. Reine Anfragende behalten weder einen navigierbaren noch einen API-/Suchzugriff auf Wiedervorlagen.

## CORS-korrigierter Eintritte-Zugriff

Die Onboarding-Function verarbeitet Browser-CORS bewusst vor der `withSupabase`-Hülle und behält für jede Nicht-OPTIONS-Anfrage die vorhandene Benutzerprüfung, aktive Mandantenmitgliedschaft und rollenbasierte Onboarding-Prüfung. Damit ein Browser die geschützte POST-Anfrage erst zustellen kann, wird nur die vorgeschaltete Gateway-JWT-Prüfung für diese Function deaktiviert. Der äussere Function-Einstieg beantwortet ausschliesslich `OPTIONS` anonym mit dem auf `https://app.nextdesk.ch` beschränkten CORS-Vertrag; er weist andere Methoden sowie POST ohne `Authorization` ab. Jede verbleibende POST-Anfrage durchläuft anschliessend zwingend die kryptografische Benutzer- und Mandantenprüfung in `withSupabase`.

## Arbeitsplatz vor Übersicht

«Arbeitsplatz» wird für berechtigte Agent:innen als erster verfügbarer Arbeitsbereich oberhalb von «Übersicht» angezeigt. Die bestehende Feature- und Rechtefilterung bleibt danach unverändert wirksam: Ist der Arbeitsplatz nicht freigegeben, beginnt die Navigation weiterhin bei «Übersicht»; reine Anfragende behalten ausschliesslich ihre zugelassenen Bereiche.

## Manuelle Claude-Aufbereitung für Wissensartikel

Der Wissenseditor erhält eine separate Rohinhalt-Eingabe und die Aktion «Mit KI aufbereiten». Ein bewusster Klick übermittelt ausschliesslich den begrenzten aktuellen Rohinhalt an Anthropic und erhält einen strukturierten Vorschlag aus Titel und Markdown zurück. Der Vorschlag wird ausschliesslich in den weiter editierbaren Dialog eingesetzt: Er speichert keinen Artikel, verändert Sichtbarkeit oder Status nicht und startet weder Review noch Veröffentlichung. Das bestehende Markdown-Design bleibt die einzige Darstellungslogik für interne und externe Artikel.

Die serverseitige `ai-assist`-Function bleibt JWT-geschützt und verlangt aktive Mandantenmitgliedschaft, `knowledge.manage`, das Funktionsflag `ai.assist` sowie eine aktuelle, explizite Anthropic-Freigabe pro Mandant. Die Freigabe wird nur für den Zweck Wissensentwurf konfiguriert und hat eine getrennte ausdrückliche Zustimmung für externe Artikelinhalte. Jeder Aufruf reserviert nur datensparsame Governance-Metadaten, erzwingt Limits und schreibt kein Rohmaterial, keinen Prompt und keinen Entwurf in Datenbank oder Audit. Bei bestehenden Artikeln liest die atomare Queue die aktuelle Sichtbarkeit mandantengebunden aus der Datenbank und sperrt externe Inhalte ohne explizite Freigabe; ein Browserwert kann diese Regel nicht umgehen. API-Schlüssel und Modell bleiben ausschliesslich serverseitige Secrets; fehlen sie, verweigert die Function den Aufruf fail-closed.

## Unaufdringliche Team-Warteschlangen

Der Arbeitsplatz blendet den vollständigen Bereich «Team-Warteschlangen» aus, wenn der aktive Mandant keine solchen Warteschlangen anbietet. Während des Ladens und bei verfügbaren Daten bleibt die bestehende Rückmeldung erhalten. Dadurch wird kein nicht bedienbarer Leerzustand als Arbeitsinhalt angezeigt; Datenzugriff, Mandantentrennung und Fehlerbehandlung des bestehenden API-Aufrufs bleiben unverändert.

## Unaufdringliche Abteilungsrückfragen

Die Einstellungen blenden die vollständige Konfiguration «Abteilungsleitungen» aus, wenn Abteilungsrückfragen für den aktiven Mandanten nicht erreichbar sind. Während des Ladens und bei verfügbaren Routen bleibt die bestehende Bedienoberfläche einschliesslich Aktualisieren erhalten. Damit bleibt die Abteilungsverwaltung ohne nicht bedienbare Fehlerfläche übersichtlich; Datenzugriff, Mandantentrennung und der bestehende serverseitige Berechtigungspfad bleiben unverändert.

## Personenorientierte Rollenverwaltung

Die administrativ geschützte Seite «Rollen» wird als verständliche Zugriffsverwaltung neu geordnet. Sie beginnt mit einer kompakten Zusammenfassung und der primären Handlung «Zugriff vergeben». Danach folgt eine personenorientierte Übersicht mit Rollenbezeichnungen und einer leicht erreichbaren Entzugsaktion; technische Berechtigungscodes werden nicht mehr als primäre Information gezeigt.

Die Rollenübersicht bleibt vollständig funktionsfähig, trennt jedoch geschützte Systemrollen klar von eigenen Rollen, zeigt Status und Anzahl Berechtigungen in lesbaren Kennzahlen und hält Detailberechtigungen auf Anforderung in gruppierten, fachlich benannten Bereichen bereit. Das Erstellen und Bearbeiten eigener Rollen fasst Berechtigungen nach Fachbereich zusammen und verwendet die vorhandenen serverseitigen Aktionen unverändert. Datenmodell, Mandantentrennung, Berechtigungschecks sowie der Schutz von Systemrollen bleiben unverändert.

### Gestaltung

- **Design Movement:** Ruhige Verwaltungsoberfläche nach dem Prinzip «Person zuerst, Rechte danach».
- **Core Principles:** klare Handlungspriorität, progressive Offenlegung technischer Details, sichere bestätigte Änderungen und konsistente mobile Lesbarkeit.
- **Color Philosophy:** bestehende nextDesk-Akzentfarbe für primäre Zugriffsaktionen, zurückhaltende Oberflächen für Übersicht und dezente Statussignale statt warnender Techniklisten.
- **Layout Paradigm:** vertikaler Arbeitsfluss aus Zugriffsvergabe, Personenübersicht und Rollenbibliothek; Detailrechte öffnen sich nur im jeweiligen Kontext.
- **Signature Elements:** kompakte Kennzahlen, Rollen-Chips und fachlich gruppierte Berechtigungsabschnitte.
- **Interaction Philosophy:** eine Mandantenadministration vergibt und entzieht Zugriffe direkt bei nachvollziehbaren Personen und Rollen; sensible technische Informationen bleiben erreichbar, aber nicht dominant.
- **Animation:** vorhandene reduzierte Übergänge werden beibehalten; keine neuen dauerhaften Animationen.
- **Typography System:** bestehende nextDesk-Sans-Serife mit klarer Hierarchie aus Abschnittstiteln, Kurzbeschreibungen und kleinen Metadaten.
- **Brand Essence:** nextDesk macht Zugriffsverwaltung für Mandantenadministrationen verständlich, ohne die Sicherheitslogik zu vereinfachen.
- **Brand Voice:** klar und handlungsorientiert, etwa «Zugriff vergeben» und «Zeigt, wer welche Rolle im Mandanten hat.»
- **Wordmark & Logo:** unverändert.
- **Signature Brand Color:** die bestehende primäre nextDesk-Farbe bleibt der eindeutige Handlungsakzent.

## Vollständige Ticketformularvorschau

Der Formular-Editor zeigt in seiner Vorschau immer zuerst den vollständigen Aufbau der Ticketerfassung: anfragende Person, Betreff, Einordnung mit Abteilung, Priorität und optionaler Kategorie sowie Beschreibung. Felder, die der Composer nur bei passenden Daten oder nach einer Auswahl zeigt, sind als situationsabhängig markiert. Die Zusatzfelder erscheinen anschliessend in ihren konfigurierten Abschnitten und Reihenfolgen. Damit bildet die Ansicht auch ohne angelegte Zusatzfelder das tatsächliche Formular ab. Die Vorschau bleibt rein visuell und löst keine Speicherung, Ticketanlage, Rechteprüfung oder Datenabfrage aus.

## Drag-and-Drop-Konfigurator für Ticketfelder

Der Bereich **Einstellungen → Ticketfelder** wird zu einer dreispaltigen, modernen Arbeitsfläche: Eine linke Feldpalette bietet ausschliesslich ticketrelevante Feldtypen und praxisnahe Voreinstellungen wie Gerät-/Inventarnummer, Standort / Raum, gewünschter Termin, betroffene Personen und Rückrufwunsch. Die zentrale Formularfläche zeigt feste Standardfelder schreibgeschützt und verwaltet frei konfigurierbare Abschnitte mit sichtbaren Ablagezonen. Neue Felder können per Klick in den ersten verfügbaren Abschnitt eingefügt oder aus der Palette gezielt in eine Ablagezone gezogen werden; bestehende Felder bleiben zwischen Abschnitten per Drag-and-Drop oder über die vorhandenen Tastaturalternativen verschiebbar.

Beim Ablegen wird eine sinnvolle, eindeutig technische Ausgangskonfiguration angelegt und direkt im kompakten Feldinspektor geöffnet. Mandantenadministrationen können Bezeichnung, Pflichtstatus, Auswahloptionen und Abschnitt anpassen oder ein Feld entfernen. Die feste Ticketbasis – anfragende Person, Betreff, Zuordnung, Priorität und Beschreibung – bleibt sichtbar, aber nicht veränderbar. Die Live-Vorschau zeigt die Formularreihenfolge einschliesslich der konfigurierten Felder. Die Umsetzung erweitert die bestehende, mandantenautorisierte `ticket-custom-fields`-API um atomare Paletteneinfügungen und versionsgebundene Layoutmutationen. Migration 0096 bereinigt aktive und archivierte Positionen ohne Feldwerte oder Archivdaten zu löschen; Rechte und Mandantentrennung bleiben unverändert.

### Gestaltung

- **Design Movement:** ruhiger Baukasten für professionelle Serviceformulare, angelehnt an moderne Form Builder ohne visuelle Überladung.
- **Core Principles:** direkte Manipulation, sichtbare Auswirkung, klare Trennung zwischen festen und konfigurierbaren Feldern sowie vollständige Tastaturalternative.
- **Color Philosophy:** die bestehende nextDesk-Akzentfarbe markiert Einfügeaktionen und aktive Ablagezonen, neutrale Karten schützen die Lesbarkeit der Formularstruktur.
- **Layout Paradigm:** Feldpalette links, konfigurierbarer Formularfluss in der Mitte und sticky Live-Vorschau rechts; auf schmalen Ansichten folgt alles als klarer vertikaler Ablauf.
- **Signature Elements:** kompakte Feldkarten mit Typ-Symbol, markierte Drop-Zonen und ein kontextbezogener Feldinspektor.
- **Interaction Philosophy:** Ziehen ordnet unmittelbar ein; Klick fügt gleichwertig und zugänglich hinzu; Pfeiltasten bleiben für präzise Reihenfolgen verfügbar.
- **Animation:** kurze, reduzierte Fokus- und Ablagezustände; keine dauerhaften oder rein dekorativen Bewegungen.
- **Typography System:** bestehende nextDesk-Typografie mit klaren, kleinen Kategorie-Labels und prägnanten Feldbezeichnungen.
- **Brand Essence:** nextDesk macht Ticketformulare präzise konfigurierbar, ohne die feste Servicebasis zu gefährden.
- **Brand Voice:** handlungsorientiert und konkret: «Feld in den Abschnitt ziehen» und «Diese Basisfelder sind immer Teil eines Tickets.»
- **Wordmark & Logo:** unverändert.
- **Signature Brand Color:** die bestehende nextDesk-Primärfarbe bleibt der Einfüge- und Fokusakzent.

### Projektstruktur

- `apps/web/src/lib/ticket-form-builder-presets.ts`: testbare Palette, ticketrelevante Voreinstellungen und konfliktfreie technische Schlüssel.
- `apps/web/src/ticket-custom-fields-admin.tsx`: Palette, Ablagepfade, Feldinspektor, bestehende mandantenautorisierte Mutationen und Live-Vorschau.
- `apps/web/src/styles.css`: responsive dreispaltige Builder-Arbeitsfläche, sichtbare Drop-Zonen und kompakter Inspektor.

## Positionssichere Feldplatzierung

Der Formular-Konfigurator verwendet eine serverseitig atomare Positionsregel: Alle sichtbaren, aktiven Ticketfelder werden innerhalb eines Abschnitts lückenlos geordnet; archivierte Felder folgen danach und verändern keine sichtbare Zielposition. Die mandantenautorisierte Move-RPC prüft weiterhin Layoutversion, Mandant, Abschnitt und Bearbeitungsrecht und lehnt archivierte Felder ab. Bestehende Layouts werden mit Migration 0096 einmalig in dieses Modell überführt.

Die Feldpalette erstellt und platziert ein Feld in einem einzigen serverseitigen Befehl. Wenn Abschnitt, Position oder Layoutversion nicht gültig sind, wird weder eine Definition noch ein Audit- oder Versionsschritt dauerhaft angelegt. Nach einer unterbrochenen Antwort lädt nextDesk das Layout erneut und erkennt das eindeutig angelegte Feld anhand seines eindeutigen Schlüssels; es entsteht keine unplatzierte Zwischenstufe.

Auch Erstellen, Reaktivieren und Archivieren verwenden dieselbe Layoutversion wie Drag-and-Drop. Eine Migration sperrt jeden betroffenen Mandanten beim einmaligen Repack, stellt aktive Positionen vor archivierte Positionen und erhöht danach die Version. Bereits geöffnete Editoransichten müssen damit bewusst neu laden, statt mit alter Positionssemantik zu speichern.

## KI-Governance-Antworthülle

Die KI-Governance-Oberfläche liest die erfolgreiche Antwort von `ai-assist` ausschliesslich über deren validierte `{ data: { approval } }`-Hülle. Dadurch wird eine gültige, JWT-geschützte Antwort nicht mehr als nicht verfügbare Governance fehlinterpretiert. Die Änderung betrifft nur die clientseitige Antwortvalidierung; keine Freigabe, Funktion, Sichtbarkeit oder Anbieterübermittlung wird dabei automatisch geändert.

## Atomare Ticketfeldbearbeitung und KI-Entwurfsdiagnose

Ein bestehendes Ticketzusatzfeld wird bei einer Abschnittsänderung über genau einen versionierten Serverbefehl aktualisiert und umplatziert. Damit sind Bezeichnung, Pflichtstatus, Auswahloptionen und Abschnitt entweder gemeinsam sichtbar oder bei einem Versionskonflikt vollständig unverändert. Mehrdeutige Client-Recovery wird entfernt: Ein bestätigter Konflikt oder Validierungsfehler bleibt sichtbar und wird nie als erfolgreiche, möglicherweise fremde Anlage ausgegeben.

Die KI-Aufbereitung wird anhand ausschliesslich technischer Auditmetadaten untersucht. Rohinhalte, Providerantworten und Zugangsdaten werden weder gelesen noch protokolliert. Eine Korrektur folgt nur für einen nachgewiesenen lokalen Vertrags- oder Konfigurationsfehler; ein Testaufruf an Anthropic erfolgt nicht automatisch.

## Atomare Ticketfeldbearbeitung und KI-Bereitschaft

Ein bestehendes Ticketzusatzfeld wird bei einem Abschnittswechsel nicht mehr zuerst separat gespeichert und danach verschoben. Der serverseitige Befehl aktualisiert Definition und Zielposition innerhalb einer Datenbanktransaktion, jeweils mit derselben mandantenlokalen Layoutversion. Bei einem Versionskonflikt bleibt weder eine veränderte Definition noch eine verschobene Platzierung zurück. Die Weboberfläche verwendet diesen Befehl ausschliesslich bei einem Abschnittswechsel; neue Felder und Reihenfolgen bleiben ebenfalls versioniert und atomar.

Die KI-Governance zeigt zusätzlich zur fachlichen Freigabe einen nicht sensitiven Bereitschaftsstatus der serverseitigen Anthropic-Anbindung. Schlüssel, Modellname und Artikelinhalt bleiben dabei verborgen. Die Wissensdatenbank übernimmt sichere Function-Meldungen unverändert, damit eine unvollständige Serverkonfiguration nicht als allgemeine Störung erscheint. Vor dem Providerkontakt werden weiterhin weder Rohinhalte noch Entwürfe gespeichert oder protokolliert.

## Fokus-stabile Sitzung

Ein Fensterfokus darf den nextDesk-Arbeitsbereich nicht erneut aufbauen. Supabase kann für dieselbe angemeldete Person beim Zurückkehren in ein Browserfenster ein `SIGNED_IN`- oder `TOKEN_REFRESHED`-Ereignis auslösen. Diese gleichbleibenden Ereignisse aktualisieren nur die interne Sitzungsreferenz und behalten Mandant, Navigationszustand sowie geladene Daten bei. Ein vollständiger Kontextreset bleibt auf die erstmalige Sitzung, eine echte Abmeldung und einen Wechsel der Benutzer-ID beschränkt.

## Arbeitsplatz oberhalb von Arbeitsbereich

Der verfügbare Arbeitsplatz steht als eigener primärer Navigationspunkt direkt unter der Mandantenmarke. Die Überschrift «Arbeitsbereich» und alle weiteren berechtigten Bereiche folgen erst darunter. Für Personen oder Mandanten ohne Arbeitsplatzfreigabe bleibt dieser zusätzliche Punkt vollständig verborgen; «Arbeitsplatz» wird nicht doppelt gerendert.

## Kontrollierter manueller Intune-Assetabgleich

nextDesk ergänzt den bestehenden lokalen, providerfreien Preflight um einen bewusst ausgelösten Microsoft-Intune-Abgleich. Der Abgleich ist ausschliesslich lesend gegenüber Microsoft Graph und hat keinen Scheduler, Worker, Webhook oder automatischen Retry. Eine Person mit `asset.integration.manage` startet jeden Lauf einzeln und bestätigt vor einer übernehmenden Synchronisation sichtbar, welche technischen Gerätedaten verarbeitet werden. Microsoft Graph erhält ausschliesslich `GET`-Anfragen; kein Intune-Gerät wird durch nextDesk verändert, zurückgesetzt, gelöscht oder stillgelegt.

Jeder Mandant bleibt strikt an seine bereits serverseitig aus der Azure-SSO-Konfiguration abgeleitete Entra-Mandanten-ID gebunden. Der neue Graph-Client verwendet eine eigene mehrmandantenfähige App-Registrierung mit der minimalen **Anwendungsberechtigung** `DeviceManagementManagedDevices.Read.All`. Die bestehenden `ENTRA_DIRECTORY_CLIENT_*`-Credentials des Personenabgleichs werden nicht wiederverwendet. Client-ID und Secret liegen ausschliesslich als neue Supabase-Edge-Function-Secrets vor; Token, Tenant-IDs, Provider-IDs, vollständige Providerantworten und Providerfehler gelangen nie in Browser, Mobile, Audit oder Logs.

Ein Lauf ruft nur `id`, Gerätename, Seriennummer, Hersteller, Modell, Betriebssystem/-version, Compliance-, Verschlüsselungs- und Zeitstatus ab. Benutzer-, Mail-, UPN-, Telefon-, IMEI-, MAC-, SIM-, UDID-, Remote-Assistance- und Health-Attestation-Daten werden weder angefragt noch gespeichert. Vor Tokenbezug und unmittelbar vor jedem einzelnen Graph-GET wird der serverseitige Lauf-Fence erneut geprüft. Die Seiten werden strikt auf die erwartete Microsoft-Graph-Herkunft, den `managedDevices`-Pfad, GET und begrenzte Seitenzahl geprüft. Alle Ergebnisse landen zunächst als minimale, service-role-only Staging-Projektion. Der Commit hält SSO-, Mitgliedschafts-, Rollen-, Berechtigungs- und Feature-Zustand für die gesamte Übernahmetransaktion fest; erst ein vollständig gelesener und weiterhin gültiger Lauf übernimmt die Datensätze atomar.

Die bestehende private Verknüpfung über `asset_intune_asset_links` bleibt die alleinige Grundlage für Aktualisierungen. Genau eine passende Provider-ID darf nur reduzierte technische Aggregatfelder des verknüpften Assets aktualisieren. Mehrdeutige oder mandantenfremde Links werden gezählt und nie beliebig aufgelöst. Für bisher nicht verknüpfte Geräte kann der bewusst bestätigte Sync ein neues nextDesk-Asset mit technischen Inventardaten anlegen, sofern kein bestehendes Asset dieselbe Seriennummer hat; bei einer Seriennummernkollision wird weder verknüpft noch überschrieben. Nicht mehr in Intune gelistete Geräte führen nie zu Löschung, Deaktivierung, Lifecycle-Änderung oder Entkopplung eines Assets.

Eine additive Migration führt private Run- und Staging-Relationen, Generation-/Lease-Fencing, Idempotenz je Client-Request-ID, maximal zwei explizite manuelle Wiederholungen sowie Ergebniszähler für empfangene, aktualisierte, neu angelegte, übersprungene und mehrdeutige Geräte ein. Die Datenbank-RPCs prüfen bei jedem Start, unmittelbar vor jeder Providerseite, jedem Staging-Batch und Commit erneut aktive Mitgliedschaft, `assets.management`, `asset.integration.manage`, SSO-Bindung, Konfigurationsgeneration und Lease. Ein abgelaufener Lauf wird beim nächsten bewussten Start als `run_expired` abgeschlossen und seine private Staging-Projektion wird gelöscht, bevor ein neuer Lauf beansprucht werden kann. Der alte Schalter `sync_enabled` bleibt deaktiviert; die neue manuelle Freigabe ist getrennt und aktiviert keine Hintergrundausführung.

Die Einstellungsoberfläche zeigt weiterhin den lokalen Preflight sowie eine klar getrennte Sektion «Manueller Microsoft-Graph-Abgleich». Sie informiert über den notwendigen Microsoft-Admin-Consent, bietet eine datensparsame Vorschau und eine zweite bewusste Synchronisationsbestätigung, zeigt nur aggregierte Laufresultate und ermöglicht eine begrenzte manuelle Wiederholung. Die native Assetansicht bleibt bei den bisherigen reduzierten Compliance-, Verschlüsselungs- und Zeitaggregaten.

### Projektstruktur

- `supabase/migrations/0098_intune_manual_asset_sync.sql`: private Staging-/Run-Relationen, harte Grants/RLS, Generation-/Lease-Fences, transaktionale Start-/Stage-/Commit-/Fail-RPCs und Audit.
- `supabase/functions/_shared/intune-managed-devices-graph.ts`: separater, testbarer Client-Credentials- und Graph-Paging-Adapter mit Feld-/Origin-Allowlist.
- `supabase/functions/intune-asset-sync/`: JWT-geschützter manueller Provider-Endpunkt für Dry-Run und bestätigte Übernahme.
- `supabase/functions/asset-registry/`: ausschliesslich serverautorisierte Konfigurations- und redigierte History-Aktionen.
- `apps/web/src/asset-intune-settings.tsx`: klare Freigabe, Bestätigungsdialog, aggregierte Live-Run-Historie und verständliche Fehlermeldungen.
- `docs/deployment/` und `docs/operations/`: Microsoft-Admin-Consent, Secretnamen, Datenvertrag, manueller Ablauf und Rücknahme.

## Intune Graph: sichere OData-Continuation

Die erste datensparsame Intune-Vorschau kann eine von Microsoft Graph gelieferte vollständige `@odata.nextLink`-URL erhalten, welche die ursprünglichen OData-Parameter `$top` und `$select` zusätzlich zum `$skiptoken` fortführt. Der Server akzeptiert weiterhin ausschliesslich HTTPS-URLs auf `graph.microsoft.com` für exakt `/v1.0/deviceManagement/managedDevices`. Für Fortsetzungen sind einmalig und zwingend nur `$skiptoken`, `$top` (1–100) und `$select` mit der unveränderten, bereits freigegebenen Minimalprojektion zulässig. Fremde Origins, Pfade, Query-Parameter, leere Tokens und abweichende Feldprojektionen werden weiterhin fail-closed abgelehnt. Der Hotfix liest keine zusätzlichen Felder, ändert keine Schreibrechte und startet keinen automatischen Abgleich.

## Sichtbare Assetbearbeitung nach Intune-Import

Bei umfangreichen Assetlisten darf die Aktion «Bearbeiten» nicht nur ein ausserhalb des sichtbaren Bereichs liegendes Inline-Formular befüllen. Die Assetverwaltung verwendet deshalb für Anlage und Bearbeitung einen viewport-festen, zugänglichen Dialog. Ein Klick auf «Bearbeiten» übernimmt nur die bereits sichtbaren, mandantenautorisierten Assetdaten in den Entwurf, setzt den Fokus auf das Namensfeld und öffnet den Dialog. Speichern, Abbrechen, Klick ausserhalb und Escape schliessen den Dialog kontrolliert; die Tastaturnavigation bleibt im Dialog. Speichern verwendet unverändert den bestehenden JWT-geschützten `service-assets`-Vertrag mit `asset.manage`. Es werden keine Berechtigungen, Datenmodelle oder Intune-Daten verändert.

## Datensparsame Intune-Primärperson

Der manuelle Intune-Abgleich liest zusätzlich ausschliesslich `managedDevice.userId`, die von Microsoft Graph dokumentierte unveränderliche Kennung der einem Gerät zugeordneten Person. Weder UPN noch E-Mail, Anzeigename oder weitere Personenattribute werden aus Intune abgefragt oder gespeichert. Die Kennung wird nur im privaten, service-role-geschützten Laufstaging verarbeitet und am Ende desselben bestätigten Synchronisationslaufs gegen die bestehende, mandantengebundene Tabelle `tenant_entra_directory_people` aufgelöst.

Eine Auflösung ist nur möglich, wenn die Entra-Person im gleichen Mandanten aktiv ist. Persistiert wird dann ausschliesslich die relationale Verknüpfung `Asset ↔ Entra-Objekt-ID`; unaufgelöste, deaktivierte oder ungültige Graph-IDs erzeugen weder eine Zuweisung noch einen Fallback über E-Mail. Der Browser erhält für berechtigte Asset-Verwaltende nur den aktuellen Anzeigenamen der lokal verifizierten Verzeichnis-Person. Objekt-ID, UPN, E-Mail und rohe Graph-Antworten bleiben serverseitig. Die automatisch angezeigte Intune-Primärperson ist bewusst keine manuelle Ausleihe oder Ticket-Anfragendenzuordnung.

Die Erweiterung bleibt an den bestehenden, bewusst gestarteten `dry_run`-/`synchronize`-Ablauf gebunden. Sie führt keine Hintergrundsynchronisation ein und muss nach Produktivbereitstellung über einen neuen, expliziten manuellen Abgleich aktualisiert werden.

## Sichtbare Intune-Primärperson bei Assets

Die bereits serverseitig lokal aufgelöste, schreibgeschützte Intune-Primärperson wird in der Assetliste als kontrastreiche Identitätskarte dargestellt: Initialen, klare Bezeichnung «Primäre Person», vollständiger Anzeigename und die Quellenmarkierung «Intune» liegen in einer einzigen, gut scanbaren Zeile. Der Bearbeitungsdialog verwendet dieselbe Karte direkt unter dem Titel und erklärt knapp, dass die Zuordnung nur aus dem lokal verifizierten Entra-Verzeichnis stammt und nicht manuell verändert werden kann. Für Assets ohne verifizierte Zuordnung bleibt eine zurückhaltende Leeranzeige sichtbar. Leere Metadaten werden nicht gerendert; dadurch erscheinen keine leeren geschweiften Klammern. Es werden weder neue Felder abgefragt noch Berechtigungen, Synchronisationsabläufe oder Datenverträge verändert.

## Vertragsmodul

Das Vertragsmodul wird als eigenes, standardmässig deaktiviertes Mandantenfeature `contracts.management` umgesetzt. Es erhält einen linken Menüpunkt «Verträge» und eine separate, serverautorisiert geschützte Edge Function. Die Sichtbarkeit im Browser ist nur eine UX-Hilfe: Jeder Lese- und Schreibzugriff prüft weiterhin aktive Mandantenmitgliedschaft, das aktive Feature und die dedizierte Vertragsberechtigung.

Die Berechtigung `contracts.manage` ist bewusst auf zwei geschützte Systemrollen begrenzt: «Tenant administrator» und die neue Tenant-Rolle «Verträge». Die Rolle «Verträge» wird pro bestehendem und künftigem Mandanten systemseitig mit genau dieser Berechtigung angelegt, aber nie automatisch Personen zugewiesen. Sie kann in der Rollenverwaltung zugewiesen oder entzogen, jedoch nicht umbenannt, deaktiviert oder mit zusätzlichen Rechten verändert werden. So bleibt die fachliche Zugriffsvorgabe nachvollziehbar und erlaubt keine versehentliche Freigabe über beliebige Custom-Rollen.

Verträge enthalten in der ersten Ausbaustufe nur fachlich notwendige Metadaten: Bezeichnung, Gegenpartei, optionale Referenznummer, Kategorie, Status, Start-/Enddatum, Kündigungsfrist, verantwortliche Person und Notiz. Es werden keine Vertragsdateien, Kontaktadressen, Zahlungsdaten, automatischen Verlängerungen, Scheduler oder Benachrichtigungen eingeführt. Fälligkeiten und Kündigungstermine werden rein lokal aus Kalenderdaten berechnet und nicht persistent dupliziert. Archivieren ist terminal; Browserclients erhalten keine Löschmöglichkeit. Änderungen werden mit IDs und Statuswechseln auditiert, aber ohne Freitextinhalte in das Auditprotokoll zu kopieren.

Die Weboberfläche verwendet eine durchsuchbare Kartenliste mit Filtern für Status, Kategorie und Fälligkeit sowie einen zugänglichen Erfassungs- und Bearbeitungsdialog. Reine Anfragende und andere Agentenrollen erhalten dadurch keine weiteren Arbeitsbereiche; eine aktive Rolle «Verträge» darf ausschliesslich den neuen Bereich zusätzlich sehen.

## Vertragsmodul: Abschluss der Sicherheitsprüfung

Die Vertragsfunktion prüft die actor-gebundene Vertragsberechtigung vor jedem Lesen eines mandantenspezifischen Funktionsstatus. Dadurch kann weder eine fremde Mandanten-ID noch eine gültige, aber unberechtigte Mitgliedschaft einen Feature-Zustand offenlegen. Eine gleichnamige frühere benutzerdefinierte Rolle «Verträge» wird beim Upgrade in eine eindeutig benannte bestehende Rolle überführt, wobei ihre Zuweisungen und bisherigen Berechtigungen unverändert bleiben; erst danach wird die geschützte Systemrolle «Verträge» mit ausschliesslich `contracts.manage` angelegt. Der Rollen-Seed und die Edge-Regression sichern diese Reihenfolge zusätzlich ab.

## Persönliche Push-Zustellung und Vertragsfristen

Die vorhandene APNs-Grundlage wird additiv erweitert, ohne bestehende Ticket-Ereignisse oder deren inhaltliche Berechtigungsgrenzen aufzuweichen. Jede aktive Person steuert für den eigenen Mandanten einen serverautorisierten globalen Zustellschalter sowie den Modus jeder zulässigen Kategorie: «Sofort», «Zusammenfassung» oder «Aus». Der Geräteschalter bleibt bewusst separat: Er registriert nur dieses iPhone, während «Aus» für den Mandanten keine neue APNs-Zustellung an die Person zulässt. Ruhezeit, Zeitzone, Check-in und Arbeitsfenster bleiben serverseitige Zustellgrenzen; zurückgestellte Hinweise werden nicht still verworfen, sondern erst in einem späteren erlaubten Fenster erneut beansprucht.

Die neue Kategorie `contract_deadline` dient ausschliesslich neutralen Vertragsfristen. Eine tägliche, idempotente Datenbankfunktion materialisiert nur für aktive, nicht archivierte Verträge und deren aktuell aktive verantwortliche Person Ereignisse für 90/60, 30/14/7/1 Tage vor Ablauf sowie maximal einmal pro lokalem Kalendertag nach dem Ablauf. Weder der Scheduler noch Push-Trigger ändern einen Vertrag, erstellen Tickets oder schliessen Aufgaben. Vertragsnamen, Gegenparteien, Notizen und Fristdetails gelangen nicht in APNs-Payloads. Die Outbox wird typisiert ergänzt und prüft unmittelbar vor der Zustellung Feature, aktive Mitgliedschaft, persönliche Präferenz und die weiterhin gültige Vertragsverantwortung.

Die iOS-Einstellung zeigt die Dreifachauswahl pro serverseitig erlaubter Kategorie sowie den persönlichen Mandanten-Pause-Schalter. Die App fordert die iOS-Berechtigung weiterhin nur nach bewusster Aktivierung auf diesem iPhone an. Ein Vertrags-Push bleibt im sichtbaren Text neutral; ein Tap führt vorerst nur in einen sicheren nextDesk-Startkontext, bis eine separat autorisierte native Vertragsansicht existiert.

## Wissensdatenbank: Sichtbarkeits- und Entwurfsfilter

Die bestehende serverautorisierte Liste bleibt die alleinige Datenquelle. `knowledge-base.tsx` ergänzt darauf eine lokale, kombinierbare Listenauswahl für Intern, Extern, Entwurf und Alle Artikel. Sie filtert nur bereits autorisierte, nicht archivierte Artikel; bei einem Wechsel wird ein nicht mehr passender Detailartikel geschlossen. Eine neue Function, Datenbankabfrage oder Rechteableitung im Browser ist nicht erforderlich.

## Wissenseditor: Kategorien und Unterkategorien

Die vorhandenen mandantenisolierten `knowledge_collections` und ihre bereits auf eine Kategorie plus eine Unterkategorie begrenzte Parent-Hierarchie werden wieder im Wissenseditor verwendet. Die bestehende Wissens-Function liefert aktive Kategorien nur an berechtigte interne Lesende und verwaltet Anlage, Umbenennung sowie Artikelzuordnung weiterhin mit serverseitiger Membership- und `knowledge.manage`-Prüfung. Der Dialog wählt höchstens eine Kategorie und eine zugehörige Unterkategorie, speichert nur die relevante Zuordnung und kann sie bewusst entfernen. Anlage und Umbenennung erfolgen im selben zugänglichen Editorbereich; sie ändern nie Sichtbarkeit, Review oder Veröffentlichung eines Artikels. Browser erhalten weder versteckte Kategorien noch andere Mandantendaten und leiten keine Rechte selbst ab.

## Abteilungsteams und Ticketgrenzen

Teams gehören immer zu genau einer aktiven Abteilung. Mandantenadministrationen verwalten Teams mit aktiven Personen derselben Abteilung; die Mehrfachauswahl kann auch bisher nicht zugewiesene Personen aufnehmen, verleiht jedoch keine Rolle oder Abteilungsmitgliedschaft. Tickets können ein Team ihrer bereits gewählten Abteilung tragen. Bei einem Teamticket gilt die Teammitgliedschaft zusätzlich zu den bisherigen Ticketregeln für Agent:innen in Datenbank, RLS und allen serverseitigen Lese-, Such-, Mutations-, Export-, Reporting-, Push- und Benachrichtigungspfaden. Die bisherige persönliche Sicht der anfragenden, betroffenen oder berechtigten Kundenperson bleibt unverändert. Teamlose Tickets behalten ihren bisherigen Zugriff. Die Datenbank schützt Abteilungs- und Teamkonsistenz bei Teamwechseln, Archivierungen und beim Entzug einer Mitgliedschaft, ohne ticketunabhängige persönliche Wiedervorlagen offenzulegen oder zu löschen.

## Arbeitsplatz: Stellvertretung

Die Stellvertretung lädt die erlaubten Zielpersonen über eine eigene, JWT-geschützte Serveraktion. Diese gibt nur aktive Agenten desselben Mandanten zurück und validiert das Ziel beim Speichern nochmals serverseitig. Der Browser leitet aus einer Personenliste weder Berechtigungen noch Mitgliedschaften ab.

## Wissensdatenbank: Kategorien, Unterkategorien und Versionen in der Lesedarstellung

Die bestehende, serverautorisierte Artikelliste enthält die Artikelzuordnungen `collectionIds`; die bereits mandantengefencete Kategorienliste liefert dazu `id`, `name`, `parentId` und `active`. Die Weboberfläche löst diese beiden bereits geladenen Antworten ausschliesslich lokal für die Darstellung zusammen. Sie führt keine zusätzliche Kategorien- oder Artikelabfrage aus und leitet daraus keine Berechtigung, Sichtbarkeit oder Veröffentlichung ab.

Eine kleine reine Hilfslogik akzeptiert nur aktive, bekannte Kategorien. Sie zeigt eine Oberkategorie eigenständig oder eine Unterkategorie mit ihrer bekannten aktiven Oberkategorie im Format `Kategorie · Unterkategorie`. Unbekannte, inaktive oder strukturell ungültige Zuordnungen bleiben leer; Namen werden nie geraten. Die gleiche Hilfslogik bestimmt die sichtbare Versionsnummer: die vom Backend gelieferte Revision hat Vorrang, andernfalls fällt eine interne Darstellung auf die aktuelle und eine externe Darstellung nur auf die veröffentlichte Revision zurück.

Artikelkarten behalten Status und Sichtbarkeit bei und ergänzen eine kompakte Zeile `Version n` sowie eine sekundäre Ordnerzeile für die Kategoriehierarchie. Die Detailansicht setzt Sichtbarkeit, Version, Aktualisierung und Kategorien vor den Titel und den Markdown-Inhalt, analog zur iOS-Reihenfolge. Die bestehende nextDesk-Leseoberfläche erhält dafür nur scoped, responsive Stile mit Umbruchschutz für lange Kategorienamen; es gibt keine Datenbank-, Function-, Berechtigungs- oder Releaseänderung.

### Projektstruktur

- `apps/web/src/lib/knowledge-collection-presentation.ts`: reine, testbare und fehlertolerante Auflösung von sichtbaren Kategoriepfaden und der tatsächlich sichtbaren Revision.
- `apps/web/src/lib/knowledge-collection-presentation.test.ts`: Regressionen für Hierarchie, unbekannte oder inaktive IDs sowie interne und externe Versionsrückfälle.
- `apps/web/src/knowledge-base.tsx`: Verwendung der bereits autorisiert geladenen Artikelliste und Kategorien in Karten und Detailansicht.
- `apps/web/src/styles.css`: scoped Metadaten- und Ordnerzeilen für Karten und Detailansicht.

## Wissensdatenbank: Filter für Kategorie und Unterkategorie

Die bestehende Wissensliste erhält neben Sichtbarkeit und Status zwei zugängliche Auswahllisten für Kategorie und Unterkategorie. Beide Listen verwenden ausschliesslich die bereits über die JWT-geschützte `knowledge-base`-Function geladenen, aktiven Kategorien des aktuellen Mandanten. Eine Kategorie filtert sowohl direkt zugeordnete Artikel als auch Artikel, die nur einer ihrer bekannten Unterkategorien zugeordnet sind; eine Unterkategorie trifft nur exakt zugeordnete Artikel. Unbekannte, inaktive oder strukturell unvollständige IDs liefern keine Treffer. Beim Mandantenwechsel, bei ungültig gewordenen Auswahlen und beim Wechsel der Kategorie wird die abhängige Unterkategorie sicher zurückgesetzt. Es gibt keine neue Browser-Berechtigungslogik, keine Datenbankmigration und keine zusätzliche Abfrage.

Die reine Filterlogik liegt testbar bei der bestehenden Kategorienpräsentation in `apps/web/src/lib/knowledge-collection-presentation.ts`. `apps/web/src/knowledge-base.tsx` bindet die Dropdowns, Zustände und kombinierte Listenfilter ein; `apps/web/src/styles.css` übernimmt nur die bestehende, responsive Filterdarstellung.

## Wissensdatenbank: Volltextsuche über Kategorien und Unterkategorien

Die bestehende service-role-only Funktion `search_knowledge_article_ids` bleibt der einzige Suchpfad der Wissensdatenbank. Eine additive Migration erweitert ihren deutschen Volltextabgleich um aktive, mandantengebundene Kategorien und Unterkategorien einer Artikelzuordnung. Eine Suche nach einer Oberkategorie findet auch Artikel, die nur einer bekannten direkten Unterkategorie zugeordnet sind. Die Suchgewichtung integriert Taxonomietreffer ohne die bestehende Revisions-, Sichtbarkeits-, Kundenorganisations- oder Archivierungsgrenze zu verändern.

Kategorienamen werden nur dann in den Suchumfang aufgenommen, wenn der serverseitig bestätigte Aufruf interne Wissensleserechte hat. Externe Personen durchsuchen unverändert ausschliesslich Titel, Zusammenfassung und die veröffentlichte Revision; so kann eine interne Kategorietaxonomie nicht über blosse Treffereffekte abgeleitet werden. Unbekannte, inaktive oder unvollständige Hierarchien bleiben ausserhalb der Taxonomiesuche. Ein aktiver Namenindex unterstützt den serverseitigen Abgleich. Der Webclient behält sein bestehendes Suchformular und erklärt dessen erweiterten Umfang, ohne neue Datenquellen oder Berechtigungsableitungen einzuführen.

## Berichte: Zeitvergleich, frei erstellter Druckbericht und Corporate Design

Der bestehende, feature- und berechtigungsgeschützte Menüpunkt «Berichte» wird als Berichts-Dashboard erweitert; es entsteht kein paralleler Reportingpfad. Die `service-reporting`-Function bleibt die alleinige Kennzahlenquelle. Sie akzeptiert neben 7, 30 und 90 Tagen einen strikt begrenzten, datumsbasierten Zeitraum und liefert für jede Abfrage die direkt vorhergehende Periode gleicher Länge. Aktive Mitgliedschaft, das aktivierte Reporting-Feature, `report.read` sowie die bestehende Teamgrenze werden serverseitig vor jeder Kennzahlenberechnung geprüft. Der vorhandene `tenant-users`-Vertrag gibt die wirksame, mandantenbezogene Leseberechtigung für die sichtbare Navigation zurück; der Browser leitet sie nicht selbst ab.

Das Dashboard vergleicht Ticketvolumen, offene und gelöste Tickets, Eskalationen, Erstreaktion, Lösungszeit, Zufriedenheit und Zeitaufwand mit der Vorperiode. Berechtigte Personen können ausschliesslich lokal einen Titel und die gewünschten Abschnitte eines Berichts zusammenstellen. Der Browserdruck verwendet nur die bereits geladene autorisierte Ansicht und speichert, versendet oder verändert weder Berichte noch Kennzahlen. Logo, Portalname und Farben stammen aus dem bestehenden Workspace-Branding; der Druckkopf enthält Brand, Zeitraum und Erstellzeitpunkt und blendet Navigation sowie Bedienelemente aus. Es gibt keine Migration, Rollenaufweitung, Scheduler-Aktivierung oder automatischen Produktionsrelease.

### Projektstruktur

- `supabase/functions/service-reporting/index.ts`: validierte Zeiträume sowie mandanten- und teamautorisierte Kennzahlen für aktuelle und vorherige Periode.
- `supabase/functions/tenant-users/index.ts`: serverautorisierte Kennzeichnung der wirksamen Berechtigung `report.read` für die Arbeitsbereichsnavigation.
- `supabase/functions/_shared/team-ticket-access.test.ts`: Regressionen für Teamgrenzen, Vergleichszeiträume und Berichtszugriff.
- `apps/web/src/service-reporting.tsx`: Berichts-Dashboard, Vorperiodenvergleich, lokale Zusammenstellung und Druckansicht.
- `apps/web/src/App.tsx`: sichere Navigation und Übergabe des bestehenden Corporate Designs an Berichte.

## Öffentlicher Systemstatus und SharePoint-Badge

nextDesk erhält einen neuen Bereich «Systemstatus» direkt bei den Services. Der Servicekatalog erhält pro aktivem Service einen bewusst gepflegten Betriebszustand: `Betriebsbereit`, `Beeinträchtigte Leistung`, `Teilweiser Ausfall`, `Schwerwiegender Ausfall` oder `Wird gewartet`. Der Zustand ist kein automatisch abgeleiteter Ticket- oder Assetzustand. Berechtigte Personen setzen ihn ausdrücklich im bestehenden Serviceformular; jede Änderung erzeugt eine zeitlich nachvollziehbare Statushistorie.

Die neue öffentliche Statusseite übernimmt die klare Informationshierarchie der Referenz: eine dominante Gesamtstatusfläche, eine zugängliche Legende, einzelne Servicezeilen mit aktuellem Status und eine lesbare 90-Tage-Verlaufslinie. Es werden keine künstlichen Gruppen erfunden, weil der bestehende Servicekatalog keine Kategorien besitzt. Lange Servicenamen umbrechen sauber, jede Statusfarbe erhält einen ausgeschriebenen Text und der Verlauf besitzt einen zugänglichen Alternativtext. Die Ansicht verwendet die bestehenden Mandantenfarben und das konfigurierte Logo, sobald diese für die bewusste Veröffentlichung verfügbar sind.

### Freigabe, Datenschutz und Mandantentrennung

Eine öffentliche Statusseite ist immer eine explizite Mandantenentscheidung. Sie bleibt standardmässig deaktiviert. Erst eine Person mit `tenant.settings.manage` kann die Veröffentlichung aktivieren und damit eine zufällige öffentliche Kennung freigeben. Dieselbe Berechtigung kann die Kennung rotieren. Die öffentliche Function gibt bei deaktivierter oder unbekannter Kennung dieselbe neutrale Nichtverfügbarkeitsantwort zurück. Sie verwendet ausschliesslich eine serverseitige Auswahl veröffentlichter Services mit Name, bewusst gesetztem Zustand, öffentlicher Seitenüberschrift, zulässiger Markeninformation und aggregiertem Verlauf. Sie gibt keine Tenant-ID, Tickets, Assetdaten, Fälle, Personalien, interne Beschreibungen, Auditdaten oder nicht veröffentlichte Services aus.

Der öffentliche Badge ist ein minimales SVG mit deutschem Statussatz, etwa «Alle Dienste verfügbar» oder «Teilweise eingeschränkt». Er ist als Bildadresse für den SharePoint-Bild-Webpart vorgesehen und verlinkt auf die öffentliche nextDesk-Statusseite. Es wird keine SharePoint-Sitzung, Graph-Berechtigung oder automatische Änderung einer SharePoint-Seite benötigt oder eingerichtet. Die Seite zeigt in nextDesk eine kopierbare Bildadresse, einen HTML-Fallback sowie kurze manuelle SharePoint-Schritte. Dadurch bleiben DSGVO, revDSG und die Datenminimierung gewahrt.

### Datenmodell und Serververträge

Migration `0106_service_status_page.sql` ergänzt `public.services` um den validierten Betriebszustand und die ausdrückliche öffentliche Sichtbarkeit. Eine mandantengefencete `service_status_events`-Tabelle zeichnet ausschliesslich Statuswechsel auf. Eine `service_status_pages`-Tabelle hält die explizite Veröffentlichung, zufällige Kennung, öffentliche Überschrift und Revisionsinformationen. RLS bleibt für Browserrollen geschlossen; Schreibvorgänge sind zusätzlich über bestehende `asset.manage`- beziehungsweise `tenant.settings.manage`-Prüfungen in Edge Functions geschützt. Trigger schreiben den anfänglichen Zustand und spätere Änderungen atomar, ohne den bisherigen Serviceaudit zu ersetzen.

`service-assets` bleibt JWT-geschützt und akzeptiert den Servicezustand nur nach aktiver Mitgliedschaft, aktivierter Assetverwaltung und `asset.manage`. `service-status` bleibt ebenfalls JWT-geschützt und liefert die interne Statusübersicht sowie die Einstellungen der Statusseite; das Speichern oder Rotieren einer öffentlichen Kennung verlangt zusätzlich `tenant.settings.manage`. Eine separate, bewusst ohne JWT betriebene `service-status-public`-Function akzeptiert nur eine UUID-Kennung, liest über serverseitigen Zugriff ausschliesslich aktivierte öffentliche Inhalte und liefert entweder einen begrenzten JSON-Vertrag für die Statusseite oder ein SVG-Badge. Der Browser leitet keine Sichtbarkeit aus lokalen Service- oder Mandantendaten ab.

### Gestaltung

- **Design Movement:** Vertrauenswürdiges Service-Operations-Design, inspiriert von modernen Statusseiten mit ruhiger Schweizer Verwaltungsästhetik.
- **Core Principles:** Sofort erfassbarer Gesamtzustand, nachvollziehbarer Verlauf, klare Statussprache und zurückhaltende Verwaltungssteuerung.
- **Color Philosophy:** Grün, Gelb, Orange, Rot und Blau tragen Statusbedeutung, werden aber immer durch Text und Symbol ergänzt; Mandantenfarben rahmen die Marke, übersteuern jedoch nie Warnfarben.
- **Layout Paradigm:** Eine vertikale Statusgeschichte vom Gesamtzustand über Legende zu einzelnen Diensten; keine dichte Dashboard-Kachelwand.
- **Signature Elements:** Breite Statusleiste, fein segmentierte 90-Tage-Verlaufslinien und ein kompakter, als Bild einbettbarer Badge.
- **Interaction Philosophy:** Status wird bewusst gesetzt, Veröffentlichung bewusst aktiviert und URLs werden explizit kopiert statt automatisch in externe Systeme geschrieben.
- **Animation:** Keine Dauerschleifen; Zustandswechsel sind auf kurze, respektvolle Übergänge begrenzt und respektieren reduzierte Bewegung.
- **Typography System:** Die vorhandene nextDesk-Schrift- und Hierarchieskala bleibt verbindlich; Gesamtstatus ist klar dominant, Serviceinformationen sind kompakt und gut lesbar.
- **Brand Essence:** nextDesk macht die Verfügbarkeit klar, glaubwürdig und sicher sichtbar – sachlich, transparent und handlungsorientiert.
- **Brand Voice:** Präzise und ruhig, zum Beispiel «Alle veröffentlichten Dienste sind verfügbar.» und «Der Dienst wird planmässig gewartet.»
- **Wordmark & Logo:** Das konfigurierte Mandantenlogo bleibt das alleinige Markenzeichen; die Statusseite erfindet kein neues Logo.
- **Signature Brand Color:** Die konfigurierten Mandantenfarben akzentuieren Header und Links, während die semantischen Statusfarben für Betriebslagen reserviert bleiben.

### Projektstruktur

- `supabase/migrations/0106_service_status_page.sql`: Servicezustände, Statushistorie, öffentliche Statusseitenkonfiguration, RLS und atomare Trigger.
- `supabase/functions/service-assets/`: Erweiterung des vorhandenen serverautorisierten Servicevertrags um den Zustand.
- `supabase/functions/service-status/`: JWT-geschützte interne Übersicht und Veröffentlichungsverwaltung.
- `supabase/functions/service-status-public/`: datensparsame öffentliche Seite- und SVG-Badge-Ausgabe ohne Schreibpfad.
- `apps/web/src/service-status.tsx`: Interne Systemstatusverwaltung und öffentliche Statusansicht.
- `apps/web/src/service-assets.tsx`: Zustandsauswahl im bestehenden Serviceformular und klare Darstellung in Servicezeilen.
- `apps/web/src/App.tsx`, `apps/web/src/styles.css`: neuer Bereich, öffentliche Query-Route und responsive, zugängliche Statusdarstellung.

### Umgesetzte Sicherheitsdetails

Die 90-Tage-Verlaufslinie erhält pro Service zusätzlich den letzten serverautorisierten Statuswechsel vor dem sichtbaren Zeitfenster. Dadurch wird ein späterer Störungszustand nicht rückwirkend auf frühere Tage übertragen. Öffentliche Status- und Badge-Antworten sind mit `no-store` gegen Wiederverwendung nach einer Kennungsrotation geschützt. Der bewusst öffentliche SVG-Badge kann ohne Credentials auch von einem SharePoint-Bild-Webpart oder dessen Proxy bezogen werden; die JSON-Statusseite akzeptiert CORS weiterhin nur von `https://app.nextdesk.ch`.
