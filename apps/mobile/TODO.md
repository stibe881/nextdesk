# nextDesk iOS – Umsetzungsstand

## TestFlight-fähige native App

- [ ] **Native Markenbasis und iOS-Konfiguration**
  - Die App verwendet die Bundle-ID `ch.grossict.nextdesk`.
  - Das aktuelle nextDesk-Produktlogo wird als iOS-App-Icon, Splash-Icon und Web-Favicon verwendet.
  - Die Expo-Konfiguration enthält einen stabilen, öffentlich erreichbaren Logo-Verweis.

- [ ] **Mobile nextDesk-Arbeitsoberfläche**
  - Sichere Anmeldung und Sitzungsverwaltung verbinden sich mit der bestehenden nextDesk-Authentifizierung.
  - Die Startübersicht zeigt relevante Tickets und kompakte persönliche Arbeitsinformationen.
  - Die Ticketliste unterstützt Suche, Filter, Status und einhändig bedienbare Aktionen.
  - Ticketdetails bieten Verlauf, Kommentare und berechtigte Support-Aktionen in einer klaren mobilen Struktur.
  - Mandanten- und Rechtekontext steuern die sichtbare Navigation und Funktionen.

- [ ] **Expo-/EAS-Release zu TestFlight**
  - iOS-Releasekonfiguration, Versionsnummer und Build-Profil sind vorbereitet.
  - Die App wird mit dem vorhandenen Expo-/EAS-Zugang signiert und über App Store Connect zu TestFlight hochgeladen.
  - Der TestFlight-Build wird erst nach erfolgreicher Apple-/Expo-Authentifizierung als bereit gemeldet.
