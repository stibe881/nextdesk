# nextDesk – Umsetzungsplan für die 90 Vorschläge

## Auftrag

Der Auftrag umfasst die vollständige Umsetzung der 90 Vorschläge aus den Bereichen User Experience, Design, Mehrwert für Agenten, Mehrwert für Anfragende, allgemeine Verbesserungen und KI-Integration. Bestehende Funktionen werden ausgebaut, nicht doppelt implementiert. Externe Dienste bleiben bis zu einer ausdrücklichen Freigabe, einem datenschutzrechtlichen Entscheid und serverseitig hinterlegten Zugangsdaten deaktiviert.

## Liefermodell

1. **Sichere Daten- und Rechtebasis:** Neue Datenstrukturen sind additiv, haben immer `tenant_id`, zusammengesetzte Mandantenbezüge, RLS, Audit und serverseitig fail-closed geprüfte Feature-Gates. Neue Berechtigungen werden nur katalogisiert, nie automatisch Rollen oder Personen zugewiesen.
2. **Arbeitsoberfläche:** Der bestehende Web-Arbeitsbereich erhält verbesserte Befehle, Ansichten, Hilfen, reduzierte Bewegung, Dark Mode, konsistente Rückmeldungen, barrierefreie Statusdarstellung und effizientere Ticketbearbeitung. Die iOS-App erhält dieselben semantischen Designwerte, native Bedienmuster, sichere Gestenalternativen und vollständige Accessibility-Metadaten.
3. **Agenten- und Anfragendenprozesse:** Bereits vorhandene Vorlagen, Zeitbuchungen, Freigaben, Wissen, Assets, Ticketverknüpfungen, Übergaben, Feedback und gespeicherte Ansichten werden vereinheitlicht. Neue Assistenzfunktionen bleiben immer explizit durch Menschen ausgelöst.
4. **Betrieb:** Regressionen, negative RLS-Fälle, Feature-Gates, Audit, Datenschutzvorbereitung, Sitzungs- und Backupnachweise sowie Performancebudgets werden ausgebaut. Es werden keine automatischen Schliessungen oder Löschungen aktiviert.
5. **KI-Grundlage:** Die KI-Governance wird vorbereitet: per-Mandant-Gates, Zweckbindung, Providerfreigabe, Datenminimierung, Audit, Quoten und Entwurfsartefakte. Kein Modell wird vor Datenschutz- und Anbieterfreigabe kontaktiert. KI-Ausgaben bleiben Entwürfe und führen nie selbständig zu Ticket-, Rollen-, Wissens- oder Statusmutationen.

## Architektur und Projektstruktur

- `apps/web/src/`: Web-Oberfläche mit thematisierten, zugänglichen Arbeitsabläufen und bestehenden RLS-autorisierten Edge-Function-Aufrufen.
- `supabase/migrations/`: ausschließlich neue, additive Datenbankmigrationen inklusive RLS, Indizes, Audit, Feature-Katalog und negativer Sicherheitsfälle.
- `supabase/functions/`: zustandsverändernde und lesende Edge APIs mit Authentifizierung, aktiver Mitgliedschaft, Mandant, Berechtigung und Feature-Gate vor jedem Zugriff.
- `mobile/` und `/home/ubuntu/nextdeskios/`: Expo-iOS-Oberfläche, deren Zugang ausschließlich über dieselben mandantenautorisierten APIs läuft. Offline bleibt auf den bestehenden, minimalen, verschlüsselten Listenfallback begrenzt.

## Design

- **Bewegung:** ruhige, präzise Operations-Oberfläche, die Handlungen statt Dekoration priorisiert.
- **Prinzipien:** Kontext bleibt sichtbar; Status ist nie nur Farbe; Rückmeldungen sind direkt, nicht störend; Touch- und Tastaturwege sind gleichwertig.
- **Farbe:** nextDesk-Violett bleibt Aktionsfarbe, Statusfarben werden mit Text und Symbol kombiniert. Dark Mode und hoher Kontrast verwenden semantische Tokens.
- **Layout:** Web hält Navigation schlank und ermöglicht Listen-Detail-Arbeit; iOS priorisiert Daumenreichweite, native Sheets und grosse Ziele.
- **Marke:** professionell, klar, vertrauenswürdig; pro Mandant nur über die vorhandene, auditierte Branding-Verwaltung konfigurierbar.

## Unverrückbare Sicherheitsgrenzen

- Anmeldung und aktive Mandantenmitgliedschaft vor jeder Daten- oder Funktionssichtbarkeit.
- Keine mandantenübergreifenden Daten, auch nicht über Suche, KI, Anhänge, Trends, Benachrichtigungen oder Cache.
- Keine automatische Rollenvergabe, keine Client-Bypässe, keine ungeprüfte Feature-Sichtbarkeit.
- Abschlüsse brauchen weiterhin sichtbare Bestätigung, serverseitige Neuprüfung und Audit.
- Intune, E-Mail, Entra-Vollabgleich, Push, Webhooks, Monitoring, Scheduler und KI-Provider werden erst nach Zugang, Consent und aktivem serverseitigem Gate eingeschaltet.
