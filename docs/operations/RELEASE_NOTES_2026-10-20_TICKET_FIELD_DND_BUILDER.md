# Release Note: Drag-and-Drop-Konfigurator für Ticketfelder

**Datum:** 20. Oktober 2026
**Produkt:** nextDesk Web / Supabase
**Code-Commit:** `7a8dd07` (`feat(ticket-fields): add drag and drop builder`)
**Datenbankmigration:** `0096_fix_ticket_custom_field_active_positions`
**Edge Function:** `ticket-custom-fields` v11, JWT-geschützt
**Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T181508Z-7a8dd07`

## Ausgeliefert

- Unter **Einstellungen → Ticketfelder** steht eine moderne Baukastenoberfläche mit Feldpalette, konfigurierbarer Formularfläche und Live-Vorschau bereit.
- Die Palette enthält nur ticketrelevante Typen und Voreinstellungen, darunter kurzer Text, Auswahl, Datum, Zahl, Ja / Nein, Gerät- oder Inventarnummer, Standort oder Raum, gewünschter Termin, betroffene Personen und Rückrufwunsch.
- Neue Felder können per Klick in den ersten Abschnitt oder per Drag-and-Drop in eine sichtbare Zielzone eingefügt werden. Das neue Feld öffnet danach im Feldinspektor.
- Bestehende aktive Felder lassen sich per Drag-and-Drop zwischen und innerhalb von Abschnitten sowie per Pfeilaktion umsortieren. Die obere und untere Kartenhälfte bilden unterschiedliche Einfügepositionen ab.
- Die feste Ticketbasis bleibt sichtbar, aber unveränderbar. Die Vorschau zeigt sie zusammen mit den konfigurierten Zusatzfeldern in ihrer wirksamen Reihenfolge.

## Sicherheit und Datenkonsistenz

- Migration 0096 ordnet aktive Felder in jedem Abschnitt lückenlos vor archivierten Feldern ein. Archivierte Felder bleiben für historische Werte erhalten, beeinflussen aber weder sichtbare Positionen noch Verschiebeziele.
- Erstellen, Reaktivieren, Archivieren und Verschieben prüfen dieselbe mandantengebundene Layoutversion und erhöhen sie bei erfolgreicher Mutation. Veraltete Editoransichten erhalten einen Konflikt statt eine neuere Reihenfolge zu überschreiben.
- Die Paletteneinfügung ist ein einzelner atomarer Datenbankbefehl: Bei ungültigem Abschnitt, Ziel oder Versionskonflikt entsteht kein unplatziertes Zusatzfeld.
- Die ehemaligen unversionierten Mutationssignaturen sind für `public`, `anon`, `authenticated` und `service_role` gesperrt. Nur die versionierten, serverseitig berechtigten Befehle sind für die Edge Function ausführbar.
- `ticket-custom-fields` bleibt JWT-geschützt und prüft Mandant, aktive Mitgliedschaft sowie `tenant.settings.manage` serverseitig.

## Validierung

- Vollständige Repository-Suite erfolgreich: Typecheck, Schema- und Datenbanktests, Edge-Check/-Tests, Formatprüfung, Hetzner-Build, Performance-Budget und `git diff --check`.
- Unabhängiger Read-only-Sicherheitsreview nach der Legacy-Sperre: keine verbleibenden Befunde.
- Migration `0096_fix_ticket_custom_field_active_positions` wurde produktiv angewendet.
- `ticket-custom-fields` v11 ist aktiv und weiterhin JWT-geschützt.
- Das Webbundle wurde nach einer Sicherung auf Hetzner ausgeliefert.
- Öffentlicher Release-Smoke-Test und neues JavaScript-Bundle: HTTP 200.
- Unauthentisierter POST auf `ticket-custom-fields`: HTTP 401.

## Bekannte Einschränkungen

- Die Ticketbasisfelder sind bewusst nicht konfigurierbar. Der Baukasten betrifft ausschliesslich Zusatzfelder.
- Bei einem Versionskonflikt lädt der Editor das Layout erneut; die Person muss die beabsichtigte Änderung danach bewusst wiederholen.

## Rücknahme

1. Bei einem reinen Webproblem kann das Webbundle aus dem oben genannten Backup nach `/usr/www/users/jqviwy/app/` zurückgespielt werden.
2. Die Migration bleibt bewusst aktiv, damit keine unversionierte Mutation die Positions- oder Versionsinvarianten umgehen kann. Ein vollständiger Datenbankrollback ist nicht vorgesehen und wäre separat zu prüfen und freizugeben.
3. Bei einem Function-Problem nur eine mit Migration 0096 kompatible, versionierte `ticket-custom-fields`-Function ausrollen; eine Rückkehr zur alten unversionierten Function wäre absichtlich nicht kompatibel.
