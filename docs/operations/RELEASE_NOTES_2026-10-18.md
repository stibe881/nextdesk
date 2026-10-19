# nextDesk – Release Notes, 18. Oktober 2026

## Ausgeliefert

- Mandantenfähiger Assets-Bereich in Web und iOS mit QR-/Barcode-Lookup, sicherem serverseitigem Intune-Synchronisationsdienst als **deaktivierter** Integrationsbaustein sowie einer Rollout-Anleitung für die erforderliche Microsoft-Graph-Freigabe.
- Mobile Arbeitsbeschleunigung: globale Ticket-/Assetsuche, direkte Ticketbearbeitung, sichere Fotoanhänge, Entwürfe, eine eigene Favoritenwarteschlange mit erneuter Serverautorisierung, Kontaktaktion, Wissenssuche, dezente Haptik und optionaler lokaler Geräteschutz. Bei vorübergehendem Netzverlust steht zusätzlich maximal zwölf Stunden eine verschlüsselte, benutzer- und mandantengebundene Ticketlisten-Metadatenansicht zur Verfügung; sie ist klar als Offlinefallback markiert sowie weder klickbar noch bearbeitbar. Ticketdetails, Kommunikation, Anhänge, Assets und Wissensinhalte bleiben offline ausgeschlossen.
- Mobile Härtung: Ticketabschlüsse verlangen eine zweite, zugängliche Bestätigungsaktion und übermitteln erst dann die serverseitig erforderliche Abschlussbestätigung. Der Offlinefallback ist ausschliesslich auf iOS aktiv, nur bei eindeutig gemeldetem Netzverlust verfügbar und verwendet einen festen, bei Abmeldung, Benutzerwechsel oder lokaler Bereinigung vollständig gelöschten Satz von OS-Schlüsselspeicher-Slots. Ticketerfassung bleibt offline gesperrt; bei bestehender Verbindung werden ausschliesslich aktuelle serverautorisierte Daten verwendet.
- Mobile Funktionsschalter: Tabs, Services, globale Suche und alle Asset-, Scan-, Wissens- sowie Ticketdetail-Deep-Links laden die effektive Freigabe aus der mandantenautorisierten Feature-Function. Fehlende, abgelaufene oder nicht prüfbare Freigaben bleiben fail-closed; die Anwendung zeigt eine verständliche Sperrseite statt Inhalte oder Mutationen anzufordern.
- Native SSO: Wenn iOS die sichere Anmeldesitzung sofort abbricht oder nicht öffnet, zeigt der Anmeldeknopf den Fortschritt sichtbar an und führt die bereits an eine PKCE-Transaktion gebundene Anmeldung kontrolliert in Safari fort. Der Rückweg bleibt ausschliesslich auf den kanonischen App-Callback begrenzt. iOS-Build **10018** aus Quellcommit `30e9d3e` wurde erfolgreich an App Store Connect übermittelt; Apple verarbeitet die TestFlight-Version separat.
- Native SSO-Nachlieferung: Die aktuelle iOS-Quellbasis ersetzt die in React Native potenziell nie auflösende WebCrypto-PKCE-Hashoperation durch Expo Crypto und erzeugt einen S256-Verifier ausschliesslich im iOS-Schlüsselspeicher. Die Transaktion erwartet keinen nicht von Supabase gelieferten lokalen `state`-Parameter mehr, sondern wird beim Codeaustausch kryptografisch durch den Verifier gebunden. Die Korrektur ist in iOS-Build **10019** (EAS `bc8baefd-56bc-41df-b4a4-71ce12629f87`, Quellcommit `5ab4e0c`) enthalten und wurde mit der Übermittlung `8ca6d7fd-cdce-4590-8c66-9271db054897` an App Store Connect übergeben; der reale iPhone-Test steht noch aus.
- Wissensverwaltung mit mandantenspezifischen Kategorien, Revisionen, Freigabeprozess, sichtbarem Versionsstand und mobiler Suche. Die App zeigt dazu ausschliesslich bereits autorisierte Sammlungen sowie Version und Aktualität an.
- Ticketprozesse mit kontrolliertem CSV-Import/-Export, Ticketvergleich, Freigaben, PDF-Ticketakte und reversibler Vorlagenarchivierung.
- Mandantenadministration mit exklusiven Einstellungsreitern, zentraler Funktionskonfiguration, zeitlich begrenzten Feature-Piloten, Datenschutz-/Retention-Richtlinien, Onboarding-Checkliste, Logo-Upload und direkter Übernahme der Mandantenmarke.
- Betriebsregeln mit Vorschau für Nachfassen, Duplikate, Datenqualität, Qualitätschecks, Compliancehinweise und Berichte. Von Regeln vorgeschlagene Schliesskandidaten können nur nach aktueller serverseitiger Kandidatenprüfung und sichtbarer Bestätigung manuell geschlossen werden. Der Lauf wird separat auditiert.
- Ticketabschluss mit auffindbaren Abschlussbewertungen, klaren Hinweisen vor dem Schliessen, zugänglichen Erfolgsmeldungen und einer direkten Statusauswahl, die geschlossene Status ohne entsprechende Abschlussberechtigung nicht anbietet. Qualitätskennzahlen und eigene Qualitätsnotizen bleiben zusätzlich serverseitig auf berechtigte Mitarbeitende beschränkt.
- Qualitätsgates für Typen, Schema, Datenbank-Migrationen, Edge Functions, Formatierung und Web-Bundlebudget; dokumentierter Rücknahme- und Recoveryablauf.
- Sicherheitsnachlieferung: Externe Wissensartikel aus einem Ticket erfordern nun zusätzlich ausdrücklich `knowledge.publish`. Der Datenbank-Trigger verhindert den Entzug der letzten aktiven Mandantenadministration. Mandanten-SSO prüft den Entra-Mandantenbezug gegen den gespeicherten Issuer und die eindeutig zugeordnete Unternehmensdomain; eine passend verifizierte Person wird beim ersten Login nur als normale anfragende Person im eigenen Mandanten angelegt. Rollen oder Agentenrechte entstehen weiterhin ausschliesslich über die Rollenverwaltung oder eine explizite Einladung. Die Rollenverwaltung reserviert sensible Rollen und Berechtigungen für effektive Mandantenadministratoren.
- Funktionsschalter für Ticketdetail, Checklisten und Zeiterfassung werden nun nicht nur in der Oberfläche ausgeblendet, sondern in der Ticket-Operations-Function mandantenbezogen und fail-closed geprüft. Abgelaufene Piloten zählen als deaktiviert; direkte Aufrufe liefern keine versteckten Checklisten- oder Arbeitszeitdaten und können keine entsprechenden Mutationen auslösen.
- Die serverseitige Durchsetzung der Funktionsschalter umfasst jetzt auch Ticketvorlagen, Kategorien, Anfragendenkontext, Anhänge, Agentenzuweisung, Abteilungswechsel, Freigaben, Wissen, Übergaben, Kundenfeedback, Qualitätsprüfung, Präsenz und Ticket-Attributwerte. Asset-Management wird ebenfalls vor jedem Serverzugriff gegen den Mandantenschalter geprüft. Fehlende, fehlerhafte oder abgelaufene Schalter werden fail-closed behandelt. Ein Merge darf ein Ticket nur dann automatisch auf «gelöst» setzen, wenn die handelnde Person zusätzlich die Abschlussberechtigung besitzt.
- Ergänzung Funktionsschalter: Wissens-API, SLA-Verwaltung, Service-Reporting und die unabhängige Asset-Registry prüfen ihre jeweilige Mandantenfreigabe nun ebenfalls serverseitig und fail-closed. Web-Einstellungen laden die Freigaben direkt nach einem Schalter- oder Pilotwechsel nach; die mobile App aktualisiert sie bei Mandantenwechsel und Rückkehr in den Vordergrund.
- Massenstatusänderungen in einen geschlossenen Status sind zweistufig: Die Ticketliste zeigt zuerst eine klare Inline-Bestätigung mit Anzahl, Zielstatus und Audit-Hinweis. Erst die explizite zweite Aktion kann schliessen. Die neue Datenbank-RPC-Signatur verlangt dieselbe Bestätigung verpflichtend, ist weiterhin nur für die Service Role ausführbar, prüft Berechtigungen pro Ticket erneut und protokolliert den bestätigten Abschluss atomar.
- Die nur manuell auslösbare Auto-Close-Aktion übergibt ihre sichtbare Webbestätigung jetzt explizit an die neue Massenabschluss-RPC. Sie bleibt auf aktuelle serverseitige Kandidaten, eine erneute Rechteprüfung und einen separaten Lauf- sowie Audit-Eintrag begrenzt; ein unbeaufsichtigter Scheduler wird nicht aktiviert.

