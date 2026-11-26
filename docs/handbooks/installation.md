---
title: Installationsanleitung
description: Inbetriebnahme eines Mandanten – Checkliste, Microsoft Entra SSO, Exchange Online, Verzeichnisabgleich, Intune, Push, PRTG und Mobile-App.
audienceLabel: Administratoren
updated: 2026-11-26
---

# Installationsanleitung

Diese Anleitung führt Administratoren durch die Inbetriebnahme von nextDesk
für ein Unternehmen. nextDesk wird als Cloud-Dienst betrieben – Server,
Datenbank und zentrale Microsoft-Apps stellt der Plattformbetreiber (Gross
ICT) bereit. Du richtest deinen **Mandanten** ein und erteilst in deinem
Microsoft-365-Konto die nötigen Freigaben.

In jedem Abschnitt ist markiert, wer handelt:

- **[Betreiber]** – Gross ICT (einmalig für die Plattform, meist bereits erledigt)
- **[Admin]** – du als nextDesk-Administrator
- **[Microsoft-Admin]** – globale Administratorin bzw. globaler Administrator deines Microsoft-365-Mandanten

## Wie mache ich …?

Hier findest du zu jeder Aufgabe eine kurze Anleitung. Ausführliche Erklärungen stehen in den weiteren Abschnitten.

### Wie sehe ich, was bei der Einrichtung noch fehlt?

1. Öffne **Einstellungen → Übersicht**.
2. Lies die Checkliste **«Bereit für den Arbeitsstart»**.
3. Erledige die offenen Punkte der Reihe nach.

Ausführlich: «Übersicht und Reihenfolge».

### Wie melde ich mich zum ersten Mal an?

1. Öffne den Link in der Einladungs-E-Mail. Die Einladung ist 7 Tage gültig.
2. Melde dich mit der eingeladenen E-Mail-Adresse an (Anmeldelink per E-Mail oder Passwort).
3. Prüfe, dass links unten der Menüpunkt **Einstellungen** erscheint.

Ausführlich: «Schritt 1: Erste Anmeldung».

### Wie richte ich Design und Anrede ein?

1. Öffne **Einstellungen → Design**.
2. Hinterlege Portalname, Logo und Farben und wähle **Corporate Design speichern**.
3. Stelle unter **Anrede** ein, ob nextDesk alle Texte duzt (Standard) oder siezt.

Ausführlich: «Schritt 2: Grundeinstellungen».

### Wie lege ich Abteilungen und Teams an?

1. Öffne **Einstellungen → Abteilungen**.
2. Lege die Abteilungen an (z. B. ICT, Facility, HR).
3. Bestimme die Leitungen.
4. Erfasse die **Teams pro Abteilung** mit Supportstufe.

Ausführlich: «Schritt 2: Grundeinstellungen».

### Wie aktiviere ich Funktionen und Module?

1. Öffne **Einstellungen → Funktionen**.
2. Aktiviere die gewünschten Module (z. B. Wissensdatenbank, Self-Service, Ticketvorlagen, SLA-Automatisierung).

Ausführlich: «Schritt 2: Grundeinstellungen».

### Wie lege ich SLA-Regeln an?

1. Öffne **Einstellungen → SLA**.
2. Lege mindestens eine SLA-Regel pro Priorität an.

Ausführlich: «Schritt 2: Grundeinstellungen».

### Wie richte ich die Anmeldung mit Microsoft ein?

1. Hole beim Betreiber die **Client-ID** der App «nextDesk – Kunden SSO» ein.
2. Lass die Administratorzustimmung für deinen Microsoft-Mandanten erteilen. Der Microsoft-Admin nutzt dafür den Link, den dir der Betreiber sendet.
3. Öffne in nextDesk **Einstellungen → Funktionen → Single Sign-On → Konfigurieren** und trage die Felder aus der Tabelle ein (Anbieter, Client-ID, Issuer-URL, Discovery-URL, zugelassene E-Mail-Domains).
4. Kreuze **SSO aktivieren** an, lass **SSO für die Anmeldung erzwingen** vorerst leer und wähle **SSO-Konfiguration speichern**.
5. Teste in einem privaten Browserfenster mit **Mit SSO anmelden**.
6. Setze erst nach erfolgreichem Test **SSO für die Anmeldung erzwingen**.

Ausführlich: «Schritt 3: Microsoft Entra SSO».

### Wie lade ich Personen ein?

1. Öffne **Einstellungen → Personen → Person einladen**.
2. Lade Agenten mit **Arbeitet als Support-Agent** und Ticketzugriffsbereich ein.
3. Mitarbeitende ohne Ticketbearbeitung müssen mit SSO nicht eingeladen werden.

Ausführlich: «Schritt 4: Personen und Rollen».

### Wie vergebe ich Rollen?

1. Öffne **Einstellungen → Rollen → Rollen zuweisen**.
2. Vergib weitere Administratoren oder eigene Rollen.

Ausführlich: «Schritt 4: Personen und Rollen».

### Wie verbinde ich das Exchange-Postfach?

1. Lass im Exchange Admin Center dem Connector-Konto für **jedes** Support-Postfach die Rechte **Vollzugriff** und **Senden als** geben (Aufgabe des Microsoft-Admins).
2. Aktiviere unter **Einstellungen → Funktionen → E-Mail-Kanal (Exchange Online)** den Kanal und öffne **Konfigurieren**.
3. Wähle **Microsoft 365 verbinden** und melde dich mit dem Connector-Konto an.
4. Wähle **Postfach hinzufügen** und erfasse Support-Postfach, Ziel-Abteilung für neue Tickets, optional das Team für neue Tickets und die gewünschten Mitteilungen. Speichere mit **Postfach speichern**.
5. Wähle **Prüfen**, dann **Aktivieren** und sende eine **Testmail**.
6. Neue E-Mails werden etwa alle 5 Minuten abgeholt.

Ausführlich: «Schritt 5: Exchange Online (E-Mail-Kanal)».

### Wie richte ich die Phishing-Meldungen ein?

1. Öffne im Bereich E-Mail-Kanal (Exchange Online) die Einstellungen für die **Phishing-Meldungen** und aktiviere sie.
2. Trage die Meldeadresse und die Zielabteilung ein.
3. Wähle Kategorie und Unterkategorie des Sicherheitstickets aus oder erfasse sie über **+ Neue Kategorie …** bzw. **+ Neue Unterkategorie …**.
4. Lege unter **Massnahmen je Urteil** fest, welche Checkliste nach dem Urteil _Harmlos_, _Spam_, _Phishing_ oder _Gezielter Angriff_ erscheint. Ohne eigene Liste gelten Standard-Checklisten.
5. Das **Sicherheitsteam** bekommt die Fälle zugewiesen und wird benachrichtigt. Nur seine Mitglieder sehen den Bereich **Phishing / Junk**.

Ausführlich: «Schritt 5: Exchange Online (E-Mail-Kanal)».

### Wie richte ich das Melden von Phishing in Outlook ein?

1. Öffne in Microsoft Defender _Einstellungen → E-Mail und Zusammenarbeit → Von Benutzern gemeldete Einstellungen_.
2. Trage die Meldeadresse als **Meldepostfach** ein (_Nur mein Berichtspostfach_).
3. Stelle sicher, dass die Meldeadresse beim verbundenen Postfach ankommt.
4. Mitarbeitende melden danach in Outlook mit **Melden → Phishing melden**.

Ausführlich: «Schritt 5: Exchange Online (E-Mail-Kanal)».

### Wie gleiche ich das Microsoft-Entra-Verzeichnis ab?

