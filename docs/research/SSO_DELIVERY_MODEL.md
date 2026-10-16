# SSO-Liefermodell für Plattform und Mandanten

## Zwei getrennte Vertrauensgrenzen

**Plattform-Eigentümer** melden sich ausschliesslich über den Gross-ICT-Identitätsprovider an. Für die vorgesehene Microsoft-Entra-Integration wird eine tenant-gebundene OIDC-Konfiguration verwendet; keine globale `common`-Authority. Nach dem Callback prüft TicketHub zusätzlich, ob die identifizierte Person in `platform_administrators` aktiv ist. Für Mandantenanlage, Mandantenstatus und Deploy-Auslösung bleibt MFA-AAL2 verpflichtend.

**Mandantenbenutzer** melden sich über die pro Mandant konfigurierte Verbindung an. Microsoft Entra, Okta, Google Workspace und weitere SAML-2.0-kompatible IdPs können dafür als separate Supabase-SAML-Verbindungen geführt werden. Der Login löst aus einer verifizierten Domain beziehungsweise einer kontrollierten Mandanten-URL den zugehörigen Provider aus. Ein SSO-Erfolg erzeugt ohne erlaubtes JIT- oder SCIM-Mapping keine Mitgliedschaft.

## Konfigurationsmodell

Die Datenbank speichert pro Mandant nur Sicherheitsmetadaten: Protokoll, Supabase-Provider-ID, erlaubte Domains, IdP-/Entra-Mandantenkennung, Status, JIT-/SSO-Pflicht und eine Secret-Referenz. SAML-Metadaten, X.509-Zertifikate und OIDC-Client-Secrets werden in Supabase Auth beziehungsweise einem serverseitigen Secret Store gehalten und nie im Browser, in RLS-Tabellen oder Git gespeichert.

Die Mandantenadministration kann eine SSO-Verbindung entwerfen, aber erst eine serverseitige, auditierte Managementaktion aktiviert sie. Das schützt vor beliebigen Provider-IDs, Domain-Hijacking oder einer unbeabsichtigten Aussperrung des Mandanten.

## Login-Flows

1. Die Eigentümeransicht bietet **„Mit Gross ICT anmelden“** und startet einen Entra-OIDC-Redirect. Magic Link bleibt für Eigentümer deaktiviert.
2. Eine Mandanten-Loginseite nimmt E-Mail-Adresse oder Mandantenkennung entgegen und ruft `signInWithSSO({ domain })` nur für eine verifizierte, aktive Verbindung auf.
3. Nach Rückkehr prüft der Server die SSO-Provider-ID, den Benutzer, MFA-AAL2 und die autorisierte Mitgliedschaft. Der Browser darf diese Prüfungen nicht ersetzen.
4. Die SAML-Provider-ID wird dem Tenant zugeordnet und kann zusätzlich als JWT-Information zur einschränkenden RLS-Prüfung verwendet werden.

## Erforderliche Angaben für Gross ICT

- Microsoft-Entra-**Directory (Tenant) ID**,
- Client-ID der TicketHub-App-Registrierung,
- serverseitig hinterlegtes Client-Secret oder Zertifikat,
- exakt registrierte Supabase-Callback-URI und `https://app.nextdesk.ch/` als Anwendungsredirect,
- Entscheidung, ob neben Entra ein dokumentierter Break-Glass-Zugang mit MFA zulässig sein soll.

## Quellen

[1]: https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc "Microsoft OpenID Connect on the Microsoft identity platform"

[2]: https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml "Supabase Single Sign-On with SAML 2.0 for Projects"

[3]: https://supabase.com/docs/reference/javascript/auth-signinwithsso "Supabase JavaScript signInWithSSO"