## Nachlieferung 16:30 Uhr

**iOS-SSO-Störung.** Build 10020 (`3a4c514`) korrigierte, dass die SSO-Taste nicht reagierte. Build 10021 (`30480ba`, EAS `dcf75910-fafa-41c4-bf65-b0ebe32bedde`, Submission `a30b4323-74ba-4c84-a3e4-74a616716dca`) behebt den danach sichtbaren Fehler „Invalid key provided to SecureStore“. Alle App-Schlüssel werden nun zentral und kollisionsfrei in Keychain-gültige Namen umgewandelt. Bestehende Supabase-Sitzungs- und PKCE-Schlüssel bleiben unverändert.

**Web und API (Commit `0dcd8b2`, live auf app.nextdesk.ch).** Neu sind Wiedervorlagen und „Mein Tag“, Wiedervorlagen und Lösungsbestätigungen im Ticket, ein Servicekatalog bei der Ticketerfassung und eine rein lesende KI-Governance-Ansicht. Migration 0057 ist produktiv; die Functions `experience-hub` und `ai-assist` sind ACTIVE (CORS 204, ohne Anmeldung 401). KI und ausgehende Webhooks bleiben pro Mandant deaktiviert, und es wird kein KI-Provider kontaktiert.

## Nachlieferung 17:30 Uhr

