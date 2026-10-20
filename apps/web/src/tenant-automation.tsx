import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Play, RefreshCw } from "lucide-react";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";

type PolicyKey =
  | "follow_up"
  | "auto_close"
  | "duplicate_warning"
  | "data_hygiene"
  | "quality_check"
  | "compliance_warning"
  | "operations_report";
type Policy = {
  key: PolicyKey;
  enabled: boolean;
  afterDays: number;
  requirePreview: boolean;
  updatedAt: string | null;
};
type Preview = {
  key: PolicyKey;
  enabled: boolean;
  afterDays: number;
  requirePreview: boolean;
  summary: string;
  count: number;
  examples: Array<{ id: string; ticketNumber: string; subject: string }>;
};
type AutoCloseConfirmation = {
  candidateCount: number;
  expiresAt: string;
};
type RunHistory = {
  id: string;
  policyKey: PolicyKey;
  mode: "preview" | "manual" | "scheduled";
  createdAt: string;
  requested: number | null;
  updated: number | null;
};

const LABELS: Record<PolicyKey, { title: string; text: string }> = {
  follow_up: {
    title: "Nachfassaufgaben",
    text: "Markiert offene Tickets ohne aktuelle Aktivität für ein Nachfassen.",
  },
  auto_close: {
    title: "Kontrollierte automatische Schliessung",
    text: "Schliesst nur einzeln geprüfte, gelöste Tickets nach einer Wartezeit und einer ausdrücklichen Bestätigung.",
  },
  duplicate_warning: {
    title: "Duplikatwarnungen",
    text: "Findet ähnliche offene Ticketbetreffe zur manuellen Prüfung und Verknüpfung.",
  },
  data_hygiene: {
    title: "Datenhygiene",
    text: "Findet offene Tickets ohne Kategorie oder Anfragende Person.",
  },
  quality_check: {
    title: "Qualitätschecks",
    text: "Ermittelt abgeschlossene Tickets ohne interne Qualitätsprüfung.",
  },
  compliance_warning: {
    title: "Compliancewarnungen",
    text: "Markiert Tickets, deren Anfragendenzuordnung fehlt.",
  },
  operations_report: {
    title: "Betriebsbericht",
    text: "Bereitet den aktuellen Ticketbestand für den mandantenbezogenen Betriebsbericht auf.",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asPolicy(value: unknown): Policy | null {
  if (
    !isRecord(value) ||
    typeof value.key !== "string" ||
    !(value.key in LABELS) ||
    typeof value.enabled !== "boolean" ||
    typeof value.afterDays !== "number" ||
    typeof value.requirePreview !== "boolean"
  )
    return null;
  return {
    key: value.key as PolicyKey,
    enabled: value.enabled,
    afterDays: value.afterDays,
    requirePreview: value.requirePreview,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}
function asPreview(value: unknown): Preview | null {
  if (!isRecord(value)) return null;
  const policy = asPolicy(value);
  if (
    !policy ||
    typeof value.summary !== "string" ||
    typeof value.count !== "number" ||
    !Array.isArray(value.examples)
  )
    return null;
  const examples = value.examples
    .filter(isRecord)
    .flatMap((row) =>
      typeof row.id === "string" &&
      typeof row.ticketNumber === "string" &&
      typeof row.subject === "string"
        ? [{ id: row.id, ticketNumber: row.ticketNumber, subject: row.subject }]
        : [],
    );
  return { ...policy, summary: value.summary, count: value.count, examples };
}
function asConfirmation(value: unknown): AutoCloseConfirmation | null {
  if (
    !isRecord(value) ||
    typeof value.candidateCount !== "number" ||
    !Number.isInteger(value.candidateCount) ||
    value.candidateCount < 1 ||
    value.candidateCount > 8 ||
    typeof value.expiresAt !== "string"
  )
    return null;
  return value as AutoCloseConfirmation;
}
function asHistory(value: unknown): RunHistory | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.policyKey !== "string" ||
    !(value.policyKey in LABELS) ||
    (value.mode !== "preview" &&
      value.mode !== "manual" &&
      value.mode !== "scheduled") ||
    typeof value.createdAt !== "string"
  )
    return null;
  const count = (candidate: unknown) =>
    typeof candidate === "number" &&
    Number.isInteger(candidate) &&
    candidate >= 0 &&
    candidate <= 50
      ? candidate
      : null;
  return {
    id: value.id,
    policyKey: value.policyKey as PolicyKey,
    mode: value.mode,
    createdAt: value.createdAt,
    requested: count(value.requested),
    updated: count(value.updated),
  };
}
async function request<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase)
    throw new Error("Die Automatisierungssteuerung ist nicht verfügbar.");
  const { data, error } = await supabase.functions.invoke("ticket-automation", {
    body,
  });
  if (error) throw error;
  if (!isRecord(data) || !isRecord(data.data))
    throw new Error("Die Automatisierungsantwort ist unvollständig.");
  return data.data as T;
}

