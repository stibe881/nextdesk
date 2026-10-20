# nextDesk – Release Note: Kategorien aus der Wissensoberfläche entfernt

- **Datum:** 20. Oktober 2026, 15:05 UTC
- **Produktiv-Commit:** `8f1bf5552e363605ea21579b432cafa0f19bffeb`
- **Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T150515Z-8f1bf55`
- **Umgebung:** Produktion `https://app.nextdesk.ch`

## Ausgeliefert

Die Wissensdatenbank verwendet keine sichtbare Kategorienführung mehr. Entfernt wurden:

- Kategorien und Unterkategorien auf Artikelkarten
- Kategorienkennzeichnungen in der Artikelansicht
- Kategorien und Unterkategorien im Artikel-Editor
- Kategorienhinweise in der Live-Vorschau
- die Schaltfläche «Kategorien verwalten» sowie das zugehörige Anlageformular

Die Wissensdatenbank bleibt über die bestehende Volltextsuche nach Titel, Zusammenfassung und Artikelinhalt nutzbar.

## Datenbewahrung und Sicherheit

Bestehende Kategorien und bestehende Artikelzuordnungen wurden nicht gelöscht und nicht migriert. Der Webclient lädt, zeigt, erstellt oder ändert Kategorien nicht mehr.

Beim Speichern eines Artikels sendet der Client nur noch den eigentlichen Artikelauftrag mit Titel, Markdown-Inhalt, Sichtbarkeit und optionaler Artikel-ID. Der frühere zusätzliche Aufruf zur Rückschreibung von Kategorienzuordnungen entfällt vollständig. Damit bleiben bestehende Zuordnungen auch bei einer späteren Artikelbearbeitung unverändert und können weder durch parallele Bearbeitungen noch durch unvollständige Leserechte im Client überschrieben werden.

Serverseitige Mandantentrennung, bestehende Rollenprüfungen und die abgesicherte serverseitige Kategorie-API bleiben unverändert. Es wurden keine Datenbankmigrationen, Edge Functions, RLS-Policies, Rollen, Scheduler, externen Integrationen oder automatischen Anlagen geändert.

## Validierung und Auslieferung

Erfolgreich ausgeführt wurden die vollständige Projektsuite, PostgreSQL-Migrations- und RLS-Regressionen, Web-Typecheck, die neue Regression für den artikelreinen Speicherauftrag, Formatprüfung, Hetzner-Produktionsbuild, Performancebudget, unauthentifizierter Browser-Test und `git diff --check`.

Zwei unabhängige Read-only-Reviews prüften zunächst die vollständige UI-Entfernung und anschliessend den korrigierten Speicherpfad. Ein erkannter potenzieller Rückschreibpfad wurde vor dem Release entfernt; der finale Review bestätigte, dass der Webclient keine Kategorienzuordnung mutiert.

Vor dem Release wurde das bestehende Webbundle gesichert. Der Produktions-Smoke-Test war erfolgreich. Die öffentliche Produktionsseite referenziert `assets/index-Dow5aziw.js`; das Bundle liefert HTTP 200.

## Rücknahmeweg

Bei einer notwendigen Rücknahme kann ausschliesslich das Webbundle aus `/usr/www/users/jqviwy/backups/nextdesk-20261020T150515Z-8f1bf55` auf das Hetzner-Webziel zurückkopiert und danach `pnpm smoke:web` wiederholt werden. Eine Datenbankrücknahme ist nicht erforderlich.