**Welle 3 (Web e871791, Migration 0058).** Agentenwerkbank:

- 360-Grad-Ticketkontext
- erklärbare Zuweisungsvorschläge, die eine Person bestätigen muss
- Team-Warteschlangen, persönliche Kennzahlen, Erwähnungen und Stellvertretungen
- Makros, die nie zuweisen oder schliessen

Anfragendenportal: Störungsmeldungen, Zeitleiste, SLA-Erwartung, eigene Geräte, Freigaben, Wiedereröffnungsanfrage, Datenauszug und Sitzungsverwaltung. Dazu kommt ein durchsuchbarer und exportierbarer Auditbericht.

**Welle 4 (Web 2df3cbb, Migration 0059).**

- Personen in Kopie, über eine datensparsame Kollegensuche mit reinen Anzeigenamen
- eigene Erreichbarkeit, im Agentenkontext sichtbar
- optionale Abteilungsansicht für Anfragende (nur Nummer, Titel, Status; standardmässig aus)
- Branding-Live-Vorschau mit WCAG-Kontrastwarnung, Dashboard-Trends und persönliche Einführungshinweise
- öffentlicher, datenfreier Health-Endpunkt
- ruhende Outbox nur für service_role
- E2E-Test ohne Anmeldung, schonender Lastcheck und lokaler Backup-Restore-Drill mit Evidenz

**Hinweis:** Die iOS-Anteile (bis 0526b7f) sind in keinem TestFlight-Build enthalten.

## Sicherheits- und Betriebsgrenzen

Die Integration mit Microsoft Intune, der vollständige Entra-Personenabgleich, E-Mail/Kalender/Teams/Slack, Webhooks/API-Schlüssel, produktives Monitoring sowie zeitgesteuerte Regelruns bleiben bewusst deaktiviert, bis die je erforderlichen Provider- und Datenschutzfreigaben, Secrets und Einwilligungen vorliegen. Sie sind nicht als aktiv ausgegeben.

