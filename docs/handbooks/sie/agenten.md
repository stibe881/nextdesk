---
title: Handbuch für Agenten
description: Tickets annehmen, bearbeiten und lösen – Übersicht, Arbeitsplatz, Personensuche, Ticketliste, Ticketdetail, Sicherheitsfälle, Störungen, Wissensdatenbank und Stellvertretung.
audienceLabel: Agenten
updated: 2026-11-13
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
- **Arbeitsbereich**: Tickets, Shop, Teams (nur mit Recht zur Shop-Verwaltung),
  Fälle
- **Sicherheit und Störungen**: Sicherheitsfälle, Störungen
  (nur für das zuständige Team, siehe unten)
- **Planung und Betrieb**: Raumplanung, Eintritte, Serviceaufgaben
- **Ressourcen**: Assets, Lager, Verträge, Lizenzen
- **Dienste und Überwachung**: Dienste, Infrastruktur, IP-Adressen,
  Systemstatus
- **Berichte**
- **Wissensdatenbank**

Welche Einträge Sie sehen, hängt von den freigeschalteten Funktionen und
Ihren Berechtigungen ab.

Zahlen neben den Einträgen zeigen, was auf Sie wartet: bei **Tickets** die
offenen Tickets, die noch keinem Agenten zugewiesen sind (auch wenn schon ein
Team gesetzt ist) – dieselbe Zahl wie in der Kachel «Nicht zugewiesene
Tickets» –, bei
**Sicherheitsfällen** die offenen Fälle, die noch niemandem zugewiesen
sind, bei **Störungen** die aktiven Störungen, die noch niemand bestätigt
hat, bei **Raumplanung**, **Shop** und
**Eintritte** die offenen Anfragen. Die Zahlen aktualisieren sich jede Minute.

In der **iOS- und Android-App** zeigt die untere Leiste dieselben Zahlen als
kleines Abzeichen am Symbol: bei **Tickets**, **Störungen** und **Phishing**
(den Sicherheitsfällen) sowie beim **Shop** die neuen Bestellungen, falls Sie
Bestellungen bearbeiten. Raumplanung und Eintritte gibt es in der App nicht.
Die Zahlen aktualisieren sich jede Minute, beim Zurückkehren in die App und
beim Wechsel des Tabs.

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
obersten Gerät reichen. Leere Racks lassen sich löschen. Geräte mit einer
aktiven Störung aus PRTG erscheinen im Rack rot mit blinkender Leuchte.

Oben rechts stehen **+ (Erfassen)**, die **globale Suche** und die
**Benachrichtigungen**.

## Personen suchen und Personenübersicht

In der **globalen Suche** finden Sie als Agent auch **Personen**: alle
Mitarbeitenden aus Microsoft Entra sowie Ticketkontakte, die nicht im
Verzeichnis stehen. Suchen Sie nach Name, E-Mail-Adresse, Funktion oder
Abteilung. Die Reiter _Alle / Personen / Tickets …_ filtern die Treffer. Neben
dem Namen sehen Sie die Anzahl offener Tickets; gesperrte Konten sind als
**Deaktiviert** markiert. Mitarbeitende ohne Agentenrolle sehen keine Personen.

Die Suche findet ausserdem **Störungen** (Nummer, Titel, Gerät) und
**Sicherheitsfälle** (Fallnummer, Betreff, Absender, meldende Person) – aber
nur für das jeweils zuständige Team (siehe unten). Ein Klick öffnet die
Störung bzw. den Fall direkt.

![Globale Suche mit Personen aus Microsoft Entra](images/ag-personensuche.jpg)

Ein Klick auf eine Person öffnet die **Personenübersicht**. Sie erreichen sie
auch im Ticket über den Namen unter **Anfragende Person** (in der App:
**Personenübersicht** unter der anfragenden Person).

- **Kopf**: Foto (aus Microsoft Entra, sonst die Initialen), Funktion,
  Abteilung, E-Mail, vorgesetzte Person, letzte Anmeldung und Kontostatus aus
  Entra. Mit **Ticket für … erfassen** öffnet sich das
  Ticketformular mit der Person als anfragender Person.
- **Kennzahlen**: offene Tickets (davon wartend auf die Person), Tickets der
  letzten 12 Monate, durchschnittliche Lösungszeit im Vergleich zum Mandanten
  und die **Zufriedenheit**.
- **Reiter**: **Tickets** (alle, auch geschlossene; filterbar nach _Alle /
  Offen / Geschlossen_), **Geräte** aus Intune und Assets (ein Klick öffnet das Gerät), **Lizenzen**,
  **Bestellungen** aus dem Shop und der **Verlauf** als Zeitleiste. Geräte,
  Lizenzen und Bestellungen erscheinen nur, wenn das Modul aktiv ist und Sie
  die Berechtigung dafür haben. Für das Sicherheitsteam kommt der Reiter
  **Sicherheitsfälle** dazu (von der Person gemeldete Phishing-Mails, mit
  Kennzeichen _Geklickt_), für das Störungsteam der Reiter **Störungen**
  (Störungen ihrer Geräte in den letzten 12 Monaten).
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
  **Eigene Reihenfolge verwerfen**. Über den Tickets stehen Ihnen zugewiesene
  offene **Störungen** und **Sicherheitsfälle** (dringende rot markiert, z. B.
  Ausfall unbestätigt, Urteil überfällig oder «Melder hat geklickt»);
  Sicherheitsfälle erscheinen nicht mehr als Ticket.
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
**Melden**. In Outlook geht es auch mit **Melden → Phishing melden**. Daraus
entsteht ein Sicherheitsfall (siehe unten).

## Sicherheitsfälle

**Sicherheitsfälle** (in der App **Phishing**) sehen nur die Mitglieder des
Sicherheitsteams, das in den Phishing-Einstellungen gewählt ist. Ohne gewähltes
Team sehen sie alle Agenten.

Gemeldete Phishing-Mails erscheinen nicht in der Ticketliste (weder im Web
noch in der App), sondern unter **Sicherheitsfälle**. Meldet mehr als eine Person dieselbe E-Mail, entsteht
nur ein Fall; alle Melder hängen daran (Kennzeichen **Kampagne**). Ähnliche
Mails (gleiche Absenderdomain mit ähnlichem Betreff oder gleichen
Link-Domains) fasst nextDesk zusätzlich zu einer **Kampagne** über mehrere
Fälle zusammen; ab drei meldenden Personen erhält das Sicherheitsteam eine
Benachrichtigung. Die Kacheln
zeigen, was zu beurteilen ist, wie viele Fälle noch Massnahmen haben, die
Meldungen von heute, die mittlere Zeit bis zum Urteil und wie oft Melder
angegeben haben, geklickt zu haben.

Ein Klick auf eine Kachel zeigt darunter die passenden Fälle: _Meldungen
heute_ die heute gemeldeten, _Zeit bis Urteil_ die in den letzten 30 Tagen
beurteilten, _Geklickt_ die Fälle, bei denen jemand angegeben hat, geklickt zu
haben. **Filter aufheben** führt zurück zu den Fällen, die zu beurteilen sind.

![Liste der Sicherheitsfälle](images/ag-sicherheitsfaelle.jpg)

Ein Klick öffnet den Fall. Die gemeldete E-Mail steht in einer **sicheren
Ansicht**: Links sind entschärft (`hxxps`, `[.]`) und nicht anklickbar, Bilder
werden nicht geladen und Anhänge erscheinen nur mit Name und Grösse. Daneben
stehen die Befunde der automatischen Analyse (SPF, DKIM, DMARC, Absender,
Links, Anhänge) und die Risikoeinschätzung. Bei hohem Risiko soll das Urteil
innerhalb von 30 Minuten fallen, bei mittlerem innerhalb von 4 Stunden,
sonst innerhalb eines Tages.

![Sicherheitsfall mit sicherer Ansicht und Urteil](images/ag-sicherheitsfall.jpg)

Unter **Zuständig** weisen Sie den Fall einer Person zu (oder mit **Mir
zuweisen** sich selbst). Zur Auswahl stehen die Agenten, die den Fall
bearbeiten dürfen, bei einem Team die Mitglieder dieses Teams. In der Liste
steht bei jedem Fall, wer zuständig ist.

So bearbeiten Sie einen Fall:

1. **Urteil fällen**: _Harmlos_, _Spam_, _Phishing_ oder _Gezielter Angriff_
   wählen und bestätigen. Alle Melder erhalten danach automatisch eine E-Mail
   mit dem Ergebnis.
2. **Massnahmen abarbeiten**: Je nach Urteil erscheint eine Checkliste (z. B.
   Absender sperren, Mail aus allen Postfächern entfernen). Haken Sie erledigte
   Schritte ab.
3. **Melder fragen: geklickt?** schickt allen Meldern eine kurze Rückfrage.
   Ihre Antwort (_Geklickt_ / _Nicht geklickt_) erscheint bei der Person; wer
   geklickt hat, löst eine Benachrichtigung an das Sicherheitsteam aus.
4. **Fall abschliessen**, sobald alles erledigt ist. Bei _Harmlos_ ohne
   Massnahmen schliesst sich der Fall direkt nach dem Urteil.

### Kontext und Massnahmen

Im Fall zeigt die Karte **Kontext und Massnahmen** zu jeder meldenden Person
Funktion, Abteilung, vorgesetzte Person, die letzte Anmeldung aus Microsoft
Entra (falls synchronisiert) und ihre Geräte mit Intune-Status (Compliance,
letzte Synchronisation) und IP-Adressen aus der IP-Verwaltung (Subnetz, VLAN,
Standort, Switch-Port). Nennt die gemeldete Mail eine IP-Adresse oder einen
Host aus dem eigenen Netz (bekanntes Subnetz, bekannte Adresse oder private
Adresse), erscheint der Hinweis **Interne Adresse!** – das kann auf ein
kompromittiertes internes Gerät oder Konto hindeuten.

