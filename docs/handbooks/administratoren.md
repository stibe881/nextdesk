---
title: Handbuch für Administratoren
description: Mandant einrichten – Design, Funktionen, SLA, Abteilungen, Personen, Rollen, Datenschutz und Protokoll.
audienceLabel: Administratoren
updated: 2026-11-09
---

# Handbuch für Administratoren

Dieses Handbuch richtet sich an Personen mit der Rolle **Administrator**
(technisch «Tenant administrator»). Administratoren verwalten den gesamten
Mandanten: Erscheinungsbild, Funktionen, Abläufe, Personen und Berechtigungen.
Für die tägliche Ticketarbeit gilt zusätzlich das _Handbuch für Agenten_, für
die erstmalige Einrichtung von Microsoft 365, SSO und Monitoring die
_Installationsanleitung_.

## Einstellungen öffnen

Der Menüpunkt **Einstellungen** ist nur für Administratoren sichtbar und
steht unten in der linken Navigation. Die Einstellungen sind in Register
gegliedert:

| Gruppe               | Register                                               |
| -------------------- | ------------------------------------------------------ |
| Allgemein            | Übersicht, Design                                      |
| Betrieb              | Funktionen, SLA, Ticketfelder, Abteilungen, Monitoring |
| Zugriff & Sicherheit | Personen, Rollen, Datenschutz, Protokoll               |

Mit **Schliessen** kehren Sie in den Arbeitsbereich zurück.

![Einstellungen – Mandantenüberblick mit Checkliste «Bereit für den Arbeitsstart»](images/ad-einstellungen.jpg)

## Übersicht

Der **Mandantenüberblick** zeigt Portalname, Support-E-Mail, Ticketzugang und
externen Ticketzugang. Darunter führt die Checkliste **«Bereit für den
Arbeitsstart»** durch die wichtigsten Einrichtungsschritte; jeder Punkt
springt direkt in das passende Register. Arbeiten Sie die Checkliste beim
Start eines neuen Mandanten von oben nach unten ab.

## Design (Corporate Design)

Unter **Design → Corporate Design bearbeiten** passen Sie das Portal an Ihr
Unternehmen an:

- **Portalname** (optional, max. 160 Zeichen). Leer lassen, wenn nur das Logo
  erscheinen soll.
- **Portal-Logo**: PNG, JPEG oder WebP bis 2 MB («Datei auswählen», «Logo
  entfernen»).
- **Primärfarbe, Sekundärfarbe, Akzentfarbe**.

Die **Portalansicht** zeigt die Wirkung sofort. Mit **Corporate Design
speichern** übernehmen Sie die Änderungen für alle Personen des Mandanten.

![Corporate Design mit Farbwahl und Vorschau](images/ad-branding.jpg)

## Funktionen & Integrationen

Im Register **Funktionen** schalten Sie Module für den ganzen Mandanten ein
oder aus. Suchen Sie über **Funktionen durchsuchen** oder filtern Sie nach
_Alle / Aktiv / Deaktiviert_. Jede Karte hat **Aktivieren** bzw.
**Deaktivieren** und – wo vorhanden – **Konfigurieren**.

> Die Konfiguration ändert den Funktionsstatus nicht. Eine deaktivierte
> Funktion behält ihre Konfiguration, verwendet sie aber nicht.

![Funktionen & Integrationen mit Suche und Filter](images/ad-module.jpg)

Wichtige Funktionen und ihre Konfiguration:

