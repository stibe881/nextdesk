# Release Notes – Veranstaltungsräume

**Datum:** 20.10.2026  
**Web-/Quellcommit:** `2023388e139fb1892ab6ca56b9e369c8176663da`  
**Produktionsstatus:** veröffentlicht und Smoke-Test erfolgreich

## Inhalt

Der neue eigenständige Bereich **«Veranstaltungsräume»** plant technische Raumaufträge für Aula und Sitzungszimmer ausserhalb der Ticketkennzahlen.

- Raumauftrag mit Raum, Anlass, Start/Ende, verantwortlicher Person und erwarteter Teilnehmendenzahl.
- Standardisierte Ausstattungswünsche: Beamer, Anschlüsse, Bildschirm, Audio, Videocall und Mikrofone.
- Einzeltermine sowie explizit gespeicherte, begrenzte Wochen- und Monatsserien.
- Kalender- und Listenansicht mit sichtbarem Nachladen weiterer Aufträge.
- Arbeitsaufgaben aus einer mandantenspezifischen Standardvorlage: Technik prüfen, Raum einrichten, Videocall vorbereiten, Vor-Ort-Test und Rückbau.
- Zustände: Geplant, In Vorbereitung, Bereit, Durchgeführt und Abgeschlossen.
- Raum- und Ausstattungskonflikte werden vor dem Speichern datensparsam als Anzahl angezeigt und müssen bewusst bestätigt werden. Die finale Prüfung erfolgt nochmals transaktional unter Sperre.
- Termine werden explizit als `Europe/Zurich` verarbeitet; nicht existente Sommerzeit-Ortszeiten werden nicht still verschoben.

Ein Raumauftrag erzeugt **nie** automatisch ein Ticket. Ein reguläres Ticket wird nur bei einer tatsächlich auftretenden Störung bewusst erstellt.

## Sicherheit und Datenwirkung

- Migration `0089_event_space_requests` ergänzt mandantenisolierte Räume, Vorlagen, Aufträge, Ausstattungswünsche und Aufgaben.
- Browserrollen erhalten keinen direkten Tabellen- oder RPC-Zugriff. Alle Datenzugriffe laufen über `event-spaces` (Version 1, JWT-geschützt) mit aktiver Mitgliedschaft und mandantenbezogener Berechtigungsprüfung.
- Neue Berechtigungen: `event.spaces.request` und `event.spaces.manage`.
- Kein Scheduler, kein Hintergrunddienst, keine neue externe Integration und keine automatische Ticketanlage.
- Bestehende Mandanten erhielten die aktive Standardaufgabenvorlage; neue Mandanten erhalten diese über den Provisionierungs-Trigger.

## Verifikation

- Projekt-, Schema-, Datenbank-, Edge-, Webtyp-, Webtest- und Produktionsbuild-Prüfungen erfolgreich.
- Produktion: Migration erfolgreich angewendet; `event-spaces` Version 1 aktiv mit `verify_jwt=true`.
- Hetzner-Webrelease erfolgreich; Produktionsbundle und Function-CORS geprüft; `pnpm smoke:web` erfolgreich.
- Sicherung der vorherigen Webversion: `/usr/www/users/jqviwy/backups/nextdesk-20261020T123907Z-2023388`.

## Rücknahmegrenze

Die Webversion kann anhand der genannten Sicherung zurückgenommen werden. Migration 0089 ist additiv und wird nicht durch das Löschen historischer Datenbankobjekte zurückgenommen. Bereits angelegte Raumaufträge und Aufgaben bleiben bei einem reinen Web-Rollback erhalten.
