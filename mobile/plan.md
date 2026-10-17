# nextDesk iOS – Ausbauplan

## Auftrag und Reihenfolge

nextDesk wird als sichere, mandantenfähige Arbeitsapp weiterentwickelt. Die Umsetzung folgt den vom Nutzer genannten Bereichen von oben nach unten: mobile Arbeitsfunktionen, Design und Bedienung, allgemeine Prozessverbesserungen, Automatisierungsgrundlagen sowie Assets mit Intune und QR-Scanner. Abhängige Daten- und Rechtebasis wird jeweils vor einer sichtbaren Oberfläche ergänzt.

## Bestehende Grundlagen

Die Expo-/TypeScript-App besitzt bereits authentifizierte Tabs für Tickets, Services, Home, 1. Hilfe und Einstellungen sowie Ticketanlage, Ticketdetail, Bearbeitung, Kommentarverlauf und mandantenautorisierten Supabase-Zugriff. Der Webbereich und die mobilen Ticketdaten nutzen dieselbe Mandanten- und Rollenbasis. Der native SSO-Rückweg bleibt bei `ch.grossict.nextdesk://auth/callback`.

## Architektur und Abhängigkeiten

- **Assets zuerst als sichere Datenbasis:** Der vorhandene mandantenisolierte Assetkatalog wird um strukturierte Scanidentitäten, Lifecycle, Personen-/Ticketbezug und Intune-Sync-Status erweitert. Web und Mobile verwenden ausschließlich autorisierte Edge-APIs; sie lesen nie Graph oder Geheimnisse direkt.
- **Mobile Module:** Eigenständige Seiten für Assets, Assetdetails und Scanner ergänzen die bestehende Expo-Router-Struktur. Der Scanner nutzt `expo-camera`, nur nach ausdrücklicher Kameraberechtigung, mit manueller Codeeingabe als Fallback.
- **Ticket- und Servicefluss:** Ticket- und Assetverknüpfungen, Entwürfe, Favoriten, Suche, Anhänge und Wissenseinstiege bauen auf den bestehenden Ticket-APIs auf. Mutationen bleiben serverseitig berechtigungsgeprüft.
- **Automatisierung:** Regeln werden als mandantenisolierte, auditierte App-Logik modelliert. Tatsächliche zeitgesteuerte Ausführung bleibt erst aktiv, wenn der bestehende sichere Scheduler-/Cron-Kontext eingerichtet ist.
- **Microsoft Intune:** Der Connector bleibt standardmässig deaktiviert. Er benötigt pro Kundenmandant Microsoft-Graph-`DeviceManagementManagedDevices.Read.All`, Administratorzustimmung, eine Intune-Lizenz und serverseitige Secrets. Er arbeitet lesend, seitenweise und idempotent.

## Design

- **Designbewegung:** Ruhige, schweizerisch präzise Operations-Oberfläche – funktional, freundlich und ohne unnötige Dekoration.
- **Kernprinzipien:** Ein klarer Hauptschritt pro Bildschirm; Ticket- und Assetkontext immer sichtbar; Informationen werden über Abstand und Typografie gruppiert, nicht über Kartenstapel; Rechte und Sichtbarkeit werden verständlich erklärt.
- **Farbphilosophie:** Das bestehende nextDesk-Violett führt primäre Handlungen; Statusfarben dienen ausschließlich eindeutiger Semantik; neutrale Flächen reduzieren visuelle Last.
- **Layoutparadigma:** Mobile nutzt eine vertikale Arbeitslinie mit Kontextkopf, Aktionen in Daumenreichweite und einem klaren Arbeitsbereich. Web nutzt eine schlanke Seitenleiste und seitennahe Werkzeuge statt modaler Verschachtelung.
- **Signaturmerkmale:** Dezente Ticket-/Assetkennungen, klare Statuschips und chatartige Kommunikation mit eindeutiger interner/externer Trennung.
- **Interaktion und Animation:** Zustandswechsel erhalten kurze, reduzierte Rückmeldungen; riskante Aktionen erklären Folgen vor Ausführung; Bewegungen werden bei reduzierter Bewegung deaktiviert.
- **Typografie:** Prägnante, dunkle Überschriften; gut lesbarer Fliesstext; Kennungen und Zeitstempel zurückhaltend. Kein Inhalt wird allein über Farbe vermittelt.
- **Markenessenz:** nextDesk macht professionellen IT-Support, Servicewissen und Geräteinformationen für Kundschaft und Agenten sofort handhabbar. Persönlich, präzise, vertrauenswürdig.
- **Markenstimme:** Direkt und handlungsorientiert, etwa „Asset scannen“ und „Antwort an Kundschaft senden“.
- **Wortmarke und Markenfarbe:** Die bestehende nextDesk-Wort-/Bildmarke bleibt erhalten; Violett bleibt die wiedererkennbare Aktionsfarbe.

## Projektstruktur

- `app/(tabs)/`: authentifizierte Arbeitsbereiche, inklusive Assets und Einstellungen.
- `app/assets/`: Assetdetail, Scanroute und mögliche Ticketverknüpfung.
- `components/`: wiederverwendbare mobile Listen-, Status-, Dialog-, Scanner- und Kontextbausteine.
- `lib/`: strikte API-Adapter, Offlineentwürfe, sichere lokale Präferenzen und Berechtigungsparser.
- `../nextdesk/supabase/migrations/`: mandantenisoliertes Modell, RLS, Indizes, Audit und Rechte.
- `../nextdesk/supabase/functions/`: Edge-APIs für Assets, Intune-Abgleich und Automationsausführung.
- `../nextdesk/apps/web/src/`: gleichwertige Webnavigation und Assetarbeitsfläche.

## Materiale Grenzen

Kein Client, keine App und kein Browser erhalten Service-Role-, Microsoft-Graph-, Scheduler- oder Provider-Geheimnisse. Die vollständige Intune-Aktivierung, E-Mail-/Teams-/Slack-/Kalenderzugänge, produktive Scheduler und Apple-native Funktionen benötigen im jeweiligen Schritt externe Zustimmung oder Zugang. Diese Punkte werden vorbereitet, aber nicht simuliert oder als aktiv ausgegeben.
