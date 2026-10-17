# Externe Quellen: Mehrmandanten-SSO mit Microsoft Entra und Supabase

- **Supabase Azure OAuth:** Eine Azure-Entra-App wird bei Entra registriert. Ihre Web-Redirect-URI ist `https://<project-ref>.supabase.co/auth/v1/callback`. Supabase konfiguriert dazu Client-ID, Secret und optional eine Azure Tenant URL. Für mandantenübergreifende Konten kann der Azure-Standardendpunkt `common` verwendet werden. Die Clientanwendung muss bei Azure den Scope `email` anfordern. Quelle: https://supabase.com/docs/guides/auth/social-login/auth-azure
- **Microsoft Entra OIDC:** Der tenant-spezifische Authority-Endpunkt lautet `https://login.microsoftonline.com/{tenant}/v2.0`; sein Discovery-Dokument liegt unter `/.well-known/openid-configuration`. Der Platzhalter `{tenant}` kann die Directory Tenant ID oder die Entra-Domain sein. Quelle: https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc

Diese Quellen wurden am 17. Oktober 2026 zur technischen Umsetzung herangezogen.
