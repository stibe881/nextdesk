# nextDesk: 50 Erweiterungsvorschläge für das Ticketsystem

**Zielbild:** nextDesk wird zum mandantenfähigen Gross-ICT-Kundenportal. Jeder Kunde arbeitet in einem technisch getrennten Mandanten. Interne Support-Mitarbeitende bearbeiten Vorgänge effizient, während Kunden nur die für sie freigegebenen Informationen sehen.

> **Leitprinzip:** Jede Funktion muss Mandantentrennung, Rollenrechte, Auditierbarkeit und nachvollziehbare Sichtbarkeit berücksichtigen. Kommentare sind standardmässig **intern**; externe Kommunikation wird bewusst freigegeben.

## Empfohlene Reihenfolge

| Priorität | Umfang | Nutzen                                                   |
| --------- | ------ | -------------------------------------------------------- |
| P0        | 1–14   | Ein vollständiger, alltagstauglicher Ticket-Lebenszyklus |
| P1        | 15–32  | Teamarbeit, Kundenportal und Automatisierung             |
| P2        | 33–43  | Wissen, Reporting und Servicequalität                    |
| P3        | 44–50  | Integrationen, Governance und Skalierung                 |

---

## A. Ticket-Lebenszyklus und Bearbeitung

### 1. Ticket-Detailansicht

**Priorität:** P0  
Eine vollständige Detailseite zeigt Beschreibung, Status, Priorität, Kategorie, anfragende Person, Zuweisung, Zeitstempel, SLA und gesamten Verlauf. Sie ist die zentrale Arbeitsoberfläche für Support-Mitarbeitende.

### 2. Statuswechsel mit klarer Zustandslogik

**Priorität:** P0  
Unterstützung für `Neu`, `In Bearbeitung`, `Wartend auf Kunde`, `Wartend auf Drittanbieter`, `Gelöst` und `Geschlossen`. Nur zulässige Übergänge sollen auswählbar sein; ein geschlossener Vorgang kann optional wiedereröffnet werden.

### 3. Interne und externe Kommentare

**Priorität:** P0  
Kommentare sind standardmässig **intern** und nur für Support-Mitarbeitende sichtbar. Beim Verfassen kann ausdrücklich auf **extern / kundensichtbar** gewechselt werden; diese Kommentare erscheinen im Kundenportal und in Kundenbenachrichtigungen.

### 4. Antwort-Composer mit Sichtbarkeitswarnung

**Priorität:** P0  
Der Eingabebereich zeigt deutlich an, ob gerade eine interne Notiz oder eine externe Kundenantwort erstellt wird. Bei externen Antworten schützt eine klare Farb- und Textmarkierung vor versehentlicher Preisgabe interner Informationen.

### 5. Ticketzuweisung an Mitarbeitende

**Priorität:** P0  
Tickets können einem einzelnen Support-Agenten, einem Team oder zunächst nur einer Queue zugewiesen werden. Die Zuweisung erzeugt ein Ereignis im Verlauf und optional eine Benachrichtigung.

### 6. Prioritäten mit nachvollziehbarer Wirkung

**Priorität:** P0  
Neben `Niedrig`, `Normal`, `Hoch` und `Dringend` soll die Oberfläche die erwartete Reaktionszeit, Eskalationsstufe und aktuelle Priorität klar zeigen.

### 7. Kategorien und Unterkategorien

**Priorität:** P0  
Pro Kundenmandant können Kategorien wie **Arbeitsplatz**, **Microsoft 365**, **Netzwerk**, **Telefonie**, **Zugriffsanfrage** oder **Störung** definiert werden. Unterkategorien erlauben aussagekräftige Auswertungen und Automatisierung.

### 8. Bearbeitungsprotokoll / Timeline

**Priorität:** P0  
Automatisch protokolliert werden: Statuswechsel, Zuweisungen, Prioritätsänderungen, Kommentare, SLA-Ereignisse, Anhänge und Kundenbenachrichtigungen. Die Timeline macht jeden Vorgang revisionssicher nachvollziehbar.

### 9. Ticket wiedereröffnen

**Priorität:** P0  
Kunden oder berechtigte Supporter können ein gelöstes Ticket innerhalb eines definierten Zeitraums wiedereröffnen. Die ursprüngliche Bearbeitung bleibt erhalten und die SLA-Regeln werden erneut bewertet.