Automatische Datenlöschung und unbeaufsichtigte Ticket-Schliessungen sind nicht aktiv. Retentionswerte sind zunächst Richtlinien; ein kontrollierter, separat freigegebener Lösch- oder Schedulerbetrieb ist nötig.

## Prüfungen

Für die Sicherheitsnachlieferung zusätzlich erfolgreich ausgeführt: Typecheck, Schema- und Berechtigungskatalogprüfung mit 56 Migrationen, lokale Postgres-/RLS-Migrationstests inklusive Wissensfreigabe, letztem Mandantenadministrator und bestätigten Massenabschlüssen, Edge-Function-Prüfung, Formatprüfung und Diff-Prüfung.

**iOS Build 10022.** Build 10022 (`ec02f11`, EAS `2298c990-9f6b-40d1-a1c8-98ebc5f0a6c1`, Submission `78c384cc-fc91-4af1-9e90-01ddff8b5308`) bündelt die mobilen Anteile der Wellen 2 bis 4, den Dark Mode mit Standard Hell, die Korrektur beim Speichern der Ticketbeschreibung und den neuen Fotobereich mit Kameraaufnahme. Der Kamera-Berechtigungstext nennt nun Asset-Scan und Ticketfotos. Serverseitig behandelt `ticket-operations` v20 (`84efa4f`) unveränderte Speichervorgänge als Erfolg und lädt alle gültigen Anfragenden-Kennungen.

## Push-Benachrichtigungen (18.10.2026)

**Produktiv umgesetzt:** Migration 0060 (Geräte, Präferenzen, Outbox, Ereignis-Trigger, `pg_net`-Weckruf, fail-closed Mandantenschalter `notifications.push`, standardmässig aus). Edge Functions `push-notifications` (v1, JWT) und `push-dispatch` (v1, Datenbank-Secret statt JWT) sind ACTIVE; `tenant-feature-flags` v3, `ticket-operations` v21, `ticket-agent-assignment` v6 und `ticket-actions` v10 übergeben die handelnde Person, damit niemand über die eigene Aktion benachrichtigt wird. Web (Mandantenschalter mit Inhaltsstufe, Geräteliste in den persönlichen Einstellungen, verständliche Benachrichtigungstexte) ist auf app.nextdesk.ch ausgerollt. iOS-Quellstand 34f95b4 enthält Opt-in, Kategorien, Ruhezeiten, Test-Push, Deep Links und Abmeldung des Geräts.

**Ereignisse:** Zuweisung, Antwort der anfragenden Person, Antwort des Supports, Erwähnung, Lösung, Freigabeanfrage, Eskalation und SLA. Push-Inhalte gehen nur an Apple; standardmässig nur Ereignisart und Ticketnummer, der Betreff nur bei ausdrücklicher Mandanteneinstellung.

**Offen (extern):** APNs-Schlüssel (.p8) bei Apple erstellen und `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` als Supabase-Secrets setzen (Anleitung: `docs/deployment/PUSH_NOTIFICATIONS.md`); Schalter pro Mandant aktivieren; neuer iOS-Build mit Push-Plugin nur auf ausdrücklichen Auftrag; reale iPhone-Abnahme. Bis die Secrets gesetzt sind, werden Push-Einträge sauber als `apns_not_configured` übersprungen; In-App-Benachrichtigungen funktionieren unabhängig davon.

## E-Mail-Kanal über Exchange Online (Commit 1b7116c, iOS 2729061)

Eingehende E-Mails an ein pro Mandant konfiguriertes Support-Postfach werden zu Tickets oder, bei Antworten, zu Chatnachrichten der anfragenden Person. Externe Agentenantworten, optionale Eingangsbestätigungen und optionale Lösungsmitteilungen gehen über Microsoft Graph aus demselben Postfach an die anfragende Person. Der Zugriff ist über eine zentrale Multi-Tenant-App und Exchange Online RBAC auf genau dieses Postfach begrenzt; es werden keine Graph-`Mail.*`-Berechtigungen im Entra-Consent verwendet.

