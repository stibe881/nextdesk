# Shop (Selbstbedienung)

Mitarbeitende bestellen Zubehör oder leihen Geräte aus – ohne Ticket. Agenten bearbeiten die Bestellungen; bei der Ausgabe wird automatisch aus dem Lager gebucht.

## Aktivierung

- Funktionsschalter **`self_service.shop`** („Shop“) pro Mandant in den Einstellungen → Funktionen.
- Für Lagerbuchungen zusätzlich **Bestandsverwaltung** (`inventory.management`) aktivieren und Lagerartikel erfassen.

## Rollen

| Berechtigung | Standardrollen | Bedeutung |
|---|---|---|
| `shop.order` | Anfragende, Agenten, Admins | Im Shop bestellen und ausleihen |
| `shop.fulfill` | Agenten, Admins | Bestellungen bearbeiten, ausgeben, Rückgaben erfassen |
| `shop.manage` | Agenten, Admins | Katalog pflegen |

## Ablauf

1. **Bestellen** (App/Web): Artikel in den Warenkorb, Übergabe (Abholung / Arbeitsplatz), bei Ausleihen Zeitraum.
2. **Freigabe** (nur bei Artikeln mit „Braucht Freigabe“): geht an die vorgesetzte Person. Ist keine bekannt, entscheidet der Support.
3. **Reservierung**: Bei Lagerartikeln wird die Menge sofort (bzw. nach der Freigabe) reserviert. Fehlt Bestand, wird die Position als „nicht an Lager“ markiert.
4. **Bearbeitung**: In Bearbeitung nehmen → Bereit zur Abholung (Push an die Person).
5. **Ausgabe**: bucht aus dem Lager (Reservierung wird verbraucht). Seriengeräte verlangen Seriennummer und Lagerort.
6. **Ausleihe**: Status „Ausgeliehen“, „Überfällig“ nach Ablauf; **Rückgabe** bucht wieder ins Lager.

Ablehnen und Stornieren geben Reservierungen frei. Bestellungen erzeugen nie ein Ticket.

## Vorgesetzte

- Werden beim Entra-Abgleich übernommen (Microsoft Graph `manager`).
- Können unter Einstellungen → Personen → Bearbeiten manuell gesetzt werden (hat Vorrang, z. B. ohne Entra).
- Die vorgesetzte Person braucht ein nextDesk-Konto im selben Arbeitsbereich, sonst entscheidet der Support.

## Technik

- Migration `0154_self_service_shop.sql` (Tabellen `shop_*`, Funktionen `shop_submit_order`, `shop_update_order`).
- Edge Function `shop`; Push-Kategorie `shop`.