### 10. Duplizierte Tickets erkennen und zusammenführen

**Priorität:** P1  
Bei ähnlichem Betreff, gleichem Service oder parallelen Störungsmeldungen schlägt nextDesk potenzielle Duplikate vor. Supporter können Tickets verknüpfen oder zusammenführen, ohne den Verlauf zu verlieren.

### 11. Verknüpfte Tickets und Parent-Child-Struktur

**Priorität:** P1  
Ein Major Incident kann als übergeordnetes Ticket mehrere Kundentickets bündeln. Status- und Kommunikationsupdates lassen sich kontrolliert an verknüpfte Vorgänge weitergeben.

### 12. Ticketvorlagen

**Priorität:** P1  
Vorlagen beschleunigen wiederkehrende Vorgänge, etwa Onboarding, neue Arbeitsplätze, Passwortprobleme oder VPN-Zugänge. Sie können Betreff, Beschreibung, Kategorie, Priorität, Checkliste und Standardantwort enthalten.

### 13. Checklisten im Ticket

**Priorität:** P1  
Supporter können Aufgabenlisten mit Verantwortlichen und Erledigungsstatus verwenden. Besonders nützlich für Standardprozesse, Changes, Onboarding und Sicherheitsprüfungen.

### 14. Private Entwürfe

**Priorität:** P1  
Antworten oder interne Notizen lassen sich als Entwurf speichern. Dies verhindert Informationsverlust bei Unterbrechungen oder bei längeren fachlichen Abklärungen.

---

## B. Teamarbeit und operative Steuerung

### 15. Queue-Board für Support-Teams

**Priorität:** P0  
Eine Kanban-artige oder listenorientierte Queue zeigt neue, unzugewiesene, wartende und überfällige Tickets. Filter nach Kunde, Team, Priorität, Kategorie und Bearbeiter ermöglichen schnelle Triage.

### 16. Persönliche Arbeitsliste

**Priorität:** P0  
Jeder Supporter sieht **Mir zugewiesen**, **Heute fällig**, **Wartend auf mich** und **Von mir beobachtet**. Das reduziert Kontextwechsel und verpasste Aufgaben.

### 17. Ticket-Beobachter

**Priorität:** P1  
Benutzer können Tickets beobachten, ohne Bearbeiter zu sein. Beobachter erhalten relevante Status- oder Kommentarbenachrichtigungen, bleiben aber nicht automatisch verantwortlich.

### 18. Übergabe zwischen Schichten

**Priorität:** P1  
Ein Feld **Übergabenotiz** dokumentiert offenen Kontext, nächste Schritte und Risiken für die nächste Schicht. Der Eintrag bleibt intern und wird in der persönlichen Arbeitsliste hervorgehoben.

### 19. Arbeitszeit und Zeiterfassung

**Priorität:** P1  
Supporter erfassen Zeit direkt am Ticket, als Timer oder manuell. Interne Zeit, verrechenbare Zeit und Kulanzzeit bleiben unterscheidbar und exportierbar.

### 20. Interne Erwähnungen

**Priorität:** P1  
`@Name`-Erwähnungen in internen Kommentaren benachrichtigen gezielt Kollegen. Berechtigungen verhindern, dass Benutzer in fremden Mandanten oder Teams erwähnt werden.

### 21. Eskalationskennzeichnung

**Priorität:** P1  
Supporter können ein Ticket als fachlich, organisatorisch oder SLA-kritisch markieren. Eskalationen erscheinen in einer separaten Ansicht und benötigen eine dokumentierte Ursache.

### 22. Schicht- und Bereitschaftszuordnung

**Priorität:** P2  
Teams erhalten Bereitschaftsfenster und Vertretungsregeln. Neue oder dringende Tickets werden auf die aktuell verantwortliche Gruppe geroutet.

---

## C. Kundenportal, Benutzer und Zugriffsrechte

### 23. Kundensicht auf eigene Tickets

**Priorität:** P0  
Ein Kundenbenutzer mit Rolle **Eigene Tickets** sieht nur Tickets, bei denen er selbst anfragende oder betroffene Person ist. Er kann eigene Tickets erfassen, externe Antworten lesen und bei Berechtigung wiedereröffnen.

### 24. Kundensicht auf alle Firmentickets

**Priorität:** P0  
Ein Kundenbenutzer mit Rolle **Alle Firmentickets** sieht alle für seine Kundenorganisation freigegebenen Tickets. Diese Rolle eignet sich für IT-Verantwortliche, Office Manager oder Geschäftsleitungen.

