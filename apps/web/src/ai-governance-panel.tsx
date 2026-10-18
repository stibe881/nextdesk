import { useEffect, useState } from "react";
import { Bot, Check, CircleAlert, ShieldCheck } from "lucide-react";
import { supabase } from "./lib/supabase";
import "./self-service.css";

type AiPurpose =
  "general_draft" | "ticket_reply_draft" | "knowledge_article_draft";

type AiCapabilities = {
  draftRequestsEnabled: boolean;
  providerInvocation: boolean;
  purposes: AiPurpose[];
  limits: {
    maxInputCharacters: number;
    maxOutputTokens: number;
    maxCostCents: number;
    maxRequestsPerHour: number;
  };
};

type CapabilityState =
  | { status: "loading" }
  | { status: "ready"; capabilities: AiCapabilities }
  | { status: "unavailable"; message: string };

const PLANNED_PURPOSES: ReadonlyArray<{ key: AiPurpose; label: string }> = [
  { key: "general_draft", label: "Allgemeine Entwürfe" },
  { key: "ticket_reply_draft", label: "Antwortentwürfe für Tickets" },
  {
    key: "knowledge_article_draft",
    label: "Entwürfe für Wissensartikel",
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPurpose(value: unknown): value is AiPurpose {
  return (
    value === "general_draft" ||
    value === "ticket_reply_draft" ||
    value === "knowledge_article_draft"
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseCapabilities(value: unknown): AiCapabilities {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("invalid_ai_capabilities");
  }
  const data = value.data;
  if (
    typeof data.draftRequestsEnabled !== "boolean" ||
    data.providerInvocation !== false ||
    !Array.isArray(data.purposes) ||
    !data.purposes.every(isPurpose) ||
    new Set(data.purposes).size !== data.purposes.length ||
    !isRecord(data.limits) ||
    !isPositiveInteger(data.limits.maxInputCharacters) ||
    !isPositiveInteger(data.limits.maxOutputTokens) ||
    !isPositiveInteger(data.limits.maxCostCents) ||
    !isPositiveInteger(data.limits.maxRequestsPerHour)
  ) {
    throw new Error("invalid_ai_capabilities");
  }

  return {
    draftRequestsEnabled: data.draftRequestsEnabled,
    providerInvocation: data.providerInvocation,
    purposes: data.purposes,
    limits: {
      maxInputCharacters: data.limits.maxInputCharacters,
      maxOutputTokens: data.limits.maxOutputTokens,
      maxCostCents: data.limits.maxCostCents,
      maxRequestsPerHour: data.limits.maxRequestsPerHour,
    },
  };
}

async function functionErrorCode(error: unknown): Promise<string | null> {
  if (!isRecord(error) || !(error.context instanceof Response)) return null;
  try {
    const body: unknown = await error.context.clone().json();
    return isRecord(body) &&
      isRecord(body.error) &&
      typeof body.error.code === "string"
      ? body.error.code
      : null;
  } catch {
    return null;
  }
}

function unavailableMessage(code: string | null): string {
  switch (code) {
    case "ai_feature_disabled":
      return "KI-Assistenz ist für diesen Mandanten nicht aktiviert.";
    case "ai_provider_not_approved":
      return "Noch nicht einsatzbereit: Die erforderliche Anbieterfreigabe liegt nicht vor oder ist nicht mehr gültig.";
    case "ai_purpose_not_approved":
      return "Noch nicht einsatzbereit: Für die vorgesehenen Zwecke liegt keine gültige Freigabe vor.";
    case "ai_governance_unavailable":
      return "Der Governance-Status kann im Moment nicht zuverlässig geprüft werden. KI-Assistenz bleibt bis zur erfolgreichen Prüfung nicht verfügbar.";
    case "tenant_feature_lookup_failed":
    case "authorization_check_failed":
      return "Der Status der KI-Assistenz kann im Moment nicht geprüft werden.";
    default:
      return "Der Status der KI-Assistenz ist im Moment nicht verfügbar. Es werden keine KI-Anfragen vorbereitet.";
  }
}

export function AiGovernancePanel({ tenantId }: { tenantId: string }) {
  const [state, setState] = useState<CapabilityState>({ status: "loading" });

  useEffect(() => {
    if (!supabase) {
      setState({
        status: "unavailable",
        message:
          "Der Governance-Status ist in dieser Umgebung nicht konfiguriert. Es werden keine KI-Anfragen vorbereitet.",
      });
      return;
    }

    let mounted = true;
    setState({ status: "loading" });
    void supabase.functions
      .invoke("ai-assist", { body: { type: "getCapabilities", tenantId } })
      .then(({ data, error }) => {
        if (error) throw error;
        const capabilities = parseCapabilities(data);
        if (mounted) setState({ status: "ready", capabilities });
      })
      .catch(async (error: unknown) => {
        if (!mounted) return;
        setState({
          status: "unavailable",
          message: unavailableMessage(await functionErrorCode(error)),
        });
      });

    return () => {
      mounted = false;
    };
  }, [tenantId]);

  const approvedPurposes =
    state.status === "ready" ? new Set(state.capabilities.purposes) : new Set();

  return (
    <section
      aria-labelledby="ai-governance-heading"
      className="ai-governance-panel"
    >
      <div className="ai-governance-panel__heading">
        <Bot aria-hidden="true" size={22} strokeWidth={1.8} />
        <div>
          <p className="ai-governance-panel__eyebrow">GOVERNANCE</p>
          <h2 id="ai-governance-heading">KI-Assistenz</h2>
          <p>
            KI-Unterstützung erstellt ausschliesslich vorbereitete Entwürfe.
            Anbieterfreigabe, Datenschutzentscheid und Zweckbindung müssen vor
            jeder Nutzung gültig sein.
          </p>
        </div>
      </div>

      <div className="ai-governance-panel__status" role="status">
        <ShieldCheck aria-hidden="true" size={19} strokeWidth={1.8} />
        <div>
          <strong>
            {state.status === "loading"
              ? "Governance-Status wird geprüft"
              : state.status === "ready"
                ? "Entwürfe sind gemäss aktueller Mandantenfreigabe vorbereitet"
                : "KI-Assistenz derzeit nicht verfügbar"}
          </strong>
          <p>
            {state.status === "loading"
              ? "Die serverseitigen Fähigkeiten werden abgerufen …"
              : state.status === "ready"
                ? "Es erfolgt kein externer Provideraufruf über diese Funktion."
                : state.message}
          </p>
        </div>
      </div>

      <div className="ai-governance-panel__content">
        <div>
          <h3>Vorgesehene Zwecke</h3>
          <ul className="ai-governance-panel__purpose-list">
            {PLANNED_PURPOSES.map((purpose) => {
              const approved = approvedPurposes.has(purpose.key);
              return (
                <li key={purpose.key}>
                  <Check aria-hidden="true" size={16} strokeWidth={2} />
                  <span>{purpose.label}</span>
                  <small>
                    {state.status === "ready"
                      ? approved
                        ? "Aktuell freigegeben"
                        : "Nicht freigegeben"
                      : "Freigabe wird serverseitig geprüft"}
                  </small>
                </li>
              );
            })}
          </ul>
        </div>
        {state.status === "ready" ? (
          <dl className="ai-governance-panel__limits">
            <div>
              <dt>Eingabe</dt>
              <dd>
                max. {state.capabilities.limits.maxInputCharacters} Zeichen
              </dd>
            </div>
            <div>
              <dt>Entwurf</dt>
              <dd>max. {state.capabilities.limits.maxOutputTokens} Token</dd>
            </div>
            <div>
              <dt>Budget</dt>
              <dd>
                max. {state.capabilities.limits.maxCostCents} Rp. je Anfrage
              </dd>
            </div>
            <div>
              <dt>Stundenlimit</dt>
              <dd>
                max. {state.capabilities.limits.maxRequestsPerHour} Anfragen
              </dd>
            </div>
          </dl>
        ) : null}
      </div>

      <aside className="ai-governance-panel__safety-note">
        <CircleAlert aria-hidden="true" size={18} strokeWidth={1.8} />
        <p>
          KI-Ergebnisse bleiben immer Entwürfe. nextDesk ändert dadurch nie
          automatisch Tickets, Status, Rollen oder Wissen. Dieses Panel
          aktiviert keinen Anbieter und nimmt keine Schlüssel entgegen.
        </p>
      </aside>
    </section>
  );
}
