# nextDesk iOS – Umsetzungsstand

## TestFlight-fähige native App

- [ ] **Native Markenbasis und iOS-Konfiguration**
  - Die App verwendet die Bundle-ID `ch.grossict.nextdesk`.
  - Das aktuelle nextDesk-Produktlogo wird als iOS-App-Icon, Splash-Icon und Web-Favicon verwendet.
  - Die Expo-Konfiguration enthält einen stabilen, öffentlich erreichbaren Logo-Verweis.

- [ ] **Mobile nextDesk-Arbeitsoberfläche**
  - [x] Sichere Anmeldung und Sitzungsverwaltung verbinden sich mit der bestehenden nextDesk-Authentifizierung über SSO und Magic Link; die Redirect-Allowlist wird vor dem Test geprüft.
  - [x] Die Startübersicht zeigt RLS-autorisierte Tickets und kompakte persönliche Arbeitsinformationen aus dem echten nextDesk-Mandanten.
  - [x] Die Ticketliste unterstützt Statusfilter und einhändig bedienbare Ticketdetails.
  - [x] Tickets können direkt in der App mit Betreff, Beschreibung, Abteilung, Priorität und angemeldeter anfragender Person erfasst werden.
  - [x] Berechtigte Agenten können Betreff und Beschreibung direkt in der mobilen Ticketdetailansicht bearbeiten.
  - [ ] Mandanten- und Rechtekontext steuern die sichtbare Navigation und Funktionen auch bei mehreren aktiven Mandanten.

- [ ] **Expo-/EAS-Release zu TestFlight**
  - iOS-Releasekonfiguration, Versionsnummer und Build-Profil sind vorbereitet.
  - Die App wird mit dem vorhandenen Expo-/EAS-Zugang signiert und über App Store Connect zu TestFlight hochgeladen.
  - Der TestFlight-Build wird erst nach erfolgreicher Apple-/Expo-Authentifizierung als bereit gemeldet.