### 25. Ticketzugriff pro Kundenorganisation konfigurieren

**Priorität:** P0  
Je Kundenorganisation wird explizit eingestellt, ob Ticketzugriff **deaktiviert**, **nur eigene Tickets** oder **alle Firmentickets** erlaubt ist. Ohne Freigabe bleibt der Kundenportalzugriff auf die vorgesehenen Funktionen beschränkt.

### 26. Benutzer- und Rollenverwaltung im Kundenmandanten

**Priorität:** P0  
Mandantenadministratoren verwalten Benutzer, Einladungen, Zugriffsrollen und deaktivierte Zugänge für ihren Kunden. Plattform-Eigentümer behalten die übergeordnete Kontrolle und Audit-Sicht.

### 27. Kundenkontaktprofil

**Priorität:** P1  
Pro anfragender Person werden Standort, Abteilung, Sprache, bevorzugter Kontaktkanal und wichtige Hinweise gepflegt. Personenbezogene Daten bleiben auf das notwendige Minimum beschränkt.

### 28. Vertretungsregel für Kunden

**Priorität:** P2  
Kundenbenutzer können eine befristete Vertretung definieren, etwa bei Ferien oder längerer Abwesenheit. Die Vertretung erhält nur den ausdrücklich freigegebenen Ticketzugriff.

### 29. Kundenportal mit verständlicher Sprache

**Priorität:** P1  
Die Kundenansicht reduziert technische Details und zeigt klare Formulierungen: **Anliegen eingegangen**, **Wir arbeiten daran**, **Wir benötigen Ihre Rückmeldung**, **Gelöst**. Interne Technikerinformationen bleiben verborgen.

### 30. Zufriedenheitsabfrage nach Lösung

**Priorität:** P2  
Nach Abschluss eines Tickets kann der Kunde mit einer kurzen Bewertung und optionalem Kommentar antworten. Die Ergebnisse fliessen in Kunden- und Serviceauswertungen ein.

---

## D. SLA, Automatisierung und Benachrichtigungen

### 31. SLA-Profile je Kunde und Priorität

**Priorität:** P1  
Für jeden Kundenmandanten können Reaktions- und Lösungsziele je Priorität definiert werden. Vertragsabhängige Unterschiede bleiben damit sauber modelliert.

### 32. Geschäftskalender und Servicezeiten

**Priorität:** P1  
SLA-Zeit läuft nur innerhalb definierter Servicezeiten, Feiertage und kundenspezifischer Wartungsfenster. 24×7-Kunden können ein abweichendes Profil erhalten.

### 33. SLA-Pausenregeln

**Priorität:** P1  
Bei Status wie **Wartend auf Kunde** oder **Wartend auf Drittanbieter** wird die SLA-Uhr nach dokumentierter Regel pausiert. Der Zeitverlauf bleibt für Support und Kunden nachvollziehbar.

### 34. Mehrstufige SLA-Eskalationen

**Priorität:** P1  
Vorwarnung, Verletzung und kritische Überschreitung lösen abgestufte Aktionen aus: In-App-Hinweis, E-Mail, Teams-Nachricht, Eskalationsqueue oder Benachrichtigung an einen Service Manager.

### 35. Regelbasierte Ticketverteilung

**Priorität:** P1  
Regeln können Tickets anhand von Kunde, Kategorie, Abteilung, Schlüsselwort, Sprache oder Priorität automatisch Teams und Queues zuordnen.

### 36. Automatische Antwortbestätigung

**Priorität:** P1  
Beim Eingang erhält der Kunde eine klar formulierte Bestätigung inklusive Ticketnummer, Priorität, erwarteter Reaktionszeit und Link zum Portal.

### 37. Erinnerungen bei ausstehender Kundenantwort

**Priorität:** P1  
Wartende Tickets erhalten nach konfigurierbaren Intervallen eine freundliche Erinnerung. Ohne Rückmeldung können Tickets nach einer nachvollziehbaren Frist automatisch geschlossen werden.

### 38. Benachrichtigungspräferenzen

**Priorität:** P2  
Benutzer wählen Kanäle und Intensität für Ticketupdates, Zuweisungen, Erwähnungen und SLA-Warnungen. Sicherheitsrelevante oder kritische Eskalationen können nicht vollständig deaktivierbar sein.

