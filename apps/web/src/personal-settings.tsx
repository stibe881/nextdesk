import { ArrowLeft, KeyRound, LogOut, Mail, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";

import { supabase } from "./lib/supabase";

type PersonalSettingsProps = {
  onBack: () => void;
  onSignOut: () => void;
  ssoEnforced: boolean;
  user: User;
};

type ProviderSummary = {
  canChangePassword: boolean;
  label: string;
  passwordNote: string;
};

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
  user,
}: PersonalSettingsProps) {
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState("");
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