1. Stelle sicher, dass SSO mit deiner eigenen Tenant-ID konfiguriert ist (nicht `common`).
2. Lass die Zustimmung für die Berechtigung _User.Read.All_ erteilen (Link vom Betreiber, Aufgabe des Microsoft-Admins).
3. Öffne **Einstellungen → Funktionen → Microsoft Entra-Verzeichnis**.
4. Aktiviere den _Connector (Abgleich jede Nacht automatisch)_ und wähle **Konfiguration speichern**.
5. Wähle **Verbindung testen** und danach **Jetzt abgleichen**.
6. Danach gleicht nextDesk das Verzeichnis jede Nacht automatisch ab; es werden keine Personen gelöscht. Die **Abgleichshistorie** zeigt die letzten Läufe.

Ausführlich: «Microsoft-Entra-Verzeichnisabgleich».

### Wie binde ich Microsoft Intune an?

1. Lass die Zustimmung für die Intune-App mit _DeviceManagementManagedDevices.Read.All_ (nur lesend) erteilen (Aufgabe des Microsoft-Admins).
2. Aktiviere die Funktion **Asset-Management** und öffne **Konfigurieren**.
3. Gib den _Microsoft-Graph-Abgleich für diesen Mandanten_ frei.
4. Prüfe die Vorschau und wähle **Übernahme ausdrücklich bestätigen**.
5. Wähle **Jetzt einmalig abgleichen**.
6. Danach läuft der Abgleich zusätzlich jede Nacht automatisch. Geräte mit bereits vorhandener Seriennummer werden übersprungen, es wird nie etwas gelöscht.

Ausführlich: «Microsoft Intune (Geräte)».

### Wie ermögliche ich Massnahmen in Phishing-/Junk-Fällen?

1. Lass für dieselbe Intune-/Entra-App zusätzliche Anwendungsberechtigungen mit Administratorzustimmung erteilen (Aufgabe des Microsoft-Admins).
2. Für **Gerät synchronisieren** und **Defender-Schnellscan** braucht es _DeviceManagementManagedDevices.PrivilegedOperations.All_.
3. Für **Sitzungen widerrufen** braucht es _User.RevokeSessions.All_.
4. Für **Passwort-Reset erzwingen** braucht es _User-PasswordProfile.ReadWrite.All_. Für Konten mit Administratorrolle braucht die App zusätzlich eine passende Entra-Rolle.
5. Fehlt eine Berechtigung, zeigt nextDesk im Fall eine klare Meldung.

Ausführlich: «Microsoft Intune (Geräte)».

### Wie richte ich Microsoft Teams im Shop ein?

1. Prüfe die Voraussetzungen: SSO mit der eigenen Tenant-ID, Verzeichnisabgleich und die Funktion **Shop**.
2. Schalte unter **Einstellungen → Funktionen** den Schalter **Microsoft Teams im Shop** ein (standardmässig aus).
3. Lass den **Zustimmungslink** in derselben Karte vom Globalen Administrator öffnen und mit **Akzeptieren** bestätigen.
4. Prüfe den Umfang der Berechtigungen mit deiner IT-Sicherheit.
5. Wähle nach einigen Minuten **Verbindung prüfen**. Die Karte nennt, was noch fehlt.
6. Stelle in der Karte die längste Laufzeit und die Gastregel ein.

Ausführlich: «Microsoft Teams im Shop».

### Wie richte ich Push-Benachrichtigungen für iOS ein?

1. Aktiviere unter **Einstellungen → Funktionen** die Funktion **Push-Benachrichtigungen**.
2. Wähle die Inhaltsstufe **Nur Ticketnummer** (empfohlen).
3. Sage den Personen, dass sie unter _Persönliche Einstellungen → Benachrichtigungen → Benachrichtigungszeit_ selbst festlegen, wann sie Mitteilungen erhalten, und pro Benachrichtigung Push und E-Mail einschalten.
4. Zum Testen wählen Anwenderinnen und Anwender in der iOS-App _Profil → Benachrichtigungen → Testmitteilung senden_.

Ausführlich: «Push-Benachrichtigungen (iOS)».

### Wie richte ich Push-Mitteilungen auf Android ein?

1. Diese Einrichtung erledigt der Betreiber einmalig.
2. Der Betreiber legt in der Firebase-Konsole ein Projekt an und fügt die Android-App mit der Paket-ID `ch.nextdesk.grossict` hinzu.
3. Er hinterlegt in EAS die Datei `google-services.json` als Datei-Variable `GOOGLE_SERVICES_JSON` und lädt den Dienstkonto-Schlüssel unter _Credentials → Android → FCM V1_ hoch.
4. Er erstellt und veröffentlicht einen neuen Android-Build. Erst Geräte mit diesem Build melden sich für Push an.

Ausführlich: «Push-Mitteilungen auf Android».

### Wie richte ich das PRTG-Monitoring ein?

1. Öffne **Einstellungen → Monitoring**, aktiviere unter **Monitoring (PRTG)** die Verarbeitung und wähle in der Karte **Alarmierung** das Team, «Störung öffnen bei» und **Erneut alarmieren, solange unbestätigt**.
2. Wähle **Token erzeugen** und kopiere die Webhook-Adresse sofort. Die Adresse wird nur einmal angezeigt.
3. Lege in PRTG unter _Setup → Kontoeinstellungen → Benachrichtigungsvorlagen_ eine Vorlage **HTTP-Aktion ausführen** mit Methode **POST** an. Die Postdaten stehen unter «PRTG-Monitoring».
4. Setze Zustands-Trigger auf der Gruppe oder dem Gerät: _Fehler_ (Down), bei Bedarf _Warnung_ und zwingend die Zeile «nicht mehr im Status …» (Up) mit derselben Vorlage.
5. Ohne den Up-Trigger erfährt nextDesk nie, dass die Störung vorbei ist.

Ausführlich: «PRTG-Monitoring».

### Wie verknüpfe ich Geräte und Dienste mit PRTG?

1. Öffne in der **Infrastruktur** das Gerät mit **Gerät bearbeiten**.
2. Trage die **PRTG-Objekt-ID** ein, am besten die Geräte-ID aus der PRTG-Adresse.
3. Kreuze bei **Dienste (für Systemstatus)** einen oder mehrere Dienste an. Nur damit ändert sich der Systemstatus.
4. Trage beim Gerät den **Uplink** (vorgelagertes Gerät) ein, damit Folgestörungen erkannt werden.

Ausführlich: «PRTG-Monitoring».

### Wie gebe ich PRTG den Weg durch die Firewall frei?

1. Dies ist nötig, wenn PRTG beim Zustellen «403 Forbidden» meldet.
2. Gib die Domain `supabase.co` für den PRTG-Server in der Firewall frei.
3. Verwende alternativ die Weiterleitung über die eigene Domain und lass auch diese Domain für den PRTG-Server zu.
4. Prüfe die Erreichbarkeit auf dem PRTG-Server. Wie, steht unter «PRTG-Monitoring».

Ausführlich: «PRTG-Monitoring».

### Wie beende ich einen offenen PRTG-Alarm?

1. Öffne das Register **Monitoring**.
2. Wähle unter **Alarme aus PRTG** die Aktion **Alarm beenden**. Die gestörten Dienste werden zurückgesetzt.
3. Alternativ schliessen Agenten die Störung unter **Störungen** ab.

Ausführlich: «PRTG-Monitoring».

### Wie richte ich die eigene Überwachung (Sonde) ein?

