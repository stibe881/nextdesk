---
title: Handbuch für Agenten
description: Tickets annehmen, bearbeiten und lösen – Übersicht, Arbeitsplatz, Personensuche, Ticketliste, Ticketdetail, Wissensdatenbank und Stellvertretung.
audienceLabel: Agenten
updated: 2026-11-09
---

# Handbuch für Agenten

Dieses Handbuch richtet sich an alle, die in nextDesk Tickets bearbeiten.
Grundlagen wie Anmeldung, persönliche Einstellungen und die Mobile-App
beschreibt das _Handbuch für Mitarbeitende_, das Ihnen ebenfalls zur
Verfügung steht.

## Einführungstour

Beim ersten Login startet eine kurze **Einführung** (Startseite, Tickets,
Im Ticket, Benachrichtigungen, Darstellung). Sie können sie mit **Einführung
beenden** abbrechen und später über _Persönliche Einstellungen → Darstellung
anpassen → Einführung erneut starten_ wiederholen.

## Navigation

Die linke Navigation ist gegliedert in:

- **Übersicht** – Ihre Startseite mit Kennzahlen
- **Arbeitsplatz** – Team-Queues, Erwähnungen, Stellvertretung, Wiedervorlagen
- **Teamführung** – nur für Leitungen von Abteilungen
- **Arbeitsbereich**: Tickets, Shop, Fälle
- **Planung und Betrieb**: Raumplanung, Eintritte, Serviceaufgaben
- **Wissen und Ressourcen**: Wissensdatenbank, Assets, Lager, Verträge, Lizenzen
- **Dienste und Überwachung**: Dienste, Infrastruktur, Systemstatus
- **Berichte**

Welche Einträge Sie sehen, hängt von den freigeschalteten Funktionen und
Ihren Berechtigungen ab.

Das **Systemstatus-Badge** oben in der Navigation und die Seite
**Systemstatus** aktualisieren sich selbst (alle 30 Sekunden und beim
Zurückkehren in den Tab). In der **Infrastruktur** hat ein Gerät einen oder
mehrere **Dienste (für Systemstatus)**, die bei einer Überwachungsstörung
(PRTG) ihren Status ändern, die **Höheneinheit** als «von … bis» und
Wartungseinträge mit Datum und optionaler **Uhrzeit**. In der
**Wartungscheckliste** erfassen Sie jeden Punkt in einer eigenen Zeile mit
einem eigenen **Datum** (z. B. wann er erledigt wurde oder wann er dran ist);
**Punkt hinzufügen** ergänzt eine Zeile, × entfernt sie. In der Ansicht **Racks**
erfassen Sie mit **Rack erfassen** ein Rack (Name, Standort, Höhe in HE,
Notizen; einen fehlenden Standort legen Sie dort mit **+ Neuer Standort …**
an) und ändern es über den **Stift** am Rack. Ein neuer Name oder
Standort gilt auch für die Geräte im Rack; die Höhe muss mindestens bis zum
obersten Gerät reichen. Leere Racks lassen sich löschen.

Oben rechts stehen **+ (Erfassen)**, die **globale Suche** und die
**Benachrichtigungen**.

## Personen suchen und Personenübersicht

In der **globalen Suche** finden Sie als Agent auch **Personen**: alle
Mitarbeitenden aus Microsoft Entra sowie Ticketkontakte, die nicht im
Verzeichnis stehen. Suchen Sie nach Name, E-Mail-Adresse, Funktion oder
Abteilung. Die Reiter _Alle / Personen / Tickets …_ filtern die Treffer. Neben
dem Namen sehen Sie die Anzahl offener Tickets; gesperrte Konten sind als
**Deaktiviert** markiert. Mitarbeitende ohne Agentenrolle sehen keine Personen.

![Globale Suche mit Personen aus Microsoft Entra](images/ag-personensuche.jpg)

Ein Klick auf eine Person öffnet die **Personenübersicht**. Sie erreichen sie
auch im Ticket über den Namen unter **Anfragende Person** (in der App:
**Personenübersicht** unter der anfragenden Person).

