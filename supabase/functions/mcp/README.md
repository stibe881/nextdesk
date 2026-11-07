# nextDesk-Connector (MCP)

Verbindet KI-Clients wie die Gemini CLI mit nextDesk. Die Anmeldung läuft über
den OAuth-2.1-Server von Supabase Auth, also mit dem normalen nextDesk-Konto
(auch Microsoft-SSO). Jede Aktion läuft mit den Rechten der angemeldeten Person.

## Werkzeuge

| Werkzeug | Art | Zweck |
| --- | --- | --- |
| `arbeitsbereiche_anzeigen` | lesen | Arbeitsbereiche des Kontos |
| `tickets_suchen` | lesen | Tickets suchen (mine, open, unassigned, all) |
| `ticket_anzeigen` | lesen | Ticket mit Beschreibung, Verlauf, Checkliste, erfasster Zeit, Eskalationen und Verknüpfungen |
| `wissen_suchen`, `wissensartikel_lesen` | lesen | Wissensdatenbank. Sucht bei ganzen Fragen einzeln nach Stichwörtern; gibt es zu einem Programm keinen eigenen Artikel, liefert sie den allgemeinen Weg (z. B. «Unternehmensportal») |
| `shop_katalog_anzeigen`, `shop_bestellungen_anzeigen` | lesen | Self-Service-Shop: Katalog und eigene Bestellungen |
| `geraet_suchen` | lesen | Geräte nach Name, Nummer, Tag oder Seriennummer |
| `ueberall_suchen` | lesen | Gleichzeitig in Tickets, Wiedervorlagen, Wissen, Veranstaltungsräumen und Eintritten suchen |
| `benachrichtigungen_anzeigen` | lesen | Eigene Benachrichtigungen (standardmässig nur ungelesene) |
| `offene_freigaben_anzeigen` | lesen | Ticketfreigaben, die auf den eigenen Entscheid warten |
| `serviceaufgaben_anzeigen` | lesen | Serviceaufgaben: überfällig, heute, kommend (mine, team, all) |
| `anfragende_suchen` | lesen | Anfragende Personen nach Name suchen |
| `wiedervorlagen_anzeigen` | lesen | Eigene Wiedervorlagen (optional nur zu einem Ticket) |
| `erwaehnungen_anzeigen` | lesen | @-Erwähnungen in Ticketnotizen |
| `meine_kennzahlen` | lesen | Persönliche Kennzahlen (offen, heute gelöst, Reaktions- und Lösungszeit, SLA) |
| `warteschlangen_anzeigen` | lesen | Offene Tickets je Abteilung und Team |
| `uebergaben_anzeigen` | lesen | Übergaben eines Tickets |
| `servicestatus_anzeigen` | lesen | Status der IT-Services und anstehende Wartungen |
| `lager_nachschlagen` | lesen | Lagerartikel oder -ort über Nummer, Barcode oder QR-Code |
| `lizenzen_anzeigen`, `vertraege_anzeigen` | lesen | Lizenzen und Verträge, optional nur bald ablaufende |
| `makros_anzeigen`, `makrotext_holen` | lesen | Antwortmakros und ihr Text |
| `raumbuchungen_anzeigen` | lesen | Räume und Raumbuchungen mit Aufgaben (alle Seiten, rund 13 Monate) |
| `eintritte_anzeigen` | lesen | Eintritte mit Aufgaben, Vorlagen und Personen |
| `ticketvorlagen_anzeigen` | lesen | Ticketvorlagen je Abteilung |
| `wissenssammlungen_anzeigen`, `artikelversionen_anzeigen`, `ticketwissen_anzeigen` | lesen | Sammlungen, Fassungen eines Artikels, Wissen am Ticket |
| `serviceaufgabe_anzeigen`, `serviceaufgaben_kalender` | lesen | Serviceaufgabe im Detail, Monatskalender |
| `ticketfreigaben_anzeigen` | lesen | Freigaben eines Tickets |
| `stellvertretungen_anzeigen`, `stoerungsmeldungen_anzeigen` | lesen | Stellvertretungen, Störungsmeldungen |
| `zuweisung_vorschlagen`, `ticketumfeld_anzeigen`, `geraete_zum_ticket` | lesen | Zuweisungsvorschläge, Ticketumfeld, Geräte der anfragenden Person |
| `servicebericht`, `sla_eskalationen_anzeigen`, `sla_regeln_anzeigen` | lesen | Kennzahlen, SLA-Eskalationen und -Regeln (braucht Berichtsrecht) |
| `teamuebersicht`, `pruefliste_anzeigen`, `monatsbericht` | lesen | Teamführung (nur für Vorgesetzte) |
| `anfragende_profil_anzeigen`, `kundenorganisationen_anzeigen` | lesen | Profil Anfragende, Kundenorganisationen |
| `geraet_anzeigen`, `lageruebersicht`, `reservationen_anzeigen` | lesen | Gerät im Detail, Lager, Reservationen |
| `ticket_erfassen` | schreiben | Ticket erfassen, für sich selbst oder eine anfragende Person (`anfragende_person`) |
| `interne_notiz_hinzufuegen` | schreiben | Interne Notiz an ein Ticket |
| `ticketstatus_aendern` | schreiben | Status ändern; Lösen/Schliessen nur mit `bestaetigt=true` |
| `prioritaet_aendern` | schreiben | Priorität ändern (low, normal, high, urgent) |
| `ticket_mir_zuweisen` | schreiben | Ticket sich selbst zuweisen |
| `ticket_beantworten` | schreiben | Antwort an Anfragende; nur mit `bestaetigt=true` |
| `zeit_erfassen` | schreiben | Arbeitszeit in Minuten erfassen (internal, billable, goodwill) |
| `checklistenpunkt_hinzufuegen`, `checklistenpunkt_abhaken` | schreiben | Checklistenpunkt hinzufügen bzw. abhaken |
| `ticket_beobachten` | schreiben | Ticket beobachten oder nicht mehr beobachten |
| `benachrichtigungen_gelesen` | schreiben | Eine oder alle Benachrichtigungen als gelesen markieren |
| `freigabe_entscheiden` | schreiben | Freigabe genehmigen oder ablehnen; nur mit `bestaetigt=true` |
| `serviceaufgabe_erledigen` | schreiben | Serviceaufgabe erledigen (optional mit Notiz) |
| `wiedervorlage_erstellen`, `wiedervorlage_erledigen` | schreiben | Wiedervorlage erstellen bzw. erledigen |
| `erwaehnung_gelesen` | schreiben | Erwähnung als gelesen markieren |
| `uebergabe_erstellen`, `uebergabe_bestaetigen` | schreiben | Übergabe erstellen, bestätigen oder abschliessen |
| `ticket_eskalieren` | schreiben | Ticket eskalieren; nur mit `bestaetigt=true` |
| `tickets_verknuepfen` | schreiben | Zwei Tickets verknüpfen (Duplikat, blockiert, Eltern/Kind …) |
| `wissensartikel_verknuepfen` | schreiben | Wissensartikel mit Ticket verknüpfen; extern nur mit `bestaetigt=true` |
| `wissensentwurf_aus_ticket` | schreiben | Wissensartikel-Entwurf aus einem Ticket (geht in die Prüfung) |
| `raum_buchen` | schreiben | Raum buchen, einmalig oder als Serie (wöchentlich bis 52, monatlich bis 12 Termine); bei Überschneidung nur mit `ueberschneidung_bestaetigt=true` |
| `raumbuchung_aktualisieren`, `raumaufgabe_aktualisieren` | schreiben | Status einer Raumbuchung bzw. ihrer Aufgaben setzen |
| `eintritt_erfassen` | schreiben | Eintritt erfassen (Vorlage, Führungsperson, ICT-Verantwortung) |
| `eintrittsaufgabe_aktualisieren` | schreiben | Status einer Eintrittsaufgabe setzen |
| `ticket_zuweisen`, `ticket_team_zuweisen` | schreiben | Ticket einer Person oder einem Team zuweisen |
| `abteilung_wechseln` | schreiben | Abteilung wechseln; nur mit `bestaetigt=true` |
| `kategorie_setzen` | schreiben | Kategorie und Unterkategorie setzen |
| `tickets_zusammenfuehren` | schreiben | Tickets zusammenführen; nur mit `bestaetigt=true` |
| `verknuepfung_entfernen` | schreiben | Verknüpfung entfernen |
| `wissensartikel_speichern`, `wissenspruefung_anfordern` | schreiben | Wissensartikel schreiben und zur Prüfung geben |
| `wissensartikel_freigeben`, `wissensartikel_archivieren` | schreiben | Veröffentlichen bzw. archivieren; nur mit `bestaetigt=true` |
| `wissensartikel_loesen`, `wissensartikel_senden` | schreiben | Artikel vom Ticket lösen bzw. an Anfragende senden (nur mit `bestaetigt=true`) |
| `serviceaufgabe_bearbeiten` | schreiben | Serviceaufgabe starten, überspringen, Notiz, Checkliste, neu planen, zuweisen, wieder öffnen |
| `freigabe_anfordern`, `freigabe_zurueckziehen` | schreiben | Freigabe anfordern bzw. zurückziehen |
| `stellvertretung_einrichten`, `stellvertretung_beenden` | schreiben | Stellvertretung einrichten bzw. beenden |
| `stoerungsmeldung_speichern` | schreiben | Störungsmeldung erfassen oder aktualisieren |
| `ticket_bewerten`, `tickets_umverteilen` | schreiben | Teamführung: Ticket bewerten, Tickets umverteilen (nur mit `bestaetigt=true`) |
| `lagerbewegung_buchen`, `material_reservieren`, `reservation_freigeben` | schreiben | Lagerbewegung buchen, Material reservieren, Reservation freigeben |
| `im_shop_bestellen` | schreiben | Im Shop bestellen; nur mit `bestaetigt=true` |

