# nextDesk – Release Notes: Assetpflege und lokaler Intune-Preflight

- **Zeitpunkt (UTC):** 2026-10-20T05:49:15Z
- **Produktionscommit (Webbundle):** `164a30f0062e1cb77807988fb52a1b8e5261ed04`
- **Bereich:** P1.5 – Assetpflege, Fallverantwortung sowie lokaler Intune-Preflight

## Ausgeliefert

- Migration `0083_asset_intune_local_preflight_control` mit lokaler, auditierter Intune-Preflight-Run-Control, Run-Historie, idempotenter Wiederholung und datensparsamem Asset-Privacy-Modell.
- Migration `0084_harden_asset_feature_gate_membership`, damit die für RLS notwendige Asset-Feature-Prüfung eine aktive Mitgliedschaft im abgefragten Mandanten voraussetzt.
- `asset-registry`, `service-assets` und `intune-asset-sync` als aktive Edge Functions der Version 9 – jeweils mit `verify_jwt = true`.
- Webbundle aus `apps/web/dist/` auf Hetzner ausgerollt.

## Sicherheits- und Betriebswirkung

Der Preflight bleibt rein lokal. Er fordert keine Tokens an, ruft keinen Microsoft-Graph-Endpunkt auf, mutiert keine Geräte oder Assets, aktiviert keinen Providerworker und richtet keinen Scheduler ein. Der bestehende Endpoint `intune-asset-sync` ist als JWT-geschützter, fail-closed Sperrpunkt bereitgestellt.

Intune-Gerätekennungen, Identifier, Provider-Snapshots und verknüpfte Personen werden nicht an Browser oder Mobile ausgeliefert. Bestehende öffentliche `intune_device_id`- und bekannte Provider-Metadatenspiegel werden in private Service-Role-Relationen verlagert beziehungsweise bereinigt; mehrdeutige Altdaten liefern keinen beliebigen Scan-Treffer. QR- und Barcode-Lookups passieren ausschliesslich im mandantengebundenen, serverseitig autorisierten Pfad.

`assets.management` und ein allfälliger Pilotablauf werden sowohl serverseitig als auch mit RLS durchgesetzt. Die zusätzlich gehärtete RLS-Feature-Prüfung ist anonym nicht ausführbar und bewertet einen Mandanten nur für dessen aktive Mitglieder. Die privaten Intune-Konfigurationen, Läufe, Geräte, Identifier und Linktabellen bleiben für `anon` und `authenticated` nicht lesbar; die Preflight-RPCs sind ausschliesslich für `service_role` ausführbar.

Fallverantwortliche sind auf aktive Mitglieder desselben Mandanten begrenzt. Die Weboberfläche ermöglicht strukturierte Assetpflege. Die native Assetdetailansicht verdichtet Inventar, Lebenszyklus und datensparsame Betriebsaggregate und bietet eine sichere Wiederholung bei Ladefehlern.

## Verifikation

Vor und während des Releases erfolgreich:

- `pnpm check`
- `pnpm test:db`
- `pnpm test:schema`
- `pnpm test:edge`
- `pnpm check:edge`
- `pnpm format:check`
- `pnpm --filter @nextdesk/web build:hetzner`
- `pnpm check` im iOS-Projekt für die reinen Quelländerungen
- unabhängige read-only Sicherheitsreviews einschliesslich der expliziten RLS-Policies

Nach dem Release erfolgreich:

- Migrationen 0083 und 0084 sind produktiv registriert.
- Alle drei P1.5-Edge Functions sind aktiv und behalten `verify_jwt = true`.
- Produktionsrechte bestätigen: keine anonyme Feature-Abfrage, keine Browserleserechte auf private Intune-Tabellen, keine Browserausführung der Preflight-RPCs und Service-Role-Ausführung für die geschützte Konfiguration.
- Die Feature-Gate-Implementierung verlangt produktiv eine aktive Mitgliedschaft.
- Web-Smoke-Test: erfolgreich.

## Web-Rückfallkopie

Vor dem Ausrollen wurde das vorherige Webbundle auf dem Hosting gesichert:

`/usr/www/users/jqviwy/backups/nextdesk-web-20261020T054915Z-164a30f`

## Bewusst nicht aktiviert

Ein echter Intune- oder Graph-Abgleich, Microsoft-Admin-Consent, App-Secrets, regelmässige Synchronisation, Scheduler und Compliance-Auswertung wurden nicht aktiviert. Diese Punkte brauchen weiterhin eine separate fachliche und sicherheitliche Freigabe.
