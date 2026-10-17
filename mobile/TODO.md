# nextDesk iOS – Umsetzungsstand

## TestFlight-fähige native App

- [ ] **Native Markenbasis und iOS-Konfiguration**
  - Die App verwendet die Bundle-ID `ch.grossict.nextdesk`.
  - Das aktuelle nextDesk-Produktlogo wird als iOS-App-Icon, Splash-Icon und Web-Favicon verwendet.
  - Die Expo-Konfiguration enthält einen stabilen, öffentlich erreichbaren Logo-Verweis.

- [ ] **Mobile nextDesk-Arbeitsoberfläche**
  - [ ] Sichere Anmeldung und Sitzungsverwaltung verbinden sich mit der bestehenden nextDesk-Authentifizierung über SSO und Magic Link. Die Azure-Anfrage fordert den `email`-Scope an; native iOS-Anmeldungen verwenden den App-Callback und die Browser-Vorschau ihren eigenen HTTPS-Callback. Der Rückweg wird im TestFlight-Build auf einem iPhone und in der freigegebenen Vorschau verifiziert.
  - [x] Die Startübersicht zeigt RLS-autorisierte Tickets und kompakte persönliche Arbeitsinformationen aus dem echten nextDesk-Mandanten.
  - [x] Die Ticketliste unterstützt Statusfilter und einhändig bedienbare Ticketdetails.
  - [ ] Tickets können direkt in der App mit Betreff, Beschreibung, Abteilung und Priorität erfasst werden. Die angemeldete Person ist vorausgewählt; Personen mit der bestehenden Berechtigung zur Verwaltung anfragender Personen können sie vor dem Speichern über eine Suche ersetzen. Ohne diese Berechtigung bleibt die serverseitige Mandanten- und Rechteprüfung verbindlich.
  - [ ] Berechtigte Agenten können Betreff, Beschreibung, Status und Priorität direkt in der mobilen Ticketdetailansicht bearbeiten. Die Ansicht zeigt eine Chat-Kommunikation; interne Kommentare sind der Standard, externe Portalantworten werden klar gekennzeichnet und nur bei der vorhandenen Serverberechtigung angeboten. Kunden erhalten keine internen Kommentare.
  - [ ] Mandanten- und Rechtekontext steuern die sichtbare Navigation und Funktionen auch bei mehreren aktiven Mandanten.

- [ ] **Expo-/EAS-Release zu TestFlight**
  - iOS-Releasekonfiguration, Versionsnummer und Build-Profil sind vorbereitet.
  - Die App wird mit dem vorhandenen Expo-/EAS-Zugang signiert und über App Store Connect zu TestFlight hochgeladen.
  - Der TestFlight-Build wird erst nach erfolgreicher Apple-/Expo-Authentifizierung als bereit gemeldet.
