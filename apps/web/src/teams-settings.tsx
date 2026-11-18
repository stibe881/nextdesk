import { tn } from "./lib/formality";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";

/** Einstellungen → Funktionen → «Microsoft Teams im Shop» (Mandanten-Administration). */

type TeamsSettingsView = {
  settings: { maxLifetimeMonths: number; allowGuests: boolean };
  platformConfigured: boolean;
  ssoConfigured: boolean;
  consentUrl: string | null;
  requiredRoles: string[];
  guestRole: string;
};

type CheckResult = {
  state: string;
  missingRoles: string[];
  consentUrl: string | null;
  requiredRoles: string[];
};

const stateText = (): Record<string, { ok: boolean; text: string }> => ({
  ok: { ok: true, text: "Verbindung in Ordnung: alle Rechte sind erteilt." },
  guest_role_missing: {
    ok: false,
    text: "Fast bereit: Für Gäste fehlt das Recht User.Invite.All. Erteile es oder schalte Gäste unten aus.",
  },
  roles_missing: {
    ok: false,
    text: "Der Microsoft-Admin muss noch Rechte erteilen (siehe Liste).",
  },
  not_consented: {
    ok: false,
    text: tn(
      "Die nextDesk-App ist in deinem Microsoft-Mandanten noch nicht freigegeben. Der Microsoft-Admin muss die Zustimmung erteilen.",
      "Die nextDesk-App ist in Ihrem Microsoft-Mandanten noch nicht freigegeben. Der Microsoft-Admin muss die Zustimmung erteilen.",
    ),
  },
  sso_missing: {
    ok: false,
    text: tn(
      "SSO mit deiner eigenen Microsoft-Tenant-ID ist noch nicht eingerichtet.",
      "SSO mit Ihrer eigenen Microsoft-Tenant-ID ist noch nicht eingerichtet.",
    ),
  },
  platform_not_configured: {
    ok: false,
    text: "Die Plattform hat für Teams noch keine Microsoft-App hinterlegt. Bitte den Betreiber informieren.",
  },
  rate_limited: {
    ok: false,
    text: "Microsoft bremst gerade. Bitte in einer Minute erneut prüfen.",
  },
  unavailable: {
    ok: false,
    text: "Microsoft ist gerade nicht erreichbar. Bitte später erneut prüfen.",
  },
});

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("nextDesk ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("teams-settings", {
    body,
  });
  if (error)
    throw new Error("Die Teams-Einstellungen sind gerade nicht erreichbar.");
  return (data as { data: T }).data;
}

export function TeamsSettings({ tenantId }: { tenantId: string }) {
  const [view, setView] = useState<TeamsSettingsView | null>(null);
  const [months, setMonths] = useState(12);
  const [guests, setGuests] = useState(true);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState<"save" | "check" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await call<TeamsSettingsView>({ type: "get", tenantId });
      setView(next);
      setMonths(next.settings.maxLifetimeMonths);
      setGuests(next.settings.allowGuests);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Fehler beim Laden.",
      );
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy("save");
    setError("");
    setNotice("");
    try {
      await call({
        type: "save",
        tenantId,
        maxLifetimeMonths: months,
        allowGuests: guests,
      });
      setNotice("Einstellungen gespeichert.");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Speichern fehlgeschlagen.",
      );
    } finally {
      setBusy(null);
    }
  };

  const runCheck = async () => {
    setBusy("check");
    setError("");
    setNotice("");
    try {
      setCheck(await call<CheckResult>({ type: "check", tenantId }));
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Prüfung fehlgeschlagen.",
      );
    } finally {
      setBusy(null);
    }
  };

  if (!view) {
    return error ? (
      <p className="fk-error">{error}</p>
    ) : (
      <p className="empty-state">Wird geladen …</p>
    );
  }
  const result = check
    ? (stateText()[check.state] ?? { ok: false, text: "Unbekanntes Ergebnis." })
    : null;
  const link = check?.consentUrl ?? view.consentUrl;

  return (
    <div className="teams-settings">
      <p>
        Mitarbeitende bestellen im Shop neue Microsoft-Teams-Teams mit Laufzeit.
        Das Menü «Teams» zeigt und verwaltet alle Teams. Damit nextDesk Teams
        anlegen darf, muss der Microsoft-Admin der nextDesk-App einmalig Rechte
        erteilen.
      </p>

      <ol className="teams-settings__steps">
        <li>
          <strong>Funktion einschalten</strong> mit dem Schalter oben bei
          «Microsoft Teams im Shop».
        </li>
        <li>
          <strong>Zustimmung erteilen:</strong> Der Microsoft-Admin (Globaler
          Administrator) öffnet diesen Link und klickt «Akzeptieren».{" "}
          {link ? (
            <>
              <a href={link} rel="noreferrer" target="_blank">
                Zustimmungslink öffnen
              </a>{" "}
              <button
                className="text-button"
                onClick={() => void navigator.clipboard?.writeText(link)}
                type="button"
              >
                Link kopieren
              </button>
            </>
          ) : (
            <em>
              {view.ssoConfigured
                ? "Die Plattform hat noch keine Microsoft-App hinterlegt."
                : tn(
                    "Zuerst SSO mit deiner Tenant-ID einrichten.",
                    "Zuerst SSO mit Ihrer Tenant-ID einrichten.",
                  )}
            </em>
          )}
        </li>
        <li>
          <strong>Verbindung prüfen</strong> (nach ein paar Minuten):
          <div>
            <button
              className="secondary-button"
              disabled={busy !== null}
              onClick={() => void runCheck()}
              type="button"
            >
              {busy === "check" ? "Prüft …" : "Verbindung prüfen"}
            </button>
          </div>
          {result ? (
            <p
              className={
                result.ok ? "teams-settings__ok" : "teams-settings__bad"
              }
              role="status"
            >
              {result.text}
            </p>
          ) : null}
          {check && check.missingRoles.length > 0 ? (
            <p className="teams-settings__bad">
              Es fehlen: {check.missingRoles.join(", ")}
            </p>
          ) : null}
        </li>
      </ol>

      <details>
        <summary>Benötigte Microsoft-Rechte (Anwendungsberechtigungen)</summary>
        <p>
          {view.requiredRoles.join(", ")}; für Gäste zusätzlich {view.guestRole}
          .
        </p>
      </details>

      <div className="teams-settings__form">
        <label>
          Längste Laufzeit eines Teams (Monate)
          <input
            max={60}
            min={1}
            onChange={(event) => setMonths(Number(event.target.value))}
            type="number"
            value={months}
          />
        </label>
        <label className="teams-settings__check">
          <input
            checked={guests}
            onChange={(event) => setGuests(event.target.checked)}
            type="checkbox"
          />
          Gäste (externe Personen) dürfen eingeladen werden
        </label>
        <button
          className="primary-button"
          disabled={
            busy !== null ||
            !Number.isInteger(months) ||
            months < 1 ||
            months > 60
          }
          onClick={() => void save()}
          type="button"
        >
          {busy === "save" ? "Speichert …" : "Einstellungen speichern"}
        </button>
      </div>
      {notice ? (
        <p className="teams-settings__ok" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="fk-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