1. Schalte unter **Funktionen** das Modul _Überwachung_ ein.
2. Lege unter **Einstellungen → Monitoring → Überwachung** mit **Sonde hinzufügen** die Sonde an und lade die `config.json` herunter. Lade danach mit **Sonde herunterladen** das Installationspaket.
3. Stelle einen Server im Netz bereit (Linux mit Docker oder Windows Server). Er braucht ausgehend HTTPS sowie ICMP und die geprüften TCP-Ports zu den überwachten Geräten.
4. Entpacke das Paket, lege die `config.json` in den Ordner `nextdesk-sonde` und führe das Installationsskript für dein System aus. Die genauen Befehle stehen unter «Eigene Überwachung (Sonde)».
5. Die Sonde erscheint nach etwa einer Minute als «online».
6. Lösche die `config.json` nach der Installation aus dem Download- und dem Paketordner, denn sie enthält den Zugangsschlüssel.

Ausführlich: «Eigene Überwachung (Sonde)».

### Wie richte ich SNMP-Sensoren für die Sonde ein?

1. Richte auf den Geräten SNMP nur lesend ein.
2. Ergänze in der `config.json` der Sonde den Block `snmp` mit den Zugangsdaten – oder hinterlege sie in nextDesk (nächste Anleitung). Den Aufbau zeigt der Abschnitt «Eigene Überwachung (Sonde)».
3. `default` gilt für alle Geräte, `hosts` für einzelne Geräte mit anderen Zugangsdaten.
4. Erlaube der Sonde UDP 161 zu den Geräten.
5. Starte die Sonde neu.

Ausführlich: «Eigene Überwachung (Sonde)».

### Wie hinterlege ich SNMP-Zugangsdaten in nextDesk?

1. Öffne in der **Überwachung** das Gerät und klicke auf **SNMP**. Das dürfen nur Mandantenadministratoren.
2. Wähle die Version und gib Community bzw. Benutzer, Verfahren und Schlüssel ein.
3. Speichere. Die Sonde (ab Version 1.4.0) übernimmt die Angaben innert einer Minute.
4. Für einen Standard pro Sonde: **Einstellungen → Monitoring → Überwachung**, Stift bei der Sonde, **SNMP-Standard**.

Gespeicherte Schlüssel werden nie wieder angezeigt; ein leeres Schlüsselfeld behält den gespeicherten. Ausführlich: «Eigene Überwachung (Sonde)».

### Wie aktualisiere ich die Sonde?

1. Zeigt nextDesk bei einer Sonde «Aktualisierung verfügbar», lade das neue Paket herunter.
2. Entpacke es.
3. Führe dasselbe Skript erneut aus. Die installierte Konfiguration mit ihren Ergänzungen bleibt erhalten.

Ausführlich: «Eigene Überwachung (Sonde)».

### Wie richte ich externe Statusquellen ein?

1. Öffne **Einstellungen → Monitoring → Externe Statusquellen**.
2. Hake die gewünschten Anbieter an und wähle **Speichern**. Öffentliche Quellen brauchen keine weitere Einrichtung.
3. Für **Microsoft 365** fügst du in Microsoft Entra bei der App unter _API-Berechtigungen_ die Anwendungsberechtigung `ServiceHealth.Read.All` hinzu und erteilst die Administratorzustimmung.
4. Teste die Verbindung mit **Jetzt prüfen**. Danach prüft nextDesk alle 5 Minuten selbständig.
5. Für WWZ und Swisscom gibt es keine Statusquelle; dort helfen Sensoren in PRTG.

Ausführlich: «Externe Statusquellen (Microsoft 365, GitHub, Claude …)».

### Wie überwache ich Zertifikate, Domains und Backups?

1. Öffne das Register **Monitoring** (dasselbe Register wie bei den externen Statusquellen).
2. Erfasse **Zertifikate und Domains**, damit nextDesk vor dem Ablauf erinnert.
   Wähle dort **Abteilung für Tickets** und **Team für Tickets**, damit die Tickets beim richtigen Team landen.
3. Richte die **Backup-Überwachung** ein (z. B. Veeam per E-Mail oder Webhook) mit erwartetem Intervall und Toleranz; auch hier legst du Abteilung und Team für die Tickets fest.

Ausführlich: «Zertifikate, Domains und Backups».

### Wie richte ich die IP-Adressverwaltung ein?

1. Schalte unter **Module** die _IP-Adressverwaltung_ ein (für alle oder einzelne Abteilungen).
2. Vergib die Rechte «IP-Adressverwaltung ansehen» bzw. «IP-Adressen, Subnetze und VLANs verwalten».
3. Übernimm bestehende Listen unter **IP-Adressen → Import** (Excel, CSV, phpIPAM, NetBox).
4. Der Abgleich mit **Intune** und **PRTG** läuft jede Nacht automatisch, sobald die jeweilige Anbindung eingerichtet ist.

Ausführlich: «IP-Adressverwaltung und Netzwerkagent».

### Wie installiere ich den Netzwerkagenten?

1. Lege unter **IP-Adressen → Discovery → Agenten → Agent anlegen** den Agenten an und wähle Subnetze, Zeitplan und SNMP-Ziele. Der Token wird nur einmal angezeigt.
2. Stelle auf einer VM `tools/ipam-agent` bereit und kopiere `config.example.json` als `config.json`. Trage Adresse, Token und SNMP-Zugangsdaten ein. SNMP-Schlüssel stehen nur in dieser Datei.
3. Starte den Agenten unter Linux oder Windows. Die genauen Befehle stehen unter «IP-Adressverwaltung und Netzwerkagent».
4. Richte auf den Switches SNMPv3 nur lesend ein und erlaube ICMP vom Agenten in alle Subnetze.
5. Der Agent verbindet sich nur ausgehend per HTTPS; eingehende Firewall-Regeln braucht es nicht.

Ausführlich: «IP-Adressverwaltung und Netzwerkagent».

### Wie erlaube ich DHCP- und DNS-Änderungen durch den Agenten?

1. Schalte beim Agenten in nextDesk «Änderungen an DHCP/DNS erlauben» ein.
2. Schalte in der lokalen `config.json` des Agenten `allowWrites` ein.
3. Der Agent schreibt nur für Aufträge, die eine Person mit Verwaltungsrecht freigegeben hat.

Ausführlich: «IP-Adressverwaltung und Netzwerkagent».

### Wie verteile ich die Mobile-App?

1. Die **nextDesk-App** für iOS steht im App Store.
2. Weise Mitarbeitende darauf hin.
3. Die Mitarbeitenden melden sich mit derselben Adresse bzw. per SSO an.

Ausführlich: «Schritt 7: Mobile-App und Abschluss».

### Wie führe ich den Abschluss-Test durch?

1. Erfasse als Mitarbeitende/r ein Ticket.
2. Übernimm als Agent das Ticket und antworte öffentlich.
3. Sende eine E-Mail an das Support-Postfach und prüfe, dass ein Ticket entsteht.
4. Prüfe im **Protokoll**, dass alle Einrichtungsschritte erfasst sind.

Ausführlich: «Schritt 7: Mobile-App und Abschluss».

## Übersicht und Reihenfolge

1. Mandant und ersten Administrator erhalten (Betreiber)
2. Grundeinstellungen: Design, Abteilungen, Teams (Admin)
3. Microsoft Entra SSO (Admin + Microsoft-Admin)
4. Personen einladen und Rollen vergeben (Admin)
5. Exchange Online als E-Mail-Kanal (Admin + Microsoft-Admin)
6. Optional: Verzeichnisabgleich, Intune, Push, PRTG, Backup- und Ablaufüberwachung
7. Mobile-App verteilen und Abschluss-Test

Die Checkliste **Einstellungen → Übersicht → «Bereit für den Arbeitsstart»**
zeigt jederzeit, was noch fehlt.

![Checkliste «Bereit für den Arbeitsstart» in der Übersicht](images/ad-einstellungen.jpg)

## Voraussetzungen