- **Kopf**: Funktion, Abteilung, E-Mail, vorgesetzte Person, letzte Anmeldung
  und Kontostatus aus Entra. Mit **Ticket für … erfassen** öffnet sich das
  Ticketformular mit der Person als anfragender Person.
- **Kennzahlen**: offene Tickets (davon wartend auf die Person), Tickets der
  letzten 12 Monate, durchschnittliche Lösungszeit im Vergleich zum Mandanten
  und die **Zufriedenheit**.
- **Reiter**: **Tickets** (alle, auch geschlossene; filterbar nach _Alle /
  Offen / Geschlossen_), **Geräte** aus Intune und Assets (ein Klick öffnet das Gerät), **Lizenzen**,
  **Bestellungen** aus dem Shop und der **Verlauf** als Zeitleiste. Geräte,
  Lizenzen und Bestellungen erscheinen nur, wenn das Modul aktiv ist und Sie
  die Berechtigung dafür haben.
- **Häufige Themen**: die Kategorien, zu denen die Person am häufigsten
  Tickets erfasst.

Sie sehen nur Tickets, die Sie auch sonst öffnen dürfen.

> **Datenschutz:** Einzelne Bewertungen und Kommentare der Person werden nie
> angezeigt. nextDesk zeigt nur den **Durchschnitt** (mit Anteil zufriedener
> Bewertungen, Mandantenvergleich und Tendenz), schon ab der ersten Bewertung.

![Personenübersicht mit Tickets, Kennzahlen und Zufriedenheit](images/ag-person.jpg)

## Übersicht

Die **Übersicht** begrüsst Sie und zeigt für den gewählten Zeitraum
(_Heute / 7 Tage / 30 Tage_) die Kennzahlen **Offene Tickets**, **Meine
Tickets**, **Nicht zugewiesene Tickets** und **Gelöste Tickets**. Ein Klick
auf eine Kachel öffnet die passende gefilterte Liste.

Weitere Blöcke:

- **Priorisierte Tickets** und **Meine Prioritäten** – von der KI
  vorgeschlagene Reihenfolge; per Ziehen anpassen, **Neu priorisieren** oder
  **Eigene Reihenfolge verwerfen**
- **Freigaben** – Entscheidungen, die auf Sie warten
- **Meine Kennzahlen** – z. B. heute gelöst, Median der ersten Antwort
- **Gerade passiert** – die neuesten Ereignisse

Mit **Startseite anpassen** blenden Sie Blöcke ein oder aus.

![Übersicht mit Kennzahlen und priorisierten Tickets](images/ag-uebersicht.jpg)

## Arbeitsplatz

Der **Arbeitsplatz** bündelt Ihre persönliche Arbeit in Registern:

- **Team** – die **Team-Warteschlangen**: offene Tickets pro Team, Ihre
  eigenen Teams zuoberst (markiert mit _Mein Team_). Daneben steht, wie viele
  davon noch **ohne Bearbeiter** sind. **Ohne Teamzuordnung** sammelt offene
  Tickets, die noch keinem Team zugeteilt sind. Ein Klick zeigt genau diese
  Tickets in der Ticketliste (Filter «Warteschlange: …», mit × entfernen).
- **Erwähnungen** – wo Sie mit @ erwähnt wurden
- **Stellvertretung** – Tickets abwesender Kolleginnen und Kollegen
- **Störungen** – aktive Störungen
- **Wiedervorlagen** – Tickets, die Sie sich zu einem Datum vorgemerkt haben
- **Mein Bereich** – eigene Tickets, Geräte, Freigaben und **Phishing melden**

![Arbeitsplatz mit Registern und Team-Warteschlangen](images/ag-arbeitsplatz.jpg)

### Abwesenheit und Stellvertretung

Unter **Arbeitsplatz → Stellvertretung → Stellvertretung anlegen** wählen Sie
die stellvertretende Person, Beginn, Ende und eine Notiz und speichern mit
**Stellvertretung speichern**. Ihre Tickets erscheinen in dieser Zeit bei der
Stellvertretung.

### Phishing melden

Unter **Mein Bereich → Phishing melden** laden Sie eine verdächtige E-Mail
(.eml oder .msg) hoch oder fügen die Kopfzeilen ein und klicken auf
**Melden**. Daraus entsteht automatisch ein Sicherheitsticket.

