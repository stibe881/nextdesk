# Expo- und React-Native-Konzept

TicketHub veröffentlicht **eine** gemeinsame iOS-App und **eine** gemeinsame Android-App. App-Name, Store-Eintrag und native Icons sind global. Logo, Farben, Portalname und Inhalte laden nach einer sicheren Mandantenauflösung dynamisch; sie dürfen keine Berechtigungsgrenze ersetzen.

## Technischer Stack

Die App basiert auf React Native, Expo, Expo Router, TypeScript und NativeWind. Sie verwendet Expo Notifications, SecureStore, ImagePicker, DocumentPicker, Linking und AuthSession. Business-Regeln, Typen und Zod-Schemata stammen aus den Paketen des Monorepos; UI-Komponenten bleiben nativ.

## Navigation und Sicherheit

Die Bottom-Navigation enthält Start, Tickets, Neu, Mitteilungen und Profil. Ticket-Deep-Links werden über Universal Links und Android App Links empfangen, aber erst nach Tokenvalidierung, Mandantenkontext und Ticketberechtigung geöffnet. Sitzungsdaten und Refresh-Token liegen in SecureStore; ein Logout, ein Mandantenwechsel oder ein Rechteentzug leert geschützte lokale Daten und Abonnements.

## Dateien, Kamera und Push

Kamera- und Dokumentzugriff werden nur bei der jeweiligen Aktion angefragt. Uploads verwenden kurzlebige, mandanten- und ticketgebundene Berechtigungen. Push-Payloads bleiben minimal und enthalten keine vertraulichen Beschreibungstexte; die App lädt nach Tap die berechtigte Ressource nach. Fehlerhafte Push-Tokens werden auf einem auditierten Serverweg entfernt.

## Offline

Der MVP zeigt einen klaren Offline-Status, speichert jedoch keine unbegrenzt gültigen Ticketdaten. Eine spätere Offline-Warteschlange verschlüsselt Daten pro Mandant und erzwingt bei Reconnect eine Berechtigungs- und Versionsprüfung vor dem Sync. Widerrufene Rechte dürfen dadurch nicht umgangen werden.

## Release-Gate

Vor Store-Submission werden Auth, Deep Links, Push, Datei-Upload, Session-Reset und Berechtigungsentzug auf echten Geräten getestet. Ein Web-Preview ersetzt diese nativen Prüfungen nicht.
