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
