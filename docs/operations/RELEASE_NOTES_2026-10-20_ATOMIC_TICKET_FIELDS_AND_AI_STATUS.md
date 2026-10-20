# Release Note: Atomare Ticketfeldbearbeitung und KI-Bereitschaftsstatus

**Datum:** 20. Oktober 2026
**Produkt:** nextDesk Web / Supabase
**Code-Commits:** `ea1dffe` (`fix: atomare Ticketfeldbearbeitung und KI-Status`) und `c8ee96d` (`fix: KI-Bereitschaft abwärtskompatibel anzeigen`)
**Datenbankmigration:** `0097_atomic_ticket_custom_field_edit`
**Edge Function:** `ticket-custom-fields` v12, JWT-geschützt
**Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T185510Z-c8ee96d`

## Ausgeliefert

- Der Drag-and-Drop-Konfigurator unter **Einstellungen → Ticketfelder** speichert Änderungen an einem bestehenden Zusatzfeld einschliesslich Abschnitt und Position als eine atomare Mutation.
- Ein Fehler, ein ungültiges Ziel oder ein Versionskonflikt kann somit weder eine teilweise Feldänderung noch eine unbeabsichtigte Verschiebung hinterlassen.
- Der Konfigurator lädt bei Versionskonflikten den aktuellen Layoutstand nach und zeigt die Fehlerrückmeldung weiterhin sichtbar an.
- Die KI-Governance-Oberfläche verarbeitet auch die bereits produktive Antwortform der `ai-assist`-Function. Fehlt eine serverseitige Bereitschaftsangabe, erscheint die Anbindung sicher als **nicht vollständig konfiguriert**, statt die Verwaltungsoberfläche als nicht verfügbar zu blockieren.

## Sicherheit und Mandantentrennung

- Die neue atomare Bearbeitungs-RPC nutzt die bestehende mandantengebundene Layoutversion und die serverseitigen Berechtigungsprüfungen der bestehenden Ticketfeld-RPCs.
- `ticket-custom-fields` bleibt JWT-geschützt. Unauthentisierte Schreibzugriffe werden weiterhin am Gateway abgewiesen.
- Die KI-Anzeige löst keinen Provideraufruf aus und übermittelt keine Artikelinhalte. Eine Wissensaufbereitung bleibt weiterhin ein ausdrücklich ausgelöster Entwurf und erfordert sowohl Mandantenfreigabe als auch vollständige serverseitige Providerkonfiguration.

## Datenbank und Edge Functions

- Migration `0097_atomic_ticket_custom_field_edit` wurde produktiv angewendet.
- `ticket-custom-fields` v12 wurde produktiv ausgerollt.
- Die produktive `ai-assist`-Function wurde nicht geändert; die Weboberfläche ist bewusst kompatibel mit ihrer bestehenden, sicheren Antwortform.

## Validierung

- Vollständige Repository-Suite erfolgreich: `pnpm check`, `pnpm test:schema`, `pnpm test:db`, `pnpm check:edge`, `pnpm test:edge`, `pnpm format:check`, Hetzner-Build, Performance-Budget und `git diff --check`.
- Webtests: 19 Testdateien und 75 Tests erfolgreich.
- Schema- und Datenbankprüfung: 96 Migrationen sowie Mandantentrennung, Versionskonflikte und die atomare Feldbearbeitung erfolgreich geprüft.
- Öffentlicher Web-Smoke-Test erfolgreich; das neue JavaScript-Bundle `assets/index-RhHrtMv3.js` antwortet mit HTTP 200.
- CORS-Preflight der JWT-geschützten `ticket-custom-fields`-Function erfolgreich; ein unauthentisierter POST wird mit HTTP 401 abgewiesen.

## Bekannte Einschränkung und erforderliche Konfiguration

- Für die tatsächliche Claude-Aufbereitung fehlt weiterhin ein serverseitiger Modellwert. Der bereits vorhandene API-Schlüssel allein genügt nicht. Bis ein gültiges `ANTHROPIC_MODEL` als Function-Secret hinterlegt ist, bleibt die Aufbereitung bewusst gesperrt und Artikelentwürfe unverändert.

## Rücknahme

1. Bei einem reinen Webproblem kann das Webbundle aus dem oben genannten Backup nach `/usr/www/users/jqviwy/app/` zurückgespielt werden.
2. Migration 0097 bleibt aktiv, damit die atomare und versionsgebundene Ticketfeldbearbeitung nicht durch Teilupdates umgangen wird. Eine Datenbankrücknahme wäre separat zu prüfen und ausdrücklich freizugeben.
3. Bei einem Function-Problem nur eine mit den Migrationen 0096 und 0097 kompatible, JWT-geschützte `ticket-custom-fields`-Version ausrollen.
