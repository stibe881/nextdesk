# Quellen: Entra-Personensynchronisation

## Microsoft Graph

nextDesk verwendet für den geplanten mandantenisolierten Personenabgleich ausschliesslich Microsoft Graph mit der Anwendungsberechtigung `User.Read.All`. Die Microsoft-Referenz verlangt für diese Berechtigung eine Administratorzustimmung. Breitere Verzeichnisberechtigungen wie `Directory.Read.All` werden nicht benötigt und sollen nicht angefragt werden.

Quelle: [Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference)

## Zustimmung je Kundenmandant

Bei einer mehrmandantenfähigen Anwendung gewährt eine Entra-Administration die Zustimmung in ihrem eigenen Kundenmandanten. Microsoft beschreibt die Zustimmung als organisationsweite, sicherheitsrelevante Freigabe; sie soll erst nach Prüfung der angeforderten Berechtigung erteilt werden. Der dokumentierte Consent-Endpunkt nutzt die Form `https://login.microsoftonline.com/{organization}/adminconsent?client_id={client-id}`.

Quelle: [Grant tenant-wide admin consent to an application](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-admin-consent)
