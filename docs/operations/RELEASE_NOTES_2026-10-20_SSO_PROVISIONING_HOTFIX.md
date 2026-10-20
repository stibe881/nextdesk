# nextDesk – Release Notes: SSO-Provisionierung und Offboarding

**Datum:** 20. Oktober 2026 (UTC)
**Codebasis:** `827307534097cc66a674431fdeae205571d66908` – `fix: harden SSO invitation offboarding`

## Ausgeliefert

- **Migration `0085_harden_sso_provisioning_offboarding`** ist in Supabase Produktion angewendet.
- **`tenant-sso-access` v18** und **`tenant-users` v12** sind aktiv und verlangen beide ein verifiziertes JWT.
- Der erste mobile Arbeitsbereichsabruf löst nach einer erfolgreichen Entra-Anmeldung einmalig die serverseitige, mandantengebundene SSO-Prüfung aus. Persönliche Einstellungen können keine Provisionierung auslösen.
- Aktuelle und frühere Einladungswege verwenden gelockte Service-Role-RPCs. Ein Widerruf gewinnt auch dann, wenn die Annahme gerade auf `accepted` gesetzt wurde: Mitgliedschaft und alle aktiven Rollen werden beendet.
- Eine aus einer Entra-Agentenvormerkung nachweisbar entstandene Rolle kann während des berechtigungsgeprüften Offboardings nur ablaufen. Die transaktionslokale Ausnahme kann keine neue Rolle, Rollenänderung oder Reaktivierung auslösen.

## Verifikation

- Vollständige TypeScript-, Deno-, PostgreSQL-RLS-, Schema- und Formatprüfungen erfolgreich.
- Datenbankregressionen decken SSO-Claim, aktuelle und frühere Einladungen, Annahme-Widerruf-Rennfälle, Re-Invite, verzögerte SSO-Versuche und getrackte Entra-Agentenrollen ab.
- Produktiv bestätigt: alle SSO-RPCs vorhanden, Browserrollen haben keine Ausführungsrechte auf den Service-Role-RPCs, die Service-Role hat diese Rechte.
- Ein unabhängiger finaler Sicherheitsreview meldete keine kritischen oder hohen Befunde.

## SSO-Loginfolgehotfix

- **Codebasis:** `bb8ef49adab6a306559efbb037dab454c264c934` – `fix: handle one-row sso claims from PostgREST`.
- `tenant-sso-access` **v19** und `tenant-users` **v13** sind aktiv, weiterhin mit JWT-Pflicht.
- Die beiden gelockten PostgreSQL-Claims liefern eine einzelne Tabellenzeile. Der Edge-Code behandelt die von PostgREST dafür verwendete einreihige Antwort jetzt korrekt und verweigert weiterhin jede leere oder mehrdeutige Antwort.
- Damit kann eine erfolgreich verifizierte Entra-Anmeldung eines erstmals berechtigten Mitarbeitenden wieder den mandantengebundenen Arbeitsbereich erstellen. Es werden weder Agentenrechte noch erhöhte Rollen automatisch vergeben.
- TypeScript-, Deno-, PostgreSQL-RLS-, Schema- und Formatprüfungen waren vor der Auslieferung erfolgreich. Der Benutzer muss die Anmeldung dennoch einmal erneut ausführen; es wurde kein Benutzerkonto oder Mandantenmitglied manuell verändert.

## SSO-Arbeitsbereichshotfix

- **Codebasis:** `ac88d28` – `fix: stabilise SSO workspace bootstrap`.
- **`tenant-sso-access` v20** ist aktiv und JWT-geschützt. Nach einer vollständigen serverseitigen Prüfung von Azure-Anmeldung, Entra-Tenant, erlaubter Domain, aktivem Mandanten und Mitgliedschaft liefert der Endpunkt ausschliesslich die minimale Mandantenzusammenfassung `id`, `name` und `slug` zurück.
- Die Webanwendung verwendet diese bereits bestätigte Zusammenfassung beim ersten SSO-Arbeitsbereichsboot. Eine zweite, timinganfällige verschachtelte PostgREST-Abfrage ist dafür nicht mehr erforderlich; gespeicherte unzulässige Arbeitsbereiche bleiben fail-closed.
- Das Hetzner-Webbundle wurde am 20. Oktober 2026 um `07:05:13 UTC` kontrolliert ausgerollt. Vorher wurde eine Rückfallkopie erstellt; der anschliessende Release-Smoke-Test war erfolgreich.
- Der zugehörige native Quellhotfix ist als Mobil-Commit `54f33fe` gespeichert und durch TypeScript sowie Vitest geprüft. Er benötigt für bereits installierte iOS-Apps einen neuen EAS-/TestFlight-Build; ein solcher Build wurde mit diesem Release nicht gestartet.

## Web-SSO-PKCE-Hotfix

- **Codebasis:** `f2a969fee67e17766c9111092bcb0b9cd16d9dfe` – `fix(auth): exchange web SSO callbacks with PKCE`.
- Der Browser-Supabase-Client verwendet für Azure-Anmeldungen nun explizit PKCE. Der Rücksprung wird als einmaliger Code mit dem im selben Browser gespeicherten Verifier ausgetauscht; damit ist keine implizite Sitzungsübergabe über ein URL-Fragment mehr vorausgesetzt.
- Das Hetzner-Webbundle wurde am 20. Oktober 2026 um `07:51:13 UTC` nach einer datierten Rückfallkopie ausgerollt. Der Release-Smoke-Test sowie die vollständige TypeScript-, Deno-, PostgreSQL-RLS-, Schema- und Formatprüfung waren erfolgreich.
- Der produktive Gatewaytest bestätigte ausschliesslich anhand anonymisierter Metadaten einen PKCE-Start (`code_challenge`, HTTP 302). Es wurden keine Token, Codes, Browser-Sitzungen oder Personendaten ausgelesen.

## Nicht Bestandteil dieses Releases

- Es wurde kein neuer iOS-Build oder TestFlight-Upload ausgelöst.
- Kein neuer Provider, keine neue Entra-Berechtigung, kein Scheduler und keine automatische Löschung.
- Keine Änderung am produktiven Microsoft-365-/Exchange-E-Mail-Kanal.

## Rücknahmegrenze

Die Migration ist additiv und wird nicht durch Löschen aus der Produktionshistorie zurückgenommen. Falls eine Function-Rücknahme nötig wird, muss eine geprüfte frühere Function-Version mit aktivierter JWT-Prüfung bereitgestellt werden. Bei einem tatsächlichen Datenwiederherstellungsbedarf gilt das zentrale [Release- und Recovery-Runbook](RELEASE_AND_RECOVERY_RUNBOOK.md).