Bei IT-Fragen (Software, Geräte, Zugänge …) weist der Connector Gemini an, zuerst
die Wissensdatenbank zu befragen und keine allgemeinen Anleitungen aus dem Web
zu erfinden.

Geschriebene Texte (Ticket, interne Notiz, Zeitnotiz, Notiz zur Serviceaufgabe,
Wiedervorlage)
enden mit dem Hinweis «Erfasst über den nextDesk-Connector.». Antworten an
Anfragende werden ohne diesen Hinweis versendet.

Alle Werkzeuge haben deutsche Namen (z. B. `ticket_erfassen`), damit Gemini sie
in Rückfragen und Bestätigungen auf Deutsch anzeigt; zusätzlich liefert der
Connector einen deutschen Anzeigetitel (`title`). Auch die Felder sind deutsch
(z. B. `betreff`, `beschreibung`, `anfragende_person`, `bestaetigt`). Die
Schlüssel, die der Connector an die Edge Functions weitergibt, bleiben
unverändert.

Auch Auswahlwerte (z. B. `in_bearbeitung`, `hoch`, `woechentlich`, `beamer`)
und die Feldnamen in den Antworten sind deutsch. Eine zentrale Schicht
übersetzt deutsche Eingaben vor der Ausführung in die Werte von nextDesk
(englische Werte bleiben gültig) und gibt Antworten deutsch aus.

