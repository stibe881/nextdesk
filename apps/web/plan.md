# TicketHub Web-Dashboard – Phase 3

## Zweck und Umfang

Die erste startbare Webschicht zeigt eine operative Übersicht für einen Mandanten. Sie verbindet später Supabase-Auth, RLS-Tickets, Benachrichtigungen und SLA-Daten. Zusätzlich erhält der Plattform-Eigentümer eine getrennte Kontrollfläche für alle Mandanten, Mandantenanlage, Archivierung und den auslösbaren GitHub-Pages-Deploy. In dieser Lieferung ist sie bewusst als lokale Vorschau nutzbar: Wenn keine sichere Publishable-Supabase-Konfiguration vorliegt, macht die Oberfläche den Preview-Modus sichtbar, statt Produktdaten vorzutäuschen.

## Architektur

`apps/web` ist eine Vite-/React-/TypeScript-Anwendung. `src/App.tsx` hält UI-Zustand für Zeitraum, Queue, Navigation und die Login-Zustände. `src/dashboard-data.ts` stellt nur für den deutlich markierten Offline-Preview deterministische Beispielzustände bereit. `src/lib/supabase.ts` kapselt den browser-sicheren Client, Magic-Link-Anmeldung und Session-Refresh. `src/lib/live-dashboard.ts` liest aktive Mitgliedschaften, Mandantendaten, Tickets, Status, Prioritäten, Abteilungen und autorisierte Ereignisse ausschliesslich mit dem User-JWT; jede Live-Abfrage bleibt damit unter den Datenbank-RLS-Policies. Die Plattformkonsole ruft ausschliesslich die user-authentifizierte Edge Function `platform-control` auf. Diese erzwingt Plattform-Eigentümerschaft und `aal2`, bevor sie mittels Service-Role Mandanten verwaltet oder einen GitHub-Workflow-Dispatch sendet. Service-Role- und GitHub-Token gehören weder in das Bundle noch in `.env.example`.

Die Webauslieferung wechselt von GitHub Pages auf Hetzner Webhosting L. Der Vite-Build erhält dort den Basis-Pfad `/` und wird über einen manuellen GitHub-Workflow per SSH/SFTP auf die Zielsubdomain übertragen. Supabase bleibt bis zu einer ausdrücklich beauftragten Backend-Neuentwicklung für PostgreSQL-RLS, Auth, Storage und die privilegierten Functions autoritativ. Eine spätere Node.js-API auf `api.<domain>` enthält lediglich serverseitige Integrations- und Deploy-Logik; sie ersetzt keine RLS-Prüfung im Browser.

Die Plattform-Eigentümerkonsole ist eine eigenständige, MFA-geschützte Ansicht. Sie ergänzt die Mandantenarbeitsfläche um Übersicht, Anlage und Statuswechsel von Mandanten; sie ist nur nach Magic Link, TOTP-AAL2 und erfolgreicher Serverprüfung der Plattformrolle sichtbar. Ihr visueller Stil folgt dem Gross-ICT-Auftritt: Graphit als Führungsfläche, warmes Gold als Handlungs- und Statusfarbe, helle Elfenbeinflächen und prägnante Versal-Hierarchie. Die zugrundeliegenden Bild- und Wortmarken werden nicht übernommen.

```text
apps/web/
├── public/manus-routes.json      # Routenmanifest für die Vorschau
├── src/
│   ├── App.tsx                   # Dashboard-Komposition und Interaktion
│   ├── dashboard-data.ts         # Klar markierte Offline-Vorschau
│   ├── lib/supabase.ts           # Browser-sichere Auth- und Session-Grenze
│   ├── lib/live-dashboard.ts     # RLS-gebundene Mandanten- und Ticketabfragen
│   ├── lib/platform-control.ts   # User-authentifizierter Plattform-API-Adapter
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
- Mit Publishable-Supabase-Konfiguration fordert die Anwendung per Magic Link eine Anmeldung an, lädt nur aktive Mandantenmitgliedschaften und zeigt Tickets ausschliesslich innerhalb des serverseitig RLS-gefilterten Mandantenkontexts an.
- Ein Plattform-Eigentümer erhält eine getrennte Mandantenliste mit Anlage und Bearbeitung; Mandanteneigentümer verwalten ausschliesslich ihren über Rollen und RLS autorisierten Mandantenkontext.
- Der sichtbare Aktualisieren-Button darf nie ein GitHub-Token enthalten: Er löst nur über die MFA-geschützte Edge Function einen `workflow_dispatch` aus und ist ohne serverseitiges Secret klar als nicht eingerichtet markiert.
