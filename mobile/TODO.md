# nextDesk iOS – Umsetzungsstand

## TestFlight-fähige native App

- [ ] **Native Markenbasis und iOS-Konfiguration**
  - Die App verwendet die Bundle-ID `ch.grossict.nextdesk`.
  - Das aktuelle nextDesk-Produktlogo wird als iOS-App-Icon, Splash-Icon und Web-Favicon verwendet.
  - Die Expo-Konfiguration enthält einen stabilen, öffentlich erreichbaren Logo-Verweis.

- [ ] **Mobile nextDesk-Arbeitsoberfläche**
  - [ ] Sichere Anmeldung und Sitzungsverwaltung verbinden sich mit der bestehenden nextDesk-Authentifizierung über SSO und Magic Link. Die Azure-Anfrage fordert den `email`-Scope an; native iOS-Anmeldungen verwenden den App-Callback und die Browser-Vorschau ihren eigenen HTTPS-Callback. In der eingebetteten Vorschau öffnet SSO in einer separaten Browser-Authentifizierung, damit Microsoft nie innerhalb des Vorschau-Frames geladen wird. Der Rückweg wird im TestFlight-Build auf einem iPhone und in der freigegebenen Vorschau verifiziert.
  - [x] Die Startübersicht zeigt RLS-autorisierte Tickets und kompakte persönliche Arbeitsinformationen aus dem echten nextDesk-Mandanten.
  - [x] Die Ticketliste unterstützt Statusfilter und einhändig bedienbare Ticketdetails.
  - [ ] Die untere Navigation zeigt in dieser Reihenfolge fünf eigenständige Bereiche: **Tickets**, **Services**, **Home**, **Wissen**, **Einstellungen**. Das Profil-Icon auf Home öffnet die persönlichen Einstellungen statt direkt abzumelden.
  - [ ] Die persönlichen Einstellungen zeigen die eigene E-Mail-Adresse und Anmeldeart. Nur Konten ohne Entra-/SSO-Anmeldung erhalten eine Passwortänderung mit Bestätigung; SSO-Konten sehen den eindeutigen Hinweis, dass das Passwort beim Identitätsanbieter verwaltet wird. Abmelden bleibt verfügbar.
  - [ ] Tickets können direkt in der App mit Betreff, Beschreibung, Abteilung und Priorität erfasst werden. Die angemeldete Person ist vorausgewählt; Personen mit der bestehenden Berechtigung zur Verwaltung anfragender Personen können sie vor dem Speichern über eine Suche ersetzen oder direkt mit Name und optionaler E-Mail-Adresse neu anlegen. Auf iOS bleibt das aktive Eingabefeld beim Tippen oberhalb der Tastatur sichtbar und die Seite lässt sich mit der Tastatur interaktiv verschieben. Ohne diese Berechtigung bleibt die serverseitige Mandanten- und Rechteprüfung verbindlich.
  - [ ] Berechtigte Agenten und Mandantenadministratoren mit aktiver Mitgliedschaft in der bearbeitenden Abteilung können Betreff, Beschreibung, Status, Priorität und anfragende Person direkt in einer klar gegliederten mobilen Ticketdetailansicht bearbeiten. Status und Priorität verwenden jeweils eine fokussierte Auswahl statt einer ungeordneten Chip-Sammlung; eine Änderung der anfragenden Person prüft ihren Mandantenbezug serverseitig. Die Kommunikation ist als klarer Chat gestaltet: Kundennachrichten links, externe Agentenantworten rechts und interne Kommentare mittig. Interne Kommentare sind für Mitarbeitende der Standard; Anfragende Personen können ausschließlich auf ihre eigenen Tickets extern antworten und erhalten nie interne Kommentare.
  - [ ] Mandanten- und Rechtekontext steuern die sichtbare Navigation und Funktionen auch bei mehreren aktiven Mandanten.
  - [ ] Ein eigener Bereich **Assets** ist im unteren Menü sichtbar. Er bietet eine mandantenautorisierte Suche, Assetlisten und Assetdetails mit Kennung, Gerätedaten, Besitzer, Service-, Standort-, Ticket- und Lifecycle-Kontext; die untere Navigation bleibt dabei auch in Assetliste, Details und Scanner sichtbar.
  - [ ] Der Scanner ist als eigener Eintrag **Scan** direkt im unteren Menüband erreichbar und akzeptiert QR- und Barcodes sowie eine manuelle Eingabe. Er erklärt die Kameraberechtigung verständlich, verarbeitet Scanwerte lokal mit Debounce, führt ausschließlich einen mandantenautorisierten Lookup aus und zeigt bei unbekannten oder mehrdeutigen Werten eine klare, datensparsame Rückmeldung.
  - [ ] Die App bietet globale Suche, Schnellaktionen, persönliche Arbeitswarteschlangen, sichere Entwürfe, Favoriten, Fotoanhänge, Kontaktaktionen, Wissenseinstiege, haptisches Feedback und einen optionalen lokalen Geräteschutz. Jede Funktion respektiert erneut geprüfte Serverrechte und speichert keine Geheimnisse.

- [ ] **Expo-/EAS-Release zu TestFlight**
  - iOS-Releasekonfiguration, Versionsnummer und Build-Profil sind vorbereitet.
  - Die App wird mit dem vorhandenen Expo-/EAS-Zugang signiert und über App Store Connect zu TestFlight hochgeladen.
  - Der TestFlight-Build wird erst nach erfolgreicher Apple-/Expo-Authentifizierung als bereit gemeldet.