## Ticketliste

Unter **Tickets** arbeiten Sie die Warteschlangen ab. Jede Ticketkarte zeigt
neben Nummer und Betreff auch die **anfragende Person** – in der Liste, auf
der Übersicht, im Kanban und in der App.

- **Queues**: Register pro Warteschlange. Arbeiten Sie in Teams mehrerer
  Supportstufen, erscheinen zusätzlich _Alle Stufen / 1st / 2nd / 3rd Level_.
- **Filter & Sortierung**: Suche, Status, Priorität, Agent (_Mir zugewiesen_,
  _Nicht zugewiesen_), Abteilung, Sortierung. **Filter zurücksetzen** stellt
  alles zurück.
- **Gespeicherte Ansichten**: Filter als **Neue Ansicht** speichern und auf
  Wunsch mit der Abteilung teilen («Teilen mit»).
- **Ansicht**: Listendichte (_Kompakt / Standard / Komfortabel_) und
  Listen-Detail-Ansicht (Liste links, Ticket rechts).
- **Mehrfachauswahl**: mehrere Tickets markieren → **Neuer Status** →
  **Status für Auswahl setzen**.

**Tastenkürzel:** `?` zeigt die Hilfe, `J`/`K` springen zum nächsten bzw.
vorherigen Ticket, `Enter` öffnet, `Esc` schliesst.

### Kanban

Über den Umschalter **Liste / Kanban** sehen Sie die Tickets als Spalten nach
Status. Ziehen Sie eine Karte in eine andere Spalte, um den Status zu ändern.

![Kanban-Ansicht nach Status](images/ag-kanban.jpg)

## Ein Ticket bearbeiten

Öffnen Sie ein Ticket mit einem Klick. Im Kopf- und Infobereich ändern Sie
direkt **Status**, **Priorität**, **Kategorie**, **Team** und **zugewiesene
Person**. Ein Klick auf den Namen der **anfragenden Person** öffnet ihre
Personenübersicht. Mit dem **Stift** in der Karte **Beschreibung** bearbeiten
Sie Betreff und Beschreibung direkt dort (**Beschreibung speichern** oder
Strg/⌘ + Enter).

Über der Beschreibung zeigt die kompakte **Ticket-Zeitachse** alle
Ereignisse, die Reaktions- und Lösungsfrist sowie längere Lücken. Darunter
folgt die **Unterhaltung** mit allen Nachrichten und Notizen.

Rechts unter der **Übersicht** liegt die Karte **Koordination**. Sie zeigt die
**Supportstufe** mit dem zuständigen Team (**An nächste Stufe übergeben**,
**Verlauf der Stufen**) sowie Teil-Tickets und Drittanbieter (**Aufteilen**,
**An Drittanbieter übergeben**).

Tickets aus E-Mails enthalten die E-Mail-Signatur nicht mehr. Stammt die Mail
von einer Adresse ausserhalb Ihrer Organisation, stehen unter **Anfragende
Person** zusätzlich die E-Mail-Adresse und alle Telefonnummern aus der
Signatur; ein Klick startet Anruf oder E-Mail.

Hat die anfragende Person genau ein Gerät (zugewiesen oder als primäre Person
in Intune), verknüpft nextDesk es beim Erstellen des Tickets automatisch. Bei
mehreren Geräten erscheinen sie unter **Asset / Katalogeintrag verknüpfen**
als **Geräte der anfragenden Person**; ein Klick verknüpft das passende Gerät.

![Ticketdetail mit Verlauf und Infobereich](images/ag-ticket-detail.jpg)

### Antworten und interne Notizen

Wählen Sie im Antwortbereich den Modus:

- **Antwort an anfragende Person** → **Externe Antwort senden**. Die Person
  sieht die Antwort im Portal und per E-Mail.
- **Interne Notiz** → **Interne Notiz speichern**. Nur für berechtigte
  Mitarbeitende sichtbar.

Praktische Helfer:

- **Antwort senden und als gelöst markieren** in einem Schritt
- `@Name` erwähnt Kolleginnen und Kollegen
- **Bilder hochladen**, **Makro anwenden**, **KI-Entwurf erstellen**
  (falls KI-Assistenz aktiv)

