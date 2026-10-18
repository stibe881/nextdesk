import {
  ArrowLeft,
  Download,
  KeyRound,
  Laptop,
  LoaderCircle,
  LogOut,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";

import { supabase } from "./lib/supabase";

type PersonalSettingsProps = {
  onBack: () => void;
  onSignOut: () => void;
  ssoEnforced: boolean;
  tenantId?: string;
  user: User;
};

type ProviderSummary = {
  canChangePassword: boolean;
  label: string;
  passwordNote: string;
};

type DataExport = {
  comments: unknown[];
  exportedAt: string;
  profile: Record<string, unknown> | null;
  tickets: unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDataExport(value: unknown): DataExport {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("invalid_requester_portal_response");
  }
  const exportedAt = value.data.exportedAt;
  const { comments, profile, tickets } = value.data;
  if (
    typeof exportedAt !== "string" ||
    Number.isNaN(new Date(exportedAt).getTime()) ||
    !Array.isArray(tickets) ||
    !Array.isArray(comments) ||
    (profile !== null && !isRecord(profile))
  ) {
    throw new Error("invalid_requester_portal_response");
  }
  return { comments, exportedAt, profile, tickets };
}

function providerSummary(user: User, ssoEnforced: boolean): ProviderSummary {
  const providers = new Set(
    (user.identities ?? [])
      .map((identity) => identity.provider?.toLocaleLowerCase("en-US"))
      .filter((provider): provider is string => Boolean(provider)),
  );
  const usesSso =
    ssoEnforced || providers.has("azure") || providers.has("saml");
  const hasEmailIdentity = providers.has("email");

  if (usesSso) {
    return {
      canChangePassword: false,
      label: "Microsoft Entra SSO",
      passwordNote:
        "Dieses Konto wird über den Unternehmens-Identitätsanbieter geschützt.",
    };
  }
  if (hasEmailIdentity) {
    return {
      canChangePassword: true,
      label: "E-Mail-Anmeldung",
      passwordNote:
        "Das Passwort gehört nur zu deinem persönlichen nextDesk-Konto.",
    };
  }
  return {
    canChangePassword: false,
    label: "Externer Identitätsanbieter",
    passwordNote:
      "Die Passwortverwaltung erfolgt über den verwendeten Identitätsanbieter.",
  };
}

export function PersonalSettings({
  onBack,
  onSignOut,
  ssoEnforced,
  tenantId,
  user,
}: PersonalSettingsProps) {
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const [exportState, setExportState] = useState<
    "idle" | "exporting" | "success" | "error"
  >("idle");
  const [exportMessage, setExportMessage] = useState("");
  const [otherSessionsState, setOtherSessionsState] = useState<
    "idle" | "confirming" | "signing-out" | "success" | "error"
  >("idle");
  const [otherSessionsMessage, setOtherSessionsMessage] = useState("");
  const provider = providerSummary(user, ssoEnforced);
  const email = user.email?.trim() || "Keine E-Mail-Adresse hinterlegt";

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!provider.canChangePassword || !supabase) return;
    setMessage("");
    if (password.length < 12) {
      setSaveState("error");
      setMessage("Das neue Passwort muss mindestens 12 Zeichen lang sein.");
      return;
    }
    if (password !== passwordConfirmation) {
      setSaveState("error");
      setMessage("Die Passwortbestätigung stimmt nicht überein.");
      return;
    }

    setSaveState("saving");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setSaveState("error");
      setMessage(
        "Das Passwort konnte nicht geändert werden. Bitte versuche es erneut.",
      );
      return;
    }
    setPassword("");
    setPasswordConfirmation("");
    setSaveState("success");
    setMessage("Dein Passwort wurde erfolgreich geändert.");
  }

  async function exportPersonalData() {
    if (!supabase || !tenantId || exportState === "exporting") {
      setExportState("error");
      setExportMessage(
        "Der Datenexport ist ohne aktiven Mandanten derzeit nicht verfügbar.",
      );
      return;
    }
    setExportState("exporting");
    setExportMessage("");
    try {
      const { data, error } = await supabase.functions.invoke(
        "requester-portal",
        {
          body: { tenantId, type: "exportMyData" },
        },
      );
      if (error) throw error;
      const exported = parseDataExport(data);
      const blob = new Blob([JSON.stringify(exported, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const date = exported.exportedAt.slice(0, 10) || "heute";
      link.href = downloadUrl;
      link.download = `nextDesk-meine-daten-${date}.json`;
      link.style.display = "none";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
      setExportState("success");
      setExportMessage("Deine Daten wurden als JSON-Datei heruntergeladen.");
    } catch {
      setExportState("error");
      setExportMessage(
        "Der Datenexport konnte nicht erstellt werden. Bitte versuche es später erneut.",
      );
    }
  }

  async function signOutOtherDevices() {
    if (!supabase || otherSessionsState === "signing-out") return;
    setOtherSessionsState("signing-out");
    setOtherSessionsMessage("");
    const { error } = await supabase.auth.signOut({ scope: "others" });
    if (error) {
      setOtherSessionsState("error");
      setOtherSessionsMessage(
        "Die anderen Geräte konnten nicht abgemeldet werden. Bitte versuche es später erneut.",
      );
      return;
    }
    setOtherSessionsState("success");
    setOtherSessionsMessage(
      "Alle anderen Geräte wurden abgemeldet. Diese Sitzung bleibt aktiv.",
    );
  }

  return (
    <section
      aria-labelledby="personal-settings-heading"
      className="personal-settings"
    >
      <header className="personal-settings__header">
        <div>
          <p className="eyebrow">MEIN KONTO</p>
          <h2 id="personal-settings-heading">Persönliche Einstellungen</h2>
          <p>
            Verwalte deine eigenen Zugangs- und Sicherheitsangaben. Diese Seite
            betrifft nur dein Konto, nicht die Mandanteneinstellungen.
          </p>
        </div>
        <button className="secondary-button" onClick={onBack} type="button">
          <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.8} />
          Zurück
        </button>
      </header>

      <div className="personal-settings__grid">
        <article className="personal-settings__card">
          <div className="personal-settings__card-heading">
            <span className="personal-settings__icon" aria-hidden="true">
              <Mail size={19} strokeWidth={1.9} />
            </span>
            <div>
              <h3>Profil und Anmeldung</h3>
              <p>
                Die E-Mail-Adresse wird aus deiner aktiven Anmeldung gelesen.
              </p>
            </div>
          </div>
          <dl className="personal-settings__details">
            <div>
              <dt>E-Mail-Adresse</dt>
              <dd>{email}</dd>
            </div>
            <div>
              <dt>Anmeldeart</dt>
              <dd className="personal-settings__provider">
                <ShieldCheck aria-hidden="true" size={15} strokeWidth={1.9} />
                {provider.label}
              </dd>
            </div>
          </dl>
        </article>

        {provider.canChangePassword ? (
          <article className="personal-settings__card">
            <div className="personal-settings__card-heading">
              <span
                className="personal-settings__icon personal-settings__icon--security"
                aria-hidden="true"
              >
                <KeyRound size={19} strokeWidth={1.9} />
              </span>
              <div>
                <h3>Passwort setzen oder ändern</h3>
                <p>{provider.passwordNote}</p>
              </div>
            </div>
            <form className="personal-settings__form" onSubmit={submitPassword}>
              <label>
                Neues Passwort
                <input
                  autoComplete="new-password"
                  disabled={saveState === "saving"}
                  minLength={12}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </label>
              <label>
                Neues Passwort bestätigen
                <input
                  autoComplete="new-password"
                  disabled={saveState === "saving"}
                  minLength={12}
                  onChange={(event) =>
                    setPasswordConfirmation(event.target.value)
                  }
                  required
                  type="password"
                  value={passwordConfirmation}
                />
              </label>
              <p className="personal-settings__hint">
                Mindestens 12 Zeichen. Das Passwort wird nicht angezeigt und nie
                in deinem Profil hinterlegt.
              </p>
              {message && (
                <p
                  aria-live="polite"
                  className={
                    saveState === "success"
                      ? "personal-settings__notice personal-settings__notice--success"
                      : "personal-settings__notice personal-settings__notice--error"
                  }
                  role="status"
                >
                  {message}
                </p>
              )}
              <button
                className="primary-button"
                disabled={saveState === "saving"}
                type="submit"
              >
                {saveState === "saving"
                  ? "Passwort wird geändert …"
                  : "Passwort ändern"}
              </button>
            </form>
          </article>
        ) : (
          <article className="personal-settings__card personal-settings__card--sso">
            <div className="personal-settings__card-heading">
              <span
                className="personal-settings__icon personal-settings__icon--security"
                aria-hidden="true"
              >
                <KeyRound size={19} strokeWidth={1.9} />
              </span>
              <div>
                <h3>Passwortverwaltung</h3>
                <p>{provider.passwordNote}</p>
              </div>
            </div>
            <p className="personal-settings__sso-copy">
              Für SSO-Konten steht keine lokale Passwortänderung zur Verfügung.
              Ändere dein Passwort direkt bei deinem Identitätsanbieter.
            </p>
          </article>
        )}
      </div>

      <section
        aria-labelledby="personal-privacy-heading"
        className="personal-settings__card"
      >
        <div className="personal-settings__card-heading">
          <span
            className="personal-settings__icon personal-settings__icon--security"
            aria-hidden="true"
          >
            <Download size={19} strokeWidth={1.9} />
          </span>
          <div>
            <h3 id="personal-privacy-heading">Datenschutz</h3>
            <p>
              Lade eine JSON-Datei mit deinen exportierbaren Profildaten,
              eigenen Tickets und externen Kommentaren herunter.
            </p>
          </div>
        </div>
        <button
          className="secondary-button"
          disabled={!tenantId || exportState === "exporting"}
          onClick={() => void exportPersonalData()}
          type="button"
        >
          {exportState === "exporting" ? (
            <LoaderCircle aria-hidden="true" size={17} strokeWidth={1.9} />
          ) : (
            <Download aria-hidden="true" size={17} strokeWidth={1.9} />
          )}
          {exportState === "exporting"
            ? "Daten werden vorbereitet …"
            : "Meine Daten exportieren"}
        </button>
        {!tenantId && (
          <p className="personal-settings__hint">
            Der Export wird verfügbar, sobald ein aktiver Mandant übergeben
            wird.
          </p>
        )}
        {exportMessage && (
          <p
            aria-live="polite"
            className={
              exportState === "success"
                ? "personal-settings__notice personal-settings__notice--success"
                : "personal-settings__notice personal-settings__notice--error"
            }
            role="status"
          >
            {exportMessage}
          </p>
        )}
      </section>

      <section
        aria-labelledby="personal-sessions-heading"
        className="personal-settings__card"
      >
        <div className="personal-settings__card-heading">
          <span
            className="personal-settings__icon personal-settings__icon--security"
            aria-hidden="true"
          >
            <Laptop size={19} strokeWidth={1.9} />
          </span>
          <div>
            <h3 id="personal-sessions-heading">Sitzungsverwaltung</h3>
            <p>
              Beende bei Bedarf alle anderen Sitzungen. Die Sitzung auf diesem
              Gerät bleibt bestehen.
            </p>
          </div>
        </div>
        {otherSessionsState === "confirming" ? (
          <div className="personal-settings__form">
            <p className="personal-settings__hint">
              Möchtest du dich wirklich auf allen anderen Geräten abmelden?
              Diese Aktion betrifft nicht die aktuelle Sitzung.
            </p>
            <button
              className="personal-settings__signout-button"
              onClick={() => void signOutOtherDevices()}
              type="button"
            >
              Alle anderen Geräte abmelden
            </button>
            <button onClick={() => setOtherSessionsState("idle")} type="button">
              Abbrechen
            </button>
          </div>
        ) : (
          <button
            className="secondary-button"
            disabled={otherSessionsState === "signing-out" || !supabase}
            onClick={() => {
              setOtherSessionsMessage("");
              setOtherSessionsState("confirming");
            }}
            type="button"
          >
            <Laptop aria-hidden="true" size={17} strokeWidth={1.9} />
            Auf allen anderen Geräten abmelden
          </button>
        )}
        {otherSessionsMessage && (
          <p
            aria-live="polite"
            className={
              otherSessionsState === "success"
                ? "personal-settings__notice personal-settings__notice--success"
                : "personal-settings__notice personal-settings__notice--error"
            }
            role="status"
          >
            {otherSessionsMessage}
          </p>
        )}
      </section>

      <article className="personal-settings__signout">
        <div>
          <strong>Sitzung beenden</strong>
          <span>Du wirst auf diesem Gerät von nextDesk abgemeldet.</span>
        </div>
        <button
          className="personal-settings__signout-button"
          onClick={onSignOut}
          type="button"
        >
          <LogOut aria-hidden="true" size={17} strokeWidth={1.9} />
          Abmelden
        </button>
      </article>
    </section>
  );
}