## Vorlagen und Entwürfe

**Vorlagen (MCP-Prompts):** In der Gemini CLI erscheinen sie als Slash-Befehle
mit Feldern zum Ausfüllen, z. B. `/ticket_erfassen --betreff="Drucker druckt nicht"`.

| Vorlage | Zweck |
| --- | --- |
| `it_frage` | IT-Frage: zuerst Wissensdatenbank und Shop, sonst Ticket |
| `problem_melden` | IT-Problem melden: Lösung suchen, Servicestatus prüfen, sonst Ticket |
| `software_anfordern` | Weg aus der Wissensdatenbank (z. B. Unternehmensportal), Shop oder Ticket |
| `ticket_erfassen` | Ticket für sich oder eine andere Person |
| `antwort_schreiben` | Antwort an Anfragende, optional mit Makro |
| `raum_buchen` | Raum einmalig oder als Serie |
| `eintritt_erfassen` | Eintritt oder Austritt einer Person |
| `shop_bestellung` | Bestellung im Self-Service-Shop |
| `abwesenheit_vertretung` | Stellvertretung für eine Abwesenheit |
| `uebergabe_erstellen` | Übergabe eines Tickets |
| `freigabe_anfordern` | Freigabe für ein Ticket |
| `wissensartikel_erstellen` | Wissensartikel, optional aus einer Ticketlösung |
| `stoerung_melden` | Interne Störungsmeldung |
| `zeit_erfassen` | Arbeitszeit auf einem Ticket |