![Antwort an die anfragende Person schreiben](images/ag-antworten.jpg)

### Weitere Aktionen im Ticket

| Aktion                                      | Wofür                                                   |
| ------------------------------------------- | ------------------------------------------------------- |
| Anhang hochladen                            | Dateien zum Ticket ablegen                              |
| Beobachtende hinzufügen / Personen in Kopie | Weitere Personen informieren                            |
| Tickets zusammenführen                      | Doppelte Meldungen bündeln                              |
| Aufteilen                                   | Ein Ticket in mehrere Aufgaben trennen                  |
| An nächste Stufe übergeben                  | Eskalation an 2nd/3rd Level mit Übergabenotiz (Pflicht) |
| An Drittanbieter übergeben                  | Lieferanten einbeziehen, mit Erinnerung                 |
| Vorgesetzte Person fragen                   | Interne Rückfrage an die Abteilungsleitung              |
| Freigabe anfordern                          | Genehmigung einholen (z. B. Kosten, Berechtigungen)     |
| Wiedervorlage setzen                        | Ticket zu einem Datum wieder vorlegen                   |
| Arbeitszeit erfassen, Checkliste            | Aufwand und Arbeitsschritte dokumentieren               |
| Zusammenfassen (KI)                         | Kurzfassung langer Verläufe                             |
| Ticketakte als PDF                          | Ticket drucken oder ablegen                             |

### An Drittanbieter übergeben

Mit **An Drittanbieter übergeben** erfassen Sie einen Lieferantenfall, wenn eine
externe Firma das Problem lösen muss:

1. Wählen Sie den **Drittanbieter**.
2. Tragen Sie bei Bedarf die **externe Fallnummer** des Anbieters und eine
   **Notiz** ein.
3. Bestätigen Sie die Übergabe.

Das Ticket wechselt auf **Wartend auf Drittanbieter**. Antwortet der Anbieter
nicht innerhalb der beim Drittanbieter eingestellten Zeit (Voreinstellung 48
Stunden), werden Sie als zugewiesene Person automatisch erinnert. Ist das
Ticket noch niemandem zugewiesen, wird der Fall erfasst, der Status bleibt
aber **Neu**, bis es zugewiesen ist.

Erscheint stattdessen «Es sind noch keine Drittanbieter erfasst», hat der
Mandant noch keine Anbieter angelegt. Wer die Berechtigung **Automationen
verwalten** hat, erfasst sie in den Mandanteneinstellungen unter
SLA-Automatisierung (siehe Administrationshandbuch); sonst wenden Sie sich an
die Mandantenadministration.

Wird eine SLA verletzt, erfassen Sie die **Ursache der SLA-Verletzung**.

### Bewertung der anfragenden Person

Sobald ein Ticket **gelöst** ist, kann die anfragende Person es mit 1 bis 5
Sternen und einem Kommentar bewerten – im Web und in der iPhone-App. Eine
abgegebene Bewertung sehen Sie im Ticket unter «Bewertung der anfragenden
Person». Die Auswertung über alle Tickets finden Sie unter **Berichte →
Feedback-Themen** (mit KI-Assistenz zusätzlich nach Themen gruppiert).

## Ticket für jemanden erfassen

Über **+ → Ticket erfassen** öffnen Sie das Formular. Als Agent wählen Sie
die **anfragende Person** (Suche, «Mich auswählen» oder neue Person), füllen
Betreff, Einordnung, Priorität und Beschreibung aus und können direkt einen
**zugewiesenen Agenten** setzen. Abschliessen mit **Ticket erstellen**.

Im selben Menü erfassen Sie – je nach Freischaltung – auch Wiedervorlagen,
Fälle, Serviceaufgaben, Wissensartikel, Lagerartikel, Verträge und Lizenzen.

![Neues Ticket als Agent erfassen](images/ag-neues-ticket.jpg)

## Wissensdatenbank pflegen

Als Agent lesen Sie nicht nur Artikel, sondern schreiben sie auch:

1. **Neuer Artikel** – Titel, Inhalt (Markdown mit Bildern), Kategorie und
   Sichtbarkeit (_Intern_ oder _Extern_ für Mitarbeitende).