- Ein aktueller Browser (Edge, Chrome, Firefox oder Safari) und die Adresse
  `https://app.nextdesk.ch`.
- Ein nextDesk-Konto mit der Rolle **Administrator** in deinem Mandanten.
  Der Betreiber legt den Mandanten an und lädt die erste Administratorin
  bzw. den ersten Administrator per E-Mail ein.
- Für die Microsoft-Integrationen: Zugang zu einem Konto mit der Rolle
  _Globaler Administrator_ (für die Freigaben) bzw. _Exchange-Administrator_
  (für Postfachberechtigungen).
- Eine Liste deiner E-Mail-Domains, Abteilungen und Support-Postfächer.

## Schritt 1: Erste Anmeldung

1. Öffne den Link in der Einladungs-E-Mail. Die Einladung ist 7 Tage
   gültig.
2. Melde dich mit der eingeladenen E-Mail-Adresse an (Anmeldelink per
   E-Mail oder Passwort).
3. Prüfe, dass links unten der Menüpunkt **Einstellungen** erscheint.

![Anmeldeseite von nextDesk](images/login.jpg)

## Schritt 2: Grundeinstellungen

1. **Einstellungen → Design**: Portalname, Logo und Farben hinterlegen,
   **Corporate Design speichern**. Unter **Anrede** stellst du ein, ob nextDesk alle Texte duzt (Standard) oder siezt.
2. **Einstellungen → Abteilungen**: Abteilungen anlegen (z. B. ICT,
   Facility, HR), Leitungen bestimmen und **Teams pro Abteilung** mit
   Supportstufe erfassen.
3. **Einstellungen → Funktionen**: die gewünschten Module aktivieren (z. B.
   Wissensdatenbank, Self-Service, Ticketvorlagen, SLA-Automatisierung).
4. **Einstellungen → SLA**: mindestens eine SLA-Regel pro Priorität anlegen.

Details zu jedem Register stehen im _Handbuch für Administratoren_.

## Schritt 3: Microsoft Entra SSO

Mit SSO melden sich Mitarbeitende mit ihrem Microsoft-Konto an.

**[Betreiber]** Die zentrale, mehrmandantenfähige App-Registrierung
«nextDesk – Kunden SSO» ist bereits vorhanden. Du erhältst vom Betreiber
deren **Client-ID** (Anwendungs-ID).

**[Microsoft-Admin]** Erteile die Administratorzustimmung für deinen
Microsoft-Mandanten. Der Betreiber sendet dir dafür einen Link der Form:

```text
https://login.microsoftonline.com/<DEINE-TENANT-ID>/adminconsent?client_id=<CLIENT-ID>
```

Deine Tenant-ID findest du im Microsoft Entra Admin Center unter
_Übersicht → Mandanten-ID_.

**[Admin]** In nextDesk unter **Einstellungen → Funktionen → Single Sign-On
→ Konfigurieren**:

| Feld                       | Wert                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| Anbieter                   | Microsoft Entra ID                                                                         |
| Client-ID                  | vom Betreiber erhalten                                                                     |
| Issuer-URL                 | `https://login.microsoftonline.com/<IHRE-TENANT-ID>/v2.0`                                  |
| Discovery-URL              | `https://login.microsoftonline.com/<IHRE-TENANT-ID>/v2.0/.well-known/openid-configuration` |
| Zugelassene E-Mail-Domains | z. B. `muster.ch` – eine pro Zeile                                                         |

1. **SSO aktivieren** ankreuzen, **SSO für die Anmeldung erzwingen** vorerst
   _nicht_ ankreuzen, **SSO-Konfiguration speichern**.
2. In einem privaten Browserfenster mit **Mit SSO anmelden** testen.
3. Erst wenn der Test klappt, **SSO für die Anmeldung erzwingen** setzen.

> Eine Domain kann nur einem nextDesk-Mandanten zugeordnet sein. Personen aus
> zugelassenen Domains werden beim ersten Login als _anfragende Person_
> angelegt – Agenten- und Adminrechte vergibst du separat.

![SSO-Konfiguration mit Microsoft Entra ID](images/in-sso.jpg)

## Schritt 4: Personen und Rollen

1. **Einstellungen → Personen → Person einladen**: Agenten mit **Arbeitet als
   Support-Agent** und Ticketzugriffsbereich einladen. Mitarbeitende ohne
   Ticketbearbeitung müssen mit SSO nicht eingeladen werden.
2. **Einstellungen → Rollen → Rollen zuweisen**: weitere Administratoren
   oder eigene Rollen vergeben.

## Schritt 5: Exchange Online (E-Mail-Kanal)

E-Mails an deine Support-Adresse werden zu Tickets, Agentenantworten gehen als
E-Mail zurück.

**[Betreiber]** Die App «nextDesk – Exchange Online» mit den delegierten
Berechtigungen _User.Read, Mail.Read, Mail.Send, Mail.Read.Shared,
Mail.Send.Shared_ ist eingerichtet. nextDesk verwendet keine
Anwendungsberechtigungen für Mail.

**[Microsoft-Admin]** Bestimme ein Connector-Konto (z. B.
`nextdesk-connector@muster.ch`). Gib diesem Konto im Exchange Admin
Center unter _Empfänger → Postfächer → Postfachdelegierung_ für **jedes**
Support-Postfach die Rechte **Vollzugriff** und **Senden als**.

**[Admin]** In nextDesk:

1. **Einstellungen → Funktionen → E-Mail-Kanal (Exchange Online)** aktivieren
   und **Konfigurieren** öffnen.
2. **Microsoft 365 verbinden** und mit dem Connector-Konto anmelden.
3. **Postfach hinzufügen**: Support-Postfach, _Ziel-Abteilung für neue
   Tickets_, optional das _Team für neue Tickets_ (jedes neue E-Mail-Ticket
   dieses Postfachs wird diesem Team zugeordnet; das Team muss zur
   Ziel-Abteilung gehören) und die gewünschten Mitteilungen (Eingangsbestätigung,
   Agentenantworten per E-Mail, Lösungsmitteilung) wählen →
   **Postfach speichern**.
4. **Prüfen** → **Aktivieren** → **Testmail** senden.

Neue E-Mails werden etwa alle 5 Minuten abgeholt. Ein Postfach kann nur einem
Mandanten gehören. Über das aktive Postfach verschickt nextDesk auch die
**E-Mail-Benachrichtigungen**, die Personen unter _Persönliche Einstellungen →
Benachrichtigungen_ pro Benachrichtigung einschalten. Für Agenten sind
anfangs alle Benachrichtigungen per Push und E-Mail eingeschaltet. Der Knopf
in diesen E-Mails verweist auf `https://app.nextdesk.ch/?benachrichtigung=<ID>`
(nur die Kennung der Benachrichtigung, keine Inhalte); die Web-App prüft nach
der Anmeldung den Zugriff und öffnet das Objekt. Optional aktivierst du im selben Bereich die
**Phishing-Meldungen** mit eigener Meldeadresse und Zielabteilung. Kategorie
und Unterkategorie des Sicherheitstickets wählst du dort aus oder erfasst sie
über **+ Neue Kategorie …** bzw. **+ Neue Unterkategorie …** direkt neu. Das
**Sicherheitsteam** bekommt die Fälle zugewiesen und wird benachrichtigt; nur
seine Mitglieder sehen den Bereich **Phishing / Junk** (Web und App).
Meldungen werden als **Phishing / Junk** bearbeitet (eigener Menüpunkt,
nicht in der Ticketliste). Unter **Massnahmen je Urteil** legst du fest,
welche Checkliste nach dem Urteil _Harmlos_, _Spam_, _Phishing_ oder
_Gezielter Angriff_ erscheint; ohne eigene Liste gelten Standard-Checklisten.

