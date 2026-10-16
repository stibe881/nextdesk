# nextDesk: 80 weitere Ausbauvorschläge

**Stand:** 16. Oktober 2026
**Ergänzung zu:** `NEXTDESK_60_AUSBAUVORSCHLAEGE.md` und `TICKETING_50_VORSCHLAEGE.md`

Dieser Katalog ergänzt die bereits dokumentierten Ideen um **80 weitere, möglichst nicht redundante Vorschläge**. Er ist nach vier Blickwinkeln gegliedert: Design, Automatisierung, Funktionen und Plattformverbesserungen.

## Prioritäten

| Priorität | Bedeutung                                        | Orientierung         |
| :-------- | :----------------------------------------------- | :------------------- |
| **P0**    | Sicherheits-, Stabilitäts- oder Bedienrisiko     | nächstes Lieferpaket |
| **P1**    | hoher Nutzen im täglichen Betrieb                | kurzfristig          |
| **P2**    | Prozessqualität, Skalierung oder Differenzierung | mittelfristig        |
| **P3**    | strategische Optimierung oder Erweiterung        | danach               |

> **Hinweis zu Automatisierungen:** Externe Nachrichten, Integrationen, KI-Verarbeitung, Kalender, Telefonie und Beschaffung werden erst nach Mandantenfreigabe, Datenschutzprüfung und Bereitstellung der passenden Zugangsdaten produktiv aktiviert.

---

## A. 20 Designvorschläge

|   # | Priorität | Vorschlag                                          | Nutzen und konkrete Umsetzung                                                                                                                                  |
| --: | :-------: | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 |    P1     | **Fokusmodus für Ticketbearbeitung**               | Reduziert die Detailansicht auf Betreff, Kommunikation, Status und nächste Aktion; ergänzende Module bleiben über eine seitliche Kontextleiste erreichbar.     |
|   2 |    P1     | **Befehlsmenü mit Tastenkürzeln**                  | `⌘/Ctrl + K` öffnet eine Suche für Tickets, Personen, Services und Aktionen wie „Ticket erfassen“ oder „Status ändern“.                                        |
|   3 |    P1     | **Persönliche Startansicht**                       | Jede angemeldete Person kann festlegen, ob sie mit Dashboard, persönlicher Arbeitsliste oder einer gespeicherten Ansicht startet.                              |
|   4 |    P2     | **Dichtegrade für Listen**                         | Die Ansichten „Kompakt“, „Standard“ und „Komfortabel“ passen Zeilenhöhe und Metadaten an unterschiedliche Bildschirmgrössen und Arbeitsweisen an.              |
|   5 |    P1     | **Klarer Bearbeitungsindikator**                   | Ein sichtbarer Hinweis zeigt, wenn eine andere berechtigte Person ein Ticket gerade geöffnet oder bearbeitet hat, ohne Daten zu sperren.                       |
|   6 |    P2     | **Kontextabhängige Aktionsleiste**                 | Häufige Aktionen richten sich nach Ticketstatus, Rolle und Auswahl: beispielsweise „Antworten“, „Übergeben“, „Lösen“ oder „Verknüpfen“.                        |
|   7 |    P1     | **Barrierefreie Kontrast- und Schriftoptionen**    | Hoher Kontrast, grössere Schrift und reduzierte Bewegung verbessern die Zugänglichkeit ohne den modernen nextDesk-Look zu verlieren.                           |
|   8 |    P2     | **Dunkler Arbeitsmodus**                           | Ein systemabhängiger oder manuell umschaltbarer Dunkelmodus erleichtert die Arbeit in Bereitschaft und bei langen Einsätzen.                                   |
|   9 |    P1     | **Erklärende Leerstati**                           | Leere Listen zeigen nicht nur „Keine Treffer“, sondern bieten passende nächste Schritte wie Filter zurücksetzen, Ticket erfassen oder Ansicht wechseln.        |
|  10 |    P2     | **Visuelle SLA-Zeitlinie**                         | Reaktions- und Lösungsziel erscheinen als verständlicher Zeitbalken mit verbleibender Zeit, Pausen und Eskalationsstufe.                                       |
|  11 |    P1     | **Unterscheidbare interne und externe Oberfläche** | Externe Antworten erhalten eine eindeutige, aber zurückhaltende Farbcodierung und einen Sichtbarkeits-Hinweis direkt im Composer.                              |
|  12 |    P2     | **Anpassbare Dashboard-Widgets**                   | Berechtigte Personen können Kacheln für Warteschlangen, SLA-Risiken, eigene Tickets und Servicezustände anordnen oder ausblenden.                              |
|  13 |    P2     | **Arbeitsbereich für Grossbildschirme**            | Auf breiten Displays können Ticketliste, Detailansicht und Aktivitätsleiste gleichzeitig sichtbar sein; auf Mobilgeräten bleibt die Ansicht fokussiert.        |
|  14 |    P1     | **Einheitliche Bestätigungsdialoge**               | Moderne, verständliche Dialoge erklären Auswirkung, Anzahl betroffener Tickets und Rückgängig-Optionen bei relevanten Aktionen.                                |
|  15 |    P2     | **Schnellaktionen direkt aus der Listenzeile**     | Ein dezentes Kontextmenü erlaubt Zuweisen, Beobachten, Priorisieren oder Kopieren, ohne das Ticket zuerst vollständig zu öffnen.                               |
|  16 |    P1     | **Stimmige Ladezustände**                          | Skeletons und gezielte Bereichs-Ladezustände vermeiden leere Sprünge und zeigen klar, ob Daten, Aktionen oder Anhänge gerade verarbeitet werden.               |
|  17 |    P2     | **Mandantenfähige Begriffsverwaltung**             | Ein Mandant kann Begriffe wie „Ticket“, „Anliegen“, „Serviceauftrag“ oder „Kundschaft“ sprachlich an die eigene Organisation anpassen.                         |
|  18 |    P3     | **Persönliche Arbeitsmarkierungen**                | Farbneutrale Favoriten, Merkliste und „später bearbeiten“-Markierung helfen Support-Mitarbeitenden beim Priorisieren ohne den offiziellen Status zu verändern. |
|  19 |    P2     | **Druckansicht für Ticket und Übergabe**           | Eine reduzierte, professionell formatierte Druckansicht fasst Ticketdaten, Verlauf, Checkliste und Übergaben für Besprechungen zusammen.                       |
|  20 |    P1     | **Designsystem-Dokumentation in der Anwendung**    | Komponenten, Statusfarben, Abstände und Interaktionsregeln werden als interne Referenz dokumentiert, damit neue Module visuell konsistent bleiben.             |

