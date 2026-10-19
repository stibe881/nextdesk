# nextDesk – P1/P2 M0: Quellbasis und Reconciliation

**Datum:** 19. Oktober 2026  
**Entscheid:** akzeptiert  
**Kanonische Baseline:** `4630abecdd424d68dcfd8ea1d0e85b37224136c4` (`origin/main`)  
**Höchste Migration in der Baseline:** `0080_harden_sla_breach_feature_gate.sql`

## Zweck

Dieser Entscheid schützt die im lokalen Hauptarbeitsbaum vorhandenen, nicht committeten Dateien, ohne sie auf den aktuellen Produktstand zu übertragen. Alle nachfolgenden P1-Arbeitsbäume müssen von der hier festgehaltenen Baseline oder einem späteren, ausdrücklich integrierten P1-Commit abgeleitet werden. Die historische Migrationslücke `0070` bleibt unberührt und wird nicht nachträglich belegt.

## Ergebnis

Die neun geprüften lokalen Deltas sind entweder bereits bytegleich in `origin/main` enthalten oder durch eine aktuellere, sicherere Remote-Implementierung ersetzt. Kein lokales Delta wird in M0 übernommen. Der lokale Hauptarbeitsbaum bleibt unverändert; insbesondere gibt es weder Reset, Checkout, Stash, Cherry-Pick, Stage noch Commit in `/home/ubuntu/nextdesk`.

| Lokale Datei                             | M0-Entscheid         | Führender Remote-Nachweis                                                                                    | Eigentümerschaft für spätere Änderungen  |
| ---------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `apps/web/src/App.tsx`                   | Durch Remote ersetzt | `39dd70a` trennt Services, Assets und Fälle zusätzlich mit serverseitig wirksamen `assets.management`-Gates. | Assets/Intune                            |
| `apps/web/src/service-assets.tsx`        | Bereits enthalten    | Bytegleich mit `origin/main`; Teil von `39dd70a`.                                                            | Assets/Intune                            |
| `apps/web/src/sla-management.tsx`        | Bereits enthalten    | Bytegleich mit `origin/main`; Teil von `39dd70a`.                                                            | Assets/Intune mit Entra/SSO-Koordination |
| `apps/web/src/styles.css`                | Bereits enthalten    | Ticket-Detail-Stile aus `39dd70a`; Onboarding-Stile aus `d0e452e` und im Remote-Stand weitergeführt.         | Remote-Integrationsstand ist führend     |
| `apps/web/src/tenant-admin-settings.tsx` | Durch Remote ersetzt | SLA-Bereich, Feature-Fallback und Onboarding-Navigation sind im Remote-Stand vollständiger umgesetzt.        | Entra/SSO                                |
| `apps/web/src/tenant-onboarding.tsx`     | Durch Remote ersetzt | Navigation aus `d0e452e`; Portalname ist seit `713e7b8` bewusst optional.                                    | Entra/SSO                                |
| `apps/web/src/ticket-detail.tsx`         | Durch Remote ersetzt | Strukturierte Arbeits-, Nachbereitungs-, Steuerungs- und Verlaufsbereiche aus `39dd70a`.                     | Workspace-Integration                    |
| `apps/web/src/ticket-workbench.css`      | Bereits enthalten    | Bytegleich mit `origin/main`; Teil von `39dd70a`.                                                            | Remote-Integrationsstand ist führend     |
| `apps/web/src/ticket-workbench.tsx`      | Durch Remote ersetzt | Kontext-, Vorbereitungs- und Anfragendenstruktur ist im Remote-Stand enthalten.                              | Workspace-Integration                    |

## Geschützte lokale Arbeitskopie

Der unveränderte lokale Patch wurde nur als Vergleichsgrundlage unter `/tmp/nextdesk-m0-local-deltas.patch` gesichert. Seine Prüfsumme lautet `af066f0f0d25cea3e7d7f46bf8e6cf38cd5bc86bbc384f17e68f11d2f2ad06ef`. Diese Sicherung ist kein Merge-Kandidat und enthält keine Secrets.

## Verbindliche Folgeordnung

1. `0081_platform_owner_deploy_requests.sql`
2. `0082_ticket_automation_controlled_runs.sql`
3. `0083_ticket_automation_manual_execution_rpc.sql`
4. `0084_asset_structured_custody_and_case_owner.sql`
5. `0085_intune_run_control_and_recovery.sql`
6. `0086_entra_directory_configuration_audit.sql`
7. `0087_entra_agent_reservations.sql`
8. `0088_apply_verified_entra_agent_reservation.sql`
9. `0089_entra_periodic_sync_preparation.sql`

Vor jedem neuen Arbeitsbaum wird `origin/main` erneut auf eine konkurrierende Migrationsnummer geprüft. Externe Provider, Produktions-Dispatches, Retention-Löschungen, Scheduler und neue Expo-/EAS-Builds gehören nicht zu M0 und bleiben deaktiviert, bis eine dafür separate Freigabe vorliegt.
