# Verifizierte Architekturquellen

Die folgenden Quellen wurden am 16. Oktober 2026 für die Phase-1-Architektur geprüft. Sie sind keine Freigabe für Konfigurationen; Verfügbarkeit und Preispläne werden vor Produktionssetzung erneut verifiziert.

1. [Supabase Available regions](https://supabase.com/docs/guides/platform/regions): nennt Central Europe (Zurich) als spezifische Region `eu-central-2` und erläutert, dass Regionswahl Datenresidenz steuert, aber Compliance nicht nachweist.
2. [Supabase Regional Invocations](https://supabase.com/docs/guides/functions/regional-invocation): führt `eu-central-2` als Region für Edge-Function-Aufrufe auf und dokumentiert `x-region` bzw. den SDK-Regionparameter.
3. [Supabase Single Sign-On with SAML 2.0 for Projects](https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml): dokumentiert App-SAML, Entra als kompatiblen IdP, Metadaten-/Domainzuordnung und den Planhinweis Pro oder höher.
4. [Microsoft OpenID Connect](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc): dokumentiert tenant-scoped OIDC-Endpunkte, registrierte Redirect-URIs, State und Nonce.
5. [Supabase Set Up SSO with Azure AD](https://supabase.com/docs/guides/platform/sso/azure): behandelt Dashboard-SSO und wird als Abgrenzung zur Anwendungs-SSO-Dokumentation geführt.

6. [Supabase Securing Edge Functions](https://supabase.com/docs/guides/functions/auth): beschreibt `withSupabase`, die Trennung von user-scoped und service-role Clients sowie den sicheren Einsatz von `verify_jwt`.
7. [Supabase Authorization headers](https://supabase.com/docs/guides/functions/auth-headers): beschreibt die getrennte Verwendung von `Authorization: Bearer <user-jwt>` und `apikey` sowie die Plattformprüfung vor der Function-Ausführung.
8. [Supabase Multi-Factor Authentication](https://supabase.com/docs/guides/auth/auth-mfa): bestätigt den `aal`-JWT-Claim, wobei `aal2` eine zusätzliche Faktorverifikation repräsentiert, und empfiehlt dessen serverseitige Durchsetzung.
9. [Supabase JWT Claims Reference](https://supabase.com/docs/guides/auth/jwt-fields): dokumentiert `aal`, `amr`, `session_id` und weitere relevante Claims für verifizierte Supabase-User-JWTs.