---

## B. 20 Automatisierungsvorschläge

|   # | Priorität | Automatisierung                                                | Auslöser → Aktion                                                                                                                        | Voraussetzung / Schutzmassnahme                                                      |
| --: | :-------: | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
|   1 |    P1     | **Auto-Tagging nach stabilen Regeln**                          | Betreff, Kategorie oder Service passt auf eine Regel → kontrollierte Tags werden vorgeschlagen oder hinzugefügt.                         | Regeln pro Mandant, nachvollziehbare Protokollierung, keine freie KI-Klassifikation. |
|   2 |    P1     | **Prioritäts-Check vor dem Schliessen**                        | Ein Ticket mit kritischem SLA- oder Eskalationsstatus wird geschlossen → System fordert eine Lösungsnotiz oder Freigabe an.              | Nur Validierung, keine Blockade für berechtigte Ausnahmefälle.                       |
|   3 |    P2     | **Automatischer Beobachtungsmodus für Beteiligte**             | Eine Person wird erwähnt, zugewiesen oder als betroffen gesetzt → relevante Statusänderungen werden abonniert.                           | Individuell abbestellbar, ausgenommen Pflichtbenachrichtigungen.                     |
|   4 |    P2     | **Wiederkehrende Wartungsfenster**                             | Geplantes Fenster beginnt oder endet → vorbereitete Statusmeldung und betroffene Services werden aktiviert bzw. zurückgesetzt.           | Freigabeprozess und gepflegte Servicezuordnung.                                      |
|   5 |    P1     | **Alterungswarnung für unbearbeitete Tickets**                 | Ticket bleibt trotz Status „Neu“ oder „In Bearbeitung“ über einer Schwelle → Hinweis an zuständige Queue.                                | Zeitgrenzen pro Priorität und Mandant.                                               |
|   6 |    P2     | **Automatisierte Qualitäts-Checkliste bei kritischen Tickets** | Priorität „Dringend“ oder Sicherheitskategorie → Checkliste für Kommunikation, Ursache und Nachbereitung wird angehängt.                 | Vorlagen je Vorgangstyp.                                                             |
|   7 |    P2     | **Geplante Zusammenfassung für Schichtwechsel**                | Schichtende oder manuell definierte Uhrzeit → Entwurf mit offenen Risiken, fälligen Tickets und Übergaben wird erzeugt.                  | Ausschliesslich interne Sichtbarkeit und menschliche Prüfung.                        |
|   8 |    P2     | **Dynamische Eskalationsverantwortung**                        | Eskalation erreicht eine Stufe → Vertretung wird anhand aktueller Rollen-, Bereitschafts- oder Organisationsdaten ermittelt.             | Gepflegte Vertretungsregeln, keine externe Benachrichtigung ohne Freigabe.           |
|   9 |    P2     | **Automatische Verknüpfung zu Service-Störungen**              | Mehrere neue Tickets betreffen denselben bekannten Service → Vorschlag zur Verknüpfung mit einem Incident oder Problemfall.              | Menschliche Bestätigung vor der Verknüpfung.                                         |
|  10 |    P1     | **Warnung vor unvollständiger Lösungsdokumentation**           | Status wechselt auf „Gelöst“ → fehlende Ursache, Lösung oder Zeiteintrag wird hervorgehoben.                                             | Pro Mandant konfigurierbare Pflichtfelder.                                           |
|  11 |    P2     | **Fristgesteuerte Freigabe-Erinnerung**                        | Eine interne Freigabe bleibt offen → zuständige Person erhält eine Erinnerung und später eine Eskalation.                                | Nur für eingeführte Freigabeprozesse.                                                |
|  12 |    P2     | **Automatisches Aktualisieren von Service-Health**             | Verknüpfter Incident wird eröffnet, gelöst oder eskaliert → Service-Dashboard erhält einen passenden, überprüfbaren Statusentwurf.       | Freigabestufe für öffentliche Kundschaftskommunikation.                              |
|  13 |    P2     | **Regelbasierte Datenhygiene**                                 | Kontakt, Asset oder Kategorie ist unvollständig oder inaktiv → Verantwortliche erhalten eine Aufräumaufgabe.                             | Kein automatisches Löschen personenbezogener Daten.                                  |
|  14 |    P3     | **Kapazitätsprognose für Warteschlangen**                      | Historische Last und aktuelle Eingänge überschreiten definierte Muster → frühzeitige Warnung für Teamleitung.                            | Transparente Berechnung, keine automatische Personalentscheidung.                    |
|  15 |    P2     | **Automatische Anlage eines Nachfass-Tickets**                 | Ein gelöster Vorgang braucht einen vereinbarten Kontrolltermin → Folge-Ticket wird mit Bezug und Fälligkeit erstellt.                    | Nur bei aktivierter Regel und eindeutigem Datum.                                     |
|  16 |    P2     | **Zeitbuchungs-Erinnerung vor Übergabe**                       | Ticket wird übergeben oder gelöst, aber Bearbeitungszeit fehlt → dezenter Hinweis an die bearbeitende Person.                            | Kann bei nicht verrechenbaren Mandanten deaktiviert werden.                          |
|  17 |    P3     | **Störungscluster über Ereignissignale**                       | Mehrere Tickets mit gleichem Service, Standort oder Fehlercode entstehen kurz nacheinander → Incident-Vorschlag mit betroffenen Tickets. | Schwellenwerte, menschliche Bestätigung und Mandantentrennung.                       |
|  18 |    P2     | **Automatisierte Archivvorbereitung**                          | Aufbewahrungsfrist läuft ab → Export- und Löschprüfung wird als freigabepflichtiger Entwurf erstellt.                                    | Datenschutz- und Rechtsfreigabe, keine automatische endgültige Löschung.             |
|  19 |    P2     | **Benachrichtigungs-Bündelung**                                | Viele niedrigkritische Updates treffen für dieselbe Person ein → Zusammenfassung statt Einzelmeldungen.                                  | Kritische SLA- und Sicherheitsereignisse bleiben sofortig.                           |
|  20 |    P3     | **Automatischer Lessons-Learned-Entwurf**                      | Major Incident wird geschlossen → internes Dokument mit Zeitlinie, Auswirkungen und offenen Verbesserungsmassnahmen wird vorbereitet.    | Redaktionelle Prüfung, vertrauliche Inhalte bleiben mandantenisoliert.               |

