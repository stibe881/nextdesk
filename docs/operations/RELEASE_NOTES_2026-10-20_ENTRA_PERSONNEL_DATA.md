# nextDesk – Release Note: Entra-Personendaten und Ticketzugriff

**Zeitpunkt:** 20. Oktober 2026 (UTC)  
**Web-Commit:** `02e4737ed9d0755a43562d70e50ee36b125a1a0f`  
**Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T110905Z-02e4737`

## Auslieferung

- `tenant-sso-access` wurde als Version 23 aktiv geschaltet, weiterhin mit JWT-Prüfung.
- `tenant-users` wurde als Version 14 aktiv geschaltet, weiterhin mit JWT-Prüfung.
- Das geprüfte Webbundle wurde auf `app.nextdesk.ch` ausgerollt.
- Der Produktions-Smoke-Test war erfolgreich.

## Fachliche Korrektur

Die Personenverwaltung unterscheidet nun sichtbar und technisch zwischen zwei unabhängigen Angaben:

1. **Entra-Organisation / Angebot** und **Entra-Funktion** sind reine Organisationsdaten aus dem zentralen Entra-Verzeichnis.
2. **Ticketzugriffsbereich** (zum Beispiel ICT oder Infrastruktur) bestimmt ausschliesslich, in welchem nextDesk-Supportbereich eine Person als Agent:in arbeiten darf.

Organisationsdaten aus Entra können keine Rollen, Agentenrechte, Abteilungsmitgliedschaften oder Ticketberechtigungen vergeben oder ändern.

## Sichere Verknüpfung

Für Azure-Identitäten ohne mitgelieferte Entra-Objektkennung verwendet nextDesk nach bereits erfolgreich geprüfter Azure-Provider- und Mandantenbindung die kanonische E-Mail ausschliesslich, um den passenden aktiven, noch ungebundenen Entra-Verzeichniseintrag zu finden. Die anschliessende Verknüpfung verwendet die aus diesem geprüften Datensatz gelesene Entra-Objektkennung.

Die Personenliste zeigt Entra-Daten nur noch für direkt und zuvor über den SSO-Pfad bestätigte lokale Verknüpfungen. Eine bloss gleiche E-Mail-Adresse in einer lokalen Mitgliedschaft genügt nicht. Dadurch bleibt die Mandantentrennung erhalten und weder Einladung noch Magic Link können Organisationsdaten eines unbestätigten Entra-Datensatzes sichtbar machen.

## Rücknahmegrenze

Die Änderung betrifft nur Edge-Function- und Webquellcode. Es wurden keine Datenbankmigrationen und keine Massendatenänderungen ausgeführt. Eine Rücknahme besteht aus dem erneuten Ausrollen des vorherigen Webbundles und der vorherigen Function-Versionen; bereits durch einen erfolgreichen SSO-Vorgang angelegte direkte Verknüpfungen bleiben bewusst bestehen und werden nicht automatisiert entfernt.