| Funktion                                                              | Was sie bewirkt / wo konfiguriert                                                                                       |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Self-Service, Anfragendenportal                                       | Portal für Mitarbeitende mit Wissensartikeln und eigenen Tickets                                                        |
| Wissensdatenbank                                                      | Artikel für Agenten und Mitarbeitende                                                                                   |
| Ticketvorlagen                                                        | **Vorlagen verwalten → Neue Vorlage**: Name, Betreff- und Beschreibungsvorlage, Abteilung, Priorität, Checklistenpunkte |
| SLA-Automatisierung                                                   | Erinnerungen, automatisches Lösen/Schliessen, Regeln für neue Tickets, KI-Triage, Drittanbieter (siehe unten)           |
| E-Mail-Kanal (Exchange Online)                                        | Support-Postfächer, Phishing-Meldungen und Massnahmen je Urteil für Sicherheitsfälle (siehe Installationsanleitung)     |
| Push-Benachrichtigungen                                               | Inhaltsstufe («Nur Ticketnummer» empfohlen); wann jemand Mitteilungen erhält, legt jede Person selbst fest              |
| KI-Assistenz                                                          | Freigabe für Wissensentwürfe mit Claude und Selbstbedienungs-Assistent im Portal                                        |
| Asset-Management                                                      | Geräte und Microsoft Intune; Monitoring liegt im Register «Monitoring»                                                  |
| Service-Reporting                                                     | Berichte und Auswertungen                                                                                               |
| Raumplanung, Eintritte, Bestandsverwaltung, Verträge, Serviceaufgaben | Zusatzmodule für einzelne Abteilungen                                                                                   |
| Single Sign-On                                                        | Anmeldung mit Microsoft Entra ID (siehe Installationsanleitung)                                                         |

### SLA-Automatisierung konfigurieren

Unter **Funktionen → SLA-Automatisierung → Konfigurieren**:

- **Erinnern, lösen, schliessen** (läuft stündlich): _Erinnern nach Tagen_,
  _Höchstens so viele Erinnerungen_, _Lösen nach Tagen (ab Beginn der
  Wartezeit)_, _Schliessen nach Tagen_.
- **Regeln für neue Tickets**: Auslöser «Beim Erstellen eines Tickets» oder
  «Zeitgesteuert». Im Teil **Wenn …** definieren Sie Bedingungen (z. B.
  Stichworte in Betreff oder Beschreibung), im Teil **… dann** die Aktion
  (Team zuweisen, Person zuweisen, Priorität setzen). **Regel speichern**.
- **Neue Tickets automatisch einordnen** (KI-Triage).
- **Automatisierungen**: Mit **Vorschau ausführen** prüfen Sie Regeln vor
  dem Einsatz, das **Prüfintervall in Tagen** erinnert an die regelmässige
  Kontrolle.
- **Drittanbieter**: externe Lieferanten, an die Agenten Tickets übergeben
  können (siehe unten).

![Regeln für neue Tickets – Wenn … dann](images/ad-automation.jpg)

### Drittanbieter erfassen

Agenten können ein Ticket über **An Drittanbieter übergeben** an eine externe
Firma (z. B. Hersteller oder Support-Partner) weitergeben. Dafür muss
mindestens ein Drittanbieter erfasst sein. Sonst zeigt der Dialog den Hinweis
«Es sind noch keine Drittanbieter erfasst».

1. Öffnen Sie **Funktionen → SLA-Automatisierung → Konfigurieren** und
   scrollen Sie zum Bereich **Drittanbieter**.
2. Wählen Sie **Drittanbieter erfassen** und füllen Sie aus: _Name_ (Pflicht),
   _E-Mail_, _Telefon_ und _Erinnerung nach (Stunden)_.
3. Lassen Sie **Aktiv** eingeschaltet und wählen Sie **Speichern**.

_Erinnerung nach (Stunden)_ ist die Frist, nach der die zugewiesene Person
erinnert wird, wenn der Anbieter nicht antwortet. Erlaubt sind 1 bis 2160
Stunden (90 Tage), voreingestellt sind 48. Mit dem Stift bearbeiten Sie einen
Eintrag; mit **Aktiv** schalten Sie einen Anbieter ab, ohne ihn zu löschen.

> Sie benötigen die Berechtigung **Automationen verwalten**. Ohne sie
> verweist der Dialog der Agenten auf die Mandantenadministration.

Bei der Übergabe wechselt das Ticket auf **Wartend auf Drittanbieter**. Ist es
noch niemandem zugewiesen, bleibt der Status **Neu**, bis jemand es übernimmt.

## SLA-Regeln

Das Register **SLA** erscheint, sobald die SLA-Automatisierung aktiv ist.
Mit **Neue SLA-Regel** legen Sie fest:

- **Name der Regel** und **Definition & Auswirkung**
- **Priorität** und **Abteilung** (oder _Mandantenweit_)
- **Servicezeit**: Wochentage und Von/Bis in der Zeitzone Europe/Zurich
- **Reaktionszeit** und **Lösungszeit** in Minuten
- **Regel aktiv**

Unter **Aktuelle Eskalationen** sehen Sie Tickets, deren SLA gefährdet oder
verletzt ist. Nicht mehr benötigte Regeln **archivieren** Sie, statt sie zu
löschen.

![SLA-Regeln und aktuelle Eskalationen](images/ad-sla.jpg)

## Ticketfelder

Unter **Ticketfelder** gestalten Sie das Ticketformular. Felder unter
_Immer enthalten_ sind fix. Weitere Felder fügen Sie über **Feld auswählen**
bzw. **Feld hinzufügen** hinzu, legen den Feldtyp fest, markieren sie bei
Bedarf als **Pflichtfeld** und speichern mit **Feld speichern**. Die
Reihenfolge ändern Sie per Ziehen und Ablegen.

## Abteilungen und Teams

Im Register **Abteilungen**:

1. **Abteilungen** anlegen (Name → _Abteilung anlegen_). Nicht mehr
   benötigte Abteilungen archivieren.
2. **Abteilungsleitungen**: Leitung und Stellvertretung für interne
   Rückfragen zu Tickets.
3. **Teams pro Abteilung**: Name, Abteilung und Supportstufe
   (1st/2nd/3rd Level). Über **Mitglieder verwalten** ordnen Sie Agenten zu.
4. **Module pro Abteilung**: welche Abteilung welche Zusatzmodule nutzt.

## Monitoring

Das Register **Monitoring** (setzt Asset-Management voraus) bündelt:

- **Monitoring (PRTG)** – Tickets aus PRTG-Alarmen. Sie wählen Abteilung,
  **Team**, Priorität und ob auch Warnungen Tickets erzeugen. Ist die Option
  «Systemstatus des verknüpften Dienstes anpassen» aktiv, ändern Alarme den
  Status der Dienste, die am Gerät in der Infrastruktur hinterlegt sind (ein
  Gerät kann mehrere Dienste haben). Unter **Alarme aus PRTG** beenden Sie
  einen hängenden Alarm mit **Alarm beenden**.
- **Zertifikate und Domains** – Erinnerung vor Ablauf
- **Backup-Überwachung** – z. B. Veeam-Jobs per E-Mail oder Webhook

Die Einrichtung ist in der _Installationsanleitung_ beschrieben.

## Personen und Agenten

Im Register **Personen** (Überschrift «Personen & Agenten») verwalten Sie
alle Zugänge.

### Person einladen

1. Unter **Person einladen** Vor- und Nachname, E-Mail-Adresse, Angebot und
   Funktion erfassen.
2. Soll die Person Tickets bearbeiten, **Arbeitet als Support-Agent**
   ankreuzen und einen **Ticketzugriffsbereich** wählen (Pflicht für Agenten).
3. **Einladung versenden**. Die Einladung ist 7 Tage gültig.

Offene Einladungen sehen Sie unter **Offene Einladungen** und können sie dort
widerrufen. Darunter stehen die Listen **Agenten** (mit Suche) und
**Angemeldete Personen**.

Mit **Bearbeiten** ändern Sie bei einer Person Name, vorgesetzte Person,
Ticketzugriffsbereich und **Team** (z. B. _Servicedesk_ oder _System
Engineer_). Die Teams erscheinen, sobald der Ticketzugriffsbereich gewählt
ist – bei Agenten und bei Mandantenadministratoren, die automatisch
Agentenzugang haben. Speichern mit **Person speichern**.

> Mit aktivem SSO werden Personen aus zugelassenen Domains beim ersten Login
> automatisch als _anfragende Person_ angelegt. Agentenrechte gibt es nur per
> Einladung, Vormerkung oder Rollenzuweisung.

![Personen & Agenten mit Einladung und Agentenliste](images/ad-benutzer.jpg)

### Personen aus Microsoft Entra

