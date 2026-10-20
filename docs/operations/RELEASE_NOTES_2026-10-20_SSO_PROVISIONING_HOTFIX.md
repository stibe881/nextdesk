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

## Nicht Bestandteil dieses Releases

- Der iOS-Quellhotfix ist separat auf dem Mobil-Repository gespeichert. Ein autorisierter Remote-TestFlight-Build wurde gestartet; dessen Ergebnis wird erst nach der Rückmeldung von EAS bestätigt.
- Kein neuer Provider, keine neue Entra-Berechtigung, kein Scheduler und keine automatische Löschung.
- Keine Änderung am produktiven Microsoft-365-/Exchange-E-Mail-Kanal.

## Rücknahmegrenze

Die Migration ist additiv und wird nicht durch Löschen aus der Produktionshistorie zurückgenommen. Falls eine Function-Rücknahme nötig wird, muss eine geprüfte frühere Function-Version mit aktivierter JWT-Prüfung bereitgestellt werden. Bei einem tatsächlichen Datenwiederherstellungsbedarf gilt das zentrale [Release- und Recovery-Runbook](RELEASE_AND_RECOVERY_RUNBOOK.md).