Antwortet eine Person auf die Rückfrage mit **«Ja, ich habe geklickt»**,
erhält das Sicherheitsteam sofort eine Benachrichtigung und der Fall bekommt
die Priorität _hoch_. Bei der Person stehen dann diese Massnahmen bereit
(jede mit Bestätigungsdialog):

- **Gerät synchronisieren** und **Defender-Schnellscan** (Windows) über Intune
  – nur, was Intune für das Gerät anbietet. Ein Gerät **isolieren** ist nur
  direkt in Microsoft Defender möglich.
- **Sitzungen widerrufen** und **Passwort-Reset erzwingen** in Microsoft
  Entra. Fehlt der nextDesk-App dafür die Berechtigung, erscheint eine klare
  Meldung; die Checkliste bleibt, und Sie erledigen den Schritt im Entra Admin
  Center.
- **Ersatzgerät bestellen**: bestellt einen Shop-Artikel im Namen der Person
  mit dem Hinweis «Ersatzgerät aus Sicherheitsfall …». Verlangt der Artikel
  eine Genehmigung, wird diese wie üblich angefordert.

Jede Massnahme steht mit Ergebnis unter **Ausgeführte Massnahmen** und im
Verlauf des Falls.

### Kampagnen und IOC-Liste

Unter **Kampagnen & IOC** sehen Sie die erkannten Kampagnen mit allen
zugehörigen Fällen und die **IOC-Liste**: Domains, URLs, sendende IPs und
Absender aus allen Fällen mit dem Urteil _Spam_, _Phishing_ oder _Gezielter
Angriff_. Jede neue Meldung wird dagegen geprüft; Treffer stehen im Fall unter
**Bekannte Indikatoren** und als interne Notiz. Ist ein Eintrag unbedenklich
(z. B. ein missbrauchter, aber seriöser Dienst), markieren Sie ihn **als
harmlos** – er löst dann keine Treffer mehr aus.

### Eskalation

Ist das Urteil überfällig, erhält das Sicherheitsteam eine Benachrichtigung;
nach weiteren 24 Stunden ohne Urteil gehen sie an die Vorgesetzten der
Abteilung (Rolle «Vorgesetzter Agent»). Mitglieder des Sicherheitsteams
erhalten neue Meldungen, Klicks, Kampagnen und Eskalationen immer – auch wenn
sie die Phishing-Meldungen in den Benachrichtigungen nicht eingeschaltet
haben.

Melder bekommen für Phishing-Meldungen keine Eingangsbestätigung, nur eine
Dankesnachricht und später das Ergebnis.

In der **iOS- und Android-App** heisst der Bereich **Phishing** (untere
Leiste, links vom Home-Knopf). Dort fällen Sie das Urteil, weisen den Fall zu,
haken Massnahmen ab, fragen die Melder nach einem Klick und schliessen den
Fall ab. Ein Tipp auf eine Phishing-Mitteilung öffnet den Fall direkt. Die
App zeigt auch Kampagne, bekannte Indikatoren und ausgeführte Massnahmen; die
Massnahmen selbst lösen Sie im Web aus.

## Störungen

**Störungen** sehen nur die Mitglieder des Teams für die Alarmierung aus den
PRTG-Einstellungen. Ohne gewähltes Team sehen sie alle Agenten.

Meldungen aus PRTG landen nicht in der Ticketliste, sondern unter
**Störungen** im Arbeitsbereich. Ein Ticket braucht es dafür nicht: Sie
bearbeiten die Störung vollständig dort.

**Externe Störungen**: Zusätzlich erscheinen Störungen, die Anbieter auf ihren
offiziellen Statusseiten melden (z. B. Microsoft 365 mit Teams, Outlook,
OneDrive und SharePoint, GitHub, Claude, Gemini, App Store, Google Play,
Init7), gekennzeichnet mit **Extern · Anbieter**. Sie zeigen, dass die Ursache
beim Anbieter liegt und nicht in Ihrem Netz, z. B. wenn mehrere Personen
melden, dass Teams nicht geht. Das Team wird beim Auftreten benachrichtigt (ohne Wiederholungsalarm); meldet der Anbieter die Störung als
behoben, schliesst sie sich automatisch. **Statusseite des Anbieters öffnen**
führt zu den Details beim Anbieter. Neue Texte des Anbieters erscheinen im
Verlauf als «Update vom Anbieter»; das Team erhält dazu eine Benachrichtigung
(«Update: Anbieter» mit dem neuen Text) und eine weitere, sobald der Anbieter
die Störung als behoben meldet («Behoben: Anbieter»). Externe Störungen müssen weder bestätigt
noch zugewiesen werden; von Hand abschliessen ist nur nötig, wenn die Meldung
beim Anbieter hängen bleibt.

- **Eine Störung pro Gerät**: Weitere Sensoren desselben Geräts (z. B. Ping
  und SNMP) hängen an derselben Störung. Kommt das Gerät innerhalb von
  10 Minuten erneut in Störung, öffnet sich die bisherige Störung wieder.
- **Folgestörungen**: Fällt ein Gerät aus, das hinter einem bereits gestörten
  Gerät hängt (Uplink in der Infrastruktur), erscheint es eingerückt als
  Folgestörung und wird nicht separat alarmiert. Es behebt sich mit der
  Ursache.
- **Alarmierung**: Sobald PRTG eine Störung meldet, erhält das in den
  Monitoring-Einstellungen gewählte Team (ohne Team alle Agenten) sofort eine
  Push-Mitteilung und eine E-Mail. Solange niemand die Störung bestätigt, wird
  in dem eingestellten Abstand (Standard 15 Minuten) erneut alarmiert. Wird
  aus einer Warnung ein Ausfall, kommt ebenfalls ein Alarm. Während einer
  Wartung im Systemstatus wird die Störung erfasst, aber nicht alarmiert.
- **Kacheln**: _Aktiv_ (Ausfälle und Warnungen), _Unbestätigt_ (mit der
  ältesten offenen Zeit), _Betroffene Dienste_, _Behebungszeit_ (Median der
  letzten 30 Tage) und _Verfügbarkeit_ der überwachten Geräte. Ein Klick auf
  eine Kachel zeigt darunter die passenden Störungen; **Filter aufheben** führt
  zurück zu den aktiven.
- **Register**: _Aktiv_, _Behoben_ und _Alle_. Die Dauer läuft live mit, und neue
  Meldungen erscheinen ohne Neuladen. Im Suchfeld finden Sie Störungen nach
  Nummer, Gerät oder Titel; ältere Störungen laden Sie mit **Weitere Störungen
  laden** nach.
- **Automatisch abgeschlossen**: Meldet PRTG für alle Sensoren wieder OK,
  wird die Störung automatisch abgeschlossen und erscheint unter _Behoben_.
  Sie muss weder bestätigt noch von Hand abgeschlossen werden, und die
  Alarmierung hört auf. Die **Ursache** tragen Sie bei Bedarf unter **Ursache
  nachtragen (optional)** nach; dort lassen sich auch zugeordnete Tickets
  informieren und ein Fall eröffnen (siehe unten).
- **Tickets zur Störung**: Gehen während einer aktiven Störung Tickets zum
  betroffenen Gerät oder Dienst ein (Gerät bzw. Dienst am Ticket verknüpft
  oder Gerätename, Hostname oder IP-Adresse im Text), ordnet nextDesk sie der
  Störung automatisch zu. Im Ticket steht dann «Gehört zur Störung STO-…».

![Liste der Störungen mit Folgestörungen](images/ag-stoerungen.jpg)

Ein Klick öffnet die Störung:

1. **Bestätigen: ich kümmere mich** stoppt die erneute Alarmierung und weist
   Ihnen die Störung zu, falls noch niemand zuständig ist. Unter
   **Zuständig** ändern Sie die Person (oder **Mir zuweisen**).
2. Der **Verlauf** zeigt alle PRTG-Meldungen und was in nextDesk geschah
   (geöffnet, alarmiert, bestätigt, Notizen). Mit **Notiz zum Verlauf
   hinzufügen** halten Sie fest, was Sie geprüft oder veranlasst haben.
3. **Letzte 24 Stunden** zeigt, wann das Gerät gestört war, und warnt, wenn
   es in dieser Woche mehrfach ausgefallen ist. Darunter stehen die
   **Sensoren** mit ihrem letzten Stand. Wie beim Ticketstatus zeigt ein
   farbiges Abzeichen den Zustand jedes Sensors: **Fehler** (rot), **Warnung**
   (gelb) oder **OK** (grün).
4. Unter **Tickets** stehen die zugeordneten Tickets mit dem Grund der
   Zuordnung (Gerät, Dienst, im Text, von Hand). Mit **Ticketnummer
   zuordnen** ergänzen Sie ein Ticket, mit **×** lösen Sie eines wieder; ein
   gelöstes Ticket wird nicht erneut automatisch zugeordnet.
5. Rechts sehen Sie **Gerät** (Ort, Adresse, PRTG-Objekt), **Netzwerk** (zu
   Beginn eingeklappt, mit IP und Anzahl Nachbarn; ein Klick klappt auf: IP,
   Subnetz, VLAN, Standort und Switch-Port aus der IP-Adressverwaltung sowie
   weitere Geräte im selben Subnetz bzw. am selben Switch mit ihrem aktuellen
   Zustand; im Web wie in der App), die **Abhängigkeiten** (vorgelagerte Geräte und Folgestörungen)
   und die **betroffenen Dienste**. Der Systemstatus wird automatisch gesetzt
   und nach der Behebung zurückgesetzt.
6. Unter **Statusseite** veröffentlichen Sie mit **Öffentliche Meldung** eine
   Meldung (Zustand, Titel, Text) auf der Statusseite und ergänzen sie später
   mit **Update veröffentlichen**. Unter **Betroffene Dienste und
   Betriebszustand** stehen die verknüpften Dienste und die Dienste der letzten
   Meldung; unter **Dienst hinzufügen** suchen Sie nach Name oder Kategorie
   und wählen weitere Dienste aus der Statusseite, auch bei externen
   Störungen. Pro Dienst stellen Sie direkt den
   Betriebszustand ein (Betriebsbereit, Beeinträchtigte Leistung, Teilweiser
   Ausfall, Schwerwiegender Ausfall, Wird gewartet). Mit dem Zustand
   **Behoben** werden die gewählten Dienste auf «Betriebsbereit» gesetzt; Sie
   können das vor dem Veröffentlichen noch ändern. Eine bereits
   veröffentlichte Meldung korrigieren Sie mit **Bearbeiten** (Zustand, Titel,
   Text, Dienste) und **Änderungen speichern**.
