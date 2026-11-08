-- The role editor shows permissions.description to tenant administrators.
-- Older catalogue entries were still in English; this translates them.
-- Only the description changes; codes and their meaning stay the same.

update public.permissions as permission
set description = translated.description
from (
  values
    ('asset.integration.manage', 'Asset-Integrationen einrichten und Geräte synchronisieren (nur lesend)'),
    ('asset.manage', 'Assets verwalten'),
    ('automation.manage', 'Automatisierungen verwalten'),
    ('department.manage', 'Abteilungen verwalten'),
    ('inventory.adjust', 'Lagerbestände manuell korrigieren'),
    ('inventory.count.close', 'Inventuren abschliessen und Zählabweichungen buchen'),
    ('inventory.manage', 'Lagerorte und Artikelstammdaten verwalten'),
    ('inventory.move', 'Wareneingänge, Ausgaben, Umbuchungen und Reservierungen buchen'),
    ('inventory.read', 'Lager ansehen'),
    ('knowledge.manage', 'Wissensartikel verwalten'),
    ('platform.support_access.request', 'Protokollierten Supportzugriff der Plattform anfordern'),
    ('platform.tenants.manage', 'Mandanten der Plattform verwalten'),
    ('report.read', 'Berichte ansehen'),
    ('role.manage', 'Rollen verwalten'),
    ('shop.fulfill', 'Shop-Bestellungen bearbeiten und aus dem Lager ausbuchen'),
    ('shop.manage', 'Shop-Katalog verwalten'),
    ('shop.order', 'Im Shop bestellen oder ausleihen'),
    ('team.manage', 'Teams verwalten'),
    ('tenant.settings.manage', 'Mandanteneinstellungen verwalten'),
    ('ticket.assign', 'Tickets zuweisen'),
    ('ticket.close', 'Tickets schliessen'),
    ('ticket.comment.external.own', 'Eigene Anfragen öffentlich kommentieren'),
    ('ticket.create', 'Tickets erstellen'),
    ('ticket.delete', 'Tickets löschen'),
    ('ticket.export', 'Ticketdaten exportieren'),
    ('ticket.internal_notes.read', 'Interne Notizen lesen'),
    ('ticket.internal_notes.write', 'Interne Notizen schreiben'),
    ('ticket.merge', 'Tickets zusammenführen oder aufteilen'),
    ('ticket.read.assigned', 'Eigene zugewiesene Tickets ansehen'),
    ('ticket.read.department', 'Tickets der eigenen Abteilungen ansehen'),
    ('ticket.read.own', 'Eigene oder betroffene Tickets ansehen'),
    ('ticket.update', 'Tickets bearbeiten'),
    ('user.manage', 'Personen verwalten')
) as translated(code, description)
where permission.code = translated.code;