Damit Mitarbeitende in Outlook mit **Melden → Phishing melden** direkt an
nextDesk melden können, trägst du in Microsoft Defender unter
_Einstellungen → E-Mail und Zusammenarbeit → Von Benutzern gemeldete
Einstellungen_ die Meldeadresse als **Meldepostfach** ein (_Nur mein
Berichtspostfach_). Die Meldeadresse muss beim verbundenen Postfach ankommen.

Ist die Meldeadresse ein verbundenes Support-Postfach (dasselbe oder ein
anderes, z. B. wenn eine Mail an mehrere Support-Adressen geht), werden nur
Mails als Meldung erkannt, deren Betreff «Phishing» oder «verdächtig» enthält oder mit «Junk:»
bzw. «Phish:» beginnt (so meldet Outlook mit **Melden**). Auch «Not junk:»
(Outlook **Melden → Kein Junk**, eine aus dem Junk-Ordner freigegebene Mail)
wird erkannt: Sie wird als Phishing-/Junk-Fall «Harmlos» abgelegt, ohne
Alarmierung und ohne Dankesnachricht; nur bei hohem Risiko bleibt der Fall
zur Beurteilung offen. Alle anderen Mails an das Support-Postfach bleiben
normale Tickets. Mit einer eigenen Meldeadresse
(Alias) wird jede Mail dorthin als Meldung behandelt.

Die Datei **winmail.dat**, die Outlook einer Meldung beilegt, wird am
Phishing-/Junk-Fall als Anhang abgelegt (nur zum Herunterladen, nie geöffnet oder
dargestellt).

![E-Mail-Kanäle mit Support-Postfächern](images/in-exchange.jpg)

## Schritt 6: Optionale Integrationen

### Microsoft-Entra-Verzeichnisabgleich

Übernimmt Name, E-Mail, Funktion, Abteilung und Aktivstatus aus Entra.

- Voraussetzung: SSO ist mit deiner **eigenen Tenant-ID** konfiguriert
  (nicht `common`).
- **[Microsoft-Admin]** Zustimmung für die Berechtigung _User.Read.All_
  erteilen (Link vom Betreiber).
- **[Admin]** **Einstellungen → Funktionen → Microsoft Entra-Verzeichnis**
  (am Ende der Seite): _Connector aktivieren (Abgleich jede Nacht
  automatisch)_ → **Konfiguration speichern** → **Verbindung testen** →
  **Jetzt abgleichen**.

Ist der Connector aktiv, läuft der Abgleich jede Nacht automatisch (um 01:41
UTC); **Jetzt abgleichen** startet ihn zusätzlich von Hand. Es werden keine
Personen gelöscht. Die **Abgleichshistorie** zeigt die letzten drei Läufe mit
_Automatischer Abgleich_ bzw. _Manueller Abgleich_, verarbeiteten und aktiven
Personen; **Ältere Läufe anzeigen** klappt bis zu 20 Läufe auf. Die
abgeglichenen Personen erscheinen unter **Einstellungen → Personen**.

![Microsoft Entra-Verzeichnis im Register Funktionen](images/in-verzeichnis.jpg)

### Microsoft Intune (Geräte)

- **[Microsoft-Admin]** Zustimmung für die Intune-App mit
  _DeviceManagementManagedDevices.Read.All_ (nur lesend) erteilen.
- **[Admin]** Funktion **Asset-Management** aktivieren →
  **Konfigurieren** → _Microsoft-Graph-Abgleich für diesen Mandanten
  freigeben_ → Vorschau prüfen → **Übernahme ausdrücklich bestätigen** →
  **Jetzt einmalig abgleichen**.

Geräte mit bereits vorhandener Seriennummer werden übersprungen, es wird nie
etwas gelöscht.

Sobald der Abgleich freigegeben ist, läuft er zusätzlich **jede Nacht (gegen
03:10 Uhr, Sommerzeit 04:10 Uhr)** automatisch (Cron `nextdesk-intune-scheduled-sync`, Edge Function
`intune-scheduled-sync`). Er läuft im Namen der Person, die die
Intune-Anbindung zuletzt gespeichert hat (sonst einer anderen Person mit dem
Recht, Asset-Integrationen zu verwalten). Ist die IP-Adressverwaltung aktiv,
liefert derselbe Geräteabruf auch die MAC-Adressen; der bisherige separate
nächtliche Intune-Abruf der IP-Adressverwaltung entfällt dann.
Voraussetzung ist die Dispatch-Konfiguration für Cron-Aufrufe (wie bei
PRTG/IP-Adressverwaltung).

Die Historie unter dem Abgleich zeigt die letzten drei Läufe; **Ältere Läufe
anzeigen** klappt bis zu 20 auf. Der nächtliche Lauf heisst dort
**Automatischer Abgleich abgeschlossen** («Synchronisation (täglich,
automatisch)»), von Hand gestartete Läufe **Manueller Abgleich
abgeschlossen** bzw. «Synchronisation (von Hand)».

![Microsoft-Intune-Abgleich](images/in-intune.jpg)

**Massnahmen in Phishing-/Junk-Fällen (optional).** Hat jemand in einer
Phishing-Mail geklickt, kann das Sicherheitsteam direkt aus dem Fall handeln.
Dafür braucht dieselbe Intune-/Entra-App zusätzliche
Anwendungsberechtigungen mit Administratorzustimmung:

- _DeviceManagementManagedDevices.PrivilegedOperations.All_ – **Gerät
  synchronisieren** und **Defender-Schnellscan** (wie bei den
  Intune-Aktionen).
- _User.RevokeSessions.All_ – **Sitzungen widerrufen**.
- _User-PasswordProfile.ReadWrite.All_ – **Passwort-Reset erzwingen**. Für
  Konten mit Administratorrolle braucht die App zusätzlich eine passende
  Entra-Rolle (z. B. _Administrator für privilegierte Authentifizierung_);
  sonst lehnt Microsoft den Schritt ab.

Fehlt eine Berechtigung, zeigt nextDesk im Fall eine klare Meldung, und das
Team erledigt den Schritt im Entra Admin Center. Ein Gerät isolieren geht nur
in Microsoft Defender.

### Microsoft Teams im Shop

Mitarbeitende können im Shop ein neues Microsoft-Teams-Team bestellen
(Wizard, ohne Genehmigung; nextDesk legt das Team über Microsoft Graph an,
erinnert die Owner vor dem Ende und archiviert abgelaufene Teams). Das
Menü **Teams** zeigt und verwaltet alle Teams der Organisation.

1. **[Admin]** Unter **Einstellungen → Funktionen** den Schalter
   **Microsoft Teams im Shop** einschalten (standardmässig aus).
2. **[Microsoft-Admin]** In derselben Karte steht der **Zustimmungslink**.
   Der Globale Administrator öffnet ihn und klickt **Akzeptieren**. Damit
   erhält die nextDesk-App diese Anwendungsberechtigungen: _Team.Create_,
   _TeamMember.ReadWrite.All_, _Channel.Create_, _TeamsTab.Create_,
   _TeamSettings.ReadWrite.All_, _Group.Read.All_, _Team.ReadBasic.All_ und
   für Gäste _User.Invite.All_. Wer Teams im Menü **Teams** löschen will,
   braucht zusätzlich _Group.ReadWrite.All_ (ohne dieses Recht bleibt das
   Löschen gesperrt, alles andere funktioniert). Prüfe den Umfang mit deiner
   IT-Sicherheit.
3. **[Admin]** Nach einigen Minuten **Verbindung prüfen**. Die Karte nennt,
   was noch fehlt (zum Beispiel ein einzelnes Recht). Dort stellst du auch
   die längste Laufzeit und die Gastregel ein.

