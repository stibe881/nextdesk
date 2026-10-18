# nextDesk – Release Notes, 18. Oktober 2026

## Ausgeliefert

- Mandantenfähiger Assets-Bereich in Web und iOS mit QR-/Barcode-Lookup, sicherem serverseitigem Intune-Synchronisationsdienst als **deaktivierter** Integrationsbaustein sowie einer Rollout-Anleitung für die erforderliche Microsoft-Graph-Freigabe.
- Mobile Arbeitsbeschleunigung: globale Ticket-/Assetsuche, direkte Ticketbearbeitung, sichere Fotoanhänge, Entwürfe, eine eigene Favoritenwarteschlange mit erneuter Serverautorisierung, Kontaktaktion, Wissenssuche, dezente Haptik und optionaler lokaler Geräteschutz. Bei vorübergehendem Netzverlust steht zusätzlich maximal zwölf Stunden eine verschlüsselte, benutzer- und mandantengebundene Ticketlisten-Metadatenansicht zur Verfügung; sie ist klar als Offlinefallback markiert sowie weder klickbar noch bearbeitbar. Ticketdetails, Kommunikation, Anhänge, Assets und Wissensinhalte bleiben offline ausgeschlossen.
- Mobile Härtung: Ticketabschlüsse verlangen eine zweite, zugängliche Bestätigungsaktion und übermitteln erst dann die serverseitig erforderliche Abschlussbestätigung. Der Offlinefallback ist ausschließlich auf iOS aktiv, nur bei eindeutig gemeldetem Netzverlust verfügbar und verwendet einen festen, bei Abmeldung, Benutzerwechsel oder lokaler Bereinigung vollständig gelöschten Satz von OS-Schlüsselspeicher-Slots. Ticketerfassung bleibt offline gesperrt; bei bestehender Verbindung werden ausschließlich aktuelle serverautorisierte Daten verwendet.
- Mobile Funktionsschalter: Tabs, Services, globale Suche und alle Asset-, Scan-, Wissens- sowie Ticketdetail-Deep-Links laden die effektive Freigabe aus der mandantenautorisierten Feature-Function. Fehlende, abgelaufene oder nicht prüfbare Freigaben bleiben fail-closed; die Anwendung zeigt eine verständliche Sperrseite statt Inhalte oder Mutationen anzufordern.
- Native SSO: Wenn iOS die sichere Anmeldesitzung sofort abbricht oder nicht öffnet, zeigt der Anmeldeknopf den Fortschritt sichtbar an und führt die bereits an eine PKCE-Transaktion gebundene Anmeldung kontrolliert in Safari fort. Der Rückweg bleibt ausschließlich auf den kanonischen App-Callback begrenzt. iOS-Build **10018** aus Quellcommit `30e9d3e` wurde erfolgreich an App Store Connect übermittelt; Apple verarbeitet die TestFlight-Version separat.
- Native SSO-Nachlieferung: Die aktuelle iOS-Quellbasis ersetzt die in React Native potenziell nie auflösende WebCrypto-PKCE-Hashoperation durch Expo Crypto und erzeugt einen S256-Verifier ausschließlich im iOS-Schlüsselspeicher. Die Transaktion erwartet keinen nicht von Supabase gelieferten lokalen `state`-Parameter mehr, sondern wird beim Codeaustausch kryptografisch durch den Verifier gebunden. Die Korrektur ist in iOS-Build **10019** (EAS `bc8baefd-56bc-41df-b4a4-71ce12629f87`, Quellcommit `5ab4e0c`) enthalten und wurde mit der Übermittlung `8ca6d7fd-cdce-4590-8c66-9271db054897` an App Store Connect übergeben; der reale iPhone-Test steht noch aus.
- Wissensverwaltung mit mandantenspezifischen Kategorien, Revisionen, Freigabeprozess, sichtbarem Versionsstand und mobiler Suche. Die App zeigt dazu ausschliesslich bereits autorisierte Sammlungen sowie Version und Aktualität an.
- Ticketprozesse mit kontrolliertem CSV-Import/-Export, Ticketvergleich, Freigaben, PDF-Ticketakte und reversibler Vorlagenarchivierung.
- Mandantenadministration mit exklusiven Einstellungsreitern, zentraler Funktionskonfiguration, zeitlich begrenzten Feature-Piloten, Datenschutz-/Retention-Richtlinien, Onboarding-Checkliste, Logo-Upload und direkter Übernahme der Mandantenmarke.
- Betriebsregeln mit Vorschau für Nachfassen, Duplikate, Datenqualität, Qualitätschecks, Compliancehinweise und Berichte. Von Regeln vorgeschlagene Schliesskandidaten können nur nach aktueller serverseitiger Kandidatenprüfung und sichtbarer Bestätigung manuell geschlossen werden. Der Lauf wird separat auditiert.
- Ticketabschluss mit auffindbaren Abschlussbewertungen, klaren Hinweisen vor dem Schliessen, zugänglichen Erfolgsmeldungen und einer direkten Statusauswahl, die geschlossene Status ohne entsprechende Abschlussberechtigung nicht anbietet. Qualitätskennzahlen und eigene Qualitätsnotizen bleiben zusätzlich serverseitig auf berechtigte Mitarbeitende beschränkt.
- Qualitätsgates für Typen, Schema, Datenbank-Migrationen, Edge Functions, Formatierung und Web-Bundlebudget; dokumentierter Rücknahme- und Recoveryablauf.
- Sicherheitsnachlieferung: Externe Wissensartikel aus einem Ticket erfordern nun zusätzlich ausdrücklich `knowledge.publish`. Der Datenbank-Trigger verhindert den Entzug der letzten aktiven Mandantenadministration. Mandanten-SSO prüft den Entra-Mandantenbezug gegen den gespeicherten Issuer und die eindeutig zugeordnete Unternehmensdomain; eine passend verifizierte Person wird beim ersten Login nur als normale anfragende Person im eigenen Mandanten angelegt. Rollen oder Agentenrechte entstehen weiterhin ausschließlich über die Rollenverwaltung oder eine explizite Einladung. Die Rollenverwaltung reserviert sensible Rollen und Berechtigungen für effektive Mandantenadministratoren.
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