Produktiv sind Migration 0061 (RLS-erzwungene, nur serverseitig zugängliche Tabellen, pg_cron-Wartung alle fünf Minuten), die Functions `exchange-mail-admin`, `exchange-mail-webhook` und `exchange-mail-worker` sowie die erweiterten `ticket-operations` und `requester-portal`. Der Webhook verarbeitet nur Benachrichtigungen mit gültigem Abo, `clientState` und Entra-Mandanten; Warteschlangeneinträge werden atomar beansprucht, damit keine doppelten Tickets oder E-Mails entstehen. Der Funktionsschalter `integrations.email` ist bei allen Mandanten ausgeschaltet. Für die Inbetriebnahme sind die externen Schritte in `docs/deployment/EXCHANGE_ONLINE_MAIL.md` nötig (zentrale App-Registrierung, zwei Supabase-Secrets, Bereitstellung und RBAC im Kundenmandanten). Ein echter End-to-End-Test mit einem Kundenpostfach steht noch aus. Die iOS-Kennzeichnung im Chat ist im Quellstand, aber erst mit dem nächsten beauftragten TestFlight-Build in der App.

## Push-Arbeitszeit-Check-in (Abend 18.10.2026)

Push-Benachrichtigungen werden nur noch während der Arbeitszeit und nach einem täglichen Check-in versendet. Standard ist 06:00 bis 17:00 Uhr (Zeitzone Europe/Zurich). Die Mandantenadministration kann den Check-in abschalten und Beginn sowie Ende anpassen. Der Server prüft das vor jedem Versand (Migration 0062, `push_work_state`, Überspringen mit `off_shift`). Die Prüfung gilt deshalb auch, wenn die App geschlossen ist. Um 17:00 Uhr endet die Aktivität automatisch, ohne Scheduler. In-App-Benachrichtigungen bleiben erhalten. Die iOS-App fragt ab 06:00 Uhr beim Start bzw. beim Wechsel in den Vordergrund, ob man eingecheckt werden soll („Einchecken“ / „Heute nicht“), und zeigt den Status unter Push-Einstellungen → Arbeitszeit. Im Web kann man in den persönlichen Einstellungen ein- und auschecken. Produktiv: Migration 0062, push-notifications v2 (Commit cc09a97), Web auf Hetzner. Die iOS-Nachfrage (Commit c2d8768) ist erst nach einem neuen TestFlight-Build verfügbar.

## Startseite und Wiedervorlage-Erinnerungen (20:37)

Die iOS-Startseite zeigt die persönlichen Kennzahlen (Offen, Heute gelöst, Erste Antwort, Fällig) direkt in der Karte «Heute im Fokus». Die Ticketliste folgt unmittelbar unter den drei Übersichts-Widgets (höchstens zehn Einträge, danach «Alle Tickets anzeigen»). Die separaten Bereiche «Meine Kennzahlen» und «Mein Tag / Wiedervorlagen» wurden von der Startseite entfernt.

Im Ticketdetail (iOS und Web) setzt man eine Erinnerung mit Datum und Uhrzeit, Schnellwahl und optionaler Notiz; offene Erinnerungen lassen sich ändern oder erledigen. Migration 0063 (`follow_up_reminders`) ist produktiv: Der pg_cron-Auftrag `nextdesk-follow-up-reminders` prüft jede Minute fällige Wiedervorlagen und erzeugt genau eine In-App-Benachrichtigung `ticket.follow_up_due`, die über die neue Push-Kategorie `follow_up` («Wiedervorlagen») als Push zugestellt wird. Ruhezeiten und der Arbeitszeit-Check-in gelten unverändert. Bereitgestellt: push-dispatch v2 und push-notifications v3 auf Commit 97c356e; Web auf Hetzner ausgerollt, Smoke-Test erfolgreich. iOS-Quellstand d68a27a enthält den nativen Datumswähler und benötigt einen neuen TestFlight-Build.

## iOS-Build 10023 (TestFlight)

