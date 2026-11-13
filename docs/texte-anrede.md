# Texte: du oder Sie

nextDesk spricht standardmässig per **du**. Jeder Mandant kann in den
Einstellungen (**Einstellungen → Design → Anrede**) auf **Sie** umstellen. Die
Einstellung gilt für alle Texte: Oberfläche, Mobile-App, E-Mails,
Mitteilungen, Handbücher.

Damit das funktioniert, wird jeder Text, der eine Person anspricht, **zweimal**
geschrieben: einmal mit du, einmal mit Sie. Das Skript
`node scripts/verify-formality.mjs` prüft das (läuft in `pnpm test:schema`).

## Regeln

1. Die **Standardfassung ist du**: «Öffne die Einstellungen.», «Du hast keine
   Berechtigung.», «deine Tickets».
2. Eine Sie-Form («Sie», «Ihnen», «Ihr …») steht nur im **letzten Argument**
   von `tn()`, `tone()` oder `msg()`, nie als Standardtext.
3. Ein Text mit du («dir», «dein …») braucht ebenfalls eine Sie-Fassung.
4. Neutrale Texte ohne Anrede («Tickets», «Speichern», «Datei auswählen»)
   brauchen keine zwei Fassungen.
5. Keine Emojis und keine Piktogramm-Zeichen (✓ ✕ ★ ⚠ …). Verwende Icons
   (Web: `lucide-react`) oder ein Wort.
6. Schweizer Rechtschreibung (ss statt ß), Gross-/Kleinschreibung wie bisher.
   Auch in der du-Fassung klein: «du», «dein», «dir».

## Web (`apps/web`)

```tsx
import { tn } from "./lib/formality";

// Text
<p>{tn("Öffne die Einstellungen.", "Öffnen Sie die Einstellungen.")}</p>;

// Text mit Markup: tn() nimmt auch JSX
<p>
  {tn(
    <>Wähle <strong>Speichern</strong>, um deine Änderungen zu übernehmen.</>,
    <>Wählen Sie <strong>Speichern</strong>, um Ihre Änderungen zu übernehmen.</>,
  )}
</p>;

// Meldung
setError(tn("Du hast keine Berechtigung.", "Sie haben keine Berechtigung."));
```

- **Nie auf Modulebene** aufrufen (`const LABEL = tn(...)` oben in der Datei):
  Das wird nur einmal beim Laden ausgewertet. Verwende eine Funktion oder
  rufe `tn()` beim Rendern auf. Konstanten mit Texten werden zu Funktionen:
  `const labels = () => ({ open: tn("…", "…") })`.
- Wechselt die Anrede, wird die App neu aufgebaut (`FormalityBoundary`). Eine
  eigene Abhängigkeit im Code braucht es nicht.

## Edge Functions (`supabase/functions`)

```ts
import { loadFormality, msg, tone } from "../_shared/formality.ts";

// Text, den die Function selbst erzeugt (E-Mail, Push, PDF)
const formality = await loadFormality(admin, tenantId);
const subject = tone(formality, "Deine Anfrage wurde gelöst", "Ihre Anfrage wurde gelöst");

// Text in einer JSON-Antwort: beide Fassungen, der Client wählt
throw new HttpError(403, "forbidden", msg("Dir fehlt die Berechtigung.", "Ihnen fehlt die Berechtigung."));
```

`msg()` liefert «⟦du␞sie⟧». Web und Mobile-App lösen das beim Empfang auf. Nutze
`msg()` nur für Antworten, die der Client anzeigt, nicht für Texte, die auf
dem Server weiterverarbeitet werden.

## Handbücher

Die du-Fassung liegt in `docs/handbooks/*.md`, die Sie-Fassung in
`docs/handbooks/sie/*.md`. Beide haben dieselben Überschriften und Bilder. Ändere
immer beide Dateien. `pnpm handbooks:build` bündelt beide Fassungen.

## Übrige Dokumente

Dokumente in `docs/` (ausser `docs/handbooks/sie/`), die Webseite in `site/` und
die Markdown-Dateien im Hauptverzeichnis sind durchgehend per du geschrieben.

## Prüfen

```bash
node scripts/verify-formality.mjs            # alles
node scripts/verify-formality.mjs --only=apps/web/src/ticket-detail.tsx
node scripts/verify-formality.mjs --list     # jede Fundstelle
```

Ausnahmen (z. B. ein Wort, das keine Anrede ist) markierst du mit einem
Kommentar `formality-ok` in derselben oder der vorherigen Zeile, Emoji-Ausnahmen
in Tests mit `emoji-ok`.