export function TenantAutomation({ tenantId }: { tenantId: string }) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [history, setHistory] = useState<RunHistory[]>([]);
  const [autoCloseConfirmation, setAutoCloseConfirmation] =
    useState<AutoCloseConfirmation | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingKey, setPendingKey] = useState<PolicyKey | "preview" | null>(
    null,
  );
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const result = await request<{ policies?: unknown; history?: unknown }>({
        type: "get",
        tenantId,
      });
      const next = Array.isArray(result.policies)
        ? result.policies
            .map(asPolicy)
            .filter((policy): policy is Policy => policy !== null)
        : [];
      setPolicies(next);
      setHistory(
        Array.isArray(result.history)
          ? result.history
              .map(asHistory)
              .filter((run): run is RunHistory => run !== null)
          : [],
      );
    } catch (error) {
      setMessage(
        await functionErrorMessage(
          error,
          "Die Automatisierungsregeln konnten nicht geladen werden.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(
    policy: Policy,
    change: Partial<Pick<Policy, "enabled" | "afterDays" | "requirePreview">>,
  ) {
    const next = { ...policy, ...change };
    setPendingKey(policy.key);
    setMessage("");
    try {
      const result = await request<{ policy?: unknown }>({
        type: "save",
        tenantId,
        policyKey: next.key,
        enabled: next.enabled,
        afterDays: next.afterDays,
        requirePreview: next.requirePreview,
      });
      const saved = asPolicy(result.policy);
      if (!saved) throw new Error("Die gespeicherte Regel ist unvollständig.");
      setPolicies((current) =>
        current.map((entry) => (entry.key === saved.key ? saved : entry)),
      );
      setPreviews([]);
      setAutoCloseConfirmation(null);
    } catch (error) {
      setMessage(
        await functionErrorMessage(
          error,
          "Die Automatisierungsregel konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setPendingKey(null);
    }
  }

  async function preview() {
    setPendingKey("preview");
    setMessage("");
    try {
      const result = await request<{
        previews?: unknown;
        autoCloseConfirmation?: unknown;
      }>({
        type: "preview",
        tenantId,
      });
      const next = Array.isArray(result.previews)
        ? result.previews
            .map(asPreview)
            .filter((entry): entry is Preview => entry !== null)
        : [];
      setPreviews(next);
      setAutoCloseConfirmation(asConfirmation(result.autoCloseConfirmation));
      setMessage(
        "Die Vorschau wurde erstellt. Es wurden keine Tickets verändert.",
      );
    } catch (error) {
      setMessage(
        await functionErrorMessage(
          error,
          "Die Automatisierungsvorschau konnte nicht erstellt werden.",
        ),
      );
    } finally {
      setPendingKey(null);
    }
  }

  async function executeAutoClose(confirmation: AutoCloseConfirmation) {
    if (
      !window.confirm(
        `${confirmation.candidateCount} in dieser Vorschau angezeigte Tickets werden jetzt geschlossen. Die Freigabe läuft in wenigen Minuten ab; alle Tickets werden unmittelbar davor erneut geprüft und der Lauf wird protokolliert. Fortfahren?`,
      )
    )
      return;
    setPendingKey("preview");
    setMessage("");
    try {
      const result = await request<{ updated?: unknown; requested?: unknown }>({
        type: "executeAutoClose",
        tenantId,
      });
      if (
        typeof result.updated !== "number" ||
        typeof result.requested !== "number"
      )
        throw new Error("Die Rückmeldung der Schliessung ist unvollständig.");
      await load();
      setPreviews([]);
      setAutoCloseConfirmation(null);
      setMessage(
        `${result.updated} von ${result.requested} geprüften Tickets wurden geschlossen.`,
      );
    } catch (error) {
      setAutoCloseConfirmation(null);
      setMessage(
        await functionErrorMessage(
          error,
          "Die vorgemerkten Tickets konnten nicht geschlossen werden. Bitte prüfen Sie die Vorschau erneut.",
        ),
      );
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <section
      className="tenant-automation"
      aria-labelledby="tenant-automation-heading"
    >
      <div className="tenant-automation__heading">
        <div>
          <p className="eyebrow">BETRIEBSREGELN</p>
          <h2 id="tenant-automation-heading">Automatisierungen</h2>
          <p>
            Aktiviere Regeln pro Mandant und prüfe ihre Wirkung zuerst als
            Vorschau. Nur die kontrollierte Schliessung kann nach einer kurzen,
            personen- und mandantengebundenen Freigabe ausgeführt werden. Alle
            übrigen Regeln bleiben bewusst Hinweise; kein Scheduler oder
            externer Provider wird dadurch aktiviert.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={pendingKey === "preview" || loading}
          onClick={() => void preview()}
          type="button"
        >
          {pendingKey === "preview" ? (
            <LoaderCircle
              aria-hidden="true"
              className="ticket-detail-spinner"
              size={16}
            />
          ) : (
            <Play aria-hidden="true" size={16} />
          )}{" "}
          Vorschau ausführen
        </button>
      </div>
      {message && (
        <p className="tenant-automation__message" role="status">
          {message}
        </p>
      )}
      {loading ? (
        <p className="empty-state">
          <LoaderCircle
            aria-hidden="true"
            className="ticket-detail-spinner"
            size={16}
          />{" "}
          Regeln werden geladen …
        </p>
      ) : (
        <ul className="tenant-automation__list">
          {policies.map((policy) => (
            <li key={policy.key}>
              <div className="tenant-automation__policy">
                <div>
                  <strong>{LABELS[policy.key].title}</strong>
                  <span>{LABELS[policy.key].text}</span>
                </div>
                <label className="tenant-automation__switch">
                  <input
                    checked={policy.enabled}
                    disabled={pendingKey === policy.key}
                    onChange={(event) =>
                      void save(policy, { enabled: event.target.checked })
                    }
                    type="checkbox"
                  />
                  <span>{policy.enabled ? "Aktiv" : "Inaktiv"}</span>
                </label>
              </div>
              <div className="tenant-automation__controls">
                <label>
                  Prüfintervall in Tagen
                  <input
                    disabled={pendingKey === policy.key}
                    max={365}
                    min={1}
                    onBlur={(event) => {
                      const afterDays = Number(event.target.value);
                      if (
                        Number.isInteger(afterDays) &&
                        afterDays !== policy.afterDays &&
                        afterDays >= 1 &&
                        afterDays <= 365
                      )
                        void save(policy, { afterDays });
                      else event.target.value = String(policy.afterDays);
                    }}
                    type="number"
                    defaultValue={policy.afterDays}
                  />
                </label>
                {policy.key === "auto_close" && (
                  <p className="tenant-automation__preview-required">
                    Vorschau und ausdrückliche Bestätigung sind immer
                    erforderlich.
                  </p>
                )}
              </div>
              {previews.find((preview) => preview.key === policy.key) &&
                (() => {
                  const current = previews.find(
                    (preview) => preview.key === policy.key,
                  )!;
                  return (
                    <div className="tenant-automation__preview">
                      <strong>{current.count} Treffer</strong>
                      <span>{current.summary}</span>
                      {current.examples.length > 0 && (
                        <ul>
                          {current.examples.map((ticket) => (
                            <li key={ticket.id}>
                              <b>{ticket.ticketNumber}</b> {ticket.subject}
                            </li>
                          ))}
                        </ul>
                      )}
                      {current.key === "auto_close" &&
                        current.enabled &&
                        current.count > 0 &&
                        autoCloseConfirmation && (
                          <>
                            <p className="tenant-automation__confirmation-note">
                              Nur die {autoCloseConfirmation.candidateCount}{" "}
                              oben aufgeführten Tickets sind bis{" "}
                              {new Date(
                                autoCloseConfirmation.expiresAt,
                              ).toLocaleTimeString("de-CH", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}{" "}
                              für eine erneute Prüfung vorgemerkt.
                            </p>
                            <button
                              className="secondary-button tenant-automation__execute"
                              disabled={pendingKey !== null}
                              onClick={() =>
                                void executeAutoClose(autoCloseConfirmation)
                              }
                              type="button"
                            >
                              Prüfung bestätigen und schliessen
                            </button>
                          </>
                        )}
                    </div>
                  );
                })()}
            </li>
          ))}
        </ul>
      )}
      <section
        className="tenant-automation__history"
        aria-labelledby="tenant-automation-history-heading"
      >
        <h3 id="tenant-automation-history-heading">
          Letzte kontrollierte Läufe
        </h3>
        {history.length === 0 ? (
          <p>Es liegen noch keine Vorschau- oder Ausführungsläufe vor.</p>
        ) : (
          <ul>
            {history.map((run) => (
              <li key={run.id}>
                <div>
                  <strong>{LABELS[run.policyKey].title}</strong>
                  <span>
                    {run.mode === "manual"
                      ? "Manuell bestätigt"
                      : run.mode === "preview"
                        ? "Vorschau"
                        : "Geplant"}
                  </span>
                </div>
                <small>
                  {new Date(run.createdAt).toLocaleString("de-CH", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                  {run.requested !== null &&
                    ` · ${run.updated ?? 0} von ${run.requested} umgesetzt`}
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>
      <button
        className="text-button"
        disabled={loading}
        onClick={() => void load()}
        type="button"
      >
        <RefreshCw aria-hidden="true" size={15} /> Aktualisieren
      </button>
    </section>
  );
}
