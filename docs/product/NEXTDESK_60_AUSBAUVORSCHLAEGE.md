# nextDesk: 60 priorisierte Ausbauvorschläge

**Stand:** 16. Oktober 2026  
**Zielbild:** nextDesk wird zu einer übersichtlichen, mandantenisolierten Service-Management-Plattform für Kunden, interne Mitarbeitende und Support-Agenten.

## Priorisierungslogik

| Priorität | Bedeutung | Umsetzungshorizont |
|---|---|---|
| P0 | Stabilität, Sicherheit oder tägliche Nutzbarkeit | Sofort / nächster Sprint |
| P1 | Hoher Nutzwert im Ticketbetrieb | Kurzfristig |
| P2 | Skalierung, Reporting oder Prozessqualität | Mittelfristig |
| P3 | Differenzierung und Optimierung | Danach |

> **Wichtig:** Alle Vorschläge mit externen Systemen, E-Mail-Versand, Kalendern, Teams/Slack, Telefonie oder KI benötigen vor der produktiven Aktivierung eine konkrete Freigabe, die passenden Zugangsdaten und eine Datenschutzprüfung.

---

## A. 30 Produktverbesserungen

| # | Priorität | Vorschlag | Konkreter Nutzen |
|---:|:---:|---|---|
| 1 | P0 | **Fehlerfreie Ticketdetail-API als Vertrags-Test absichern** | Jede Änderung an Edge Functions wird gegen reale Beispielantworten getestet; leere optionale Felder verhindern das Öffnen eines Tickets nicht mehr. |
| 2 | P0 | **Einheitliche Fehlerzustände für alle Module** | Technische Fehler werden mit verständlicher Ursache, Wiederholen-Aktion und Support-Referenz statt mit „non-2xx“ angezeigt. |
| 3 | P0 | **Automatisierte Smoke-Tests nach jedem Release** | Anmeldung, Dashboard, Ticketliste, Ticket öffnen und Ticket erstellen werden nach einer Bereitstellung geprüft. |
| 4 | P0 | **Berechtigungsübersicht pro Mandant** | Administratoren sehen klar, wer welche Rolle, Abteilung und wirksamen Berechtigungen besitzt. |
| 5 | P0 | **Sicheres Audit-Log-Viewer-Modul** | Mandantenadministratoren sehen nachvollziehbar, wann Rollen, Einstellungen, SSO, Tickets und Daten geändert wurden. |
| 6 | P1 | **Ticket-Schnellvorschau in der Liste** | Hover oder Tippen zeigt Status, Anfragende Person, Agent, SLA und letzte Aktivität ohne vollständiges Öffnen. |
| 7 | P1 | **Gespeicherte Ticketansichten** | Eigene Filter wie „Meine kritischen Tickets“, „Unzugewiesen heute“ oder „Warten auf Kunde“ können gespeichert und geteilt werden. |
| 8 | P1 | **Massenaktionen für Ticketlisten** | Berechtigte Agenten können mehrere Tickets gleichzeitig einem Team, Agenten, Status oder einer Kategorie zuweisen. |
| 9 | P1 | **Echte Ticket-Paginierung und Endlosladen** | Grosse Mandanten bleiben schnell; die Oberfläche zeigt nie unbemerkt nur einen abgeschnittenen Teil der Tickets. |
| 10 | P1 | **Erweiterte Suchsyntax** | Suche nach Ticketnummer, Anfragender Person, Agent, Service, Asset, Tag, Status oder Zeitraum mit klaren Filter-Chips. |
| 11 | P1 | **Ticket-Tags und individuelle Felder** | Jeder Mandant kann kontrollierte Tags sowie eigene Ticketfelder für Prozesse wie Standort, Vertragsnummer oder Gerätetyp definieren. |
| 12 | P1 | **Kollaborative Antwortentwürfe** | Agenten können interne Entwürfe vorbereiten, weitergeben und vor Versand freigeben lassen. |
| 13 | P1 | **Antwortbausteine mit Variablen** | Textvorlagen wie Begrüssung, Abschluss und Wartungshinweis füllen Ticketnummer, Name, SLA oder Agent automatisch ein. |
| 14 | P1 | **Ticket-Checklisten mit Vorlage** | Wiederkehrende Abläufe für Onboarding, Arbeitsplatzwechsel, Incident oder Offboarding werden als Checklisten wiederverwendbar. |
| 15 | P1 | **Sichtbare Ticket-Historie als Zeitachse** | Statuswechsel, Antworten, Zuweisungen, SLA-Ereignisse und Anhänge werden chronologisch und verständlich dargestellt. |
| 16 | P1 | **Drag-and-drop-Anhänge mit Vorschau** | Dateien lassen sich ablegen; Bilder und PDFs erhalten eine sichere Vorschau, ohne dass private Anhänge öffentlich werden. |
| 17 | P1 | **Unterscheidung Incident, Service Request, Problem und Change** | Klare Vorgangstypen verbessern Routing, Reporting, SLA und die Zusammenarbeit zwischen Support und Kunden. |
| 18 | P1 | **Duplikat-Erkennung beim Erfassen** | Ähnliche offene Tickets werden angezeigt, damit Anfragende bestehende Vorgänge ergänzen statt neue Duplikate zu erzeugen. |
| 19 | P1 | **Verknüpfte Problemfälle besser visualisieren** | Ein Problemfall zeigt betroffene Tickets, Services, Assets, Ursachen, Workarounds und Kommunikationsstand. |
| 20 | P1 | **Kundensicht für externe Anfragende** | Externe sehen nur ihre eigenen Tickets, Status, sichere Antworten, Anhänge und freigegebene Wissensartikel. |
| 21 | P2 | **Mehrsprachige Oberfläche pro Benutzerprofil** | Deutsch, Englisch, Französisch und Italienisch können je Benutzer gewählt werden; Ticketinhalte bleiben unverändert. |
| 22 | P2 | **Mandantenspezifisches Corporate Design** | Logo, Primärfarbe, E-Mail-Branding und Begriffe sind pro Mandant konfigurierbar, ohne die Plattformmarke zu verändern. |
| 23 | P2 | **SSO-Testassistent pro Mandant** | Administratoren prüfen Domain, OIDC/SAML-Metadaten, Claims, Gruppen- und Rollenzuordnung vor dem Aktivieren. |
| 24 | P2 | **Servicekatalog mit Formularen** | Services wie „Neuer Mitarbeitender“, „VPN-Zugang“ oder „Hardware bestellen“ erhalten strukturierte, mandantenspezifische Antragsformulare. |
| 25 | P2 | **Asset-Lebenszyklus** | Assets erhalten Besitzer, Standort, Garantie, Vertragsbezug, Verknüpfung zu Tickets und eine Historie. |
| 26 | P2 | **SLA-Kalender und Geschäftszeiten** | SLA-Ziele berücksichtigen Feiertage, Arbeitszeiten, Pausen, Priorität und kundenspezifische Verträge. |
| 27 | P2 | **Service-Dashboard je Mandant** | Verfügbarkeit, laufende Störungen, SLA-Trends, Ticketvolumen und Kundenzufriedenheit werden verständlich visualisiert. |
| 28 | P2 | **Datenschutz- und Aufbewahrungsregeln** | Mandanten definieren Löschfristen, Exportprozesse und Zugriff auf personenbezogene Daten nachvollziehbar. |
| 29 | P3 | **Mobile-First-Agentenansicht** | Eine fokussierte Mobilansicht für Zuweisung, Antwort, Zeiterfassung, Foto-Anhang und Eskalation beschleunigt Arbeit unterwegs. |
| 30 | P3 | **In-App-Produktfeedback und Feature-Voting** | Benutzer können Verbesserungsideen melden; Mandantenadministratoren priorisieren sie transparent mit Status und Roadmap. |

