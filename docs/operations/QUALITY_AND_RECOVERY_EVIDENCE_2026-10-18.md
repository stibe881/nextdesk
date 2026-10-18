# nextDesk – Qualitäts- und Wiederherstellungsnachweis

**Datum:** 18. Oktober 2026  
**Ausführungsumgebung:** isolierte Manus-Sandbox, PostgreSQL 16.15, Node.js 22.13.0  
**Geltungsbereich:** Dieser Nachweis verwendet keine Anmeldung, keine Schreibvorgänge gegen die Produktion und keine externen Provider. Der Datenbank-Drill läuft ausschliesslich in einer temporären lokalen PostgreSQL-Instanz.

## Zusammenfassung

| Prüfung             | Zeitpunkt (CEST) | Ergebnis                                                                                                                                 |
| ------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:e2e`     | 17:18            | Erfolgreich: unauthentifizierte Anmeldemaske, keine Arbeitsbereichsinhalte, keine Konsolenfehler, kein horizontaler Überlauf bei 390 px. |
| `pnpm check:load`   | 17:18            | Erfolgreich: 60 nicht authentifizierte Lese-/Preflight-Anfragen bei Parallelität 4, 0 Fehler.                                            |
| `pnpm drill:backup` | 17:19            | Erfolgreich: 59 Migrationen, Dump und Restore in eine frische lokale Datenbank; Tabellen, Zeilenzahlen und RLS-Flags identisch.          |

## Unauthentifizierter Browser-Ende-zu-Ende-Test

Befehl:

```bash
pnpm test:e2e
```

Das Skript verwendet das vorhandene `apps/web/dist` und startet dafür ausschliesslich eine lokale `vite preview`-Instanz auf einem freien Loopback-Port. Nur wenn `apps/web/dist/index.html` fehlt, wird vorab einmal `pnpm --filter @nextdesk/web build:hetzner` ausgeführt. Für den Test wurde **kein Neubau** ausgelöst.

Ein lokaler Playwright-Chromium-Browser prüfte mit einer Breite von **390 px**:

- Die Schaltfläche **MIT SSO ANMELDEN** ist sichtbar.
- Keine Arbeitsbereichs- oder Mandantenbedienelemente wie **Übersicht**, **Arbeitsplatz**, **Erwähnungen**, **Mein Portal**, **Aktive Tickets**, **Mandant auswählen** oder **Mandant wechseln** sind sichtbar.
- Es gab keine Browser-Konsolen- oder Seitenausnahmen.
- `document.body.scrollWidth` und `document.documentElement.scrollWidth` überschritten die Viewport-Breite nicht.

Reale Ausgabe:

```text
Vorhandenes apps/web/dist wird ohne Neubau geprüft.
Unauthentifizierter Browser-Test erfolgreich (390 px, keine Konsolenfehler).
```

## Schonender Produktions-Lastcheck

Befehl:

```bash
pnpm check:load
```

Der Lastcheck ist absichtlich begrenzt: **maximal 60 Anfragen**, **Parallelität maximal 4**, keine Anmeldedaten und keine schreibenden HTTP-Methoden. Er verwendete ausschliesslich diese Ziele:

1. `GET https://app.nextdesk.ch/` (statische Startseite)
2. `OPTIONS https://ewizsylzrwogsztsthbl.supabase.co/functions/v1/requester-portal` mit der Origin `https://app.nextdesk.ch` (CORS-Preflight)

Die Perzentile verwenden die Nearest-Rank-Methode pro Zielgruppe.

| Ziel                              | Anfragen | HTTP-Ergebnisse               | Fehler |      p50 |        p95 |
| --------------------------------- | -------: | ----------------------------- | -----: | -------: | ---------: |
| Statische Startseite              |       30 | `200 × 30`                    |      0 | 377.7 ms | 2'195.7 ms |
| CORS-Preflight `requester-portal` |       30 | `204 × 30`                    |      0 | 193.3 ms |   279.3 ms |
| **Gesamt**                        |   **60** | **60 erfolgreiche Antworten** |  **0** |        – |          – |

Reale Ausgabe:

```text
Schonender Lastcheck: 60 Anfragen, Parallelität 4, keine Anmeldung und keine Schreibvorgänge.
Statische Startseite: 30 Anfragen, Fehler 0, p50 377.7 ms, p95 2195.7 ms, Status HTTP 200 × 30
CORS-Preflight requester-portal: 30 Anfragen, Fehler 0, p50 193.3 ms, p95 279.3 ms, Status HTTP 204 × 30
Lastcheck erfolgreich.
```

> Die Stichprobe ist ein schonender Erreichbarkeits- und Latenznachweis, keine Lastkapazitätszusage oder ein SLO.

## Lokaler Backup-und-Restore-Drill

Befehl:

```bash
pnpm drill:backup
```

Das Skript folgt der lokalen PostgreSQL-16-Vorgehensweise aus `supabase/tests/run-local-migration-tests.sh`: Es initialisiert ein temporäres Cluster mit `initdb`, verwendet einen eigenen Unix-Socket und startet `pg_ctl` nur lokal. Es hat weder eine Produktionsdatenbank noch Supabase angesprochen.

Ablauf:

1. Alle **59** Migrationen aus `supabase/migrations/` wurden in der lokalen Quelldatenbank angewendet.
2. Lokale Beispieldaten für zwei Personen, einen Mandanten, eine Abteilung, Mitgliedschaften, Status, Priorität, Ticket und Kommentar wurden eingefügt.
3. `pg_dump --format=custom --no-owner --no-privileges` erzeugte den lokalen Dump.
4. `pg_restore --exit-on-error` stellte ihn in eine frisch angelegte lokale Datenbank wieder her.
5. Tabellenliste, jede Tabellenzeilenzahl und die RLS-Flags `relrowsecurity` und `relforcerowsecurity` der Schemata `auth` und `public` wurden zwischen Quelle und Restore per Diff verglichen.

| Nachweis                     | Ergebnis                             |
| ---------------------------- | ------------------------------------ |
| Tabellen                     | 100 in Quelle und Restore, identisch |
| Datenzeilen                  | 105 in Quelle und Restore, identisch |
| Tabellen mit aktiviertem RLS | 99 in Quelle und Restore, identisch  |
| Migrationslaufzeit           | 2'811 ms                             |
| Dump-Laufzeit                | 165 ms                               |
| Restore-Laufzeit             | 760 ms                               |
| Gesamtlaufzeit               | 4'287 ms                             |

Reale Ausgabe:

```text
Backup- und Restore-Drill erfolgreich.
Migrationen: 59; Tabellen: 100; Datenzeilen: 105; RLS aktiviert: 99.
Dauer: Migrationen 2811 ms; Dump 165 ms; Restore 760 ms; Gesamt 4287 ms.
```

Die temporäre Dateninstanz und der Dump werden am Ende des Skripts entfernt. Der Drill deckt Datenbankschema, Anwendungsdaten und RLS-Metadaten ab; er ist kein Ersatz für einen abgestimmten Point-in-Time-Restore oder eine Storage-Wiederherstellung in Supabase.

## Reproduzierbarkeit

```bash
pnpm test:e2e
pnpm check:load
pnpm drill:backup
```

Vor einem Release zusätzlich die im [Release- und Wiederherstellungsrunbook](./RELEASE_AND_RECOVERY_RUNBOOK.md) geforderten Prüfungen ausführen.
