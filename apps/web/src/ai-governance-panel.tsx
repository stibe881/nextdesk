import { useCallback, useEffect, useState } from "react";
import { Bot, Check, CircleAlert, ShieldCheck } from "lucide-react";
import { functionErrorMessage } from "./lib/function-error";
import {
  parseAiGovernanceApprovalResponse,
  type AiGovernanceApproval,
  type AiPurpose,
} from "./lib/ai-governance";
import { supabase } from "./lib/supabase";
import "./self-service.css";

type State =
  | { status: "loading" }
  | { status: "ready"; approval: AiGovernanceApproval }
  | { status: "unavailable"; message: string };

const PURPOSES: ReadonlyArray<{ key: AiPurpose; label: string }> = [
  { key: "general_draft", label: "Neue Wissensartikel aufbereiten" },
  {
    key: "knowledge_article_draft",
    label: "Bestehende Wissensartikel überarbeiten",
  },
];

export function AiGovernancePanel({ tenantId }: { tenantId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) {
      setState({
        status: "unavailable",
        message:
          "Die Governance-Einstellungen sind in dieser Umgebung nicht konfiguriert.",
      });
      return;
    }
    setState({ status: "loading" });
    try {
      const { data, error } = await supabase.functions.invoke<unknown>(
        "ai-assist",
        { body: { type: "getAdminConfiguration", tenantId } },
      );
      if (error) throw error;
      setState({
        status: "ready",
        approval: parseAiGovernanceApprovalResponse(data),
      });
    } catch (error) {
      setState({
        status: "unavailable",
        message: await functionErrorMessage(
          error,
          "Die Governance-Einstellungen konnten nicht geladen werden.",
        ),
      });
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveApproval(next: AiGovernanceApproval) {
    if (!supabase || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.functions.invoke("ai-assist", {
        body: {
          type: "setAnthropicApproval",
          tenantId,
          enabled: next.enabled,
          allowExternalArticleContent: next.allowExternalArticleContent,
        },
      });
      if (error) throw error;
      setState({ status: "ready", approval: next });
    } catch (error) {
      setState({
        status: "unavailable",
        message: await functionErrorMessage(
          error,
          "Die Anthropic-Freigabe konnte nicht gespeichert werden.",
        ),
      });
    } finally {
      setSaving(false);
    }
  }

  const approval = state.status === "ready" ? state.approval : null;
  return (
    <section
      aria-labelledby="ai-governance-heading"
      className="ai-governance-panel"
    >
      <div className="ai-governance-panel__heading">
        <Bot aria-hidden="true" size={22} strokeWidth={1.8} />
        <div>
          <p className="ai-governance-panel__eyebrow">EXTERNE KI-ANBINDUNG</p>
          <h2 id="ai-governance-heading">Claude für Wissensartikel</h2>
          <p>
            Anthropic kann Rohinhalt auf einen einheitlich strukturierten
            Markdown-Entwurf aufbereiten. Ein Aufruf erfolgt nur nach einem
            bewussten Klick im Wissenseditor.
          </p>
        </div>
      </div>

      {state.status === "unavailable" ? (
        <div className="ai-governance-panel__status" role="alert">
          <CircleAlert aria-hidden="true" size={19} strokeWidth={1.8} />
          <div>
            <strong>Anthropic ist derzeit nicht verfügbar</strong>
            <p>{state.message}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="ai-governance-panel__status" role="status">
            <ShieldCheck aria-hidden="true" size={19} strokeWidth={1.8} />
            <div>
              <strong>
                {state.status === "loading"
                  ? "Freigabe wird geprüft"
                  : !approval?.providerConfigured
                    ? "Die serverseitige Anthropic-Konfiguration ist unvollständig"
                    : approval.enabled
                      ? "Anthropic ist für Wissensentwürfe freigegeben"
                      : "Anthropic ist noch nicht freigegeben"}
              </strong>
              <p>
                {!approval?.providerConfigured
                  ? "API-Zugang oder Modell sind serverseitig noch nicht verfügbar. nextDesk übermittelt bis zur vollständigen Konfiguration keine Inhalte."
                  : "Zusätzlich muss die Funktion «KI-Assistenz» in den Einstellungen aktiviert sein. Ohne beides übermittelt nextDesk keine Inhalte."}
              </p>
            </div>
          </div>

          {approval ? (
            <div className="ai-governance-panel__content">
              <div>
                <h3>Freigabe für Wissensentwürfe</h3>
                <label className="ai-governance-panel__control">
                  <input
                    checked={approval.enabled}
                    disabled={saving}
                    onChange={(event) =>
                      void saveApproval({
                        ...approval,
                        enabled: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  <span>
                    Ich genehmige die Übermittlung von internem fachlichem
                    Rohinhalt an Anthropic, ausschliesslich für manuell
                    ausgelöste Wissensentwürfe.
                  </span>
                </label>
                <label className="ai-governance-panel__control">
                  <input
                    checked={approval.allowExternalArticleContent}
                    disabled={saving || !approval.enabled}
                    onChange={(event) =>
                      void saveApproval({
                        ...approval,
                        allowExternalArticleContent: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  <span>
                    Ich genehmige zusätzlich die Übermittlung von Rohinhalt für
                    externe Artikel an Anthropic.
                  </span>
                </label>
              </div>
              <div>
                <h3>Erlaubte Zwecke</h3>
                <ul className="ai-governance-panel__purpose-list">
                  {PURPOSES.map((purpose) => (
                    <li key={purpose.key}>
                      <Check aria-hidden="true" size={16} strokeWidth={2} />
                      <span>{purpose.label}</span>
                      <small>
                        {approval.allowedPurposes.includes(purpose.key) &&
                        approval.enabled
                          ? "Freigegeben"
                          : "Nicht freigegeben"}
                      </small>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </>
      )}

      <aside className="ai-governance-panel__safety-note">
        <CircleAlert aria-hidden="true" size={18} strokeWidth={1.8} />
        <p>
          API-Schlüssel und Modell bleiben ausschliesslich serverseitig. Der
          Rohinhalt wird nicht in nextDesk gespeichert, und das Ergebnis bleibt
          ein editierbarer Entwurf: Speichern, Sichtbarkeit, Prüfung und
          Veröffentlichung erfolgen weiterhin separat.
        </p>
      </aside>
    </section>
  );
}
