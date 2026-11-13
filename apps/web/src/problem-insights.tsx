import { tn } from "./lib/formality";
import { ChevronDown, ChevronUp, Lightbulb, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { supabase } from "./lib/supabase";
import "./problem-insights.css";

type CandidateTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  categoryName?: string | null;
};
type CandidateGroup = {
  key: string;
  kind: "category" | "keyword" | "similar";
  label: string;
  tickets: CandidateTicket[];
};

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Die Verbindung ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke(
    "problem-management",
    { body },
  );
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = (await context.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (payload?.error?.message) throw new Error(payload.error.message);
    }
    throw new Error("Die Anfrage konnte nicht ausgeführt werden.");
  }
  return (data as { data: T }).data;
}

/**
 * Clusters of similar open tickets without a case. One click opens a case
 * («Problem») with all selected tickets linked.
 */
export function ProblemCandidates({
  tenantId,
  onCreated,
  onOpenTicket,
}: {
  tenantId: string;
  onCreated: () => void;
  onOpenTicket?: (ticketId: string) => void;
}) {
  const [groups, setGroups] = useState<CandidateGroup[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await call<{ groups: CandidateGroup[] }>({
        type: "candidates",
        tenantId,
      });
      setGroups(data.groups);
      setSelected(
        Object.fromEntries(
          data.groups.map((group) => [
            group.key,
            new Set(group.tickets.map((ticket) => ticket.id)),
          ]),
        ),
      );
      setTitles(
        Object.fromEntries(
          data.groups.map((group) => [
            group.key,
            group.kind === "keyword"
              ? `Häufung «${group.label}»`
              : `Häufung: ${group.label}`,
          ]),
        ),
      );
    } catch {
      // Without the permission the panel simply stays hidden.
      setGroups([]);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(group: CandidateGroup) {
    const ids = [...(selected[group.key] ?? [])];
    if (!ids.length) return;
    setBusy(true);
    setError("");
    try {
      const result = await call<{ linked: number }>({
        type: "createFromTickets",
        tenantId,
        title: titles[group.key] ?? group.label,
        description: `Automatisch erkannte Häufung von ${ids.length} ähnlichen Tickets.`,
        ticketIds: ids,
      });
      setMessage(
        tn(
          `Fall angelegt und ${result.linked} Tickets verknüpft. Ergänze dort Ursache und Workaround.`,
          `Fall angelegt und ${result.linked} Tickets verknüpft. Ergänzen Sie dort Ursache und Workaround.`,
        ),
      );
      setOpen(null);
      await load();
      onCreated();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Der Fall konnte nicht erstellt werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!groups.length && !message) return null;

  return (
    <section
      aria-labelledby="problem-candidates-heading"
      className="problem-candidates"
    >
      <header>
        <span aria-hidden="true" className="problem-candidates__icon">
          <Sparkles size={18} />
        </span>
        <div>
          <h3 id="problem-candidates-heading">Mögliche Probleme</h3>
          <p>
            Häufungen ähnlicher offener Tickets der letzten 30 Tage, die noch
            keinem Fall zugeordnet sind.
          </p>
        </div>
        <button
          aria-expanded={!collapsed}
          className="text-button"
          onClick={() => setCollapsed((current) => !current)}
          type="button"
        >
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          {collapsed ? "Anzeigen" : "Ausblenden"}
        </button>
      </header>
      {message ? (
        <p className="form-message form-message--success" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
      {!collapsed ? (
        <ul className="problem-candidates__list">
          {groups.map((group) => {
            const isOpen = open === group.key;
            const chosen = selected[group.key] ?? new Set<string>();
            return (
              <li key={group.key}>
                <button
                  aria-expanded={isOpen}
                  className="problem-candidates__summary"
                  onClick={() => setOpen(isOpen ? null : group.key)}
                  type="button"
                >
                  <strong>{group.tickets.length}</strong>
                  <span>
                    {group.kind === "category"
                      ? "Kategorie"
                      : group.kind === "keyword"
                        ? "Stichwort"
                        : "Ähnlich wie"}{" "}
                    «{group.label}»
                  </span>
                  {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                {isOpen ? (
                  <div className="problem-candidates__detail">
                    <ul>
                      {group.tickets.map((ticket) => (
                        <li key={ticket.id}>
                          <label>
                            <input
                              checked={chosen.has(ticket.id)}
                              onChange={(event) => {
                                const next = new Set(chosen);
                                if (event.target.checked) next.add(ticket.id);
                                else next.delete(ticket.id);
                                setSelected({ ...selected, [group.key]: next });
                              }}
                              type="checkbox"
                            />
                            <code>{ticket.ticketNumber}</code>
                          </label>
                          <button
                            className="text-button"
                            onClick={() => onOpenTicket?.(ticket.id)}
                            type="button"
                          >
                            {ticket.subject}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <label className="problem-candidates__title">
                      Titel des Falls
                      <input
                        maxLength={240}
                        onChange={(event) =>
                          setTitles({
                            ...titles,
                            [group.key]: event.target.value,
                          })
                        }
                        value={titles[group.key] ?? ""}
                      />
                    </label>
                    <button
                      className="primary-button"
                      disabled={
                        busy ||
                        chosen.size === 0 ||
                        (titles[group.key] ?? "").trim().length < 3
                      }
                      onClick={() => void create(group)}
                      type="button"
                    >
                      Als Fall erfassen ({chosen.size} Tickets)
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

const WHY_PLACEHOLDERS = [
  "Warum ist das Problem aufgetreten?",
  "Warum ist das passiert?",
  "Und warum das?",
  "Warum genau?",
  "Was ist die eigentliche Ursache?",
];

/** Structured root cause analysis (5 × why) and impact of a case. */
export function ProblemAnalysis({
  tenantId,
  problemId,
  disabled,
}: {
  tenantId: string;
  problemId: string;
  disabled?: boolean;
}) {
  const [whys, setWhys] = useState<string[]>(["", "", "", "", ""]);
  const [impact, setImpact] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  useEffect(() => {
    let active = true;
    void call<{ whys: string[]; impact: string }>({
      type: "getAnalysis",
      tenantId,
      problemId,
    })
      .then((data) => {
        if (!active) return;
        setWhys([...data.whys, "", "", "", "", ""].slice(0, 5));
        setImpact(data.impact);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [problemId, tenantId]);

  async function save() {
    setState("saving");
    try {
      const filled = whys.map((why) => why.trim());
      while (filled.length && !filled[filled.length - 1]) filled.pop();
      await call({
        type: "saveAnalysis",
        tenantId,
        problemId,
        whys: filled,
        impact: impact.trim(),
      });
      setState("saved");
    } catch {
      setState("error");
    }
  }

  const visibleCount = Math.min(
    5,
    Math.max(1, whys.findIndex((why) => !why.trim()) + 1 || 5),
  );

  return (
    <section className="problem-analysis" aria-label="Ursachenanalyse">
      <h4>
        <Lightbulb aria-hidden="true" size={16} /> Ursachenanalyse (5 × Warum)
      </h4>
      <ol>
        {whys.slice(0, visibleCount).map((why, index) => (
          <li key={index}>
            <input
              aria-label={`Warum ${index + 1}`}
              disabled={disabled}
              maxLength={1000}
              onChange={(event) => {
                const next = [...whys];
                next[index] = event.target.value;
                setWhys(next);
                setState("idle");
              }}
              placeholder={WHY_PLACEHOLDERS[index]}
              value={why}
            />
          </li>
        ))}
      </ol>
      <label>
        Auswirkung (wer und was ist betroffen?)
        <textarea
          disabled={disabled}
          maxLength={4000}
          onChange={(event) => {
            setImpact(event.target.value);
            setState("idle");
          }}
          rows={2}
          value={impact}
        />
      </label>
      <div className="problem-analysis__actions">
        <button
          className="secondary-button"
          disabled={disabled || state === "saving"}
          onClick={() => void save()}
          type="button"
        >
          Analyse speichern
        </button>
        {state === "saved" ? <span>Gespeichert.</span> : null}
        {state === "error" ? (
          <span className="problem-analysis__error">
            Speichern fehlgeschlagen.
          </span>
        ) : null}
      </div>
    </section>
  );
}