---

## C. 20 Funktionsvorschläge

|   # | Priorität | Funktion                                             | Nutzen und konkrete Umsetzung                                                                                                           |
| --: | :-------: | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
|   1 |    P1     | **Erweiterte Ticket-Suche mit Suchsyntax**           | Suchen wie `status:offen`, `priorität:hoch`, `agent:ich`, `service:VPN` oder Zeiträume werden als verständliche Filter-Chips umgesetzt. |
|   2 |    P1     | **Ticket-Tags mit Governance**                       | Mandanten verwalten erlaubte Tags, Synonyme und Farben; freie Tags können bei Bedarf eingeschränkt werden.                              |
|   3 |    P2     | **Benutzerdefinierte Ticketfelder**                  | Mandanten definieren strukturierte Felder wie Standort, Vertragsnummer, Kostenstelle oder Dringlichkeitsbegründung.                     |
|   4 |    P1     | **Vorlagen mit Platzhaltern**                        | Antwortbausteine und Ticketvorlagen können Ticketnummer, Anfragende Person, Service, SLA und zuständige Person automatisch einsetzen.   |
|   5 |    P2     | **Freigabe-Workflows im Ticket**                     | Serviceanträge erhalten nachvollziehbare Genehmigungsstufen, Stellvertretung, Kommentare und Entscheidungsverlauf.                      |
|   6 |    P2     | **Serviceabhängigkeiten**                            | Services können voneinander abhängig modelliert werden; Störungen zeigen automatisch potenziell betroffene Services und Kundschaft.     |
|   7 |    P2     | **Wartungs- und Change-Kalender**                    | Geplante Arbeiten, Risikobewertung, betroffene Services und Kommunikationsfenster werden in einer Mandantenansicht gebündelt.           |
|   8 |    P1     | **Ticket-Import mit Prüfmodus**                      | Berechtigte Personen importieren Tickets aus CSV in eine Vorschau, prüfen Feldzuordnung und übernehmen erst nach Bestätigung.           |
|   9 |    P2     | **Gesicherter Ticket-Export mit Vorlagen**           | Exportprofile für Management, Serviceverantwortliche oder Rechnungsprüfung berücksichtigen Rollen, Sichtbarkeit und Audit-Protokoll.    |
|  10 |    P1     | **Vergleichsansicht für Tickets**                    | Zwei verwandte Tickets können nebeneinander verglichen werden, etwa vor einer Zusammenführung oder bei wiederkehrenden Vorfällen.       |
|  11 |    P2     | **Eskalationsmatrix-Editor**                         | Mandanten pflegen Stufen, verantwortliche Rollen, Reaktionszeiten und interne Kommunikationsvorgaben direkt in den Einstellungen.       |
|  12 |    P2     | **Abwesenheits- und Vertretungsverwaltung**          | Support-Mitarbeitende hinterlegen Abwesenheiten und Vertretungen, damit Zuweisungen verständlich bleiben.                               |
|  13 |    P2     | **Warteschlangen-Skills**                            | Teams und Personen erhalten Kompetenzprofile; Routing und Planung können daraus später transparent Vorschläge ableiten.                 |
|  14 |    P1     | **Sichere interne Link-Vorschau**                    | Verknüpfte Tickets, Wissensartikel, Assets und Problemfälle zeigen beim Überfahren eine RLS-geprüfte Kurzinfo.                          |
|  15 |    P2     | **Anfragenden-Selbstservice für Kontaktdaten**       | Externe Anfragende können freigegebene Kontakt- und Kommunikationspräferenzen im eigenen Profil aktualisieren.                          |
|  16 |    P2     | **Feedback mit Kategorien**                          | Nach einer Lösung kann Kundschaft zusätzlich zur Bewertung Themen wie Kommunikation, Geschwindigkeit oder Fachkompetenz wählen.         |
|  17 |    P3     | **Service-Portfolio und Eigentümerschaft**           | Jeder Service erhält eine geschäftliche und technische verantwortliche Person, Kritikalität, Beschreibung und Kontaktweg.               |
|  18 |    P2     | **Ticket-Konversation als sichere PDF-Akte**         | Berechtigte Personen erzeugen eine revisionsfreundliche Zusammenfassung inklusive sichtbarer Kommentare und Anhänge-Verweise.           |
|  19 |    P3     | **Mehrmandanten-Portfolio für Eigentümer\*innen**    | Die Eigentümerkonsole zeigt berechtigten Plattformverantwortlichen mandantenübergreifend Trends, Risiken und Konfigurationslücken.      |
|  20 |    P2     | **API-Schlüssel und Webhook-Verwaltung pro Mandant** | Mandantenadministration kann begrenzte, rotierbare Integrationszugänge mit Berechtigungsumfang, Ablauf und Audit verwalten.             |