7. **Abschliessen bzw. Ursache nachtragen**: Wählen Sie die **Ursache** (Strom, Netzwerk, Hardware,
   Software, Wartung, Extern, Unbekannt) und halten Sie die Lösung fest. Sind
   Tickets zugeordnet, ist **Tickets informieren und auf «Gelöst» setzen**
   eingeschaltet: Jedes offene Ticket erhält eine öffentliche Antwort mit der
   Ursache (Text anpassbar, Versand per Mail wie gewohnt) und wird gelöst.
   Tickets, für die Ihnen die Berechtigung fehlt oder bei denen die Ursache
   einer SLA-Verletzung noch fehlt, werden ausgelassen und nach dem Abschluss
   aufgeführt. Mit **Fall eröffnen** legen Sie gleichzeitig einen Fall
   (Problem-Management) mit Tickets und Diensten der Störung an. Eine noch
   aktive Störung schliessen Sie ebenso ab, etwa wenn ein «Up» von PRTG
   verloren ging; Folgestörungen werden mit abgeschlossen.
8. War das Gerät in 30 Tagen mindestens dreimal gestört (oder trat dieselbe
   Ursache dreimal auf), schlägt die Karte **Fall** mit **Fall vorschlagen**
   einen Fall vor; frühere Störungen des Geräts werden auf Wunsch verknüpft.
9. Bei einer abgeschlossenen Störung mit Ursache erstellt **Wissen →
   Wissensartikel-Entwurf erstellen** einen internen Artikelentwurf (Symptom,
   Ursache, Lösung, Vorbeugung) – mit KI, wenn sie für den Mandanten
   freigegeben ist, sonst aus den Angaben der Störung. Prüfen und
   veröffentlichen Sie ihn in der Wissensdatenbank.

![Störung mit Verlauf, Gerät und Abhängigkeiten](images/ag-stoerung.jpg)

Über **Auswertung** sehen Sie für 30 oder 90 Tage die Anzahl Störungen, die
mittlere Behebungszeit, die Verfügbarkeit, die häufigsten Ursachen und die
Geräte mit den meisten Störungen.

Die Benachrichtigungen dazu schalten Sie unter _Persönliche Einstellungen →
Benachrichtigungen → Störungen_ (Push und E-Mail) ein oder aus.

In der **iOS- und Android-App** finden Sie **Störungen** in der unteren Leiste
links vom Home-Knopf (Tickets, Störungen, Phishing). Dort sehen Sie die aktiven,
unbestätigten, behobenen und abgeschlossenen Störungen samt Folgestörungen,
bestätigen sie, weisen sie zu, ergänzen Notizen und schliessen sie mit Ursache
ab – auf Wunsch mit Antwort an die zugeordneten Tickets. Die Störung zeigt auch
die Tickets und den Netzwerk-Kontext. Ein Tipp auf eine Störungs-Mitteilung
öffnet die Störung direkt.

## Ticketliste

Unter **Tickets** arbeiten Sie die Warteschlangen ab. Jede Ticketkarte zeigt
neben Nummer und Betreff auch die **anfragende Person** – in der Liste, auf
der Übersicht, im Kanban und in der App.

- **Queues**: Register pro Warteschlange. Arbeiten Sie in Teams mehrerer
  Supportstufen, erscheinen zusätzlich _Alle Stufen / 1st / 2nd / 3rd Level_.
  Wählen Sie eine Stufe, zeigen auch die Kacheln oben nur die Zahlen dieser
  Stufe.
- **Filter & Sortierung**: Suche, Status (Mehrfachauswahl: mehrere Status
  gleichzeitig ankreuzen), Priorität, Agent (_Mir zugewiesen_,
  _Nicht zugewiesen_), Abteilung, Sortierung. **Filter zurücksetzen** stellt
  alles zurück.
- **Gespeicherte Ansichten**: Filter als **Neue Ansicht** speichern und auf
  Wunsch mit der Abteilung teilen («Teilen mit»).
- In der **iOS- und Android-App** wählen Sie in der Ticketliste unter **Status**
  einen oder mehrere Status gleichzeitig; **Zurücksetzen** hebt die Auswahl auf.
- **Ansicht**: Listendichte (_Kompakt / Standard / Komfortabel_) und
  Listen-Detail-Ansicht (Liste links, Ticket rechts).
- **Mehrfachauswahl**: mehrere Tickets markieren → **Neuer Status** →
  **Status für Auswahl setzen**.
- **SLA-Anzeige**: Jede Karte zeigt die verbleibende Zeit bis zur
  Lösungsfrist; Tickets in einem wartenden Status zeigen stattdessen **«SLA
  pausiert seit …»** (siehe «SLA-Pause in wartenden Status»).
- **Suchfilter im Suchfeld**: `status:offen`, `prio:hoch`, `queue:ict`,
  `agent:mir` sowie `sla:kritisch` (Lösungsfrist in weniger als 1 Stunde oder
  überschritten), `sla:warnung` (1 bis 4 Stunden), `sla:ok` (mehr als
  4 Stunden oder ohne Frist) und `sla:pausiert` (SLA pausiert, Ticket in
  einem wartenden Status). Pausierte Tickets erscheinen nur unter
  `sla:pausiert`, nie unter `sla:kritisch`, `sla:warnung` oder `sla:ok`.

### Gelöschte Tickets (Papierkorb)

Mit der Berechtigung zum Löschen können Sie markierte Tickets über
**Löschen** entfernen. Sie kommen in den **Papierkorb**: Sie sind nirgends mehr
sichtbar (Listen, Suche, Berichte, App), lösen keine Benachrichtigungen oder
Mails mehr aus und lassen sich **90 Tage lang wiederherstellen**. Danach werden
sie automatisch endgültig entfernt, samt Kommentaren und Anhängen.

Den Papierkorb öffnen Sie in der Ticketliste über **Filter & Sortierung →
Gelöschte Tickets anzeigen**. Dort sehen Sie, wer ein Ticket wann gelöscht hat
und wie lange es noch wiederherstellbar ist. Ein Klick zeigt das Ticket mit
Beschreibung und Verlauf; **Wiederherstellen** holt es unverändert zurück.

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

Oben rechts im Ticketkopf sehen Sie als runde Profilbilder (ohne Foto: Kürzel)
alle Kolleginnen und Kollegen, die das Ticket gerade geöffnet haben. Bewegen Sie die Maus über ein
Bild, sehen Sie den Namen. Ein grüner Rand bedeutet, dass die Person gerade
etwas ändert; so vermeiden Sie doppelte Arbeit.

**Status ändern heisst Ticket übernehmen:** Wer den Status eines Tickets ändert
(im Ticketdetail, auf der Kachel in Liste und Kanban oder in der App), wird
automatisch als **zugewiesene Person** eingetragen, sofern er oder sie das
Ticket bearbeiten darf. Das gilt auch für ein neues, noch nicht zugewiesenes
Ticket: der Status «Neu» lässt sich dann direkt ändern. Wählen Sie im selben
Schritt eine andere Person aus, gilt diese Auswahl. Bei der Mehrfachauswahl
(Sammelaktion) wird nicht automatisch zugewiesen.

Über der Beschreibung zeigt die kompakte **Ticket-Zeitachse** alle
Ereignisse, die Reaktions- und Lösungsfrist sowie längere Lücken. Darunter
folgt die **Unterhaltung** mit allen Nachrichten und Notizen. Dateien
erscheinen direkt bei der Nachricht, zu der sie gehören – auch die Anhänge der
E-Mail, aus der das Ticket entstanden ist (unter der Beschreibung). Bilder
werden als Vorschau gezeigt, andere Dateien öffnen Sie mit **Öffnen**.

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
  Im Antwortfeld steht bereits die Begrüssung «Liebe Vorname» bzw. «Lieber
  Vorname» (nach dem Vornamen; bei nicht eindeutigen Namen «Guten Tag
  Vorname») mit Platz darunter; ein Klick ins Feld setzt den Cursor direkt dahinter. Sie können die
  Begrüssung ändern oder löschen. Eine Antwort, die nur aus der Begrüssung
  besteht, wird nicht gesendet.
  Eine Antwort ist jederzeit möglich, auch wenn Felder wie die Kategorie noch
  leer sind. Ist das Ticket noch niemandem zugewiesen, wird es mit dem Senden
  der Person zugewiesen, die geantwortet hat (sofern sie für das Ticket
  zuweisbar ist). Ein neues Ticket wechselt dabei automatisch auf **In
  Bearbeitung**. Pflichtfelder gelten erst beim Lösen oder Schliessen.
- **Interne Notiz** → **Interne Notiz speichern**. Nur für berechtigte
  Mitarbeitende sichtbar.

Unter dem Antwortfeld können Sie Ihren Text mit **Mit KI umformulieren** von
der KI überarbeiten lassen (falls KI-Assistenz aktiv): **Kurz** macht ihn knapp
und auf den Punkt, **Ausführlich** erklärt die genannten Schritte vollständig.
Die KI schreibt die anfragende Person immer per Du an. Der Ton ist immer professionell, aber persönlich und freundlich; die KI erfindet
keine Fakten, Zusagen oder Termine. Eine vorhandene Begrüssung bleibt
bestehen. Mit **Original wiederherstellen** holen Sie Ihren Text zurück. In der
iPhone- und der Android-App heissen die Knöpfe unter dem Nachrichtenfeld **KI
kurz** und **KI ausführlich** (mit **Original** zum Zurückholen).

Praktische Helfer:

- **Antwort senden und als gelöst markieren** in einem Schritt
- `@Name` erwähnt Kolleginnen und Kollegen
- **Dateien anhängen** (Bilder, PDF, Word, Excel, TXT, CSV; bis 5 Dateien pro
  Nachricht), **Makro anwenden**, **KI-Entwurf erstellen**
  (falls KI-Assistenz aktiv)

![Antwort an die anfragende Person schreiben](images/ag-antworten.jpg)

### Anhänge

Unter der **Beschreibung** zeigt eine schlanke Zeile alle **Anhänge** als Chips
(Typ-Symbol oder Bildvorschau, Name, Grösse). Ein Klick lädt die Datei herunter,
das **×** löscht sie nach Rückfrage. Ab fünf Dateien erscheint **+n weitere**.
Mit **+ Anhang** wählen Sie eine oder mehrere Dateien aus; Sie können sie auch
direkt auf die Zeile ziehen (max. 25 MiB pro Datei).

### Weitere Aktionen im Ticket

| Aktion                                      | Wofür                                                   |
| ------------------------------------------- | ------------------------------------------------------- |
| Anhang hinzufügen                           | Dateien zum Ticket ablegen                              |
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

Wird eine SLA verletzt, erfassen Sie die **Ursache der SLA-Verletzung**. Das
ist Pflicht: Ein Ticket mit verletzter SLA lässt sich erst **lösen oder
schliessen**, wenn die Ursache erfasst ist (auch bei der Sammelaktion). Beim
Abschluss kann sie direkt im Bestätigungsfeld eingetragen werden.

### SLA-Pause in wartenden Status

In den Status **Wartend**, **Wartend auf Kunde** und **Wartend auf
Drittanbieter** hält die SLA an (die Mandantenadministration kann das pro
Status ändern, siehe Administrationshandbuch). Solange ein Ticket in einem
dieser Status ist:

- zeigen Ticketliste, Übersicht, Ticketkopf und App **«SLA pausiert seit …»**
  statt der verbleibenden Zeit;
- wird keine SLA-Verletzung ausgelöst und keine Warnung «SLA in Gefahr»
  verschickt; das Ticket zählt nicht als überfällig (Teamführung, Meine
  Prioritäten, Zeitregeln «SLA läuft bald ab») und nicht als «SLA
  überschritten» in den Drilldowns der Berichte;
- finden Sie es in der Ticketliste mit dem Suchfilter `sla:pausiert`;
- bleibt die Pause bestehen, wenn Sie zwischen zwei wartenden Status wechseln.

Setzen Sie das Ticket wieder auf einen bearbeitenden Status (z. B. **In
Bearbeitung**), läuft die SLA weiter: Die Fristen für Erstantwort (falls noch
offen) und Lösung werden um die pausierte Zeit verschoben. Gezählt wird nur
die **Servicezeit** der SLA-Regel – bei Geschäftszeiten also nur die Stunden
innerhalb der Geschäftszeiten. Schliessen Sie ein pausiertes Ticket direkt ab,
endet die Pause ebenfalls; die Wartezeit zählt auch dann nicht gegen die SLA.
Eine Frist, die **vor** Beginn der Pause schon überschritten war, bleibt
überschritten. Antworten Sie der anfragenden Person zum ersten Mal, während
das Ticket noch wartet, wird die Reaktionsfrist um die bis zur Antwort
pausierte Zeit verschoben. Berichte und SLA-Einhaltung messen gelöste
Tickets an den verschobenen Fristen. In der **Ticket-Zeitachse** zeigt eine
pausierte Frist **«SLA pausiert, Restzeit …»**.

Im Verlauf des Tickets sehen Sie **SLA pausiert («Status»)** und **SLA
fortgesetzt, Fristen um … Servicezeit verschoben**.

### Bewertung der anfragenden Person

Sobald ein Ticket **gelöst** ist, kann die anfragende Person es mit 1 bis 5
Sternen und einem Kommentar bewerten – im Web und in der iPhone-App. Eine
abgegebene Bewertung sehen Sie im Ticket unter «Bewertung der anfragenden
Person». Die Auswertung über alle Tickets finden Sie unter **Berichte →
Feedback-Themen** (mit KI-Assistenz zusätzlich nach Themen gruppiert).

## Ticket für jemanden erfassen

Über **+ → Ticket erfassen** öffnen Sie das Formular. Als Agent wählen Sie
die **anfragende Person** (Suche, «Mich auswählen» oder neue Person), füllen
Betreff, Einordnung, Priorität und Beschreibung aus (Zusammenfassung links, Abschnitte rechts, Pflichtfelder mit **\***) und können direkt einen
**zugewiesenen Agenten** setzen. Abschliessen mit **Ticket erstellen**.

Im selben Menü erfassen Sie – je nach Freischaltung – auch Wiedervorlagen,
Fälle, Serviceaufgaben, Wissensartikel, Lagerartikel, Verträge und Lizenzen.

![Neues Ticket als Agent erfassen](images/ag-neues-ticket.jpg)

## Dienste und Systemstatus

Unter **Dienste** öffnet **Details** bei einem Dienst die Dienstansicht:

- **Verfügbarkeit** der letzten 30 und 90 Tage, der Anteil geplanter Wartung
  und die Verfügbarkeit ohne Wartung gerechnet
- die **Geräte** des Dienstes mit IP-Adresse, Subnetz, VLAN und Switch-Port
  (aus der IP-Adressverwaltung) und ihrem **Monitoring-Zustand**; fällt ein
  Gerät aus, steht oben «Betroffen durch Ausfall» mit dem Gerät und der
  Störung
- die **Subnetze**, deren Adressen dem Dienst zugeordnet sind

Die Dienste eines Geräts pflegen Sie in der **Infrastruktur** (mehrere Dienste
möglich); im Asset-Katalog gilt der gewählte Dienst als erster Dienst des
Geräts, weitere bleiben erhalten. Die **Assets** laden seitenweise: Suche und
Filter wirken auf alle Assets, **Weitere Assets laden** zeigt die nächsten.

In einer **Serviceaufgabe**, deren Gerät Dienste hat, plant **Wartungsfenster
planen** ein Fenster im Systemstatus (Beginn und Ende, optional öffentlich).
Während des Fensters stehen die Dienste auf Wartung; danach setzt nextDesk sie
automatisch zurück. Der Abschluss der Aufgabe trägt die Wartung ins
Wartungsprotokoll des Geräts ein.

## Wissensdatenbank pflegen

Die Wissensdatenbank ist eine Suchzentrale: Tippen Sie ein Stichwort ins
Suchfeld (Taste `/` springt hinein), die Treffer erscheinen beim Tippen. Mit
der Themenreihe (seitlich scrollbar, mit Symbol und Artikelzahl) und dem
Umschalter **Alle Artikel / Intern / Extern / Entwurf** grenzen Sie die Liste ein. Ohne
Suche und Filter zeigt die Startseite die neusten Artikel als Karten. Status, Sichtbarkeit und «Überarbeiten?» sehen nur
Agenten. Ein Klick öffnet den Artikel auf einer eigenen Leseseite mit
**Bearbeiten**, **Veröffentlichen**, **Archivieren** und **Löschen**.

![Artikelansicht mit Banner, «Kurz gesagt» und Abschnitten](images/ag-artikel.jpg)

Der Artikel erscheint im Verlauf der Farben aus **Einstellungen → Design**
(Verlauf von der Primärfarbe zur Akzentfarbe). Oben stehen die
Art (z. B. Anleitung, FAQ, Störung, Referenz, Information), Thema, Datum und
Lesezeit, darunter **Kurz gesagt**. Ab drei Abschnitten (Überschriften mit
`##`) klappen die Abschnitte auf und zu; **Alle aufklappen** öffnet alle. Die
Art ergibt sich aus dem Text: nummerierte Listen werden Schritte, Überschriften
mit Fragezeichen werden Fragen und Antworten, «Symptom», «Ursache» und «Lösung»
werden Störung, Tabellen werden Referenz. Absätze, die mit **Hinweis:**,
**Tipp:** oder **Achtung:** beginnen, werden farbige Hinweisboxen.

Als Agent lesen Sie nicht nur Artikel, sondern schreiben sie auch:

1. **Neuer Artikel** – Titel, optional eine **Kurzfassung** (ein bis zwei Sätze,
   erscheint als «Kurz gesagt»; ohne Kurzfassung gilt der erste Absatz),
   Inhalt (Markdown mit Bildern), Kategorie und Sichtbarkeit (_Intern_ oder
   _Extern_ für Mitarbeitende). Die **Live-Vorschau** zeigt den Artikel schon
   im späteren Design.
2. Optional **Mit KI aufbereiten** oder direkt aus einem gelösten Ticket
   **Entwurf mit KI erstellen**.
3. **Speichern** – der Artikel ist sofort **veröffentlicht**, eine Freigabe ist
   nicht nötig. Frühere Fassungen bleiben im Verlauf erhalten. Veraltete
   Artikel **archivieren**.

Die KI schreibt Artikel so, dass sie in diesem Design gut aussehen (kurze
Einleitung, Abschnitte, Schritte, Hinweise). KI-Entwürfe aus Tickets erscheinen zuerst als _Entwurf_; mit **Speichern** oder
**Veröffentlichen** gehen sie live.

![Wissensdatenbank aus Sicht der Agenten](images/ag-wissen.jpg)

## Lager: Artikel erfassen und ausleihen

**Lager → Artikel → Artikel erfassen** (und **Bearbeiten** in der Liste) öffnet
dasselbe Formular wie ein Artikel im Shop: Bezeichnung, Fotos (per Drag and
Drop oder Auswahl), Kategorien, Artikelnummer, Beschreibung, technische Angaben
und alle weiteren Shop-Felder. Dazu kommen die Lagerangaben **Einheit** und
**Mindest-/Zielbestand**.

Neue Artikel erfassen Sie nur im Lager; der Shop hat keinen Knopf **Artikel
hinzufügen** mehr. Im Shop lassen sich bestehende Artikel weiter bearbeiten.

