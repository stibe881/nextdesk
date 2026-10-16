# Verifizierte Architekturquellen

Die folgenden Quellen wurden am 16. Oktober 2026 für die Phase-1-Architektur geprüft. Sie sind keine Freigabe für Konfigurationen; Verfügbarkeit und Preispläne werden vor Produktionssetzung erneut verifiziert.

1. [Supabase Available regions](https://supabase.com/docs/guides/platform/regions): nennt Central Europe (Zurich) als spezifische Region `eu-central-2` und erläutert, dass Regionswahl Datenresidenz steuert, aber Compliance nicht nachweist.
2. [Supabase Regional Invocations](https://supabase.com/docs/guides/functions/regional-invocation): führt `eu-central-2` als Region für Edge-Function-Aufrufe auf und dokumentiert `x-region` bzw. den SDK-Regionparameter.
3. [Supabase Single Sign-On with SAML 2.0 for Projects](https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml): dokumentiert App-SAML, Entra als kompatiblen IdP, Metadaten-/Domainzuordnung und den Planhinweis Pro oder höher.
4. [Microsoft OpenID Connect](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc): dokumentiert tenant-scoped OIDC-Endpunkte, registrierte Redirect-URIs, State und Nonce.
5. [Supabase Set Up SSO with Azure AD](https://supabase.com/docs/guides/platform/sso/azure): behandelt Dashboard-SSO und wird als Abgrenzung zur Anwendungs-SSO-Dokumentation geführt.