- Voraussetzungen: SSO mit der eigenen **Tenant-ID**, der
  **Verzeichnisabgleich** (für die Personensuche) und die Funktion **Shop**.
- **[Betreiber]** Die zentrale Graph-App (dieselbe wie für Intune) braucht
  die oben genannten Rechte einmalig als Anwendungsberechtigungen in ihrer
  App-Registrierung. Optional kann eine eigene App über die Secrets
  `TEAMS_GRAPH_CLIENT_ID` und `TEAMS_GRAPH_CLIENT_SECRET` verwendet werden.
- Das Menü **Teams** sehen Personen mit dem Recht zur Shop-Verwaltung; der
  Abgleich mit Microsoft läuft beim Öffnen und auf Knopfdruck.

Das Anlegen läuft im Hintergrund (Cron `nextdesk-teams-lifecycle`, alle
5 Minuten, Edge Function `teams-lifecycle`).

### Push-Benachrichtigungen (iOS)

- **[Admin]** Funktion **Push-Benachrichtigungen** aktivieren und die
  Inhaltsstufe **Nur Ticketnummer** (empfohlen) wählen. Ein Einchecken ist
  nicht nötig: Jede Person legt unter _Persönliche Einstellungen →
  Benachrichtigungen → Benachrichtigungszeit_ selbst fest, an welchen Tagen
  und zu welchen Zeiten sie Mitteilungen erhält, und schaltet pro
  Benachrichtigung Push und E-Mail ein.
- Anwenderinnen und Anwender testen in der iOS-App unter _Profil →
  Benachrichtigungen → Testmitteilung senden_.

### Push-Mitteilungen auf Android

Ticket-Mitteilungen gibt es nur auf dem iPhone. Die **Push-Mitteilungen der
Administration** (Einstellungen → Funktionen → Push-Benachrichtigungen) gehen
auch an Android-Geräte, und zwar über den Expo-Push-Dienst. Einmalig nötig:

1. **[Betreiber]** In der Firebase-Konsole ein Projekt anlegen und die
   Android-App mit der Paket-ID `ch.nextdesk.grossict` hinzufügen. Die Datei
   `google-services.json` herunterladen.
2. **[Betreiber]** In EAS die Datei als Datei-Variable `GOOGLE_SERVICES_JSON`
   hinterlegen (oder in den Ordner `mobile` legen) und unter _Credentials →
   Android → FCM V1_ den Dienstkonto-Schlüssel des Firebase-Projekts hochladen.
3. **[Betreiber]** Einen neuen Android-Build erstellen und veröffentlichen.
   Erst Geräte mit diesem Build melden sich für Push an (beim ersten Start
   fragt Android nach der Erlaubnis für Benachrichtigungen).

### PRTG-Monitoring

PRTG-Meldungen erzeugen keine Tickets, sondern **Störungen** im
Arbeitsbereich (siehe _Handbuch für Agenten_). Das gewählte Team wird sofort
per Push und E-Mail alarmiert.

1. **[Admin]** **Einstellungen → Monitoring**: unter **Monitoring (PRTG)** die
   Verarbeitung aktivieren; in der Karte **Alarmierung** (gilt auch für die
   eigene Überwachung) **Team für die Alarmierung** (ohne Team alle Agenten; nur dieses
   Team sieht den Bereich Störungen in Web und App),
   «Störung öffnen bei» (Down bzw. Down und Warning) und **Erneut alarmieren,
   solange unbestätigt** (Standard alle 15 Minuten, oder _Nie_) wählen,
   **Token erzeugen**. Die Webhook-Adresse wird **nur einmal** angezeigt –
   sofort kopieren. **Folgestörungen bündeln** fasst Geräte hinter einem
   gestörten Gerät (Uplink in der Infrastruktur) zusammen; **Während einer
   Wartung … nicht alarmieren** unterdrückt Alarme, solange ein betroffener
   Dienst im Systemstatus auf Wartung steht.
2. In PRTG unter _Setup → Kontoeinstellungen → Benachrichtigungsvorlagen_
   eine Vorlage **HTTP-Aktion ausführen** mit Methode **POST** anlegen.
   Postdaten:

   ```text
   device=%device&host=%host&sensor=%sensor&status=%status&message=%message&down=%down&lastvalue=%lastvalue&datetime=%datetime&group=%group&probe=%probe&sensorid=%sensorid&deviceid=%deviceid
   ```

3. Zustands-Trigger auf der Gruppe oder dem Gerät setzen: _Fehler_ (Down),
   bei Bedarf _Warnung_ und **zwingend** die Zeile «nicht mehr im Status …»
   (Up) mit derselben Vorlage. Ohne den Up-Trigger erfährt nextDesk nie, dass
   die Störung vorbei ist, und der Dienst bleibt im Systemstatus gestört. Bei
   _Up_ steht die Störung auf «Wieder OK – offen»; abgeschlossen wird sie von
   Hand mit der Ursache. nextDesk versteht die
   Statuswörter deutsch (Fehler, Warnung, OK, Pausiert) und englisch (Down,
   Warning, Up, Paused).
4. **Geräte und Dienste verknüpfen** (nur damit ändert sich der Systemstatus):
   unter **Infrastruktur → Gerät bearbeiten** die **PRTG-Objekt-ID** eintragen
   (am besten die Geräte-ID aus der PRTG-Adresse `device.htm?id=…`, dann gelten
   alle Sensoren des Geräts) und bei **Dienste (für Systemstatus)** einen oder
   **mehrere Dienste** ankreuzen. Ohne ID ordnet nextDesk über Hostname bzw.
   IP-Adresse, dann über den Gerätenamen und zuletzt über eine IP-Adresse
   bzw. einen Hostnamen der IP-Adressverwaltung mit verknüpftem Gerät zu. Bei
   Down wechseln alle
   gewählten Dienste auf «Teilweiser Ausfall» (Warning: «Eingeschränkt»), bei
   Up zurück auf «Betriebsbereit», sobald kein anderer Alarm sie mehr betrifft.
5. Blockiert deine Firewall die Webhook-Adresse (typisch: Webfilter oder
   HTTPS-Prüfung, PRTG meldet «403 Forbidden»), gib die Domain
   `supabase.co` für den PRTG-Server in der Firewall frei oder verwende
   die Weiterleitung über die eigene Domain:
   `https://app.nextdesk.ch/prtg-relay.php?token=<TOKEN>`. Auch diese Domain
   muss die Firewall für den PRTG-Server zulassen; die Prüfung erfolgt mit
   `curl.exe -ik …` auf dem PRTG-Server (Antwort 401 mit falschem Token =
   erreichbar).
6. Geht ein «Up» verloren, bleibt ein Alarm offen. Im Register **Monitoring**
   beendest du ihn unter **Alarme aus PRTG → Alarm beenden**; dabei werden die
   gestörten Dienste zurückgesetzt. Alternativ schliessen Agenten die Störung
   unter **Störungen** ab.
7. Damit Folgestörungen erkannt werden, beim Gerät in der Infrastruktur den
   **Uplink** (vorgelagertes Gerät) eintragen.

![Monitoring (PRTG) mit Token und Alarmierung](images/in-monitoring.jpg)

### Eigene Überwachung (Sonde)

Die Sonde ist derselbe Netzwerkagent wie für die IP-Adressverwaltung
(`tools/ipam-agent`). Läuft er bereits, ist nichts zu installieren: Er
übernimmt die Sensoren, sobald das Modul _Überwachung_ aktiv ist und der
Agent auf Version 1.1.0 oder neuer aktualisiert wurde (SNMP-Sensoren: 1.2.0,
Verbindungen: 1.3.0).