---

## D. 20 Verbesserungen für Plattform und Betrieb

|   # | Priorität | Verbesserung                                      | Nutzen und konkrete Umsetzung                                                                                                                       |
| --: | :-------: | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 |    P0     | **Ende-zu-Ende-Regressionstests für Kernabläufe** | Ein Test deckt Anmeldung, Mandantenkontext, Ticket erfassen, öffnen, kommentieren, Status ändern und Rechtefehler ab.                               |
|   2 |    P0     | **Vertragsversionierung für Edge Functions**      | Jede relevante API-Antwort wird gegen versionierte Beispiele geprüft, damit UI und Backend keine stillen Brüche erhalten.                           |
|   3 |    P1     | **Fehlerreferenz mit Korrelations-ID**            | Nutzer*innen sehen eine kurze Support-Referenz; technische Details bleiben geschützt, sind aber im Audit und Betrieb auffindbar.                    |
|   4 |    P1     | **Performance-Budget für den Web-Client**         | Ladezeit, JavaScript-Grösse und Interaktionszeit werden gemessen; grosse Module werden bei Bedarf dynamisch geladen.                                |
|   5 |    P1     | **Datenbank-Abfragebudget und Indexpflege**       | Häufige Ticket-, Dashboard- und Reporting-Abfragen werden gemessen, mit sicheren Indizes abgesichert und regelmässig überprüft.                     |
|   6 |    P0     | **Berechtigungs-Regressionstests je Rolle**       | Automatisierte Tests prüfen jede Rolle auf Mandanten-, Abteilungs- und Ticketgrenzen, inklusive abgelaufener Zuweisungen.                           |
|   7 |    P1     | **Strukturierte Betriebsprotokolle**              | Edge Functions protokollieren Dauer, Fehlerklasse und Korrelations-ID ohne vertrauliche Ticketinhalte.                                              |
|   8 |    P2     | **Mandantenfähige Demo- und Schulungsumgebung**   | Eine isolierte Beispielumgebung ermöglicht Schulung, Rollentests und Produktdemos ohne Produktionsdaten.                                            |
|   9 |    P1     | **Konfigurierbare Datenqualität-Dashboards**      | Mandanten sehen unvollständige Services, unzugeordnete Assets, offene Übergaben oder fehlende SLA-Daten.                                            |
|  10 |    P2     | **Release-Notizen in der Anwendung**              | Nach einer Bereitstellung erscheinen kurze, mandantenneutrale Release-Informationen mit Hinweisen auf relevante Änderungen.                         |
|  11 |    P2     | **Rückgängig-Fenster für risikoarme Aktionen**    | Aktionen wie Massenstatus, Zuweisung oder Tagging können innerhalb eines kurzen Zeitfensters mit Audit-Vermerk rückgängig gemacht werden.           |
|  12 |    P1     | **Verbindliche Datenschutzhinweise pro Mandant**  | Mandantenadministration verwaltet Hinweise zu Datenverarbeitung, Aufbewahrung und Kontaktstellen sichtbar im Portal.                                |
|  13 |    P2     | **Konfigurationsvergleich zwischen Mandanten**    | Plattformverantwortliche können Vorlagen mit Mandanteneinstellungen vergleichen, ohne Ticket- oder Personendaten offenzulegen.                      |
|  14 |    P2     | **Betriebsstatusseite für nextDesk**              | Eine statusorientierte Seite informiert über bekannte Einschränkungen von Portal, Anmeldung, E-Mail-Eingang oder Integrationen.                     |
|  15 |    P1     | **Gezielte Onboarding-Checkliste**                | Neue Mandantenadministration erhält Aufgaben für Branding, Rollen, Kategorien, SSO-Test, SLA und Kontaktinformationen.                              |
|  16 |    P2     | **Mandantenübergreifende Vorlagenbibliothek**     | Eigentümer*innen können geprüfte Startvorlagen für Kategorien, Rollen, Services und Checklisten bereitstellen; Übernahme bleibt explizit.           |
|  17 |    P2     | **Last- und Wiederherstellungstests**             | Regelmässige Tests prüfen Backup, Wiederanlauf, grössere Ticketmengen und Fehlerszenarien vor wachsendem Einsatz.                                   |
|  18 |    P1     | **Veraltete Konfigurationen sichtbar machen**     | Nicht mehr verwendete Webhooks, abgelaufene SSO-Zertifikate, leere Teams oder inaktive SLA-Regeln erscheinen als handhabbare Hinweise.              |
|  19 |    P2     | **Sicherer Funktionsschalter mit Vorschau**       | Neue Module können pro Mandant zuerst für eine Pilotgruppe aktiviert, gemessen und danach ausgerollt werden.                                        |
|  20 |    P3     | **Produktmetriken mit Datenschutzrahmen**         | Opt-in-Nutzungsmetriken zeigen, welche Arbeitsabläufe Reibung verursachen; keine Ticketinhalte oder personenbezogenen Daten werden dafür verwendet. |