- EAS-Build `360c7e87-ec35-4b44-bc0c-f51e7315e71e`, iOS-Quellcommit `ba7f5e8`, App-Version 1.0.0, Submission `80310966-389e-4dad-8c06-28e6b55ca347`; Upload an App Store Connect erfolgreich, Apple-Verarbeitung folgt.
- Erster Build mit Push-Berechtigung (`aps-environment: production`); Signierung über die EAS-Zugangsdaten erfolgreich.
- Enthält Push-Benachrichtigungen, Push-Check-in, E-Mail-Kennzeichnung im Chat, kompakte Ticketdetails, Messenger-Chat, neue Startseite mit Erinnerungstermin, Agent*innen-Namen in Zuweisungsvorschlägen und die Tab-Leiste mit zentriertem Home-Kreis.
- Web: Zuweisungsvorschläge zeigen den vom Server gelieferten Namen als Rückfall (`13e093d`, auf Hetzner ausgerollt).
- Offen: reale iPhone-Abnahme; Push funktioniert erst nach Einrichtung des APNs-Schlüssels und Aktivierung des Mandantenschalters.

## Kennzahlen, Kachel «Nicht zugewiesen» und Face-ID-Schleife

- Persönliche Kennzahlen zählen nach denselben Status- und Datumsregeln (Schweizer Zeit) wie die Ticketliste; die erste Kennzahl heisst «Mir zugewiesen» (Web `770e312`, iOS `41803e5`).
- Die Kennzahlen sind antippbar und öffnen die Ticketliste mit genau den gezählten Tickets (Web `a96c270`, auf Hetzner live; iOS `21a14d0`).
- Die iOS-Startseite zeigt die Kachel «Nicht zugewiesen» (Tickets ohne zugewiesene Agent*in, gleiche Regel wie im Web) statt «Gelöst» (iOS `0487f5f`).
- Geräteschutz: Während der Face-ID-Abfrage meldet iOS kurz «inaktiv» und danach wieder «aktiv». Dieser Wechsel wurde bisher als Rückkehr aus dem Hintergrund gewertet und löste sofort die nächste Abfrage aus. Neu sperrt die App nur nach echtem Hintergrundwechsel, deckt Inhalte beim Verlassen sofort ab, begrenzt eine hängende Abfrage auf 45 Sekunden und lässt «Abmelden» immer zu (iOS `885c1ca`).

## iOS-Build 10024 (TestFlight)

- EAS-Build `8d27a576-63d0-4be3-927f-5c34a5abcbfe` (FINISHED), iOS-Quellcommit `885c1ca`, App-Version 1.0.0, Profil production, Submission `0a065501-5093-4483-8247-ce027a6afd46`; Upload an App Store Connect erfolgreich, Apple-Verarbeitung folgt.
- Vorabprüfung: sauberer Stand gleich origin/main, TypeScript, Lint, Schlüsselbund- und PKCE-Prüfung grün; Bundle-ID und URL-Schema `ch.grossict.nextdesk`.
- Enthält gegenüber Build 10023 den Face-ID-Fix, die Kachel «Nicht zugewiesen», antippbare Fokuskennzahlen und die Kennzahl «Mir zugewiesen».
- Offen: reale iPhone-Abnahme, insbesondere Face ID (aktivieren, entsperren, in den Hintergrund und zurück, erneut entsperren – ohne Schleife).

## Kennzahl «Fällig» nach Antwort- und Lösungsfrist (22:05)

- «Fällig» zählt neu die mir zugewiesenen offenen Tickets, bei denen die Frist für die erste Antwort (noch ohne erste Antwort) oder die Lösungsfrist (noch ohne Lösung) erreicht ist; gleiche Regel wie die SLA-Automation. Antippen öffnet genau diese Tickets, am längsten überfällige zuerst. Fällige Wiedervorlagen werden dort nicht mehr gezählt.
- Produktiv: agent-workbench v6 (Commit `c90d37c`, zusätzliches Feld `slaDue`; `dueFollowUps` bleibt für ältere App-Versionen erhalten). Web auf Hetzner ausgerollt («Antwort/Lösung fällig»), Smoke-Test erfolgreich.
- iOS-Quellstand `c7be8a7` (gespiegelt `a8f5e70`) ist noch in keinem TestFlight-Build; Build 10024 zeigt unter «Fällig» weiterhin fällige Wiedervorlagen.
- Voraussetzung: Fristen entstehen nur aus einem aktiven SLA-Profil mit Regeln je Priorität und nur für danach erstellte Tickets. Für Verein SONNENBERG Baar ist der Schalter `automation.sla` aus und es besteht kein SLA-Profil; die Kennzahl bleibt deshalb vorerst bei 0.

