import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Compass, X } from "lucide-react";
import "./onboarding-tour.css";

export type TourStep = {
  title: string;
  body: string;
  /** Navigation section shown behind the step. */
  section?: string;
};

export const AGENT_TOUR: TourStep[] = [
  {
    title: "Willkommen bei nextDesk",
    body: "In zwei Minuten zeigen wir Ihnen die wichtigsten Stellen. Sie können die Tour jederzeit beenden und später unter «Persönliche Einstellungen» erneut starten.",
    section: "Übersicht",
  },
  {
    title: "Ihre Startseite",
    body: "Oben sehen Sie Ihre Kennzahlen, rechts «Meine Prioritäten»: Die KI ordnet Ihre zugewiesenen Tickets mit kurzer Begründung. Ziehen Sie Tickets, um die Reihenfolge selbst zu bestimmen. Mit «Startseite anpassen» blenden Sie Bereiche ein oder aus.",
    section: "Übersicht",
  },
  {
    title: "Tickets bearbeiten",
    body: "In «Tickets» filtern Sie nach Warteschlange, Status oder Priorität, wechseln zwischen Liste und Kanban und speichern Filter als Ansicht – auf Wunsch geteilt mit Ihrer Abteilung. Mehrere Tickets lassen sich gemeinsam bearbeiten.",
    section: "Tickets",
  },
  {
    title: "Im Ticket",
    body: "Im Ticket antworten Sie oder schreiben interne Notizen, sehen wer gerade mitliest, lassen den Verlauf von der KI zusammenfassen und setzen Wiedervorlagen. Beobachten Sie ein Ticket, um über jede Änderung informiert zu werden.",
    section: "Tickets",
  },
  {
    title: "Benachrichtigungen",
    body: "Die Glocke oben rechts sammelt Zuweisungen, Antworten, SLA-Hinweise und Fristen. In der App erhalten Sie dieselben Mitteilungen als Push.",
  },
  {
    title: "Darstellung und Einstellungen",
    body: "Unter «Persönliche Einstellungen» wählen Sie Hell, Dunkel oder die Systemeinstellung, steuern Push-Mitteilungen und Ihre Abwesenheit mit Stellvertretung.",
  },
  {
    title: "Bereit",
    body: "Das war's. Bei Fragen hilft die Wissensdatenbank – und Ihr Team. Viel Erfolg!",
    section: "Übersicht",
  },
];

const storageKey = (userId: string) => `nextdesk.tour.agent.v1.${userId}`;

export function tourSeen(userId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(userId)) === "done";
  } catch {
    return true;
  }
}

export function markTourSeen(userId: string, seen: boolean) {
  try {
    if (seen) window.localStorage.setItem(storageKey(userId), "done");
    else window.localStorage.removeItem(storageKey(userId));
  } catch {
    // A convenience only.
  }
}

/** Step-by-step introduction for new agents. */
export function OnboardingTour({
  steps,
  onNavigate,
  onClose,
}: {
  steps: TourStep[];
  onNavigate: (section: string) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const step = steps[index]!;

  useEffect(() => {
    if (step.section) onNavigate(step.section);
  }, [onNavigate, step.section]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight" && index < steps.length - 1) {
        setIndex(index + 1);
      }
      if (event.key === "ArrowLeft" && index > 0) setIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, onClose, steps.length]);

  const last = index === steps.length - 1;
  return (
    <div className="onboarding-tour" role="presentation">
      <section
        aria-labelledby="onboarding-tour-title"
        aria-modal="true"
        className="onboarding-tour__card"
        role="dialog"
      >
        <header>
          <span className="onboarding-tour__badge">
            <Compass aria-hidden="true" size={14} /> Einführung {index + 1}/
            {steps.length}
          </span>
          <button
            aria-label="Einführung beenden"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>
        <h2 id="onboarding-tour-title">{step.title}</h2>
        <p>{step.body}</p>
        <div className="onboarding-tour__dots" aria-hidden="true">
          {steps.map((entry, position) => (
            <span
              className={position === index ? "is-active" : ""}
              key={entry.title}
            />
          ))}
        </div>
        <footer>
          <button className="text-button" onClick={onClose} type="button">
            Überspringen
          </button>
          <span>
            {index > 0 ? (
              <button
                className="secondary-button"
                onClick={() => setIndex(index - 1)}
                type="button"
              >
                <ArrowLeft aria-hidden="true" size={15} /> Zurück
              </button>
            ) : null}
            <button
              className="primary-button"
              onClick={() => (last ? onClose() : setIndex(index + 1))}
              type="button"
            >
              {last ? "Los geht's" : "Weiter"}
              {last ? null : <ArrowRight aria-hidden="true" size={15} />}
            </button>
          </span>
        </footer>
      </section>
    </div>
  );
}