---

## Empfohlene nächste Lieferpakete aus diesem Katalog

| Reihenfolge | Paket                              | Enthaltene Vorschläge   | Warum jetzt                                                               |
| :---------: | ---------------------------------- | ----------------------- | ------------------------------------------------------------------------- |
|      1      | **Schnelle Bedienbarkeit**         | A1, A3, A9, A14, C1, C4 | Sofort sichtbarer Nutzen für Support-Mitarbeitende und Anfragende.        |
|      2      | **Betriebssicherheit**             | D1, D2, D3, D6, D7      | Reduziert Regressionen und macht Fehler im Alltag besser nachvollziehbar. |
|      3      | **Steuerbare Automatisierung**     | B2, B5, B10, B16, C11   | Erhöht Prozessqualität ohne externe Zugänge vorauszusetzen.               |
|      4      | **Mandantenreife**                 | A17, C3, C5, D12, D15   | Verbessert Einführung, Anpassbarkeit und Governance je Mandant.           |
|      5      | **Skalierung und Differenzierung** | A12, B7, C6, C13, D17   | Ausbaustufe für wachsende Teams und komplexere Serviceorganisationen.     |

## Nächster sinnvoller Umsetzungsschritt

Für die nächste technische Lieferung empfiehlt sich das Paket **„Schnelle Bedienbarkeit“** mit:

1. erweiterter Suchsyntax und Filter-Chips,
2. Antwortbausteinen mit sicheren Platzhaltern,
3. leeren Zuständen mit gezielten Folgeaktionen,
4. modernen, einheitlichen Bestätigungsdialogen,
5. persönlicher Startansicht und Ticket-Fokusmodus.

Damit verbessert nextDesk den täglichen Ticketbetrieb sichtbar, ohne neue externe Zugänge oder Integrationsfreigaben zu benötigen.
