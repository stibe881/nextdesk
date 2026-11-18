import { tn } from "./lib/formality";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Layers,
  LoaderCircle,
  X,
} from "lucide-react";
import {
  HANDOVER_NOTE_MAX,
  handOverTicketLevel,
  handoverNoteError,
  levelChangeText,
  loadLevelTeamAgents,
  loadTicketSupportLevel,
  supportLevelLabel,
  type LevelTeamOption,
  type SupportLevel,
  type TicketSupportLevel as TicketSupportLevelState,
} from "./lib/support-levels";
import "./ticket-support-level.css";

type HandoverMode = {
  direction: "escalated" | "returned";
  level: SupportLevel;
  teams: LevelTeamOption[];
};

const dateTime = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "short",
  timeStyle: "short",
});

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateTime.format(date);
}

/**
 * Eskalationsstufe des Tickets (1st/2nd/3rd Level) mit Übergabe an die
 * nächste Stufe oder zurück. Die Übergabenotiz der aktuellen Stufe wird
 * hervorgehoben, damit die nächste Stufe sofort sieht, was versucht wurde.
 */
export function TicketSupportLevel({
  onChanged,
  refreshKey,
  tenantId,
  ticketId,
  embedded = false,
}: {
  onChanged: () => void;
  refreshKey: string;
  tenantId: string;
  ticketId: string;
  /** Rendered as a block inside the «Koordination» card. */
  embedded?: boolean;
}) {
  const [state, setState] = useState<TicketSupportLevelState | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<HandoverMode | null>(null);
  const [message, setMessage] = useState("");
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const next = await loadTicketSupportLevel(tenantId, ticketId);
      if (current !== sequence.current) return;
      setState(next);
      setError("");
    } catch (nextError) {
      if (current !== sequence.current) return;
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Supportstufe konnte nicht geladen werden.",
      );
    }
  }, [tenantId, ticketId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    setState(null);
    setMode(null);
    setMessage("");
  }, [tenantId, ticketId]);

  // Without a first answer (e.g. no agent rights) the panel stays hidden.
  if (!state) return null;
  if (
    !state.levelsConfigured &&
    state.currentLevel === null &&
    state.history.length === 0
  ) {
    return null;
  }

  const handover = state.currentHandover;
  const Wrapper = embedded ? "div" : "section";
  return (
    <Wrapper
      aria-labelledby="ticket-support-level-heading"
      className={
        embedded
          ? "ticket-coordination__block ticket-support-level ticket-support-level--embedded"
          : "ticket-detail-primary ticket-support-level"
      }
    >
      <div
        className={
          embedded
            ? "ticket-support-level__heading"
            : "ticket-detail-section-heading"
        }
      >
        {embedded ? (
          <div>
            <p className="ticket-support-level__label">Supportstufe</p>
            <h4 id="ticket-support-level-heading">
              <Layers aria-hidden="true" size={embedded ? 16 : 18} />
              {state.currentLevel
                ? supportLevelLabel(state.currentLevel)
                : "Ohne Stufe"}
              {state.currentTeam ? (
                <span className="ticket-support-level__team">
                  {state.currentTeam.name}
                </span>
              ) : null}
            </h4>
          </div>
        ) : (
          <div>
            <p className="eyebrow">SUPPORTSTUFE</p>
            <h3 id="ticket-support-level-heading">
              <Layers aria-hidden="true" size={embedded ? 16 : 18} />
              {state.currentLevel
                ? supportLevelLabel(state.currentLevel)
                : "Ohne Stufe"}
              {state.currentTeam ? (
                <span className="ticket-support-level__team">
                  {state.currentTeam.name}
                </span>
              ) : null}
            </h3>
          </div>
        )}
        {state.canHandover ? (
          <div className="ticket-support-level__actions">
            {state.targets.back.map((target) => (
              <button
                className="secondary-button"
                key={target.level}
                onClick={() => {
                  setMessage("");
                  setMode({
                    direction: "returned",
                    level: target.level,
                    teams: target.teams,
                  });
                }}
                type="button"
              >
                <ArrowDownLeft aria-hidden="true" size={15} />
                Zurück an Stufe {target.level}
              </button>
            ))}
            {state.targets.next ? (
              <button
                className="primary-button"
                onClick={() => {
                  setMessage("");
                  if (state.targets.next)
                    setMode({
                      direction: "escalated",
                      level: state.targets.next.level,
                      teams: state.targets.next.teams,
                    });
                }}
                type="button"
              >
                <ArrowUpRight aria-hidden="true" size={15} />
                An nächste Stufe übergeben
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {state.currentLevel === null && !state.ticketClosed ? (
        <p className="ticket-support-level__muted">
          {tn(
            "Das Ticket ist keinem Team mit Supportstufe zugewiesen. Weise es einem Stufen-Team zu, um es später übergeben zu können.",
            "Das Ticket ist keinem Team mit Supportstufe zugewiesen. Weisen Sie es einem Stufen-Team zu, um es später übergeben zu können.",
          )}
        </p>
      ) : null}

      {message ? (
        <p className="ticket-detail-message success" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="ticket-detail-message error" role="alert">
          <AlertCircle aria-hidden="true" size={17} />
          {error}
        </p>
      ) : null}

      {handover?.note ? (
        <div
          aria-label="Übergabenotiz"
          className={`ticket-support-level__handover ticket-support-level__handover--${handover.kind}`}
        >
          <p className="ticket-support-level__handover-title">
            {handover.kind === "returned"
              ? "Rückgabe mit Notiz"
              : "Übergabenotiz der vorherigen Stufe"}
          </p>
          <p className="ticket-support-level__handover-meta">
            {[
              handover.actorName,
              formatDate(handover.createdAt),
              handover.fromLevel
                ? `von ${supportLevelLabel(handover.fromLevel)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="ticket-support-level__note">{handover.note}</p>
        </div>
      ) : null}

      {state.history.length > 0 ? (
        <details className="ticket-support-level__history">
          <summary>Verlauf der Stufen ({state.history.length})</summary>
          <ol>
            {state.history.map((entry) => (
              <li key={entry.id}>
                <strong>{levelChangeText(entry)}</strong>
                <span>
                  {[entry.actorName, formatDate(entry.createdAt)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {entry.note && entry.id !== handover?.id ? (
                  <p className="ticket-support-level__note">{entry.note}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {mode && state.currentLevel ? (
        <HandoverDialog
          currentLevel={state.currentLevel}
          mode={mode}
          onClose={() => setMode(null)}
          onDone={(text) => {
            setMode(null);
            setMessage(text);
            onChanged();
            void load();
          }}
          tenantId={tenantId}
          ticketId={ticketId}
        />
      ) : null}
    </Wrapper>
  );
}

function HandoverDialog({
  currentLevel,
  mode,
  onClose,
  onDone,
  tenantId,
  ticketId,
}: {
  currentLevel: SupportLevel;
  mode: HandoverMode;
  onClose: () => void;
  onDone: (message: string) => void;
  tenantId: string;
  ticketId: string;
}) {
  const [teamId, setTeamId] = useState(
    mode.teams.length === 1 ? (mode.teams[0]?.id ?? "") : "",
  );
  const [agentId, setAgentId] = useState("");
  const [agents, setAgents] = useState<{ id: string; displayName: string }[]>(
    [],
  );
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const label = supportLevelLabel(mode.level);
  const noteError = handoverNoteError(note);

  useEffect(() => {
    setAgentId("");
    setAgents([]);
    if (!teamId) return;
    let active = true;
    setAgentsLoading(true);
    loadLevelTeamAgents(tenantId, ticketId, teamId)
      .then((next) => {
        if (active) setAgents(next);
      })
      .catch(() => {
        if (active) setAgents([]);
      })
      .finally(() => {
        if (active) setAgentsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [teamId, tenantId, ticketId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  async function submit() {
    setTouched(true);
    if (!teamId) {
      setError(
        tn(
          `Bitte wähle ein Team der Stufe ${label}.`,
          `Bitte wählen Sie ein Team der Stufe ${label}.`,
        ),
      );
      return;
    }
    if (noteError) return;
    setSaving(true);
    setError("");
    try {
      await handOverTicketLevel({
        tenantId,
        ticketId,
        targetTeamId: teamId,
        targetAgentId: agentId || null,
        note,
        expectedLevel: currentLevel,
      });
      const team = mode.teams.find((item) => item.id === teamId)?.name ?? "";
      onDone(
        mode.direction === "escalated"
          ? `Das Ticket wurde an ${label} (${team}) übergeben.`
          : `Das Ticket wurde an ${label} (${team}) zurückgegeben.`,
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Übergabe konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="ticket-support-level__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
      role="presentation"
    >
      <div
        aria-labelledby="ticket-support-level-dialog-heading"
        aria-modal="true"
        className="ticket-support-level__dialog"
        role="dialog"
      >
        <div className="ticket-support-level__dialog-heading">
          <div>
            <p className="eyebrow">
              {mode.direction === "escalated"
                ? "AN NÄCHSTE STUFE ÜBERGEBEN"
                : `ZURÜCK AN STUFE ${mode.level}`}
            </p>
            <h3 id="ticket-support-level-dialog-heading">
              {supportLevelLabel(currentLevel)} → {label}
            </h3>
            <p className="ticket-support-level__muted">
              Die Notiz wird als interner Kommentar gespeichert und der
              übernehmenden Stufe hervorgehoben angezeigt.
            </p>
          </div>
          <button
            aria-label="Dialog schliessen"
            className="more-button"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        {error ? (
          <p className="ticket-detail-message error" role="alert">
            <AlertCircle aria-hidden="true" size={17} />
            {error}
          </p>
        ) : null}

        <form
          className="ticket-support-level__form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label>
            Team ({label})
            <select
              disabled={saving}
              onChange={(event) => setTeamId(event.target.value)}
              required
              value={teamId}
            >
              <option value="">Team auswählen</option>
              {mode.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Person (optional)
            <select
              disabled={saving || !teamId || agentsLoading}
              onChange={(event) => setAgentId(event.target.value)}
              value={agentId}
            >
              <option value="">
                {agentsLoading ? "Personen werden geladen …" : "Ganzes Team"}
              </option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="ticket-support-level__note-field">
            Übergabenotiz (Pflicht)
            <textarea
              aria-invalid={touched && Boolean(noteError)}
              disabled={saving}
              maxLength={HANDOVER_NOTE_MAX}
              onBlur={() => setTouched(true)}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Was wurde bereits versucht? Welche Erkenntnisse, Logs oder Fehlermeldungen liegen vor?"
              rows={6}
              value={note}
            />
            <small
              className={
                touched && noteError
                  ? "ticket-support-level__error"
                  : "ticket-support-level__muted"
              }
            >
              {touched && noteError
                ? noteError
                : `${Array.from(note.trim()).length} / ${HANDOVER_NOTE_MAX} Zeichen`}
            </small>
          </label>
          <div className="ticket-support-level__dialog-footer">
            <button
              className="secondary-button"
              disabled={saving}
              onClick={onClose}
              type="button"
            >
              Abbrechen
            </button>
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-support-level__spin"
                  size={15}
                />
              ) : null}
              {mode.direction === "escalated"
                ? `An ${label} übergeben`
                : `Zurück an ${label}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
