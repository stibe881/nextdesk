# Lager-Modul – bestätigter Umsetzungsplan

## Ziel und Abgrenzung

Das neue Modul **«Lager»** wird im Web als eigener Menüpunkt direkt unter «Assets» umgesetzt. Es verwaltet quantitative Lagerartikel und deren Bewegungen, ohne langlebige Einzelgeräte aus dem bestehenden Asset-Modul umzudeuten. Assets bleiben Geräte mit Inventar-/Seriennummer, Lebenszyklus und Personenzuordnung; Lager verwaltet physische, reservierte und verfügbare Mengen von Artikeln wie Kabeln, Adaptern oder Verbrauchsmaterial.

Die Umsetzung erfolgt ohne Produktivdeployment, ohne Anwendung der Migration und ohne neuen iOS-Build. Alle schreibenden Abläufe bleiben serverautorisiert; Browser und iOS leiten weder Rechte noch Bestände oder Verfügbarkeiten selbst her.

## Fachlicher Lieferumfang

1. **Lagerartikel und Lagerorte:** Artikelstamm mit Name, Artikelnummer, Kategorie, Einheit, Mengenführung, Mindest- und Sollbestand, Hersteller, Modell, Lieferant, Notiz und Aktivstatus. Artikelnummern können gescannt werden; eine Serienführung wird erst mit einem gesicherten Serial-Unit-Erfassungsablauf aktiviert. Lagerorte und Fächer bleiben eine eigene Domäne und werden nicht mit Assetstandorten oder Veranstaltungsräumen vermischt.
2. **Bestandsbuch:** Eingang, Ausgabe, Rückgabe, Umlagerung, Defekt/Verlust, manuelle Korrektur, Reservationshaltung, Reservationsauflösung und Reservationsverbrauch werden als unveränderbare, auditierte Ledger-Ereignisse gespeichert. Physischer und reservierter Bestand werden serverseitig als Summe des Ledgers ermittelt; verfügbarer Bestand ist physisch minus reserviert.
3. **Reservationen und Inventur:** Bewusste Reservationen mit optionalem autorisiertem Ticketbezug; Bestandsprüfung, Idempotenz und Sperren erfolgen transaktional. Eine Inventur hat getrennte Zählzeilen und kann nur durch eine bewusste Abschlussaktion Differenzbewegungen erzeugen.
4. **Operative Übersicht:** Das Web zeigt kritische Unterbestände, offene Reservationen, laufende Inventuren, jüngste Bewegungen und reine Bestellvorschläge. Bestellungen, Benachrichtigungen, Provider oder Scheduler werden weder aktiviert noch automatisch ausgelöst.
5. **Mobile Nutzung:** iOS erhält innerhalb von Assets einen Einstieg «Lager» mit lesender Übersicht und Artikelsuche. Der Scanner bleibt ein bewusster Unterpfad; der globale Scan-Tab wird aus dem unteren Menü entfernt. Ein gemischter Scanvertrag wird erst für eindeutig typisierte Serverantworten genutzt; unbekannte oder mehrdeutige Codes erzeugen keine Buchung.

## Sicherheits- und Datenmodellentscheidungen

- Alle Lagerrelationen besitzen `tenant_id`, zusammengesetzte Tenant-FKs und RLS. Tabellenrechte für `anon` und `authenticated` werden entzogen; nur service-only RPCs schreiben.
- Neue Rechte: `inventory.read`, `inventory.manage`, `inventory.move`, `inventory.adjust` und `inventory.count.close`. Tenant-Administrierende erhalten sie als sichere Voreinstellung; weitere Rollen werden bewusst über die bestehende Rollenverwaltung zugewiesen.
- Das Mandanten-Feature `inventory.management` ist standardmässig deaktiviert. Sichtbarkeit und jede Edge-Aktion prüfen die Freigabe sowie aktive Mitgliedschaft und Berechtigung erneut auf dem Server.
- Ledgerzeilen sind append-only: Trigger verweigern `UPDATE` und `DELETE`; jede Berichtigung erfolgt durch eine Gegenbuchung. Mutationen verwenden `clientRequestId` für Idempotenz und transaktionale Sperren pro Artikel/Lagerort.
- Audits enthalten nur Typ, Mengen und Referenzart – keine Barcodewerte, Notizen oder privaten Bildpfade.
- Raumaufträge und Eintritte liegen im aktuellen Hauptzweig noch nicht vor. Für sie wird keine unsichere Freitextreferenz gebaut. Eine additive Folge-Migration ergänzt zusammengesetzte FKs und explizite Reservationsaktionen erst nach Zusammenführung der Raum-/Onboarding-Migrationen.

## Implementierungsstruktur

- `supabase/migrations/0068_inventory_foundation.sql`: Feature, Rechte, Tabellen, Constraints, RPCs, RLS, Ledger-Sperren und Audit.
- `supabase/functions/inventory/index.ts`: JWT-geschützte, allowlistbasierte Read- und Command-API für Web und iOS.
- `supabase/functions/inventory/index.test.ts`: Regressionen für Aktionsparser, Datenminimierung und Berechtigungsgrenzen.
- `apps/web/src/inventory.tsx`: operative Lageransicht mit Übersicht, Artikeln, Orten, Bewegungen, Reservationen und Inventur.
- `apps/web/src/App.tsx` und `apps/web/src/styles.css`: featuregegate-te Navigation und Layoutintegration.
- `nextdeskios`: Lagerzugang im Assetbereich, serverseitig validierte Datenverträge und bewusster Scanpfad; keine Offlinebestände oder stillen Buchungen.

## Design

Das Modul übernimmt die bestehende nextDesk-Arbeitsoberfläche: ruhige Flächen, klare Statusfarben und handlungsnahe Informationen vor administrativen Details. Die Übersicht ist keine Tabellenwand, sondern eine Abfolge operativer Zustände: Unterbestand, offene Reservationen, Inventur, Bewegungen. Ein einzelner, klar beschrifteter Aktionsbereich bündelt Artikel erfassen und Bestand buchen; kritische Werte sind sichtbar, aber nicht alarmistisch.

Die Typografie bleibt beim bestehenden System. Primärfarbe, Logo und Kontrast folgen den servergeladenen Mandanteneinstellungen. Leerzustände führen jeweils zu genau einer nächsten sicheren Handlung, zum Beispiel «Ersten Lagerort erfassen» oder «Ersten Artikel erfassen».

## Nicht enthaltene Automatiken

Nicht Bestandteil dieser Lieferung sind Seriengeräte-Erfassung und -Buchung, automatische Bestellungen, automatische Reservationsabläufe, Scheduler, Push-Benachrichtigungen, Lieferantenintegration, Bild-Uploads, externe Einkaufs-APIs oder automatische Raum-/Onboarding-Reservierungen. Solche Schritte benötigen eine separate fachliche und produktive Freigabe.
