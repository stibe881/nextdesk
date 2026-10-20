# Release Note: Kontrollierte Anthropic-Aufbereitung für Wissensartikel

**Datum:** 20. Oktober 2026  
**Produkt:** nextDesk Web / Supabase  
**Code-Commit:** `1c0f353` (`feat: add governed Anthropic knowledge drafting`)  
**Datenbankmigration:** `0095_anthropic_knowledge_drafts`  
**Edge Function:** `ai-assist` v6, JWT-geschützt  
**Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T170315Z-1c0f353`

## Ausgeliefert

- Der dialogbasierte Wissenseditor bietet berechtigten Personen den bewussten Schritt **«Mit KI aufbereiten»** für fachlichen Rohinhalt.
- Anthropic liefert ausschliesslich einen Entwurf aus Titel und strukturiertem Markdown. nextDesk rendert diesen Inhalt weiter im einheitlichen Artikel-Design.
- Entwürfe bleiben vor dem Speichern vollständig editierbar. Es gibt keine automatische Speicherung, Veröffentlichung oder Änderung der Sichtbarkeit.
- Die Mandantenadministration kann Anthropic für Wissensentwürfe explizit freigeben und externe Artikelinhalte separat zulassen oder sperren.
- Die serverseitige Function verlangt JWT, aktive Mandantenmitgliedschaft und `knowledge.manage`. Rohinhalt, Prompts und KI-Ergebnisse werden nicht in Queue oder Audit gespeichert.
- Migration 0095 ergänzt die explizite Freigabe externer Inhalte und härtet die ausschliesslich für `service_role` verfügbare KI-Queue. Bei bestehenden Artikeln wird die aktuelle, mandantengebundene Sichtbarkeit in der Queue serverseitig geprüft; ein Browserwert kann die Externfreigabe nicht umgehen.

## Validierung

- Vollständige Repository-Suite erfolgreich: Typecheck, Schema- und Datenbanktests, Edge-Check/-Tests, Formatprüfung, Hetzner-Build, Performance-Budget und `git diff --check`.
- Unabhängiger Read-only-Sicherheitsreview: keine verbleibenden hohen oder mittleren Befunde.
- Migration `0095_anthropic_knowledge_drafts` wurde produktiv angewendet.
- `ai-assist` v6 ist aktiv und weiterhin JWT-geschützt.
- Webrelease auf Hetzner mit Sicherung durchgeführt.
- Öffentlicher Release-Smoke-Test und neues Webbundle: HTTP 200.
- Unauthentisierter POST auf `ai-assist`: HTTP 401; CORS-Preflight von `https://app.nextdesk.ch`: HTTP 204.

## Bewusste Inbetriebnahme

Die KI-Aufbereitung bleibt bis zur vollständigen serverseitigen Anbieter-Konfiguration fail-closed. Ohne einen gültigen `ANTHROPIC_API_KEY` und `ANTHROPIC_MODEL` sendet nextDesk keinen Artikelinhalt an Anthropic und liefert keinen KI-Entwurf.

Für die Nutzung sind zusätzlich die bewusste Aktivierung von `ai.assist` und die Anthropic-Freigabe im gewünschten Mandanten erforderlich. Externe Artikelinhalte bleiben gesperrt, bis die separate Zustimmung dafür gesetzt wird.

## Rücknahme

1. Falls nötig, das Webbundle aus dem oben genannten Backup nach `/usr/www/users/jqviwy/app/` zurückspielen.
2. `ai.assist` im Mandanten deaktivieren oder die Anthropic-Freigabe ausschalten. Damit stoppen neue Aufbereitungen sofort.
3. Bei einem Funktionsproblem die vorherige `ai-assist`-Version wiederherstellen. Die Migration ist additiv; keine Inhalte wurden migriert oder gelöscht.
