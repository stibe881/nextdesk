# Umsetzungsstatus

_Stand: 18. Oktober 2026_

## Produktiv bereitgestellt

- 18.10.2026, 17:30 Uhr: Migrationen 0058 und 0059 sind produktiv. Edge Functions: agent-workbench v2, requester-portal v2, tenant-audit-log v6, health v1. Web-Commit 2df3cbb ist ausgerollt, Smoke-Test erfolgreich. Enthalten sind Agentenwerkbank, Anfragendenportal, durchsuchbarer Auditexport, Kopie und Erreichbarkeit, eine optionale Abteilungsansicht (standardmässig aus), die Branding-Live-Vorschau, Dashboard-Trends und Einführungshinweise.

- **Web:** nextDesk läuft produktiv unter [app.nextdesk.ch](https://app.nextdesk.ch/) auf Hetzner. Die Web-App verlangt vor jeder Inhaltsansicht eine Anmeldung und arbeitet mandantenisoliert über Supabase-RLS, serverseitige Edge Functions und rollenbasierte Berechtigungen.
- **Mandantenverwaltung:** Plattform-Eigentümer verwalten Mandanten; Mandantenadministratoren verwalten nur ihren eigenen Mandanten, darunter Personen, Rollen, SSO, Corporate Design, Datenschutz, Funktionsschalter und Pilotzeiträume. Normale Nutzende erhalten keine Mandantenauswahl.
- **Tickets und Prozesse:** Direkte Ticketbearbeitung, Anfragende, Kategorien und Unterkategorien, Agentenzuweisung, Chatkommunikation, Übergaben, Verknüpfungen, Vergleiche, Freigaben, Import/Export, Ticketakte, Vorlagen, Qualitätsprüfung, Kundenfeedback, kontrollierte Einzel- und Massenabschlüsse sowie auditierte Auto-Close-Vorschauen sind implementiert.
- **Wissen und Assets:** Die Wissensdatenbank unterstützt Kategorien, Revisionen, Freigaben und Sichtbarkeitsgrenzen. Asset- und Intune-Daten sind mandantenautorisiert durchsuchbar; QR-/Barcode-Lookup ist im Web und in der iOS-Quellbasis vorhanden.
- **Automationen und Betrieb:** Tenant-Automationsrichtlinien liefern Vorschauen für Nachfassaufgaben, Schliesskandidaten, Duplikate, Datenhygiene, Qualität, Compliance und Betriebsberichte. Automatische Schliessungen bleiben manuell bestätigt, serverseitig erneut geprüft und auditiert. Retention-Richtlinien, Onboarding, Performancebudgets, Recovery-Runbook und Release Notes sind vorhanden; automatische Löschung und unbeaufsichtigte Scheduler sind bewusst nicht aktiv.
- **Sicherheits- und Feature-Gates:** SSO-Mitgliedschaften, Rollenverwaltung, Wissensfreigaben, letzter Mandantenadministrator, Ticketmodule, Wissen, Assets, SLA-Verwaltung, Reporting und Pilotabläufe sind serverseitig fail-closed abgesichert. Ein Umschalten oder Ändern eines Piloten aktualisiert die Webfreigabe unverzüglich; die iOS-Quellbasis aktualisiert sie bei Mandantenwechsel und Rückkehr in den Vordergrund.

## Mobile iOS

- Die Expo-iOS-App besitzt die Bundle-ID `ch.grossict.nextdesk`, den nativen PKCE-SSO-Rückweg `ch.grossict.nextdesk://auth/callback`, SecureStore/Keychain-Sitzungen, optionalen Geräteschutz, Haptik, sichere Fotoanhänge, Entwürfe, Favoriten, Tastaturvermeidung, globale Suche, Wissen, Assets und Scanner.
- Offline werden keine Ticketdetails, Kommunikation, Anfragendendaten, Anhänge, Assets oder Wissensinhalte gespeichert. Ausschliesslich auf iOS kann eine maximal zwölf Stunden alte, verschlüsselte und schreibgeschützte Ticketlisten-Metadatenansicht bei eindeutig erkanntem Offlinezustand erscheinen. Sie wird bei Abmeldung, Benutzerwechsel oder lokaler Bereinigung vollständig gelöscht.
- Der bestätigte letzte TestFlight-Upload ist Build **10024** (`8d27a576-63d0-4be3-927f-5c34a5abcbfe`, Status FINISHED) aus iOS-Quellcommit `885c1ca`, übermittelt mit Submission `0a065501-5093-4483-8247-ce027a6afd46` (Upload an App Store Connect erfolgreich). Er enthält zusätzlich zu Build 10023 (`ba7f5e8`) die Behebung der Face-ID-Schleife im Geräteschutz (`885c1ca`), die Kachel «Nicht zugewiesen» statt «Gelöst» (`0487f5f`), antippbare Fokuskennzahlen mit gefilterter Ticketliste (`21a14d0`) und die korrigierte Kennzahl «Mir zugewiesen» (`41803e5`). Bereits seit Build 10023 enthalten: Push-Benachrichtigungen, Push-Check-in, E-Mail-Kennzeichnung im Chat, kompakte Ticketdetails, Messenger-Chat, neue Startseite mit Erinnerungstermin, Agent*innen-Namen und die Tab-Leiste mit zentriertem Home-Kreis. Die reale iPhone-Abnahme von Build 10024 – insbesondere Face ID – steht aus.
- Der iOS-Quellstand `c291fd5` übernimmt für den bestätigten Mandanten Portalname, Logo sowie Primär-, Sekundär- und Akzentfarbe aus den Web-Designeinstellungen; bei Mandantenwechsel oder ungültigem Kontext bleibt die App fail-closed auf einer neutralen Palette. Die Detailkarte eines Tickets enthält nun eine direkte Kategorie-/Unterkategorieauswahl. Bereits gespeicherte, später deaktivierte Kategorien bleiben lesbar, können aber nicht erneut ausgewählt werden. Dieser Quellstand ist noch in keinem weiteren TestFlight-Build enthalten.

## Ausgeführte Qualitätsprüfungen

- Web: `pnpm check`, `pnpm test:schema`, `pnpm test:db`, `pnpm check:edge`, Hetzner-Produktionsbuild, Prettier-/Diff-Prüfung, Bundlebudget und Produktions-Smoke-Test.
- Datenbank: Lokale PostgreSQL-16-Regressionen prüfen Migrationen, RLS, Mandantentrennung, Rollen, Wissensfreigaben, Abschlussbestätigungen und Sicherheitsinvarianten.
- Mobile: `pnpm check`, `pnpm lint`, Unit-Tests, Kontrastprüfung und `git diff --check` für alle aktuell gelieferten Quelländerungen. Nativer SSO-, Kamera-, Tastatur- und Offlinebetrieb erfordert zusätzlich einen Test auf einem realen iPhone nach einem TestFlight-Build.

## Verbleibende externe oder reale Abnahmebedingungen

- **TestFlight-/iPhone-Abnahme:** Installation, Verarbeitung in TestFlight sowie ein realer iPhone-End-to-End-Test für SSO-Rückkehr, Eingabefelder, Kamera, Abschlussbestätigung, Geräteschutz und Offlineverhalten.
- **Entra-Verzeichnisabgleich:** Benötigt Microsoft Graph `User.Read.All`, sichere Edge-Function-Secrets und Admin-Consent jedes Kundenmandanten.
- **Intune-Synchronisation:** Benötigt Graph `DeviceManagementManagedDevices.Read.All`, serverseitige Secrets und den kundenseitigen Admin-Consent.
- **Weitere Integrationen:** E-Mail, Kalender, Teams/Slack, Monitoring, Webhooks/API-Schlüssel, KI und externe Provider benötigen jeweils deren Zugänge, Datenschutzfreigaben und Konfiguration.
- **Unbeaufsichtigte Abläufe:** SLA-Scheduler, automatische Löschung oder produktive Hintergrundjobs werden erst nach expliziter Betriebsfreigabe samt erforderlichen Secrets beziehungsweise Hosting-Konfiguration aktiviert.
- **GitHub-Workflow-Publish:** Die gehärteten Workflow-Dateien benötigen weiterhin eine wirksame GitHub-`workflow`-Berechtigung, bevor sie nach `main` veröffentlicht werden können.

## Push-Benachrichtigungen (18.10.2026)

**Produktiv umgesetzt:** Migration 0060 (Geräte, Präferenzen, Outbox, Ereignis-Trigger, `pg_net`-Weckruf, fail-closed Mandantenschalter `notifications.push`, standardmässig aus). Edge Functions `push-notifications` (v1, JWT) und `push-dispatch` (v1, Datenbank-Secret statt JWT) sind ACTIVE; `tenant-feature-flags` v3, `ticket-operations` v21, `ticket-agent-assignment` v6 und `ticket-actions` v10 übergeben die handelnde Person, damit niemand über die eigene Aktion benachrichtigt wird. Web (Mandantenschalter mit Inhaltsstufe, Geräteliste in den persönlichen Einstellungen, verständliche Benachrichtigungstexte) ist auf app.nextdesk.ch ausgerollt. iOS-Quellstand 34f95b4 enthält Opt-in, Kategorien, Ruhezeiten, Test-Push, Deep Links und Abmeldung des Geräts.

**Ereignisse:** Zuweisung, Antwort der anfragenden Person, Antwort des Supports, Erwähnung, Lösung, Freigabeanfrage, Eskalation und SLA. Push-Inhalte gehen nur an Apple; standardmässig nur Ereignisart und Ticketnummer, der Betreff nur bei ausdrücklicher Mandanteneinstellung.

**Offen (extern):** APNs-Schlüssel (.p8) bei Apple erstellen und `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` als Supabase-Secrets setzen (Anleitung: `docs/deployment/PUSH_NOTIFICATIONS.md`); Schalter pro Mandant aktivieren; neuer iOS-Build mit Push-Plugin nur auf ausdrücklichen Auftrag; reale iPhone-Abnahme. Bis die Secrets gesetzt sind, werden Push-Einträge sauber als `apns_not_configured` übersprungen; In-App-Benachrichtigungen funktionieren unabhängig davon.

## E-Mail-Kanal Exchange Online (Stand 18.10.2026, 19:36)

Implementiert und produktiv bereitgestellt (Migration 0061, Functions exchange-mail-admin/-webhook/-worker, ticket-operations v22, requester-portal v3, Web auf Hetzner). Funktionsschalter `integrations.email` bei allen Mandanten aus. Offen und extern: zentrale Entra-App `nextDesk – Exchange Online`, Supabase-Secrets `EXCHANGE_MAIL_CLIENT_ID` und `EXCHANGE_MAIL_CLIENT_SECRET`, Bereitstellung und Exchange-RBAC im Kundenmandanten, danach Verbindungstest, Aktivierung und realer End-to-End-Test. iOS-Kennzeichnung (2729061) noch nicht in TestFlight.

## Push-Arbeitszeit-Check-in (18.10.2026)

Produktiv: Migration 0062 (`push_work_checkins`, `push_work_state`, Versandsperre `off_shift` in `push_claim_outbox`), push-notifications v2 mit `checkIn`/`checkOut`/`declineCheckIn` und Mandanteneinstellungen für Arbeitszeiten (Standard 06:00–17:00 Uhr, Check-in erforderlich). Web-Einstellungen sind ausgerollt. iOS-Nachfrage und Arbeitszeitbereich sind in Commit c2d8768 umgesetzt, aber noch in keinem TestFlight-Build enthalten (letzter Build 10022). Push bleibt insgesamt inaktiv, bis APNs-Secrets gesetzt und der Funktionsschalter aktiviert sind.

- 2026-10-18 20:37: Startseite mit Kennzahlen im Fokus-Bereich und Ticketliste direkt unter den Widgets; Wiedervorlage-Erinnerungen mit Termin im Ticketdetail (iOS/Web), Migration 0063 und Push-Kategorie `follow_up` produktiv. iOS-Stand d68a27a ist noch nicht in TestFlight (nativer Datumswähler, neuer Build nötig).
- 2026-10-18 22:05: Kennzahl «Fällig» zählt die mir zugewiesenen offenen Tickets mit erreichter Antwort- oder Lösungsfrist (agent-workbench v6, `c90d37c`; Web live). iOS-Stand `c7be8a7` ist noch in keinem TestFlight-Build. Wirksam erst mit aktivem SLA-Profil; bei Verein SONNENBERG Baar sind `automation.sla` und SLA-Profile derzeit nicht eingerichtet.