**Artikel von Brack importieren:** Im Formular (Lager und Shop) steht oben das
Feld **Von Brack importieren**. Fügen Sie den Link einer Brack-Produktseite (auch
business.brack.ch) ein und wählen Sie **Daten übernehmen**: nextDesk füllt Name,
Beschreibung, Artikelnummer, Lieferanten-Link, technische Angaben, Kategorie und
bis zu drei Produktfotos vor. Bereits ausgefüllte Felder bleiben unverändert.
Prüfen Sie die Angaben und ergänzen Sie Genehmigung, Maximalmenge und Kategorie
selbst. Lässt Brack den Abruf nicht zu, erscheint ein Hinweis, und Sie erfassen
den Artikel von Hand.

Unter **Zuständige Abteilung** legen Sie fest, welche Abteilung den Artikel
betreut (z. B. ICT oder Infrastruktur). Geht im Shop eine Bestellung zu diesem
Artikel ein, werden nur die Agenten dieser Abteilung benachrichtigt, die
Shop-Bestellungen bearbeiten dürfen. Zur Auswahl stehen Ihre eigenen
Abteilungen; sind Sie nur in einer, ist sie fest eingetragen. Hat ein Artikel
keine Abteilung oder ist in der Abteilung niemand für Bestellungen zuständig,
werden wie bisher alle benachrichtigt.

- **Zum Bestellen anbieten** (Schieber): Eingeschaltet kann der Artikel im Shop
  bestellt werden. Er hat **Mindest- und Zielbestand**.
- **Zum Ausleihen anbieten** (Schieber): Der Artikel wird im Shop ausgeliehen
  und zurückgegeben (z. B. Presenter). Er hat dann keinen Mindest- und
  Zielbestand, sondern einen **Bestand** mit **Lagerort**; Änderungen daran
  werden als Lagerbewegung gebucht. Den **Lagerort** können Sie im Formular
  wechseln; der Bestand wird dann beim Speichern umgelagert.
- Sie können **beides** einschalten: Der Artikel erscheint dann im Shop
  einmal zum Bestellen und einmal zum Ausleihen. Sind beide Schieber aus, bleibt
  der Artikel nur im Lager (nötig sind dann Bezeichnung, ein Bild, Kategorie,
  Artikelnummer und die Lagerangaben). Ausschalten nimmt die jeweilige Art beim
  Speichern aus dem Shop; der Lagerartikel bleibt bestehen.

**Etiketten drucken** wie bei den Assets: In der Artikelliste wählen Sie Artikel
mit **Für Etikett auswählen** (oder **Alle sichtbaren**) und drucken mit
**Etiketten drucken** Etiketten mit QR-Code, Bezeichnung, Artikelnummer und
Lagerort (Bogenformate oder Etikettendrucker). Der QR-Code enthält einen
Web-Link: Er öffnet den Artikel im Lager von nextDesk. Im Druckdialog legen Sie
unter **Anzahl Etiketten** fest, wie viele Etiketten pro Artikel gedruckt
werden (z. B. 10 gleiche Etiketten für ein Fach). Die Scan-Funktion der
iOS-App erkennt ihn ebenfalls und zeigt nur diesen Artikel im Lager; mit
**Alle Artikel anzeigen** sehen Sie wieder die ganze Liste. Wer beim Scannen mit
der Kamera noch nicht angemeldet ist, landet nach der Anmeldung direkt beim
Artikel.

Mit **Löschen** im Formular entfernen Sie einen Artikel endgültig (auch aus dem
Shop). Hat er schon Bewegungen oder Reservationen, lässt er sich nicht löschen;
nextDesk bietet dann an, ihn zu **archivieren**.

Unter **Lagerorte** ändern Sie Ortscode und Bezeichnung mit dem Stift
(**Bearbeiten**). Mit dem Papierkorb (**Löschen**) steht ein Lagerort nicht
mehr zur Auswahl; bisherige Buchungen bleiben erhalten. Buchen Sie einen
vorhandenen Bestand vorher an einen anderen Ort um. Gelöschte Lagerorte
erscheinen blass und lassen sich mit **Wieder aktivieren** zurückholen.

## Lager-Automatik, Rücknahmen und Austritt

**Ausgabe und Rückgabe von Geräten.** Übergeben Sie im Shop eine Bestellung
mit Seriennummer (Lagerort und Seriennummer wählen) und ist die Serieneinheit
mit einem Asset verknüpft, weist nextDesk das Gerät automatisch der
bestellenden Person zu; das Asset steht dann auf «In Betrieb». Dasselbe gilt
für die Ausgabe einer Lager-Reservation mit Seriennummer zu einem Ticket (das
Gerät geht an die anfragende Person). Kommt eine Shop-Ausleihe zurück, endet
die Zuweisung, das Asset steht wieder auf «An Lager» und die Serieneinheit ist
wieder an Lager.

**Lager → Automatik** (nur mit dem Recht, das Lager zu verwalten):

- **Standard-Lagerort** für Rücknahmen, auf Wunsch pro **Abteilung** ein
  eigener Lagerort. Zurückgegebene Geräte aus einem Austritt werden dorthin
  gebucht, sofern bei der Rückgabe kein anderer Lagerort gewählt wird.
- **Mindestbestand:** **Lagerverwaltung benachrichtigen** schickt die
  Mitteilung «Nachbestellen», sobald ein Artikel unter den Mindestbestand
  fällt (wer schon den Push «Mindestbestand» erhalten hat, bekommt sie nicht
  doppelt). **Nachbestell-Aufgabe anlegen** erstellt zusätzlich eine Aufgabe
  mit der Menge bis zum Sollbestand. Offene Nachbestellungen erscheinen oben in
  diesem Register: **Bestellt**, **Erledigt** oder **Verwerfen**.
- **Reservationen:** Offene Reservationen werden nach der eingestellten Zahl
  Tage automatisch freigegeben (stündliche Prüfung). Reservationen aus
  Shop-Bestellungen, Eintritten und Raumbuchungen bleiben bestehen.
- **Inventur:** Pro Lagerort ein Intervall in Tagen. Ist es seit der letzten
  abgeschlossenen Inventur abgelaufen, erhält die Lagerverwaltung die
  Mitteilung «Inventur fällig».

**Austritt:** Im Austritt öffnen Sie **Rückgaben und Lizenzen**. Neben den
zugewiesenen Geräten listet nextDesk die offenen **Shop-Ausleihen** und die
**Lizenzen** der Person. Wählen Sie die Einträge und den Lagerort für die
Rücknahme (vorausgewählt ist der Standard-Lagerort) und klicken Sie
**Aufgaben erstellen**. Ist eine Aufgabe erledigt, wird das Gerät
zurückgenommen und als Serieneinheit an den Lagerort gebucht, die Ausleihe
zurückgebucht bzw. die Lizenz freigegeben (Grund «Austritt»). Die Lizenz in
Microsoft 365 entfernen Sie bei Bedarf weiterhin unter **Lizenzen**.

**Ersatzgerät ohne Genehmigung:** Aus einem Sicherheitsfall kann der Support
ein Ersatzgerät im Namen der Person bestellen. Die Bestellung braucht keine
Freigabe; in der Bestellung steht die Herkunft «Sicherheitsfall …
(ohne Genehmigung)».

## Shop: Artikel nur für Kaderstufen

Beim Erfassen im Lager (**Zum Bestellen anbieten**) bzw. beim **Bearbeiten**
im Shop legen Sie unter
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

## Teams: alle Microsoft-Teams-Teams verwalten

Der Menüpunkt **Teams** (Arbeitsbereich) erscheint nur mit dem Recht zur
Shop-Verwaltung, wenn die Funktion **Microsoft Teams im Shop** eingeschaltet
und Microsoft Teams eingerichtet ist (siehe Installationshandbuch). Er zeigt
**alle** Teams der Organisation, auch die bestehenden, nicht nur die über den
Shop bestellten.

- **Kacheln mit Handlungsbedarf**: _Brauchen einen Owner_, _Laufen in 30
  Tagen ab_, _Teams mit Gästen_ und _Teams gesamt_. Ein Klick auf eine Kachel
  filtert die Liste; ein zweiter Klick hebt den Filter auf.
- **Liste**: pro Team Symbol, Name, Beschreibung, Sichtbarkeit, Herkunft
  (_über nextDesk_ oder _bestehend_), Gäste, Owner mit Avataren, Zahl der
  Mitglieder, Erstellt-Datum, Laufzeit mit Fortschrittsbalken und Status
  (_Aktiv_, _Läuft ab_, _Verwaist_, _Archiviert_); fahren Sie mit der Maus über
  den Status, erklärt ein Hinweis, was er bedeutet (_Verwaist_ = das Team hat
  keinen Owner). Filter: _Über nextDesk
  bestellt_, _Bestehend_, _Läuft bald ab_, _Ohne Owner_, _Mit Gästen_, _Ohne
  Ende_, _Archiviert_. Sortierung nach Name, Neueste, Ende oder Mitgliedern.
- **Mehrfachauswahl**: Teams ankreuzen, dann in der blauen Leiste **Ende
  setzen**, **Owner hinzufügen**, **Archivieren** oder **Löschen** für alle auf
  einmal.
- **Mit Microsoft abgleichen**: liest die Teams neu ein. Beim Öffnen läuft der
  Abgleich automatisch, wenn der Stand älter als ein Tag ist.
- **Details** (Klick auf ein Team), drei Reiter:
  - **Übersicht**: Kennzahlen, Laufzeit verlängern (+1, +3, +6 Monate, +1
    Jahr) oder ein Ende setzen, **In Teams öffnen**, **Archivieren** bzw.
    **Wiederherstellen** und **Team löschen**. Beim Löschen wird das Team bei
    Microsoft entfernt (mit Dateien, Chats und Kanälen); Microsoft hält es noch
    30 Tage im Papierkorb von Entra. Zur Bestätigung geben Sie den Namen des
    Teams ein (in der Mehrfachauswahl das Wort _LÖSCHEN_). Dafür braucht die
    Microsoft-App das Recht _Group.ReadWrite.All_ (siehe Installationshandbuch).
  - **Personen**: Owner, Mitglieder und Gäste getrennt, Personen hinzufügen
    oder entfernen, zum Owner machen oder die Owner-Rolle entziehen (der
    letzte Owner bleibt immer). Bei einem Team ohne Owner wird die erste
    hinzugefügte Person Owner.
  - **Verlauf**: Zeitleiste aus dem Protokoll (bestellt, angelegt, verlängert,
    Erinnerungen, Änderungen).