1. Unter **Funktionen** das Modul _Überwachung_ einschalten.
2. Unter **Einstellungen → Monitoring → Überwachung** (oder **Dienste und
   Überwachung → Überwachung → Sonden**) mit **Sonde hinzufügen** die Sonde
   anlegen und die `config.json` herunterladen. Danach mit **Sonde
   herunterladen** das Installationspaket (`nextdesk-sonde-<Version>.zip`)
   laden.
3. Einen Server im Netz bereitstellen (2 vCPU, 2 GB RAM; Linux mit Docker
   oder Windows Server 2016+ mit Node.js 22 LTS). Er braucht:
   - ausgehend HTTPS (443) zu `<projekt>.supabase.co`, keine eingehende
     Firewall-Regel;
   - ICMP (Ping) und die geprüften TCP-Ports zu den überwachten Geräten.
4. Das Paket auf dem Server entpacken und die `config.json` in den Ordner
   `nextdesk-sonde` legen.
   - **Windows**: in einer PowerShell als Administrator
     `.\windows\install-service.ps1` ausführen. Das Skript kopiert die Sonde
     nach `C:\Program Files\nextDesk\ipam-agent`, legt die Konfiguration
     unter `C:\ProgramData\nextDesk\ipam-agent` ab (lesbar nur für SYSTEM,
     Administratoren und das Dienstkonto), prüft die Verbindung und startet
     den Dienst «nextDesk IPAM-Agent». Der Dienst-Wrapper WinSW liegt dem
     Paket bei.
   - **Linux**: `sudo linux/install.sh` ausführen. Das Skript legt die
     Konfiguration unter `/etc/nextdesk-ipam-agent` ab, baut das
     Docker-Image, prüft die Verbindung und startet den Container
     `nextdesk-ipam-agent`.
5. In der Überwachung erscheint die Sonde nach etwa einer Minute als
   «online».
6. Die `config.json` enthält den Zugangsschlüssel: nach der Installation aus
   dem Download- und dem Paketordner löschen.

**SNMP-Sensoren** (Laufzeit, Port-Traffic, eigene OID, ab Sonde 1.2.0)
brauchen Zugangsdaten – in der `config.json` der Sonde oder in nextDesk
(siehe unten). Für die Datei den Block `snmp` ergänzen und die Sonde neu
starten:

```json
"snmp": {
  "default": {
    "version": "v3",
    "user": "nextdesk-ro",
    "authProtocol": "sha256",
    "authKey": "<Authentifizierungsschlüssel>",
    "privProtocol": "aes",
    "privKey": "<Verschlüsselungsschlüssel>"
  },
  "hosts": {
    "192.0.2.201": { "version": "v2c", "community": "<nur lesend>" }
  }
}
```

`default` gilt für alle Geräte, `hosts` für einzelne Geräte mit anderen
Zugangsdaten (Schlüssel = IP-Adresse bzw. Hostname wie in der Infrastruktur).
Die Sonde braucht UDP 161 zu den Geräten; auf den Geräten SNMP nur lesend
einrichten.

Geräte mit unterschiedlichen Zugangsdaten (USV, Storage, iLO) erhalten je
einen Eintrag unter `hosts`, mit der IP-Adresse wie in nextDesk. Ein `"` oder
`\` in einem Schlüssel wird als `\"` bzw. `\\` geschrieben. SNMPv3 mit
DES-Verschlüsselung (ältere APC-USV) funktioniert ab Sonde 1.3.2; sicherer ist
AES auf dem Gerät.

**SNMP-Zugangsdaten in nextDesk** (ab Sonde 1.4.0): Statt in der
`config.json` lassen sich die Zugangsdaten auch in nextDesk pflegen – pro
Gerät im Gerätedetail der Überwachung über **SNMP**, als Standard einer Sonde
unter **Einstellungen → Monitoring → Überwachung** im Dialog der Sonde
(**SNMP-Standard**). Das dürfen nur Mandantenadministratoren. Community und
Schlüssel liegen verschlüsselt im Tresor der Datenbank (Supabase Vault),
werden in nextDesk nie wieder angezeigt und gehen nur über die verschlüsselte
Verbindung an die Sonde, die sie im Arbeitsspeicher hält. Die Sonde übernimmt
Änderungen innert einer Minute, ohne Neustart. Reihenfolge: Eintrag des
Geräts in nextDesk, Eintrag des Geräts unter `hosts`, Standard der Sonde in
nextDesk, `default` der `config.json`. Wer die Zugangsdaten nicht in der
Cloud speichern will, pflegt sie weiterhin nur in der `config.json`.

**Verbindungen** (welcher Port führt zu welchem Gerät, ab Sonde 1.3.0):
Mit denselben SNMP-Zugangsdaten liest die Sonde bei Switches, Firewalls und
Routern sowie bei allen Geräten mit SNMP-Sensor alle sechs Stunden die Ports,
die LLDP-Nachbarn und die MAC-Tabelle aus. Dafür ist nichts weiter
einzurichten. Damit Verbindungen zwischen Switches erkannt werden, muss auf
den Switches LLDP aktiv sein (bei Aruba und HP Standard). Endgeräte werden
über ihre MAC-Adresse zugeordnet; sie muss dazu in der IP-Adressverwaltung
oder beim Gerät in der Infrastruktur stehen.

**Wächter:** Meldet sich eine Sonde mit Sensoren fünf Minuten nicht, öffnet
nextDesk eine Störung. Das prüft ein Datenbank-Job jede Minute; er nutzt
dieselbe Weck-Einrichtung wie die Ablauf- und Backup-Überwachung.

**HTTPS-Prüfung der Firewall:** Entschlüsselt eine Firewall den
HTTPS-Verkehr (z. B. Sophos mit eigener Zertifizierungsstelle), bricht die
Installation mit «self-signed certificate in certificate chain» ab. Ab
Sonde 1.2.1 vertraut die Sonde den Zertifizierungsstellen aus dem
Zertifikatsspeicher des Betriebssystems. Liegt das CA-Zertifikat der Firewall
dort (Windows: «Vertrauenswürdige Stammzertifizierungsstellen» des
Computers), genügt das neue Paket. Sonst das CA-Zertifikat dort installieren
oder `<projekt>.supabase.co` in der Firewall von der HTTPS-Entschlüsselung
ausnehmen. Die Prüfung der Zertifikate wird nie abgeschaltet.

**Aktualisieren:** Zeigt nextDesk bei einer Sonde «Aktualisierung verfügbar»,
das neue Paket herunterladen, entpacken und dasselbe Skript erneut ausführen.
Die installierte Konfiguration mit ihren Ergänzungen (z. B. SNMP) bleibt
erhalten. Unter Windows gilt das ab Paket 1.3.1 auch, wenn im Paketordner noch
die `config.json` derselben Sonde liegt; ältere Pakete und das Linux-Skript
überschreiben die installierte Datei mit ihr. Eine `config.json` einer
anderen Sonde (anderer Token) ersetzt die installierte immer.

**Betreiber:** Das Paket baut der GitHub-Workflow «Publish probe package» bei
jeder Änderung unter `tools/ipam-agent` auf `main` und legt es im privaten
Storage-Bucket `probe-packages` ab. Er braucht das Secret
`SUPABASE_ACCESS_TOKEN`. Die Version steht in `tools/ipam-agent/package.json`
und `src/version.ts`; nur eine höhere Version löst den Hinweis
«Aktualisierung verfügbar» aus.

Die Sonde holt ihre Prüfaufträge etwa jede Minute neu und meldet Resultate
alle 30 Sekunden. Ist nextDesk nicht erreichbar, puffert sie die Resultate
und liefert sie nach.