2. Optional **Mit KI aufbereiten** oder direkt aus einem gelösten Ticket
   **Entwurf mit KI erstellen**.
3. **Zur Freigabe einreichen** – nach der Prüfung wird der Artikel
   **veröffentlicht**. Veraltete Artikel **archivieren**.

Status: _Entwurf → Prüfung → Veröffentlicht_.

![Wissensdatenbank aus Sicht der Agenten](images/ag-wissen.jpg)

## Shop: Artikel nur für Kaderstufen

Im Shop legen Sie beim **Artikel hinzufügen** bzw. **Bearbeiten** unter
**Sichtbar für** fest, wer den Artikel sieht:

- **Alle Mitarbeitenden** (Standard) – keine Einschränkung.
- **Kaderstufe 1**, **2** und/oder **3** – nur Personen genau dieser Stufen
  sehen und bestellen den Artikel. Eine höhere Stufe sieht die Artikel tieferer
  Stufen nicht automatisch; kreuzen Sie dafür mehrere Stufen an.

Agenten sehen immer alle Artikel; eingeschränkte Artikel tragen das Etikett
«Nur Kaderstufe …». Bestellen Sie für eine andere Person, weist der Warenkorb
darauf hin, wenn ein Artikel für deren Kaderstufe nicht freigegeben ist – die
Bestellung ist trotzdem möglich.

Die Stufe einer Person ergibt sich aus ihrer **Funktion in Entra**. Die
Zuordnung pflegen Sie im Shop über **Kaderstufen** (z. B. Geschäftsleitung →
Kaderstufe 1, Fachbereichsleitung und Angebotsleitung → Kaderstufe 2,
Teamleitung → Kaderstufe 3). Dort können Sie für einzelne Personen eine Stufe
auch von Hand festlegen oder «Kein Kader» setzen. Ändert sich die Funktion in
Entra, gilt die neue Stufe nach dem nächsten Abgleich automatisch.

## Benachrichtigungen und Erreichbarkeit

- Die **Glocke** zeigt Zuweisungen, Erwähnungen, Antworten und Eskalationen.
- **Push-Benachrichtigungen** auf dem iPhone kommen ohne Einchecken. Unter
  _Persönliche Einstellungen → Benachrichtigungen → Benachrichtigungszeit_
  legen Sie fest, an welchen **Tagen** und zu welchen **Zeiten** Sie
  Mitteilungen erhalten (z. B. Mo–Fr, 06:00–17:00) oder ob **Jederzeit**. Was
  ausserhalb dieser Zeit anfällt, kommt zu Beginn der nächsten
  Benachrichtigungszeit.
- In der Tabelle **Benachrichtigungen** schalten Sie pro Benachrichtigung
  (z. B. Zuweisungen, Eskalationen, Erwähnungen) einzeln **Push** und
  **E-Mail** ein oder aus. Für Agenten sind zu Beginn alle Benachrichtigungen
  per Push und E-Mail eingeschaltet. E-Mails kommen über das Exchange-Postfach
  Ihres Unternehmens und sind verfügbar, sobald eines verbunden ist.
- Das iPhone-Widget **Meine Prioritäten** zeigt Ihre wichtigsten Tickets in
  den Farben Ihres Unternehmens. Öffnen Sie die App einmal, damit es aktuell
  ist.

## Persönliche Einstellungen

Zusätzlich zu den Karten für Mitarbeitende sehen Agenten:

- **Passwort setzen oder ändern** (ohne SSO)
- **Handbücher** – Handbuch für Mitarbeitende und Handbuch für Agenten

![Persönliche Einstellungen eines Agenten](images/ag-profil.jpg)

## Gute Praxis

- Neue Tickets zeitnah **zuweisen** – auch wenn Sie sie nicht sofort lösen.
- Für Rückfragen einen wartenden Status (z. B. «wartet») setzen, damit die SLA
  pausiert und die Person erinnert wird.
- Interne Informationen immer als **Interne Notiz**, nie als externe Antwort.
- Lösungen, die mehr als einmal gebraucht werden, als **Wissensartikel**
  festhalten.