- **Ende setzen**: Auch bei bestehenden Teams möglich. Ab dann erinnert
  nextDesk die Owner 14, 7 und 1 Tag vorher und archiviert das Team am Ende.
  Bei einem Team ohne Owner geht das nicht: zuerst einen Owner festlegen.

Gelöscht wird nie: nextDesk archiviert nur; ein archiviertes Team bleibt
lesbar und lässt sich wiederherstellen.

![Menü «Teams» mit Handlungsbedarf, Liste und Detail](images/ag-teams.jpg)

## IP-Adressen

Unter **Dienste und Überwachung → IP-Adressen** verwalten Sie Subnetze,
VLANs, Standorte und einzelne IP-Adressen (IPv4 und IPv6). Der Bereich
erscheint, wenn das Modul _IP-Adressverwaltung_ eingeschaltet ist und Sie das
Recht «IP-Adressverwaltung ansehen» haben; Änderungen brauchen «IP-Adressen,
Subnetze und VLANs verwalten». Subnetze, VLANs und Standorte mit einer
Abteilung sehen nur deren Mitglieder; ohne Abteilung gelten sie für alle.

Oben wählen Sie die Register **Übersicht**, **Netze**, **VLANs**,
**Standorte** und **Funde** (die Zahl nennt die offenen Funde). Rechts daneben
öffnet **Subnetz-Planer** den Planer mit IP-Rechner. Das Menü **Verwaltung**
enthält den **Bereinigungs-Assistenten**, den **Import** (Excel, phpIPAM,
NetBox), **Export & Sophos-Objekte**, **Discovery & Agenten**, **API &
Webhooks** und **VRF anlegen**.

Hilfen in allen Ansichten:

- **Suche überall**: Ausserhalb der Übersicht steht das Suchfeld oben rechts.
  Die Taste **/** setzt den Cursor ins Suchfeld, mit ↑/↓ wählen Sie einen
  Treffer, **Enter** öffnet ihn, **Esc** leert das Feld.
- nextDesk merkt sich in diesem Browser das zuletzt gewählte Register und
  Netz; beim nächsten Öffnen geht es dort weiter.
- Nach einer Änderung erscheint unten eine Meldung. Lässt sich die Änderung
  zurücknehmen (z. B. Reservierung, Freigabe, Archivieren, Massenänderung),
  enthält sie den Knopf **Rückgängig**. Darum fragt nextDesk bei diesen
  Aktionen nicht mehr nach; nur endgültiges Entfernen (z. B. eines VLAN)
  verlangt eine Bestätigung.
- Fachbegriffe wie Gateway, VLAN, Zone, DHCP-Pool, VRF oder Container sind
  gepunktet unterstrichen: Zeigen Sie darauf oder wählen Sie sie mit der
  Tabulatortaste an, erscheint eine kurze Erklärung.
- Neben IP-Adressen und Netzen kopiert das kleine Kopier-Symbol den Wert in
  die Zwischenablage.

**Übersicht**

- Das grosse **Suchfeld** zeigt schon während der Eingabe Treffer: IP-Adressen,
  MAC-Adressen, Hostnamen, Subnetze und VLANs (z. B. «10.20.30» oder
  «SW016»). Ein Klick öffnet den Treffer, mit ↑/↓ und der Eingabetaste wählen
  Sie per Tastatur.
- Vier **Kennzahlen**: freie IPv4-Adressen in aktiven Subnetzen (mit Ring für
  die Belegung aller aktiven IPv4-Subnetze), Subnetze über der Warnschwelle
  (und wie viele davon in unter 30 Tagen voll sind), offene Funde nach Art
  (farbiger Balken) und Reservierungen, die in den nächsten 30 Tagen ablaufen.
- **Am stärksten ausgelastet** listet die vollsten Subnetze mit Balken, einer
  kleinen Verlaufskurve der letzten 30 Tage und der **Prognose** («voll in ca.
  18 Tagen», «stabil», «sinkt»). Ein Klick auf die Zeile öffnet das Subnetz.
  Balken und Kurve werden ab der Warnschwelle des Subnetzes (standardmässig
  85 %) orange, ab 95 % rot.
- **Netzwerkagenten** zeigt jeden Agenten als «Online», «Verspätet» (länger
  als 30 Minuten still), «Offline» (länger als einen Tag) oder «Deaktiviert».
- **Zuletzt geändert** nennt die letzten Änderungen; **Protokoll** führt zum
  vollständigen Änderungsprotokoll.

**Netze**

- Links steht der **Baum** mit einem Feld **Netz, Name oder VLAN filtern**
  (z. B. «10.10.4», «Drucker» oder «120»). Mit **Hierarchie** sehen Sie
  Supernetze mit ihren Teilnetzen (bei mehreren VRFs je VRF), mit **Nach
  Standort** die Subnetze je Standort. Mit dem Pfeil vor einem Supernetz
  klappen Sie dessen Teilnetze zu oder auf. **Filter** blendet die Auswahl
  nach Standort, Zone und Status sowie **Veraltete zeigen** ein; die Zahl am
  Knopf nennt die aktiven Filter, **Filter zurücksetzen** hebt sie auf. Beim
  Filtern bleiben die übergeordneten Netze blass sichtbar, damit der
  Zusammenhang erhalten bleibt. Die Marke «prüfen» kennzeichnet ein aktives
  Netz, das selbst aktive Teilnetze enthält – meist sollte es ein Container
  sein. Auf dem Smartphone ist der Baum unter **Netz wählen** zugeklappt.
- Über dem gewählten Netz zeigt ein **Pfad** die übergeordneten Supernetze
  (z. B. 10.0.0.0/8 › 10.10.0.0/16 › 10.10.4.0/22); ein Klick springt dorthin.
- **Mehrere auswählen** blendet Kästchen ein. Für die gewählten Netze setzen
  Sie danach in der Leiste Status, Abteilung, Zone oder Standort und
  bestätigen mit **Übernehmen** (bis 200 Netze auf einmal); **Rückgängig** in
  der Meldung stellt die vorherigen Werte wieder her.
- Ein **Supernetz** (Container oder Netz mit Teilnetzen) zeigt im Ring, wie
  viel an Teilnetze vergeben ist, dazu freie Adressen, den grössten freien
  Block, die Zahl der Teilnetze und die Grösse. Der **Adressraum** teilt das
  Supernetz in bis zu 256 gleich grosse Felder (bei einem /16 ist ein Feld
  ein /24). Teilnetze haben je eine Farbe, die auch in der Legende und in der
  Tabelle darunter steht; halb gefüllte Felder enthalten kleinere Teilnetze.
  Zeigen Sie auf ein Feld, erscheinen Netz, Name und Auslastung. Ein Klick auf
  ein Teilnetz öffnet es; ein Klick auf ein freies Feld zeigt den freien
  Block, die Grösse und einen Vorschlag – **Subnetz anlegen …** öffnet das
  Formular mit diesem Netz, VRF, Standort und Abteilung vorausgefüllt. **Im
  Planer aufteilen** öffnet den Subnetz-Planer für dieses Supernetz.
- Ein **Subnetz** zeigt oben die Auslastung als Ring, Gateway, VLAN, Zone,
  DHCP-Pool, Grösse mit Netzmaske, Standort (bei Bedarf VRF und Abteilung).
  Darunter stehen die **Zusammensetzung** (farbiger Balken: aktiv,
  reserviert, DHCP-Pool, frei …) und die **Prognose** («Warnschwelle 85 % in
  ca. 14 Monaten») aus dem Verlauf der letzten 90 Tage. **Nächste freie IP**
  schlägt die erste freie Adresse ausserhalb von Gateway und DHCP-Pool vor und
  öffnet den Dialog **Adresse reservieren** (Hostname, Zweck, verantwortliche
  Person oder Team, auf Wunsch «Befristet bis»).
- Register **Belegung**: Ein Raster mit 16 Feldern pro Zeile zeigt jede
  Adresse; links steht der Beginn der Zeile (z. B. «.32»), oben der Versatz
  (+0 … +15). Die Farben sind in der Legende erklärt (Aktiv, Reserviert,
  DHCP-Pool, Ghost-IP gestreift, Konflikt, Veraltet, Gateway,
  Netz/Broadcast, Frei); ein Klick auf einen Legendeneintrag hebt nur diese
  Adressen hervor. Bei Subnetzen grösser als /24 (bis /20) wählen Sie oben den
  /24-Block; jeder Block zeigt seine Belegung und offene Funde. Zeigen Sie auf
  ein Feld, erscheinen IP, Status, Hostname, MAC, Switch-Port und zuletzt
  gesehen. Ein Klick öffnet die Adresse rechts im Detail. Mit den Pfeiltasten
  bewegen Sie sich im Raster, Enter öffnet.
- **Mehrere Adressen reservieren**: Halten Sie die Umschalttaste und klicken
  Sie auf die erste und die letzte Adresse, oder wählen Sie **Bereich
  wählen** und tippen Sie die Felder an (Leertaste per Tastatur). Die Leiste
  unten nennt den Bereich; **… Adressen reservieren** öffnet den Dialog für
  alle freien Adressen der Auswahl (belegte werden übersprungen, Hostnamen
  werden nummeriert).
- Register **Adressen**: Liste mit IP, Status, Hostname, MAC, Switch-Port und
  zuletzt gesehen; die Kopfzeile bleibt beim Blättern stehen. Filtern Sie mit
  dem Suchfeld und den Knöpfen **Alle**, **Aktiv**, **Reserviert**, **DHCP**,
  **Veraltet** und **Mit Fund**. **Freie Bereiche zeigen** fasst freie
  Adressen zu einer Zeile zusammen («10.10.1.141 – 10.10.1.254 · 114 frei»);
  **Erste reservieren** reserviert die erste davon. Ein Klick auf die Zeile
  öffnet die Adresse. IPv6-Subnetze erscheinen nur in dieser Liste (mit
  Seiten).
- Register **Verlauf & Prognose**: Flächendiagramm der täglich gemessenen
  Auslastung mit Warnschwelle, Linie «heute» und gestrichelter Prognose samt
  Unsicherheitsbereich. Zeigen Sie auf das Diagramm (oder wählen Sie es an und
  nutzen Sie die Pfeiltasten), erscheint der Wert des jeweiligen Tages.
- Register **Funde**: offene Funde in diesem Subnetz.
- **Bearbeiten** öffnet alle Felder des Netzes, inklusive einer **Notiz** für
  interne Hinweise. Das Scheren-Symbol (**Aufteilen**) zerlegt ein Subnetz in
  gleich grosse Teilnetze. Mit dem Archiv-Symbol markieren Sie ein Netz als
  «Veraltet»; Adressen und Verlauf bleiben erhalten, **Rückgängig** stellt den
  vorherigen Status wieder her. Ein neues Netz legen Sie mit
  **+ Subnetz** in CIDR-Schreibweise an (z. B. 10.20.30.0/24). Dasselbe
  Subnetz darf im selben VRF nur einmal vorkommen, Gateway und DHCP-Pool
  müssen darin liegen.

**Bereinigungs-Assistent**

Nach einem Import finden sich oft Altlasten. Der Assistent (Knopf
**Bereinigen** in «Netze» oder **Verwaltung → Bereinigungs-Assistent**) schlägt
Korrekturen vor: aktive Netze mit Teilnetzen werden Container, Hinweise wie
«--> neu im Datacenter» wandern aus der Beschreibung in die Notiz, Gateway
oder DHCP-Bereich ausserhalb des Subnetzes werden geleert, alte
Zusammenfassungen («OLD», «ALT») werden als veraltet markiert. Doppelte VLANs
und leere Container erscheinen nur als Hinweis (nicht vorausgewählt). Wählen
Sie die gewünschten Vorschläge und übernehmen Sie sie in einem Schritt; jede
Änderung steht danach im Änderungsprotokoll und lässt sich dort zurücknehmen.

**Subnetz-Planer und IP-Rechner**

- Im **Planer** wählen Sie ein Supernetz und erfassen die gewünschten
  Teilnetze mit Name, Grösse, VLAN-ID und Zone. nextDesk setzt jedes Teilnetz
  in der eingegebenen Reihenfolge in die kleinste passende freie Lücke. Der
  Balken zeigt bestehende (grau), geplante (blau) und freie Bereiche, die
  Tabelle das Ergebnis und die Anzahl Hosts; passt ein Teilnetz nicht, steht
  dort der Grund. **Geplante Teilnetze anlegen** legt alle in einem Schritt
  an – mit Standort und Abteilung des Supernetzes, der ersten Adresse als
  Gateway und, falls eine VLAN-ID angegeben ist und am Standort fehlt, dem
  VLAN.
- Der **IP-Rechner** steht allen zur Verfügung: Eingabe wie
  «172.16.68.0/22» oder «10.0.0.5 255.255.255.0» ergibt Netz, Maske,
  Wildcard, erste und letzte nutzbare Adresse, Broadcast und Anzahl Hosts
  (auch für IPv6). «In nextDesk» zeigt, ob das Netz erfasst ist oder in
  welchem erfassten Netz es liegt.

**VLANs**

- Die **Matrix** vergleicht jeden Standort mit der **Standort-Vorlage**:
  Zeilen sind die Funktionen der Vorlage (z. B. MGMT, PRINTER, WLAN), Spalten
  die Standorte. Grün heisst «wie Vorlage», gelb «Name oder Grösse weicht ab»
  (mit Grund, z. B. «/23 statt /22»), gestrichelt «fehlt» mit Vorschlag für
  VLAN-ID und Subnetz. Mit **+ anlegen** erstellen Sie das fehlende VLAN samt
  Subnetz. Standorte ohne passende VLANs (z. B. VPN) zeigen «–». VLANs
  ausserhalb der Vorlage stehen darunter unter «Weitere VLANs».
- Die **Liste** zeigt die VLANs je Standort mit ID, Name, Beschreibung, Zone,
  Subnetz und Auslastung; hier bearbeiten oder entfernen Sie VLANs. Einträge,
  die noch von Subnetzen verwendet werden, lassen sich nicht entfernen.
- **Standort-Vorlage** legt fest, welche VLANs und Subnetze ein Standort hat:
  je Funktion den VLAN-Versatz zur VLAN-Basis des Standorts, den Versatz im
  Standort-Supernetz in /24-Schritten, die Grösse, die Zone und ob DHCP
  vorgesehen ist. Gibt es noch keine Vorlage, schlägt nextDesk eine aus dem
  Standort mit den meisten VLANs vor.
- **+ Standort aus Vorlage** legt einen neuen Standort in einem Schritt an:
  Name, Supernetz (freie Blöcke der passenden Grösse werden vorgeschlagen),
  VLAN-Basis und Asset-Standort (neu anlegen, bestehenden wählen oder nicht
  verknüpfen). Die Vorschau zeigt VLAN, Subnetz und Gateway je Funktion;
  einzelne Funktionen lassen sich abwählen.

**Standorte**

- Jede **Kachel** zeigt VLANs, Netze, Switches, Access Points, die Auslastung
  aller aktiven Subnetze, den Status des zuständigen Netzwerkagenten und ob
  der Standort mit einem **Asset-Standort** verknüpft ist. Ist er verknüpft,
  erscheinen die Geräte dieses Asset-Standorts automatisch.
- Im Detail wählen Sie den Asset-Standort direkt in der Auswahl oben.
  **Bearbeiten** öffnet auch Standort-Supernetz, VLAN-Basis und Vorlage (sie
  steuern den Abgleich in der VLAN-Matrix).
- Register **VLANs & Netze** (mit Gateway, DHCP und Auslastung), **Geräte**
  (Switches, Access Points und weitere Infrastruktur mit IP, Ort und
  Uplink) und **Netzwerkkarte** (Geräte nach Uplink geordnet, mit Anzahl
  Access Points je Switch).
- **Dokumentation (PDF)** öffnet eine Druckansicht mit VLANs und Netzen,
  Geräten mit Seriennummern und der Netzwerkkarte. Mit **Drucken / als PDF
  speichern** wählen Sie im Druckdialog «Als PDF speichern». Passwörter und
  WLAN-Schlüssel sind nie enthalten.

**Funde, Soll/Ist und Änderungsprotokoll**

Im Register **Funde** schalten Sie oben zwischen drei Ansichten um:

- **Funde**: Die Discovery meldet Abweichungen – Konflikte und fremde MAC auf
  einer reservierten IP (rot), Ghost-IPs (aktiv, aber nicht dokumentiert),
  DNS-Abweichungen und lange nicht gesehene Adressen. Stündlich prüft nextDesk
  ausserdem die **Auslastung**: Ein Subnetz über seiner Warnschwelle oder ein
  DHCP-Bereich über 90 % wird zum Fund und schliesst sich von selbst, sobald
  die Auslastung wieder darunter liegt. Täglich erscheinen wichtige Geräte
  (Server, Switches, Firewalls, Router) ohne PRTG-Überwachung als
  **PRTG-Lücke**. Ghost-IPs übernehmen Sie mit **Übernehmen** als
  dokumentierte Adresse, mit **Ticket** entsteht ein Ticket, mit **Erledigt**
  oder **Ignorieren** schliessen Sie den Fund (ignorierte Funde kommen nicht
  wieder).
- **Soll / Ist** vergleicht je Subnetz die dokumentierten Adressen mit dem,
  was die Netzwerkagenten in den letzten 7 Tagen gesehen haben:
  Übereinstimmung in Prozent, «Nur gesehen» (nicht dokumentiert) und «Nur
  dokumentiert» (nicht gesehen).
- Das **Änderungsprotokoll** zeigt jede Änderung an Netzen, VLANs, Standorten
  und Adressen mit Zeit, Person oder Herkunft (z. B. Planer, Bereinigung,
  Standort-Vorlage, Discovery, Intune-Abgleich, Import, API) und dem Vorher und
  Nachher. Filtern Sie nach Objekt, Herkunft und Zeitraum. **Rückgängig** setzt
  eine Änderung zurück, solange der Eintrag seither nicht erneut geändert
  wurde; die Rücknahme wird selbst protokolliert.

**Eine Adresse**

Ein Klick auf eine Adresse öffnet sie: Status, Hostname, MAC und Hersteller,
Gerätetyp, Switch-Port, VLAN, Verantwortung, zuletzt gesehen, Verknüpfungen in
nextDesk (Infrastruktur-Gerät mit derselben IP, Asset, Dienst und Tickets, in
denen die IP oder der Hostname vorkommt), eigene Felder und der Verlauf. Mit
**Freigeben** wird die Adresse sofort als «Veraltet» markiert und wieder als
frei vorgeschlagen; der Verlauf bleibt, **Rückgängig** in der Meldung stellt
den vorherigen Eintrag wieder her. **Ticket erstellen** legt ein Ticket mit
den Angaben zur Adresse an, **Bearbeiten** öffnet alle Felder. Eine eben
reservierte Adresse geben Sie mit **Rückgängig** in der Meldung gleich wieder
frei. **Esc** schliesst die Detailansicht.

**Export & Sophos-Objekte**

Unter **Verwaltung → Export & Sophos-Objekte** laden Sie Subnetze, Adressen
und VLANs als CSV oder JSON herunter. Unter **Firewall-Objekte (Sophos)**
erzeugen Sie eine Import-Datei mit Netzwerken, einzelnen Hosts und je Subnetz
einer Hostgruppe für die Sophos Firewall (XML) oder eine Objektliste als CSV.

**Discovery & Agenten**

Unter **Verwaltung → Discovery & Agenten** sehen Sie die Netzwerkagenten mit
Status und letzter Meldung, die letzten **Scans** und unter **DHCP & DNS** die
DHCP-Bereiche mit Auslastung, Leases und den Vergleich der DNS-Einträge mit
der Dokumentation. Mit **Jetzt scannen** stossen Sie einen Scan an. Dort
beauftragen Sie auch DHCP-Reservierungen oder fehlende bzw. abweichende
DNS-Einträge; der Agent führt den Auftrag aus, sobald eine Person mit
Verwaltungsrecht ihn freigegeben hat. Neue Konflikte und volle Subnetze
melden sich per Glocke, Push und E-Mail (Kategorie **IP-Adressverwaltung**).
Meldet sich ein Agent länger als zwei Stunden nicht, erhalten alle mit
Verwaltungsrecht einmal pro Ausfall die Mitteilung «Netzwerkagent offline»;
die Karte des Agenten zeigt dann «Ausfall gemeldet».

**Reservierungen mit Ablaufdatum**

Hat eine reservierte Adresse ein Datum «Reserviert bis», erinnert nextDesk
bis zu drei Tage vorher die verantwortliche Person und das Team
(«Reservierung läuft ab»). Nach Ablauf wird die Adresse automatisch
freigegeben (Status Veraltet); Verlauf und Änderungsprotokoll nennen als
Herkunft «System».

**Geräte-IP und IP-Adressverwaltung**

Die IP-Adresse eines Infrastruktur-Geräts muss eine gültige IP sein (optional
mit Präfixlänge, z. B. 10.1.2.3/24). Tragen Sie eine IP ein, verknüpft
nextDesk die dokumentierte Adresse mit dem Gerät bzw. legt sie in einem
bekannten Subnetz an. Umgekehrt ergänzt das Verknüpfen einer Adresse mit
einem Gerät dessen IP, wenn sie noch leer ist.

**Import**

Unter **Verwaltung → Import** übernehmen Sie bestehende Listen in vier
Schritten (Datei wählen, Zuordnung prüfen, Vorschau, Übernehmen):

- **Excel** (.xlsx) oder **CSV**: IP-Listen mit einem Blatt pro Subnetz,
  eine Übersicht mit VLANs und Subnetzen, Switch-Listen und Access-Point-
  Listen. nextDesk erkennt die Spalten selbst; in der Zuordnung können Sie sie
  ändern.
- **phpIPAM** und **NetBox**: CSV-Exporte der Subnetze bzw. Prefixe,
  Adressen und VLANs.
- Switches und Access Points werden zusätzlich als Geräte in der
  **Infrastruktur** angelegt (mit Seriennummer, MAC und Uplink-Switch).

Die Vorschau zeigt, was neu ist, was sich ändert und was übersprungen wird,
mit Hinweisen zu jeder Zeile (z. B. fehlende Präfixlänge, Gateway ausserhalb
des Subnetzes, doppelte Geräte). Bestehende Einträge werden nur ergänzt, nicht
überschrieben. Blätter mit Zugangsdaten (z. B. WLAN-Schlüssel) und Vorlagen
werden nie übernommen. Danach lohnt sich ein Durchgang mit dem
Bereinigungs-Assistenten.

**Abgleich mit Intune und PRTG**

Jede Nacht gleicht nextDesk die dokumentierten Adressen mit den Geräten aus
Intune und den Sensoren aus PRTG ab: Hostname, MAC und zuletzt gesehen werden
ergänzt, Geräte ohne dokumentierte IP erscheinen als Fund. In der Adresse
sehen Sie die Verknüpfung zum Intune-Gerät bzw. zum PRTG-Sensor.

**Netzwerkkarte der Infrastruktur**

In der **Infrastruktur → Netzwerkkarte** zeigt jedes Gerät zusätzlich sein
Subnetz und VLAN (aus der IP-Adresse des Geräts). Über die Legende über der
Karte heben Sie die Geräte eines VLAN hervor.

**Netzwerk im Ticket**

Kommt in einem Ticket eine IP-Adresse, ein Subnetz, eine MAC-Adresse oder ein
dokumentierter Hostname vor, zeigt das Ticket rechts die Box **Netzwerk**:
Subnetz und VLAN, Gerät, Switch-Port, verantwortliche Person und zuletzt
gesehen. Mit **In der IP-Adressverwaltung öffnen** springen Sie zur Adresse.
Dürfen Sie das Ticket bearbeiten, hängen Sie mit **Gerät … ans Ticket
hängen** bzw. **Dienst … ans Ticket hängen** das Gerät und seine Dienste
direkt an (bereits verknüpfte erscheinen als «am Ticket»). Für eine erkannte,
noch nicht dokumentierte IP in einem bekannten Subnetz reserviert **IP
reservieren** die Adresse nach einer Bestätigung (braucht das Recht,
IP-Adressen zu verwalten). Tickets zu einer Adresse findet die
IP-Adressverwaltung über einen Suchindex auch in grossen Ticketbeständen
schnell.

**In der App**

In der iPhone-App zeigen die Detailseiten von Assets und Infrastruktur-Geräten
die Karte **Netzwerk** mit IP, Subnetz, VLAN, Gateway und Switch-Port. Scannen
Sie den QR-Code am Gerät, sehen Sie diese Angaben direkt vor Ort. Tippen Sie
auf eine Mitteilung der IP-Adressverwaltung, öffnet die App das Gerät oder
die Netzwerkdaten der betroffenen Adresse.

**KI-Assistent**

Über die nextDesk-Schnittstelle für KI-Assistenten (MCP) können Sie Fragen
wie «Welche IP hat der Drucker im 2. OG?», «Wie viele Adressen sind in VLAN
20 frei?» oder «Reserviere die nächste freie IP im Server-Netz» stellen. Es
gelten dieselben Rechte und Abteilungsgrenzen wie in der Weboberfläche.

## Benachrichtigungen und Erreichbarkeit

- Die **Glocke** zeigt Zuweisungen, Erwähnungen, Antworten und Eskalationen.
  Ein Klick auf einen Eintrag öffnet genau das auslösende Objekt: das Ticket,
  den Sicherheitsfall, die Störung, die Bestellung, den Lagerartikel, die
  Serviceaufgabe, das Infrastruktur-Gerät oder in der IP-Adressverwaltung die
  Adresse, das Netz bzw. die Funde und die Agenten.
- Ein **Tipp auf eine Push-Mitteilung** öffnet in der iPhone-App ebenfalls
  direkt das auslösende Objekt – auch wenn die App geschlossen war. Gehört die
  Mitteilung zu einem anderen Arbeitsbereich, wechselt die App zuerst dorthin.
  Serviceaufgaben öffnen sich in einer eigenen Ansicht, in der Sie die
  Checkliste abhaken und die Aufgabe erledigen; fällige Inventuren zeigen die
  Artikel des Lagerorts. Für Vertragsfristen und Netzwerkagenten gibt es in der
  App keine Ansicht; die App weist dann auf die Web-App hin.
- Eine **Sammelmitteilung** («5 neue Hinweise in nextDesk») öffnet in der App die
  **Mitteilungen**: die letzten Benachrichtigungen aller Arten (Tickets,
  Bestellungen, Störungen, Lager …), Ungelesene markiert. Ein Tipp öffnet den
  Eintrag wie die einzelne Push-Mitteilung und markiert ihn als gelesen;
  **Alle gelesen** leert die Liste. Die Mitteilungen erreichen Sie jederzeit
  über die **Glocke** oben auf der Startseite der App (mit Anzahl
  ungelesener Einträge).
- Der Knopf in einer **E-Mail-Benachrichtigung** öffnet in der Web-App genau
  das auslösende Objekt. Sind Sie noch nicht angemeldet, öffnet es sich nach
  der Anmeldung (auch per SSO); gehört es zu einem anderen Mandanten, in dem
  Sie Mitglied sind, wechselt nextDesk zuerst dorthin. Haben Sie keinen
  Zugriff mehr, erscheint ein Hinweis.
- **Push-Benachrichtigungen** auf dem iPhone kommen ohne Einchecken. Unter
  _Persönliche Einstellungen → Benachrichtigungen → Benachrichtigungszeit_
  legen Sie fest, an welchen **Tagen** und zu welchen **Zeiten** Sie
  Mitteilungen erhalten (z. B. Mo–Fr, 06:00–17:00) oder ob **Jederzeit**. Was
  ausserhalb dieser Zeit anfällt, kommt zu Beginn der nächsten
  Benachrichtigungszeit.
- In der Tabelle **Benachrichtigungen** schalten Sie pro Benachrichtigung
  (z. B. Zuweisungen, Eskalationen, Erwähnungen, Phishing, Sicherheitsfälle,
  Störungen, IP-Adressverwaltung) einzeln **Push** und **E-Mail** ein oder
  aus. Für Agenten sind zu Beginn alle Benachrichtigungen per Push und
  E-Mail eingeschaltet – ausser **Phishing** und **Sicherheitsfälle**: Diese
  sind ausgeschaltet. Wer sie erhalten möchte, schaltet sie dort selbst ein.
  Mitglieder des in den Phishing-Einstellungen hinterlegten Teams erhalten
  Phishing-Meldungen, überfällige Sicherheitsfälle, «geklickt» und Kampagnen
  immer; die Tabelle weist darauf hin. **IP-Adressverwaltung** (Funde,
  Netzwerkagent offline, ablaufende Reservierungen) sehen Personen mit Zugriff
  auf die IP-Adressverwaltung; **Lager** umfasst Mindestbestand,
  Nachbestellung und fällige Inventur, **Shop** auch Erinnerungen zu
  Ausleihen und offenen Freigaben. E-Mails kommen über das Exchange-Postfach
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
- Für Rückfragen einen wartenden Status (z. B. **Wartend auf Kunde**) setzen,
  damit die SLA pausiert und die Person erinnert wird.
- Interne Informationen immer als **Interne Notiz**, nie als externe Antwort.
- Lösungen, die mehr als einmal gebraucht werden, als **Wissensartikel**
  festhalten.
