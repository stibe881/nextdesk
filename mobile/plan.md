# nextDesk iOS – Ausbauplan

## Auftrag

Die bestehende Expo-iOS-App wird als sichere, mandantenfähige Arbeitsapp entlang der bestätigten 90 nextDesk-Vorschläge erweitert. Bereits vorhandene mobile Funktionen – Tickets, Services, Home, Wissen, Scan, Assets, globale Suche, sichere Entwürfe, Favoriten, Fotoanhänge, Geräteschutz und minimaler Offlinefallback – bleiben erhalten und werden ausgebaut.

## Mobile Lieferbereiche

- **Bedienung und Accessibility:** System- oder manuell wählbarer Dark Mode, Dynamic Type, hoher Kontrast, reduzierte Bewegung, verständliche Screenreader-Beschriftungen, Skeletons, konsistente Meldungen, gleichwertige Schaltflächen zu Gesten und tastatursichere Formulare.
- **Ticketarbeit:** native Status-/Prioritäts-Sheets, persistenter Kontextkopf, sichere Wischaktionen nur für Favorit/Mir zuweisen mit sichtbarer Alternative, Wiedervorlagen, Mein Tag, Zeitbuchung, Übergabe- und Vor-Ort-Kontext.
- **Anfragende und Wissen:** klare Statuszeitleiste, Wissensvorschläge, Servicekatalog und Freigabe-Eingang über dieselben serverseitigen, mandantengeprüften APIs wie im Web.
- **Design:** gemeinsame semantische Design-Tokens, grosse Touchziele, ruhige Statusdarstellung, Avatar-Fallbacks und einheitliche Erfolg-/Warn-/Fehlermeldungen.
- **KI:** ausschließlich ausdrücklich ausgelöste, serverseitig gegatete Entwürfe. Keine Modellaufrufe, keine Audio-/Bildweitergabe und keine automatische Mutation vor zugelassener Provider- und Datenschutzkonfiguration.

## Grenzen

Kein iOS-Client erhält Service-Role-, Graph-, Scheduler- oder Providergeheimnisse. Der native SSO-Rückweg bleibt `ch.grossict.nextdesk://auth/callback` mit Expo-Crypto-S256-PKCE und geschütztem Keychain-Verifier. Offline speichert die App weiterhin keine Ticketdetails, Kommunikation, Assets, Wissensinhalte oder Anhänge. Push, Sprachfunktionen, Bildanalyse, Intune, E-Mail und andere externe Integrationen bleiben bis zu separater Freigabe deaktiviert.
