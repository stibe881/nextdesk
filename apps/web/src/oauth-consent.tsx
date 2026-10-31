import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "./lib/supabase";

const STORAGE_KEY = "nextdesk:oauth-authorization-id";
const CONSENT_PATH = "/oauth/consent";
// Eine Anfrage des Auth-Servers ist nur kurz gültig; ältere Merkzettel verfallen.
const MAX_AGE_MS = 15 * 60 * 1000;

/**
 * Der Supabase-Auth-Server leitet Anwendungen wie den nextDesk-Connector auf
 * /oauth/consent?authorization_id=… weiter. Die ID wird gemerkt, weil die
 * Anmeldung (Microsoft-SSO) die Adresse zwischendurch verlässt.
 */
export function captureOAuthAuthorizationId(): void {
  try {
    if (!window.location.pathname.startsWith(CONSENT_PATH)) return;
    const id = new URLSearchParams(window.location.search).get(
      "authorization_id",
    );
    if (id && /^[A-Za-z0-9_-]{8,200}$/.test(id)) {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ id, savedAt: Date.now() }),
      );
    }
  } catch {
    // Ohne Speicherzugriff läuft der normale Anmeldeweg weiter.
  }
}

export function pendingOAuthAuthorizationId(): string | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored: unknown = JSON.parse(raw);
    if (
      isRecord(stored) &&
      typeof stored.id === "string" &&
      typeof stored.savedAt === "number" &&
      Date.now() - stored.savedAt < MAX_AGE_MS
    ) {
      return stored.id;
    }
    window.sessionStorage.removeItem(STORAGE_KEY);
    return null;
  } catch {
    return null;
  }
}

function clearPendingOAuthAuthorizationId(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nichts zu tun.
  }
}

type Details = {
  clientName: string;
  redirectHost: string;
  scopes: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SCOPE_LABELS: Record<string, string> = {
  email: "deine E-Mail-Adresse",
  openid: "deine Anmeldung bestätigen",
  profile: "deinen Namen",
};

export function OAuthConsentScreen({
  authorizationId,
  Shell,
  userLabel,
}: {
  authorizationId: string;
  Shell: (props: { children: ReactNode }) => ReactNode;
  userLabel: string;
}) {
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!supabase) {
        setError("Die Verbindung ist nicht konfiguriert.");
        return;
      }
      const { data, error: loadError } =
        await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (loadError || !isRecord(data)) {
        clearPendingOAuthAuthorizationId();
        setError(
          "Die Anfrage ist ungültig oder abgelaufen. Bitte starte die Verbindung im Programm erneut.",
        );
        return;
      }
      // Bereits früher zugelassen: direkt zurück zum Programm.
      if (
        !("authorization_id" in data) &&
        typeof data.redirect_url === "string"
      ) {
        clearPendingOAuthAuthorizationId();
        window.location.assign(data.redirect_url);
        return;
      }
      const record = data as unknown as Record<string, unknown>;
      const client = isRecord(record.client) ? record.client : {};
      let redirectHost = "";
      try {
        redirectHost = new URL(String(record.redirect_uri)).host;
      } catch {
        redirectHost = String(record.redirect_uri ?? "");
      }
      setDetails({
        clientName:
          typeof client.name === "string" && client.name.trim()
            ? client.name.trim()
            : "Eine Anwendung",
        redirectHost,
        scopes:
          typeof record.scope === "string"
            ? record.scope.split(" ").filter(Boolean)
            : [],
      });
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  // Meldet das aktuelle Konto ab. Die Anfrage bleibt gemerkt, nach der neuen
  // Anmeldung erscheint diese Seite wieder.
  async function switchAccount() {
    if (!supabase) return;
    setBusy(true);
    await supabase.auth.signOut();
    window.location.reload();
  }

  async function decide(approve: boolean) {
    if (!supabase) return;
    setBusy(true);
    setError("");
    const { data, error: decisionError } = approve
      ? await supabase.auth.oauth.approveAuthorization(authorizationId)
      : await supabase.auth.oauth.denyAuthorization(authorizationId);
    if (
      decisionError ||
      !isRecord(data) ||
      typeof data.redirect_url !== "string"
    ) {
      setBusy(false);
      setError("Die Entscheidung konnte nicht gespeichert werden.");
      return;
    }
    clearPendingOAuthAuthorizationId();
    window.location.assign(data.redirect_url);
  }

  return (
    <Shell>
      <p className="eyebrow">ZUGRIFF FREIGEBEN</p>
      <h2>
        {details
          ? `${details.clientName} verbinden?`
          : "Anfrage wird geladen …"}
      </h2>
      {details && (
        <>
          <p className="access-lead">
            {details.clientName} möchte als <strong>{userLabel}</strong> auf
            nextDesk zugreifen. Alle Aktionen laufen mit deinen Rechten und in
            deinem Namen.
          </p>
          <ul>
            <li>Tickets, Wissensartikel und Geräte lesen</li>
            <li>Tickets erfassen und interne Notizen schreiben</li>
            {details.scopes
              .filter((scope) => SCOPE_LABELS[scope])
              .map((scope) => (
                <li key={scope}>{SCOPE_LABELS[scope]}</li>
              ))}
          </ul>
          {details.redirectHost && (
            <p className="access-lead">
              Rückkehradresse: <code>{details.redirectHost}</code>
            </p>
          )}
          <button
            className="gross-sso-button"
            disabled={busy}
            onClick={() => void decide(true)}
            type="button"
          >
            ZULASSEN
          </button>
          <button
            className="email-access-button"
            disabled={busy}
            onClick={() => void decide(false)}
            type="button"
          >
            Ablehnen
          </button>
          <button
            className="access-toggle"
            disabled={busy}
            onClick={() => void switchAccount()}
            type="button"
          >
            Anderes Konto verwenden
          </button>
        </>
      )}
      {error && <p className="access-message error">{error}</p>}
      {error && !details && (
        <button
          className="email-access-button"
          onClick={() => {
            clearPendingOAuthAuthorizationId();
            window.location.assign("/");
          }}
          type="button"
        >
          Zur nextDesk-App
        </button>
      )}
    </Shell>
  );
}
