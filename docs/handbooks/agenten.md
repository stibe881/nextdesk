---
title: Handbuch für Agenten
description: Tickets annehmen, bearbeiten und lösen – Übersicht, Arbeitsplatz, Ticketliste, Ticketdetail, Wissensdatenbank und Stellvertretung.
audienceLabel: Agenten
updated: 2026-11-08
---

# Handbuch für Agenten

Dieses Handbuch richtet sich an alle, die in nextDesk Tickets bearbeiten.
Grundlagen wie Anmeldung, persönliche Einstellungen und die Mobile-App
beschreibt das *Handbuch für Mitarbeitende*, das Ihnen ebenfalls zur
Verfügung steht.

## Einführungstour

Beim ersten Login startet eine kurze **Einführung** (Startseite, Tickets,
Im Ticket, Benachrichtigungen, Darstellung). Sie können sie mit **Einführung
beenden** abbrechen und später über *Persönliche Einstellungen → Darstellung
anpassen → Einführung erneut starten* wiederholen.

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

Oben rechts stehen **+ (Erfassen)**, die **globale Suche** und die
**Benachrichtigungen**.

## Übersicht

Die **Übersicht** begrüsst Sie und zeigt für den gewählten Zeitraum
(*Heute / 7 Tage / 30 Tage*) die Kennzahlen **Offene Tickets**, **Meine
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

- **Team** – Tickets Ihrer Teams
- **Erwähnungen** – wo Sie mit @ erwähnt wurden
- **Stellvertretung** – Tickets abwesender Kolleginnen und Kollegen
- **Störungen** – aktive Störungen
- **Wiedervorlagen** – Tickets, die Sie sich zu einem Datum vorgemerkt haben
- **Mein Bereich** – eigene Tickets, Geräte, Freigaben und **Phishing melden**

![Arbeitsplatz mit Team-Queue](images/ag-arbeitsplatz.jpg)

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

Unter **Tickets** arbeiten Sie die Warteschlangen ab.

- **Queues**: Register pro Warteschlange; bei Supportstufen zusätzlich
  *Alle Stufen / 1st / 2nd / 3rd Level*.
- **Filter & Sortierung**: Suche, Status, Priorität, Agent (*Mir zugewiesen*,
  *Nicht zugewiesen*), Abteilung, Sortierung. **Filter zurücksetzen** stellt
  alles zurück.
- **Gespeicherte Ansichten**: Filter als **Neue Ansicht** speichern und auf
  Wunsch mit der Abteilung teilen («Teilen mit»).
- **Ansicht**: Listendichte (*Kompakt / Standard / Komfortabel*) und
  Listen-Detail-Ansicht (Liste links, Ticket rechts).
- **Mehrfachauswahl**: mehrere Tickets markieren → **Neuer Status** →
  **Status für Auswahl setzen**.

**Tastenkürzel:** `?` zeigt die Hilfe, `J`/`K` springen zum nächsten bzw.
vorherigen Ticket, `Enter` öffnet, `Esc` schliesst.

![Ticketliste mit Filtern und Status](images/ag-arbeitsplatz.jpg)

### Kanban

Über den Umschalter **Liste / Kanban** sehen Sie die Tickets als Spalten nach
Status. Ziehen Sie eine Karte in eine andere Spalte, um den Status zu ändern.

![Kanban-Ansicht nach Status](images/ag-kanban.jpg)

## Ein Ticket bearbeiten

Öffnen Sie ein Ticket mit einem Klick. Im Kopf- und Infobereich ändern Sie
direkt **Status**, **Priorität**, **Kategorie**, **Team** und **zugewiesene
Person**. Der **Verlauf** zeigt alle Nachrichten, Notizen und Änderungen
chronologisch; die SLA-Anzeige zeigt die verbleibende Zeit.

![Ticketdetail mit Verlauf und Infobereich](images/ag-ticket-detail.jpg)

### Antworten und interne Notizen

Wählen Sie im Antwortbereich den Modus:

- **Antwort an anfragende Person** → **Externe Antwort senden**. Die Person
  sieht die Antwort im Portal und per E-Mail.
