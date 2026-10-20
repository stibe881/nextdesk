# nextDesk: zentraler Mehrmandanten-SSO mit Microsoft Entra ID

## Zielbild

nextDesk wird zentral auf `app.nextdesk.ch` betrieben. Jeder Kunde besitzt einen vollständig eigenen nextDesk-Mandanten, eigene Daten und sein eigenes Microsoft-Entra-Verzeichnis. Kundenbenutzer werden **nicht** als Gastkonten im Gross-ICT-Verzeichnis angelegt.

Für Kunden-SSO gibt es eine zentrale mehrmandantenfähige Entra-App von nextDesk. Sie kann nach expliziter Zustimmung im jeweiligen Kundenverzeichnis anmelden. Die bestehende Plattform-Eigentümerprüfung bleibt separat: Nur aktive `platform_administrators` erhalten die Eigentümerkonsole.

## 1. Zentrale Entra-App registrieren

In **Microsoft Entra Admin Center → App registrations → New registration**:

- **Name:** `nextDesk – Kunden SSO`
- **Unterstützte Kontotypen:** `Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)`
- **Redirect URI / Web:** `https://ewizsylzrwogsztsthbl.supabase.co/auth/v1/callback`

Danach unter **Certificates & secrets** ein Client Secret erzeugen und dessen Wert nur in Supabase hinterlegen. Weder den Secret-Wert noch Zugangsdaten in nextDesk, Git oder Chat speichern.

## 2. Zentralen Azure-Provider in Supabase setzen

In **Supabase → Authentication → Providers → Azure** konfigurieren:

- **Client ID:** Application (client) ID der zentralen mehrmandantenfähigen `nextDesk – Kunden SSO`-App
- **Client Secret:** Secret Value dieser App
- **Azure Tenant URL:** `https://login.microsoftonline.com/common`

Die Supabase-Site-URL bleibt `https://app.nextdesk.ch`. Die Redirect-URLs müssen mindestens enthalten:

- `https://app.nextdesk.ch/`
- `ch.grossict.nextdesk://auth/callback` (Mobile App)

Die alte einmandantenfähige Gross-ICT-App darf nicht als Azure-Provider für Kundenanmeldungen konfiguriert bleiben. Gross-ICT-Plattformadministratoren melden sich ebenfalls über die zentrale App an; der Zugriff auf die Eigentümerkonsole wird zusätzlich und unabhängig über `platform_administrators` geprüft.

## 3. Kundenmandanten in nextDesk vorbereiten

Für jeden Kundenmandanten im Bereich **Einstellungen → Single Sign-On**:

1. Anbieter **Microsoft Entra ID** auswählen.
2. Mandantenspezifische Issuer- und Discovery-URL erfassen:
   - Issuer: `https://login.microsoftonline.com/<KUNDEN-TENANT-ID>/v2.0`
   - Discovery: `https://login.microsoftonline.com/<KUNDEN-TENANT-ID>/v2.0/.well-known/openid-configuration`
3. Eine oder mehrere eindeutige Unternehmensdomains erfassen, beispielsweise `sonnenberg-baar.ch`.
4. **SSO aktivieren**, aber **SSO erzwingen** vorerst deaktiviert lassen.
5. Den Kundenbenutzer zuerst über die Mandanten-Benutzerverwaltung einladen. Ein erfolgreicher Entra-Login allein erstellt bewusst keine beliebige Mitgliedschaft.

Eine Domain kann durch die technische Routingtabelle nur einem aktivierten Kundenmandanten gehören. Dadurch werden Mehrdeutigkeiten und tenantübergreifende Zuordnungen verhindert.

## 4. Einmaliger Kunden-Consent

Der Administrator des Kundenverzeichnisses erteilt der zentralen nextDesk-App die Zustimmung. Die URL folgt diesem Muster:

```text
https://login.microsoftonline.com/<KUNDEN-TENANT-ID>/adminconsent?client_id=<ZENTRALE-NEXTDESK-CLIENT-ID>&redirect_uri=https%3A%2F%2Fewizsylzrwogsztsthbl.supabase.co%2Fauth%2Fv1%2Fcallback
```

Nach der Zustimmung testet der eingeladene Benutzer die Anmeldung über **MIT SSO ANMELDEN**. nextDesk akzeptiert die Sitzung nur, wenn:

- die E-Mail-Domain zu genau einem aktiven Kunden-SSO-Mandanten gehört,
- die Anmeldung über Microsoft Entra erfolgt,
- die Person bereits aktive Mitgliedschaft oder eine noch offene Einladung im richtigen Mandanten besitzt,
- ein vorhandener Entra-Tenant-Claim zur konfigurierten Kunden-Issuer-URL passt.

Erst nach diesem Test kann die Mandantenadministration **SSO für die Anmeldung erzwingen** aktivieren.

## 5. Sichere Provisionierung und Offboarding

Die mobile App führt nach einer erfolgreichen Azure-Anmeldung genau einmal eine serverseitige SSO-Mandantenprüfung aus, bevor sie den ersten Arbeitsbereich lädt. Die App übergibt dabei keine Rollen, Einladungsdaten oder Mandantenentscheidung; diese werden ausschliesslich serverseitig aus der verifizierten Sitzung, Domainbindung und Azure-Identität bestimmt. Bereits gespeicherte, aber nicht mehr zugelassene Arbeitsbereiche werden nicht stillschweigend wiederhergestellt.

Ein Widerruf darf nie durch eine verspätete SSO- oder E-Mail-Einladungsantwort umgangen werden. nextDesk sperrt deshalb die betroffene Einladung und Mandantenmitgliedschaft innerhalb derselben Datenbanktransaktion. Auch die normale E-Mail-Einladungsannahme beansprucht vor allen nachgelagerten Profil- und Rollenaktionen die exakt gelistete Einladung atomar. Ein Widerruf oder eine Stornierung behandelt sowohl noch gesendete als auch bereits angenommene Einladungen als Offboarding-Ziel, sodass die letzte Annahmeaktualisierung einen administrativen Widerruf nie überholen kann. Bei Widerruf werden die Mitgliedschaft entfernt und alle noch aktiven Rollen beendet, auch eine nachweisbar aus einer Entra-Agentenvormerkung entstandene Support-Agentenrolle. Dafür darf die berechtigungsgeprüfte Widerrufs- oder Re-Invite-RPC transaktionslokal ausschliesslich ein Ablaufdatum für diese getrackte Rolle setzen; sie kann keine Rolle erstellen, verändern oder eine Mitgliedschaft reaktivieren. Ein späterer SSO- oder Einladungsclaim erhält nur den Status «entfernt» und kann weder die Mitgliedschaft noch Rollen reaktivieren. Eine erneute Einladung wird ausschliesslich über den autorisierten Einladungszustellpfad angelegt; dabei werden frühere Berechtigungen nicht übernommen.

Diese Datenbankoperationen sind nur für `service_role` ausführbar. Die Edge Functions `tenant-sso-access` und `tenant-users` verlangen verifizierte Benutzer-JWTs und prüfen vor jeder Mutation die aktuelle Mandantenberechtigung. Weder Browser noch Mobile erhalten Zugriff auf die privaten Einladungs- oder Rollenoperationen.

## Test- und Rückfallregeln

- Vor dem Erzwingen immer mindestens eine reale Kundenanmeldung prüfen.
- Bei Fehlern bei der Azure-Konfiguration **SSO erzwingen** wieder deaktivieren; die Einladung und die Mandantendaten bleiben unverändert.
- Niemals einen Kundenbenutzer als Gast in Gross ICT anlegen, nur um den Login zu ermöglichen.
- Keine Kundendomains in mehreren Mandanten konfigurieren.
