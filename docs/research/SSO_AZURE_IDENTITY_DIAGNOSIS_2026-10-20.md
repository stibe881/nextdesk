# Azure-SSO-Diagnose vom 20. Oktober 2026

Die produktive, aktive Azure-SSO-Konfiguration verwendet einen mandantenspezifischen Microsoft-Entra-Issuer mit GUID. Die aggregierte Prüfung ergab, dass die Identitäten mit einer konfigurierten Unternehmensdomain diesen Issuer exakt bestätigen. Die gemeldete SSO-Sperre ist daher nicht durch einen fehlenden oder abweichenden Issuer der bereits zugeordneten Identitäten erklärbar.

Es bestehen zudem Azure-Identitäten mit nicht zugeordneter Unternehmensdomain und abweichendem Issuer. Sie dürfen nicht automatisch Zugriff auf einen Kundenmandanten erhalten. nextDesk verlangt für sie eine explizite Mandantenzuordnung oder Einladung. Diese Prüfung ist absichtlich fail-closed und wird nicht gelockert.

Supabase dokumentiert für den Azure-Provider die zentrale Tenant-URL `common` bei mehrmandantenfähigen Apps. Eine Kundenmandantenprüfung muss deshalb zusätzlich und serverseitig über die in nextDesk gespeicherte, konkrete Issuer-URL erfolgen. Supabase führt die mit einer Person verknüpften OAuth-Identitäten; ein Supabase-JWT signalisiert eine OAuth-Anmeldung über `amr`, enthält jedoch keinen vertrauenswürdigen Nachweis des aktuellen Azure-Tenants.

**Quellen**

[1]: https://supabase.com/docs/guides/auth/social-login/auth-azure "Add Azure Microsoft OAuth to Supabase"
[2]: https://supabase.com/docs/guides/auth/auth-identity-linking "Supabase Auth identity linking"
[3]: https://supabase.com/docs/guides/auth/jwt-fields "Supabase JWT claims reference"
