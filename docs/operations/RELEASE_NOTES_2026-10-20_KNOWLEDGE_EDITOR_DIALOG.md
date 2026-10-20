# nextDesk – Release Note: Dialogbasierter Wissenseditor

- **Datum:** 20. Oktober 2026, 15:16 UTC
- **Produktiv-Commit:** `d8c89440eed63f6e9a8424c1332eb4d02dec2746`
- **Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T151652Z-d8c8944`
- **Umgebung:** Produktion `https://app.nextdesk.ch`

## Ausgeliefert

Das Anlegen und Bearbeiten von Wissensartikeln öffnet den bestehenden Editor jetzt als fokussierten Dialog über der Wissensdatenbank. Die Seite springt nicht mehr ans untere Seitenende.

Im Dialog bleiben unverändert verfügbar:

- Titel und Sichtbarkeit
- Markdown-Eingabe
- Live-Vorschau
- Anlegen und Speichern von Artikeln

Bei langen Artikeln scrollt ausschliesslich die Dialogfläche. Auf schmalen Bildschirmen erscheint der Editor als gut bedienbare, von unten einblendende Fläche.

## Bedienung und Zugänglichkeit

Beim Öffnen liegt der Fokus im Titelfeld. Der Dialog bietet eine sichtbare Schaltfläche «Schliessen», eine Schaltfläche «Abbrechen» sowie Escape zum kontrollierten Schliessen. Die Tab-Navigation bleibt innerhalb des Dialogs.

Während eine Speicherung läuft, ist das Schliessen gesperrt. Der Dialog selbst bleibt dabei als fokussierbarer Tab-Anker aktiv. Hintergrundscrolling und Scrollweitergabe ausserhalb der Dialogfläche sind gesperrt, damit die Wissensseite im Hintergrund ihre Position nicht verändert.

## Daten und Sicherheit

Die Änderung betrifft ausschliesslich die Weboberfläche. Titel, Sichtbarkeit, Markdown, Vorschau und der bestehende Speicherauftrag bleiben unverändert. Es wurden keine Datenmodelle, Datenbankmigrationen, Edge Functions, RLS-Policies, Rollen, Mandantentrennung, Scheduler, externen Integrationen oder automatischen Anlagen geändert.

## Validierung und Auslieferung

Erfolgreich ausgeführt wurden die vollständige Projektsuite, PostgreSQL-Migrations- und RLS-Regressionen, Web-Typecheck, fokussierte Dialogregressionen, Formatprüfung, Hetzner-Produktionsbuild, Performancebudget, unauthentifizierter Browser-Test und `git diff --check`.

Ein unabhängiger Read-only-Review identifizierte zunächst Lücken bei Fokus im Speicherzustand und Scrollweitergabe. Diese wurden vor dem Release korrigiert. Der finale Review bestätigte den festen Dialog, die interne Scrollbarkeit, die Hintergrundscroll-Sperre, die Fokusfalle inklusive Busy-Zustand sowie den unveränderten mandantengebundenen Speicherpfad.

Vor dem Release wurde das bestehende Webbundle gesichert. Der Produktions-Smoke-Test war erfolgreich. Die öffentliche Produktionsseite referenziert `assets/index-B4vKNjul.js`; das Bundle liefert HTTP 200.

## Rücknahmeweg

Bei einer notwendigen Rücknahme kann ausschliesslich das Webbundle aus `/usr/www/users/jqviwy/backups/nextdesk-20261020T151652Z-d8c8944` auf das Hetzner-Webziel zurückkopiert und danach `pnpm smoke:web` wiederholt werden. Eine Datenbankrücknahme ist nicht erforderlich.