Ist der Verzeichnisabgleich eingerichtet, erscheinen Personen aus Entra in
der Liste. Sie können eine Person **als Agent vormerken** – Name, vorgesetzte
Person, Ticketzugriffsbereich und Team werden bei der ersten
Microsoft-Anmeldung übernommen.

## Rollen und Berechtigungen

Das Register **Rollen** («Rollen & Zugriffe») hat zwei Ansichten, die Sie
oben umschalten:

**Personen zuweisen**

- Suchen Sie über **Person suchen …** und filtern Sie nach **Agenten** oder
  **Alle Personen**.
- In der Tabelle setzen Sie pro Person ein Häkchen bei der gewünschten Rolle;
  ohne Häkchen ist die Rolle wieder entzogen. Die Änderung wirkt sofort für
  den ganzen Mandanten.
- Rollen, die nur für eine Abteilung oder ein Team gelten, stehen unter
  **Auf Abteilung oder Team begrenzte Zuweisungen**; dort nehmen Sie sie mit
  **Entziehen** wieder weg.

**Rollen definieren**

- Links wählen Sie eine bestehende Rolle oder **+ Neue Rolle**.
  Systemrollen sind mit «System» markiert und geschützt.
- Bei einer neuen Rolle geben Sie den **Namen der neuen Rolle** ein, wählen
  unter **Berechtigungen** die gewünschten Rechte (je Gruppe mit **Alle
  auswählen**) und klicken auf **Rolle erstellen**. Unter jeder Berechtigung
  steht kurz, was sie erlaubt; Rechte mit weitreichendem Zugriff sind als
  «Erweitert» markiert.
- Bestehende eigene Rollen ändern Sie und speichern mit **Änderungen
  speichern**; mit **Rolle deaktivieren** bzw. **Rolle aktivieren** schalten
  Sie sie ab oder wieder ein.

Die Basisrollen _Requester_ (alle angemeldeten Personen) und _Support agent_
(über «Arbeitet als Support-Agent») werden nicht direkt vergeben.

![Rollen & Zugriffe – Ansicht «Personen zuweisen»](images/ad-rollen.jpg)

> **Handbücher und Rollen:** Welche Handbücher eine Person im Profil sieht,
> folgt automatisch ihren Rollen: alle Mitglieder das Handbuch für
> Mitarbeitende, Personen mit Ticketbearbeitung zusätzlich das Handbuch für
> Agenten, Administratoren alle Handbücher inklusive Installationsanleitung.

## Datenschutz und Aufbewahrung

Unter **Datenschutz** («Aufbewahrung & Datenschutz») legen Sie Fristen in
Tagen fest für _Geschlossene Tickets_, _Private Anhänge_ und das
_Audit-Protokoll_. Die **Rechtliche Aufbewahrungssperre** verhindert jede
Bereinigung. Die Werte sind Richtlinien – nextDesk löscht nie automatisch.

## Protokoll

Das **Protokoll** (Änderungsprotokoll) zeichnet alle administrativen
Änderungen auf. Filtern Sie nach Person, Aktion, Objekt, Schweregrad und
Zeitraum, öffnen Sie einen Eintrag für _Änderungen_ und _Metadaten_ und
exportieren Sie bei Bedarf als **CSV** oder **JSON**.

## Systemstatus veröffentlichen

Der **Systemstatus** liegt im Arbeitsbereich (nicht in den Einstellungen).
Dort planen Sie **Wartungen** und veröffentlichen eine **öffentliche
Statusseite** sowie ein **SharePoint-Badge** (SVG-Bild) für das Intranet.
Das Badge in der Navigation und die Seiten aktualisieren sich selbst (intern
alle 30 Sekunden, öffentlich jede Minute); ein manuelles Neuladen ist nicht
nötig.

## Eigenes Profil und Handbücher

Ihre persönlichen Einstellungen öffnen Sie unten links über Ihren Namen →
**Persönliche Einstellungen**. Unter **Handbücher** finden Sie alle vier
Handbücher.

![Persönliche Einstellungen eines Administrators mit allen Handbüchern](images/ad-profil.jpg)