## Mobiles Mandantendesign und Ticketkategorien (19.10)

- Die iOS-App übernimmt nach der Anmeldung für den bestätigten aktiven Mandanten Portalname, hochgeladenes Logo sowie Primär-, Sekundär- und Akzentfarbe aus den Web-Designeinstellungen. Beim Mandantenwechsel, während der Kontextprüfung und bei einem Ladefehler wird keine vorherige Mandantenfarbe weiterverwendet. Anmeldung und SSO-Rückkehr folgen zudem der lokalen Hell-/Dunkelpräferenz; «Wie iPhone» hebt den expliziten iOS-Override wieder auf.
- Im Ticketdetail lassen sich Kategorie und Unterkategorie direkt in der kompakten Detailkarte setzen, ändern oder entfernen. Die Auswahl enthält nur aktive Kategorien derselben Ticketabteilung; die serverseitige Zuweisung prüft weiterhin Mitgliedschaft, `ticket.update`, Mandant und Abteilung und schreibt Ereignis und Auditprotokoll. Historisch zugewiesene, später deaktivierte Kategorien bleiben als Kontext lesbar, können aber nicht erneut gewählt werden.
- iOS-Quellcommit `c291fd5`; `ticket-operations` liefert dazu aktive Auswahlkategorien und gespeicherte historische Kategorien getrennt und mandanten-/abteilungsgebunden. TypeScript, Lint, 27 Unit-Tests, Kontrastprüfung, Deno-Prüfung und Diff-Prüfung sind grün. Kein neuer Expo-/TestFlight-Build wurde gestartet; die tatsächliche iPhone-Abnahme erfolgt erst mit einem ausdrücklich beauftragten Build.

## Abteilungsrückfragen und Geräteschutz-Branding (19.10)

- Im mobilen Ticketdetail ersetzt «Abteilungsrückfragen» die frühere, nicht passende Bezeichnung «Offene Entscheide». Die aktuell zugewiesene Agentin oder der aktuell zugewiesene Agent kann eine Frage ausschliesslich an die im Web unter **Einstellungen → Abteilungen** festgelegte Leitung der Ticketabteilung senden; eine Stellvertretung wird nur genutzt, wenn die Leitung nicht mehr aktuell berechtigt ist. Die adressierte Person antwortet im Ticketdetail, die Antwort geht an die aktuell zugewiesene Agentin oder den aktuell zugewiesenen Agenten.
- Migrationen 0064 und 0065 speichern Routen und Fragen mandantenisoliert. Jede Mutation wird erneut gegen Mandant, Abteilung, Mitgliedschaft, Zuweisung und Berechtigung geprüft und auditiert. E-Mail und Push werden vor dem Versand nochmals autorisiert: Eine zwischenzeitlich entzogene Abteilungsrolle oder Ticketzuweisung führt zu `recipient_not_authorized` und keiner Wiederholung. Die bestehenden APNs- und Exchange-Schalter bleiben weiterhin standardmässig deaktiviert.
- Die Web-Abteilungsverwaltung enthält die explizite Auswahl für Leitung und optionale Stellvertretung. Die iOS-App zeigt im Geräteschutzdialog das originale nextDesk-Logo oder, sobald verfügbar, das im Web hinterlegte Logo des bestätigten Mandanten; der Plattformname folgt ebenfalls dem Mandantendesign. Kein neuer Expo-/TestFlight-Build wurde gestartet.

## Web: klare Ticketdetails (19.10)