> Parallelbetrieb mit PRTG: Beide Systeme dürfen dasselbe Gerät überwachen.
> Jedes führt seine eigenen Alarme; die Störung wird je Gerät gemeinsam
> geführt und erst behoben, wenn beide wieder OK melden.

### Externe Statusquellen (Microsoft 365, GitHub, Claude …)

1. **[Admin]** **Einstellungen → Monitoring → Externe Statusquellen**: die
   gewünschten Anbieter anhaken und **Speichern**. Die öffentlichen Quellen
   (GitHub, Claude, Gemini, App Store, Google Play, Init7, Swisscom, Salt)
   brauchen keine
   weitere Einrichtung.
2. Für **Microsoft 365** liest nextDesk den Dienststatus deines Mandanten über
   Microsoft Graph mit derselben Entra-App wie der Verzeichnisabgleich. In
   Microsoft Entra unter _App-Registrierungen → nextDesk → API-Berechtigungen_
   die **Anwendungsberechtigung** `ServiceHealth.Read.All` (Microsoft Graph)
   hinzufügen und die **Administratorzustimmung erteilen**. Ohne diese
   Berechtigung zeigt die Quelle «Berechtigung ServiceHealth.Read.All fehlt».
   Berücksichtigt werden Vorfälle; reine Hinweise (Advisories) lösen keinen
   Alarm aus.
3. Mit **Jetzt prüfen** testest du die Verbindung; danach prüft nextDesk alle
   5 Minuten selbständig.
4. **WWZ und Swisscom** bieten keine maschinenlesbare Statusquelle. Lege
   dafür in PRTG einen Ping-Sensor auf das Gateway bzw. einen HTTP-Sensor an;
   die Meldungen kommen dann wie gewohnt als Störung.

### Zertifikate, Domains und Backups

Im selben Register erfasst du **Zertifikate und Domains** (Erinnerung vor
Ablauf) und die **Backup-Überwachung** (z. B. Veeam per E-Mail oder Webhook mit
erwartetem Intervall und Toleranz).

Bei **Zertifikate und Domains** und bei der **Backup-Überwachung** wählst du neben der **Abteilung für Tickets**
auch das **Team für Tickets**: Die Tickets (vor dem Ablauf bzw. bei fehlgeschlagenen oder ausbleibenden Backups) werden diesem Team
zugewiesen. Zur Auswahl stehen die aktiven Teams der gewählten Abteilung; ohne
Abteilung landet das Ticket in der Abteilung des Teams.

### IP-Adressverwaltung und Netzwerkagent

1. Unter **Module** die _IP-Adressverwaltung_ einschalten (für alle oder
   einzelne Abteilungen) und die Rechte «IP-Adressverwaltung ansehen» bzw.
   «IP-Adressen, Subnetze und VLANs verwalten» vergeben.
2. Bestehende Listen unter **IP-Adressen → Import** übernehmen (Excel, CSV,
   phpIPAM, NetBox).
3. Für die automatische Erkennung den **Netzwerkagenten** im LAN installieren.
   Er verbindet sich nur ausgehend per HTTPS (443) mit nextDesk; eingehende
   Firewall-Regeln braucht es nicht.
   - Unter **IP-Adressen → Discovery → Agenten → Agent anlegen** den Agenten
     erfassen, die zu scannenden Subnetze, den Zeitplan und die SNMP-Ziele
     wählen. Der Token wird **nur einmal** angezeigt.
   - Auf einer VM (Linux mit Docker, oder Windows Server für Microsoft DHCP
     und DNS) `tools/ipam-agent` aus dem Repository bereitstellen und
     `config.example.json` als `config.json` kopieren: Adresse
     `https://<projekt>.supabase.co/functions/v1/ipam-agent`, Token und die
     SNMP-Zugangsdaten. **SNMP-Schlüssel stehen in dieser Datei** oder,
     ab Sonde 1.4.0, verschlüsselt in nextDesk (Überwachung → Gerät →
     **SNMP**); die Einstellungen des Agenten selbst nehmen keine
     Zugangsdaten an.
   - Linux: Image mit `docker build` erstellen, mit `--check` die Verbindung
     prüfen und mit `docker run -d --network host --restart unless-stopped`
     starten. Windows: `npm ci && npm run build`, danach
     `windows\install-service.ps1` (Dienst unter einem gMSA-Dienstkonto).
   - Auf den Switches SNMPv3 nur lesend einrichten und ICMP vom Agenten in
     alle Subnetze erlauben (Firewall und IDS informieren).
   - Die ausführliche Anleitung mit Beispielen für Aruba steht in
     `tools/ipam-agent/README.md`.
4. DHCP-Reservierungen und DNS-Einträge schreibt der Agent nur, wenn beim
   Agenten «Änderungen an DHCP/DNS erlauben» und in der lokalen `config.json`
   `allowWrites` eingeschaltet sind, und nur für Aufträge, die eine Person mit
   Verwaltungsrecht freigegeben hat.
5. Der Abgleich mit **Intune** und **PRTG** läuft jede Nacht automatisch,
   sobald die jeweilige Anbindung oben eingerichtet ist.

## Schritt 7: Mobile-App und Abschluss

- Die **nextDesk-App** für iOS steht im App Store. Mitarbeitende melden sich
  mit derselben Adresse bzw. per SSO an.
- Abschluss-Test:
  1. Als Mitarbeitende/r ein Ticket erfassen.
  2. Als Agent das Ticket übernehmen und öffentlich antworten.
  3. Eine E-Mail an das Support-Postfach senden und prüfen, dass ein Ticket
     entsteht.
  4. Im **Protokoll** prüfen, dass alle Einrichtungsschritte erfasst sind.

## Fehlerbehebung

| Problem                                         | Lösung                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| SSO-Anmeldung meldet fehlende Zustimmung        | Admin-Consent-Link erneut durch den Microsoft-Admin ausführen lassen                         |
| Person landet im falschen bzw. keinem Mandanten | Domain unter «Zugelassene E-Mail-Domains» prüfen; eine Domain gehört nur zu einem Mandanten  |
| Postfach lässt sich nicht prüfen                | Vollzugriff und «Senden als» für das Connector-Konto prüfen, danach erneut **Prüfen**        |
| Keine Tickets aus E-Mails                       | Postfach aktiv? Bis zu 5 Minuten warten; Status im Bereich E-Mail-Kanäle prüfen              |
| PRTG-Alarme erscheinen nicht unter Störungen    | Token neu erzeugen, Postdaten und Methode POST prüfen, ggf. `prtg-relay.php` verwenden       |
| PRTG meldet «403 Forbidden» beim Zustellen      | Firewall/Webfilter des PRTG-Servers blockiert die Domain; Freigabe oder Weiterleitung nutzen |
| Dienst bleibt auf «Teilweiser Ausfall»          | Fehlt der Up-Trigger oder kam das Up nicht an? Alarm im Register Monitoring beenden          |
| Agent sieht keine Tickets                       | Rolle und Ticketzugriffsbereich unter **Personen** bzw. **Rollen** prüfen                    |

## Anhang: Plattformbetrieb (nur Betreiber)

Für den Betrieb der Plattform selbst (nicht für Kunden-Administratoren):
Supabase in der Region Zürich (`eu-central-2`) für Datenbank, Anmeldung und
Edge Functions; Auslieferung der Web-App per GitHub-Workflow auf das
Webhosting; Secrets ausschliesslich in Supabase bzw. GitHub, nie im
Browser. Die vollständigen Betriebsanleitungen stehen im Repository unter
`DEPLOYMENT.md`, `SUPABASE.md` und `docs/deployment/`.