---

## E. Wissen, Problemlösung und Wiederverwendung

### 39. Wissensartikel direkt aus Tickets erstellen

**Priorität:** P1  
Aus einem gelösten Ticket kann ein Supporter mit einem Klick einen Wissensartikel oder Lösungsvorschlag erstellen. Betreff, relevante Schritte und Anhänge werden als Entwurf übernommen.

### 40. Sichtbarkeit von Wissensartikeln

**Priorität:** P1  
Jeder Artikel besitzt eine klare Sichtbarkeit: **intern**, **für einen Kundenmandanten** oder **extern für berechtigte Kunden**. Interne Details, Zugänge und Sicherheitsinformationen bleiben geschützt.

### 41. Durchsuchbare Wissensdatenbank und FAQ

**Priorität:** P1  
Supporter und Kunden finden Artikel über Volltextsuche, Kategorien und Tags. Während der Ticketerfassung werden passende Lösungen proaktiv vorgeschlagen.

### 42. Verlinken von Tickets und Wissen

**Priorität:** P2  
Ein Ticket kann auf verwendete Wissensartikel verweisen. Das verbessert die Nachvollziehbarkeit und zeigt, welche Lösungen häufig helfen oder überarbeitet werden müssen.

### 43. Problem- und Known-Error-Management

**Priorität:** P2  
Wiederkehrende Tickets werden einem Problemfall zugeordnet. Supporter pflegen Workarounds, Root Cause, betroffene Services und bekannte Fehler, bis ein dauerhafter Fix umgesetzt ist.

---

## F. Reporting und Servicequalität

### 44. Kunden-Dashboard

**Priorität:** P1  
Kundenverantwortliche sehen offene Vorgänge, Prioritäten, SLA-Stand, häufige Kategorien und Trends. Die Ansicht enthält nur RLS-autorisierte Daten des jeweiligen Kunden.

### 45. Support-Dashboard

**Priorität:** P1  
Für Gross ICT zeigt das Dashboard Ticketvolumen, Backlog, Alter, SLA-Risiken, Erstantwortzeit, Lösungszeit, Auslastung je Team und Kundenentwicklung.

### 46. Regelmässige Kundenberichte

**Priorität:** P2  
Monatliche oder quartalsweise PDF-/CSV-Berichte fassen Tickets, SLA, Trends, offene Risiken und Serviceverbesserungen zusammen. Der Versand wird pro Kunde konfiguriert und protokolliert.

### 47. Qualitätsstichproben

**Priorität:** P2  
Service Manager können gelöste Tickets stichprobenartig bewerten: Dokumentationsqualität, Kommunikation, SLA, fachliche Lösung und Kundenzufriedenheit.

### 48. Export mit Berechtigungsprüfung

**Priorität:** P2  
CSV-/PDF-Exporte benötigen eine explizite Rolle und werden im Audit protokolliert. Exportinhalte berücksichtigen immer Sichtbarkeit von internen Notizen und Kundenrechten.

---

## G. Integrationen, Sicherheit und Skalierung

### 49. E-Mail-to-Ticket und E-Mail-Threading

**Priorität:** P2  
Kundeneingänge per E-Mail erzeugen oder aktualisieren Tickets. Antworten werden sicher einem Ticket zugeordnet; automatische Antworten, externe Sichtbarkeit und Anhänge folgen klaren Regeln.

### 50. Service- und Asset-Bezug

**Priorität:** P3  
Tickets können betroffene Services, Geräte, Standorte, Verträge oder Konfigurationselemente referenzieren. Bei Störungen wird sichtbar, welche Kunden und Tickets betroffen sein könnten.

---

## Konkreter nächster Umsetzungsschnitt

1. **Ticketdetail, interne/externe Kommentare und Statuswechsel** (Vorschläge 1–4).
2. **Kundenrollen „eigene Tickets“ / „alle Firmentickets“** mit konfigurierbarem Zugriff je Kundenorganisation (23–26).
3. **Queue, Zuweisung und Triage** (5, 15–17).
4. **SLA-Grundmodell und Eskalationen** (31–37).
5. **Wissen aus Tickets** inklusive interner/externer Sichtbarkeit (39–42).

Damit entsteht zuerst ein belastbarer, sicherer Service-Desk-Kern; Automatisierung, Reporting, Integrationen und Asset Management bauen darauf auf.