- **Interne Notiz** → **Interne Notiz speichern**. Nur für berechtigte
  Mitarbeitende sichtbar.

Praktische Helfer:

- **Antwort senden und als gelöst markieren** in einem Schritt
- `/` im Textfeld fügt einen **Antwort-Baustein** ein (verwalten unter
  *Persönliche Einstellungen → Antwort-Bausteine*)
- `@Name` erwähnt Kolleginnen und Kollegen
- **Bilder hochladen**, **Makro anwenden**, **KI-Entwurf erstellen**
  (falls KI-Assistenz aktiv)

![Antwort an die anfragende Person schreiben](images/ag-antworten.jpg)

### Weitere Aktionen im Ticket

| Aktion                                    | Wofür                                                        |
| ----------------------------------------- | ------------------------------------------------------------ |
| Anhang hochladen                          | Dateien zum Ticket ablegen                                   |
| Beobachtende hinzufügen / Personen in Kopie | Weitere Personen informieren                               |
| Tickets zusammenführen                    | Doppelte Meldungen bündeln                                   |
| Aufteilen                                 | Ein Ticket in mehrere Aufgaben trennen                       |
| An nächste Stufe übergeben                | Eskalation an 2nd/3rd Level mit Übergabenotiz (Pflicht)      |
| An Drittanbieter übergeben                | Lieferanten einbeziehen, mit Erinnerung                      |
| Vorgesetzte Person fragen                 | Interne Rückfrage an die Abteilungsleitung                   |
| Freigabe anfordern                        | Genehmigung einholen (z. B. Kosten, Berechtigungen)          |
| Wiedervorlage setzen                      | Ticket zu einem Datum wieder vorlegen                        |
| Arbeitszeit erfassen, Checkliste          | Aufwand und Arbeitsschritte dokumentieren                    |
| Zusammenfassen (KI)                       | Kurzfassung langer Verläufe                                  |
| Ticketakte als PDF                        | Ticket drucken oder ablegen                                  |

Wird eine SLA verletzt, erfassen Sie die **Ursache der SLA-Verletzung**.

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
   Sichtbarkeit (*Intern* oder *Extern* für Mitarbeitende).
2. Optional **Mit KI aufbereiten** oder direkt aus einem gelösten Ticket
   **Entwurf mit KI erstellen**.
3. **Zur Freigabe einreichen** – nach der Prüfung wird der Artikel
   **veröffentlicht**. Veraltete Artikel **archivieren**.

Status: *Entwurf → Prüfung → Veröffentlicht*.

![Wissensdatenbank aus Sicht der Agenten](images/ag-wissen.jpg)

## Benachrichtigungen und Erreichbarkeit

- Die **Glocke** zeigt Zuweisungen, Erwähnungen, Antworten und Eskalationen.
- **Push-Benachrichtigungen** auf dem iPhone erhalten Sie nur, wenn Sie
  **eingecheckt** sind (*Persönliche Einstellungen → Push-Benachrichtigungen →
  Einchecken*, oder morgens in der App). Dort wählen Sie auch die
  Kategorien, z. B. Zuweisungen, Eskalationen, Erwähnungen.

## Persönliche Einstellungen

Zusätzlich zu den Karten für Mitarbeitende sehen Agenten:

- **Antwort-Bausteine** – eigene Textbausteine anlegen und bearbeiten
- **Passwort setzen oder ändern** (ohne SSO)
- **Datenschutz** → **Meine Daten exportieren**
- **Handbücher** – Handbuch für Mitarbeitende und Handbuch für Agenten

![Persönliche Einstellungen eines Agenten](images/ag-profil.jpg)

## Gute Praxis

- Neue Tickets zeitnah **zuweisen** – auch wenn Sie sie nicht sofort lösen.
- Für Rückfragen einen wartenden Status (z. B. «wartet») setzen, damit die SLA
  pausiert und die Person erinnert wird.
- Interne Informationen immer als **Interne Notiz**, nie als externe Antwort.
- Lösungen, die mehr als einmal gebraucht werden, als **Wissensartikel**
  festhalten.