- Web-Commit `be8c49f` ist auf Hetzner ausgerollt und per Produktions-Smoke-Test geprüft. Das Ticketdetail folgt jetzt der Arbeitsreihenfolge: kompakte steuerbare Fakten, Beschreibung, Antwort und Kommunikation, danach Kategorien und Zusatzangaben.
- Der Antworteditor ist vor der bisherigen Unterhaltung sichtbar. Zuweisungsvorschläge, 360°-Kontext, Wissensentwurf und weitere Werkzeuge stehen in einem standardmässig geschlossenen Bereich «Arbeitskontext & Werkzeuge» und werden dort ohne enge Zweispaltenansicht gezeigt. Abschluss- und Kontextbereiche öffnen nicht mehr automatisch.
- Die schmale Darstellung macht Chatnachrichten vollbreit, ordnet Kategorie und Unterkategorie untereinander an und verwendet für auswählbare Werte mindestens 16 Pixel Schriftgrösse. Kopfaktionen werden im begrenzten Detailpanel zu gut erreichbaren Icons verdichtet; «Bearbeiten» und Schliessen bleiben klar erkennbar.

## Web: schnellere Ticketöffnung (19.10)

- Web-Commit `f578412` ist auf Hetzner ausgerollt; `ticket-operations` v25 ist aktiv. Die erste sichtbare Ticketansicht wartet nicht mehr auf eine zweite Abfrage der Agentenliste, sondern nutzt die bereits im autorisierten Ticketpayload enthaltenen Agenten.
- Die standardmässig geschlossenen Bereiche «Arbeitskontext & Werkzeuge», «Abschluss & Kontext» und «Arbeitswerkzeuge» bauen ihre umfangreichen Komponenten und Nachladungen erst beim Öffnen auf. Das betrifft insbesondere Wissen, Anhänge, Übergaben, Qualität, Kundenfeedback, betroffene Objekte und verknüpfte Werkzeuge.
- Serverseitig laufen die unabhängigen Leserechte, Funktionsschalter, Agenten- und übrigen Berechtigungsprüfungen parallel. Typecheck, Schema- und Formatprüfungen, Deno-Prüfung, Produktionsbuild, Diff-Prüfung sowie Web- und API-Smoke-Tests sind erfolgreich.

## Web: realitätsnahe Corporate-Design-Vorschau (19.10)

- Web-Commit `c6fc63b` ist auf Hetzner ausgerollt. Die bisherige Drei-Punkte-Mock-up-Vorschau wurde ersetzt: Der Designbereich zeigt neu dieselbe grundlegende Desktop-Anordnung wie das Portal mit Seitenleiste, Markenposition, vollständiger Navigation, Kopfzeile, Ticketaktion und Übersichtskarten.
- Portalname, hochgeladenes Logo sowie Primär-, Sekundär- und Akzentfarbe aktualisieren die Vorschau weiterhin unmittelbar vor dem Speichern. Nach dem Speichern verwenden Vorschau und echtes Mandantenportal dieselben Brandingwerte. Typecheck, Schema-/Formatprüfung, Produktionsbuild und Smoke-Test sind erfolgreich.

## Entra-Anzeigenamen und Manus-Preview (19.10)

- Web-Commit `533fc6b` ist auf Hetzner ausgerollt; `tenant-sso-access` v10 ist aktiv. Web und iOS verlangen beim Microsoft-Entra-Login nun die Scopes `openid profile email`. Der bestätigte Azure-Anzeigename wird bei jeder SSO-Anmeldung nachgeführt; eine nicht erfolgreiche optionale Profilsynchronisation sperrt niemals eine bestehende aktive Mandantenmitgliedschaft.
- Der bereits gespeicherte Profilname «Stefan Gross» wurde einmalig auf die Entra-Schreibweise korrigiert. Der iOS-Quellstand `8838772` enthält den nativen und den Web-Preview-Scope-Fix, ist jedoch in keinem zusätzlichen TestFlight-Build enthalten.
- Für die aktuelle Manus-Preview ist ausschliesslich ihre exakte Callback-Adresse als zusätzliche Supabase-Redirect-URL hinterlegt. Es wurde keine Wildcard und keine Änderung an der Produktions-URL freigegeben. Die temporäre URL wird nach der Vorschau-Abnahme wieder entfernt; der echte Test muss mit dem vorgesehenen Entra-Konto erfolgen.
