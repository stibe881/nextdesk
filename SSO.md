# Microsoft Entra ID und SSO

## Grundsatz

Eine erfolgreiche Entra-Anmeldung beweist nur die Identität. Sie erzeugt niemals ohne weitere Prüfung eine Mitgliedschaft in einem beliebigen TicketHub-Mandanten. Die Zuordnung erfolgt über eine verifizierte Mandantenkonfiguration, erlaubte E-Mail-Domains, einen expliziten Gruppen- oder SCIM-Mapping-Entscheid und einen Audit-Eintrag.

## Unterstützte Wege

| Weg                         | Einsatz                                                                                   | Sicherheitsregeln                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Entra OIDC/OAuth 2.0        | Standard für Web und Expo, wenn der Mandant einen modernen Entra-App-Client bereitstellt. | Authorization-Code-Flow mit PKCE, registrierte Redirect-URIs, State und Nonce; keine Client-Secrets in App-Bundles. |
| SAML 2.0 über Supabase Auth | Unternehmens-SSO mit mandantenspezifischem IdP-Metadatensatz.                             | IdP-UUID/Domain wird dem TicketHub-Mandanten zugeordnet; Metadaten und Zertifikate serverseitig verwaltet.          |
| Passwort-/Magic-Link-Login  | Optionaler Fallback je Mandant.                                                           | Nicht verfügbar, wenn der Mandant SSO erzwingt.                                                                     |

Supabase Auth dokumentiert App-SAML für SAML-2.0-kompatible IdPs, darunter Microsoft Entra; die Funktion ist laut aktueller Dokumentation standardmässig deaktiviert und ab Pro verfügbar.[1] Die separate Supabase-Dashboard-SSO-Dokumentation darf nicht mit der SSO-Architektur der TicketHub-Endbenutzer verwechselt werden.[2]

## Mandantenspezifische Konfiguration

Die später anzulegende Tabelle `sso_configurations` enthält mindestens Mandant, Verfahren, Entra Directory ID, erlaubte E-Mail-Domains, IdP-/OIDC-Metadaten, Gruppenmapping, Rollenmapping, Status, Rotation und Auditmetadaten. Zertifikate und Client-Secrets liegen ausschliesslich in Supabase-Secrets oder einem gleichwertigen Secret Store; die Tabelle enthält nur Referenzen und nicht sensible Kennungen.

Eine Anmeldeaufforderung löst zuerst den Zielmandanten auf: verifizierte Custom Domain, kontrollierte Subdomain oder explizite Mandantenauswahl. Die SSO-Konfiguration dieses Mandanten liefert eine konkrete Entra-Authority, niemals pauschal `common`. So bleiben Gast- und Cross-Tenant-Fälle kontrollierbar.

## Provisionierung und Mapping

1. Der SSO-Callback wird durch Auth kryptographisch validiert.
2. Eine serverseitige Funktion findet den einzigen aktiven Mandanten und die passende `sso_configuration`.
3. JIT-Provisionierung ist nur aktiv, wenn Konfiguration und Mapping sie erlauben. Die niedrigste vorher festgelegte Mandantenrolle wird gesetzt.
4. Gruppen-, Abteilungs- und Rollenwerte werden gegen eine Allowlist gemappt; unbekannte Gruppen ergeben keine Berechtigung.
5. Jede Erstellung, Deaktivierung oder Mapping-Änderung erzeugt Audit-Events. SCIM ist später ein separater, idempotenter Integrationsweg.

## Expo-Flow

Expo verwendet `expo-auth-session` im Systembrowser. Die Callback-URIs sind explizit als Development-, EAS-Preview- und Production-Scheme/Universal-Link/Android-App-Link bei Entra und Supabase registriert. Tokens werden in `expo-secure-store` abgelegt; Redirect, State, PKCE-Verifier und Logout werden pro laufendem Flow validiert. Ein Deep Link zu einem Ticket wird erst nach Session- und Mandantenberechtigungsprüfung geöffnet.

Microsoft dokumentiert tenant-scoped OIDC-Endpunkte und verlangt exakte Redirect-URI-Übereinstimmung; State und Nonce dienen dem CSRF- und Replay-Schutz.[3]

## Erforderliche Konfigurationen

**Supabase:** Auth Site URL/Redirect Allowlist, E-Mail-Templates, MFA-Policy, SAML-Provider pro Mandant, JWT-Claims-Konzept, Server-Secrets und Audit-Log-Retention.

**Microsoft Entra pro Mandant:** App Registration, unterstützte Kontoarten, Redirect-URIs, delegierte minimal nötige Graph-Scopes, optional Enterprise Application/SAML-Metadaten, Gruppenclaims, Token-Lebensdauer, Test-Benutzer und Administratorkonsens.

## Referenzen

[1] https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml "Supabase Single Sign-On with SAML 2.0 for Projects"

[2] https://supabase.com/docs/guides/platform/sso/azure "Supabase Set Up SSO with Azure AD"

[3] https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc "Microsoft OpenID Connect on the Microsoft identity platform"
