# TicketHub Web-Dashboard – Phase 3

## Zweck und Umfang

Die erste startbare Webschicht zeigt eine operative Übersicht für einen Mandanten. Sie verbindet später Supabase-Auth, RLS-Tickets, Benachrichtigungen und SLA-Daten. In dieser Lieferung ist sie bewusst als lokale Vorschau nutzbar: Wenn keine sichere Publishable-Supabase-Konfiguration vorliegt, macht die Oberfläche den Preview-Modus sichtbar, statt Produktdaten vorzutäuschen.

## Architektur

`apps/web` ist eine Vite-/React-/TypeScript-Anwendung. `src/App.tsx` hält UI-Zustand für Zeitraum, Queue und Navigation; `src/dashboard-data.ts` stellt nur für den deutlich markierten Offline-Preview deterministische Beispielzustände bereit. Der spätere Supabase-Adapter liegt getrennt in `src/lib/supabase.ts`; er kann ausschliesslich `VITE_SUPABASE_URL` und `VITE_SUPABASE_PUBLISHABLE_KEY` lesen. Service-Role-Werte gehören weder in das Bundle noch in `.env.example`.

```text
apps/web/
├── public/manus-routes.json      # Routenmanifest für die Vorschau
├── src/
│   ├── App.tsx                   # Dashboard-Komposition und Interaktion
│   ├── dashboard-data.ts         # Klar markierte Offline-Vorschau
│   ├── lib/supabase.ts           # Browser-sichere Konfigurationsgrenze
│   ├── main.tsx                  # React-Einstieg
│   └── styles.css                # Responsives Designsystem
├── index.html
├── package.json
└── vite.config.ts
```

## Designsystem

- **Design Movement:** Schweizer Leitsystem trifft auf ruhige Operationskonsole.
- **Kernprinzipien:** klare Hierarchie, hohe Informationsdichte ohne Enge, sichtbare Zustandsfarben und bewusste Leerflächen.
- **Farbphilosophie:** Nachtblau schafft Ruhe und Vertrauen; warmes Off-White hält die Arbeitsfläche lesbar; Signalorange reserviert sich für kritische Reaktionszeiten; Petrol unterscheidet aktive Services.
- **Layout:** Ein vertikaler Command Rail führt in eine asymmetrische Arbeitsfläche mit Live-Signalzeile, Ticket-Queues und einer rechten Ereignisspur statt eines zentralen Kachelrasters.
- **Signature Elements:** die farbcodierte Zeitlinie bei Tickets, der dreistufige Servicezustand und die kompakte Queue-Pille mit numerischer Last.
- **Interaktion:** Navigation und Zeit-/Queue-Filter reagieren sofort; der Preview-Modus bleibt persistent sichtbar, bis eine echte Publishable-Konfiguration vorhanden ist.
- **Animation:** nur kurze 140-ms-Farb- und Schattenwechsel; `prefers-reduced-motion` deaktiviert Transitionen.
- **Typografie:** `IBM Plex Sans` für UI/Lesetext und `IBM Plex Mono` für Nummern, SLA-Zeiten und technische Metadaten.
- **Brand Essence:** „Die ruhige Kommandozentrale für mandantenfähigen IT-Support.“ Präzise, vertrauenswürdig, handlungsorientiert.
- **Brand Voice:** Überschriften nennen den Zustand direkt („SLA-Risiko in 42 Minuten“); Aktionen sind eindeutig („Queue öffnen“, nicht „Mehr erfahren“).
- **Wordmark/Marke:** Ein abstrahiertes Ticket mit einer ansteigenden Wegmarke als CSS-gezeichnete Wortmarke; der Name bleibt über die gemeinsame Produktkonfiguration austauschbar.
- **Signaturfarbe:** `#FF5C35` als TicketHub-Signalorange.

## Ausgangskriterien

- Die Anwendung startet lokal mit `pnpm --filter @nextdesk/web dev` auf Port 5173.
- `/manus-routes.json` wird als echtes JSON geliefert.
- Desktop und schmale Mobile-Breite bleiben lesbar; die Rail wird auf schmalen Bildschirmen zur horizontalen Navigation.
- Navigation, Zeitraum und Queue-Auswahl aktualisieren die sichtbaren Zustände.
- Ohne Publishable-Supabase-Konfiguration ist der Offline-Preview-Modus deutlich ausgewiesen.