---

## B. 30 Automatisierungsvorschläge

| # | Priorität | Automatisierung | Auslöser → Aktion | Voraussetzung / Hinweis |
|---:|:---:|---|---|---|
| 1 | P0 | **SLA-Warnung vor Fristablauf** | SLA-Restzeit unterschreitet Schwelle → Agent und Team erhalten Hinweis. | Geschäftszeiten und SLA-Profile müssen gepflegt sein. |
| 2 | P0 | **SLA-Eskalation bei Fristverletzung** | Antwort- oder Lösungsziel überschritten → Eskalation an Teamleitung, Audit-Ereignis und Prioritätsprüfung. | Eskalationsmatrix je Mandant konfigurieren. |
| 3 | P0 | **Automatische Ticketnummer und Standardwerte** | Ticket wird erstellt → Nummer, Status, Standardpriorität und Ereignis werden gesetzt. | Bereits vorhanden, mit Contract-Tests absichern. |
| 4 | P0 | **Routing nach Kategorie und Unterkategorie** | Kategorie gewählt → passendes Team, Agentenpool, SLA und Vorlage werden vorgeschlagen. | Kategorien und Routingregeln je Mandant pflegen. |
| 5 | P0 | **Automatische Zuweisung bei Agentenabwesenheit** | Zugewiesener Agent ist abwesend → Ticket wird dem Team oder Stellvertreter zugewiesen. | Kalender-/Abwesenheitsquelle oder manuelle Abwesenheitspflege erforderlich. |
| 6 | P1 | **Bestätigung an Anfragende nach Erfassung** | Neues Ticket → sichere Empfangsbestätigung mit Nummer, Betreff, Status und Link. | Produktiver Mailversand mit Zustellungsprotokoll erforderlich. |
| 7 | P1 | **Antwortbenachrichtigung an Anfragende** | Externe Antwort wird publiziert → Benachrichtigung per Portal und optional E-Mail. | Benutzerpräferenzen und E-Mail-Integration erforderlich. |
| 8 | P1 | **Erinnerung bei wartender Kundenantwort** | Ticket steht auf „Warten auf Kunde“ → Erinnerung nach definierter Dauer. | Status- und Kommunikationsregel je Mandant definieren. |
| 9 | P1 | **Automatisches Schliessen nach Inaktivität** | Kunde reagiert nach mehreren Erinnerungen nicht → Ticket wird mit dokumentierter Frist geschlossen. | Muss je Mandant aktivierbar und reversibel sein. |
| 10 | P1 | **Zufriedenheitsumfrage nach Lösung** | Ticket wird gelöst → kurze Bewertung mit optionalem Kommentar. | Datenschutz- und Versandfreigabe erforderlich. |
| 11 | P1 | **Negative Bewertung als Rückrufauftrag** | Bewertung 1–2 Sterne → Follow-up-Ticket oder Eskalation an verantwortliche Person. | Verantwortlichkeiten und Kontaktkanal definieren. |
| 12 | P1 | **Duplikatvorschlag bei ähnlichem Ticket** | Neuer Betreff ähnelt offenen Tickets → Bestehende Tickets werden vor dem Erstellen vorgeschlagen. | Lokaler Volltextindex oder KI-gestützte Ähnlichkeit, Datenschutz prüfen. |
| 13 | P1 | **Wissensartikel-Vorschlag aus Ticketkategorie** | Kategorie/Betreff erkannt → passende interne oder externe Artikel im Antwortbereich anzeigen. | Wissensartikel müssen versioniert und freigegeben sein. |
| 14 | P1 | **Erstellung eines Wissensentwurfs nach Lösung** | Ticket wird erfolgreich gelöst und als wiederkehrend markiert → Entwurf mit anonymisierten Kerndaten vorbereiten. | Menschliche Freigabe bleibt zwingend. |
| 15 | P1 | **Automatische Ticket-Checkliste** | Vorgangstyp oder Service ausgewählt → passende Checkliste wird angehängt. | Vorlagenverwaltung und Bearbeitungsrechte erforderlich. |
| 16 | P1 | **Erkennung kritischer Schlagwörter** | Text enthält definierte Begriffe wie „Ausfall“, „Datenschutz“ oder „Sicherheitsvorfall“ → Prioritätswarnung und Eskalationsvorschlag. | Regelwerk pro Mandant, keine automatische Klassifikation ohne Review. |
| 17 | P1 | **Incident-Kommunikationsstatus** | Mehrere Tickets betreffen denselben Service → Statusseite oder Sammelmeldung wird vorbereitet. | Service-/Problemverknüpfungen und Freigabeprozess nötig. |
| 18 | P2 | **E-Mail-zu-Ticket mit Anfragendenzuordnung** | E-Mail trifft ein → Absender wird als Anfragende Person gespeichert, Ticket kategorisiert und bestätigt. | Mailbox/Webhook, SPF/DKIM/DMARC und Absenderregeln erforderlich. |
| 19 | P2 | **E-Mail-Anhänge sicher übernehmen** | E-Mail mit Anhang → Virenprüfung, Typ-/Grössenprüfung und private Ablage am Ticket. | Malware-Scan-Service und Speicherkosten beachten. |
| 20 | P2 | **Microsoft Teams- oder Slack-Benachrichtigung** | Kritisches Ticket oder Eskalation → Nachricht in freigegebenen Teamkanal mit Deep Link. | Teams/Slack-App, Kanalzuordnung und Datenschutzfreigabe erforderlich. |
| 21 | P2 | **Kalendertermin aus Supporttermin** | Ticket benötigt Besprechung → Termin wird vorgeschlagen und nach Freigabe im Kalender erstellt. | Microsoft 365 oder Google Workspace OAuth erforderlich. |
| 22 | P2 | **Onboarding-Workflow** | Serviceantrag „Neue Mitarbeitende“ → Aufgaben für IT, HR, Vorgesetzte und Berechtigungen werden erstellt. | Rollen, Checklisten und Identity-Integrationen erforderlich. |
| 23 | P2 | **Offboarding-Workflow** | Austritt gemeldet → Zugänge, Geräte, Gruppen und Aufgaben werden mit Fristen gesammelt. | Identity- und Asset-Integrationen erforderlich. |
| 24 | P2 | **Asset-Garantie- und Lizenzwarnung** | Garantie oder Lizenz läuft ab → Vorabmeldung und optional Beschaffungsentwurf. | Asset-/Lizenzdaten müssen vollständig sein. |
| 25 | P2 | **Kapazitätsausgleich zwischen Agenten** | Queue eines Agenten übersteigt Schwelle → neue Tickets bevorzugt an verfügbare qualifizierte Agenten verteilen. | Skill-Matrix, Arbeitszeiten und Transparenzregeln erforderlich. |
| 26 | P2 | **Wöchentlicher Servicebericht** | Zeitplan wöchentlich/monatlich → Bericht zu Volumen, SLA, Trends und Zufriedenheit als Entwurf erzeugen. | Berichtsempfänger und Datenfreigabe definieren. |
| 27 | P2 | **Qualitätsstichprobe für gelöste Tickets** | Regelmässige Stichprobe oder Risikoregel → Tickets werden einem Qualitätsreview zugeordnet. | Qualitätskriterien und Reviewer-Rollen erforderlich. |
| 28 | P3 | **Proaktive Störungsmeldung aus Monitoring** | Monitoring meldet Servicefehler → Incident mit Service/Asset, Priorität und Zeitstempel erzeugen. | Monitoring-Webhook, Deduplizierung und Alarmregeln erforderlich. |
| 29 | P3 | **KI-gestützte Zusammenfassung und Klassifizierung** | Lange Ticketkonversation oder E-Mail → Entwurf für Zusammenfassung, Kategorie und Antwortvorschlag. | Nur mit Datenverarbeitungsvereinbarung, Mandantenfreigabe und menschlicher Kontrolle. |
| 30 | P3 | **Automatische Eröffnung eines Problemfalls** | Wiederholte ähnliche Incidents überschreiten Schwelle → Problemfall mit verknüpften Tickets und Ursachenanalyse-Checkliste vorbereiten. | Duplikatlogik, Mindestschwellen und Freigabe durch Problem Manager erforderlich. |

---

## Empfohlene nächste drei Lieferpakete

### Paket 1 – Verlässlicher Kern (P0)

1. API-Vertrags- und Release-Smoke-Tests
2. Einheitliche Fehlerdarstellung
3. Berechtigungsübersicht und Audit-Log-Viewer
4. SLA-Warnungen und Eskalationsmatrix

### Paket 2 – Schnellerer Ticketbetrieb (P1)

1. Gespeicherte Ansichten, Massenaktionen und leistungsfähige Suche
2. Antwortbausteine, Checklisten und Wissensvorschläge
3. Erinnerungen, Kundenbenachrichtigungen und Zufriedenheitsumfrage
4. Duplikatvorschläge und Problemfall-Visualisierung

### Paket 3 – Skalierung und Integrationen (P2/P3)

1. Servicekatalog, Asset-Lebenszyklus und SLA-Kalender
2. E-Mail-Eingang, Teams/Slack und Kalender
3. Onboarding/Offboarding, Reporting und Qualitätsstichproben
4. Monitoring- und KI-Integrationen nach Datenschutzfreigabe