**Entwurf vor dem Abschicken:** `ticket_erfassen`, `ticket_beantworten`,
`raum_buchen`, `eintritt_erfassen`, `im_shop_bestellen`,
`stoerungsmeldung_speichern`, `freigabe_anfordern`, `stellvertretung_einrichten`,
`wissensartikel_speichern` und `uebergabe_erstellen` geben ohne `bestaetigt` ein
ausgefülltes Formular zurück (mit aufgelösten Namen, Schweizer Zeiten und nicht
ausgefüllten optionalen Feldern). Abgeschickt wird erst mit `bestaetigt=true`.

## Berechtigungen

Der Connector hat keine eigenen Rechte. Jedes Werkzeug ruft dieselben Edge
Functions wie die Web-App mit dem Zugriffstoken der angemeldeten Person auf;
nextDesk prüft dort Mitgliedschaft, Funktionsfreigaben und Rechte (z. B.
`ticket.assign`, `knowledge.manage`, `knowledge.publish`, `report.read`,
`inventory.move`, `team.supervise`). Fehlt ein Recht, meldet das Werkzeug
«Keine Berechtigung für diese Aktion». Zusätzlich verlangt der Connector für
folgenreiche Aktionen die ausdrückliche Bestätigung der Person (`bestaetigt=true`).

## Einrichtung (einmalig)

1. **Supabase → Authentication → OAuth Server:** aktivieren.
   - Authorization Path: `/oauth/consent`
   - Dynamic Client Registration: aktivieren (MCP-Clients registrieren sich selbst).
2. **Supabase → Authentication → URL Configuration:**
   - Site URL: `https://app.nextdesk.ch`
   - Redirect URLs: `https://app.nextdesk.ch/**` ergänzen.
3. **Web-App deployen** (enthält die Seite `/oauth/consent`).
4. **Funktion ausliefern:**
   `npx supabase functions deploy mcp --import-map supabase/functions/deno.json --use-api`
   (`verify_jwt = false` steht in `supabase/config.toml`, weil Clients zuerst die
   Metadaten ohne Token abrufen.)

## Gemini CLI

In `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "nextdesk": { "httpUrl": "https://<projekt-ref>.supabase.co/functions/v1/mcp" }
  }
}
```

Dann in der Gemini CLI `/mcp auth nextdesk` ausführen, im Browser anmelden und
«Zulassen» wählen.

## Sicherheit

- Ohne gültiges Zugriffstoken antwortet die Funktion mit 401; das Token wird bei
  jeder Anfrage beim Auth-Server geprüft (widerrufene Sitzungen fallen durch).
- Zugriff auf Daten und Aktionen erfolgt über dieselben Edge Functions und
  Zeilenregeln wie in der Web-App. Es gibt keinen eigenen Rechtepfad.
- Die Person bestätigt jede Verbindung auf der Seite `/oauth/consent` und kann
  sie jederzeit in Supabase widerrufen.
