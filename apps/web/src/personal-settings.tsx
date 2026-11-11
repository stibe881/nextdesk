import {
  ArrowLeft,
  KeyRound,
  Laptop,
  LogOut,
  Mail,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Trash2,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";

import { HandbookCard, HandbookViewer } from "./handbooks";
import { deleteAccount } from "./lib/account";
import type { HandbookId } from "./lib/handbooks";
import { supabase } from "./lib/supabase";
import {
  DEFAULT_DELIVERY_WINDOW,
  deliveryWindowFromPreferences,
  getStatus,
  preferencesWithDeliveryWindow,
  pushCategoryMeta,
  pushNotificationsRequest,
  updatePreferences,
  type DeliveryWindow,
  type PushCategory,
  type PushDevice,
  type PushStatus,
} from "./lib/push-notifications";

type PersonalSettingsProps = {
  /** Plain employees: no password or data-export cards. */
  employeeView?: boolean;
  onBack: () => void;
  onOpenAppearance: () => void;
  onSignOut: () => void;
  ssoEnforced: boolean;
  tenantId?: string;
  user: User;
};

type ProviderSummary = {
  canChangePassword: boolean;
  /** Accounts managed by the organisation's identity provider. */
  usesSso: boolean;
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
      usesSso: true,
      label: "Microsoft Entra SSO",
      passwordNote:
        "Dieses Konto wird über den Unternehmens-Identitätsanbieter geschützt.",
    };
  }
  if (hasEmailIdentity) {
    return {
      canChangePassword: true,
      usesSso: false,
      label: "E-Mail-Anmeldung",
      passwordNote:
        "Das Passwort gehört nur zu deinem persönlichen nextDesk-Konto.",
    };
  }
  return {
    canChangePassword: false,
    usesSso: false,
    label: "Externer Identitätsanbieter",
    passwordNote:
      "Die Passwortverwaltung erfolgt über den verwendeten Identitätsanbieter.",
  };
}

function pushDisabledReasonLabel(reason: string | null | undefined): string {
  switch (reason?.trim()) {
    case "apns_unregistered":
      return "Von Apple abgemeldet, zum Beispiel nach dem Löschen der App.";
    case "device_registration_failed":
      return "Die Registrierung ist fehlgeschlagen.";
    case "apns_not_configured":
      return "Der Apple-Zugang ist noch nicht eingerichtet.";
    case undefined:
    case "":
      return "Grund nicht bekannt";
    default:
      return "Vom System deaktiviert.";
  }
}

function pushDateLabel(value: string | null): string {
  if (!value || Number.isNaN(new Date(value).getTime())) {
    return "nicht bekannt";
  }
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  }).format(new Date(value));
}

const WEEKDAYS: ReadonlyArray<{ day: number; short: string; long: string }> = [
  { day: 1, short: "Mo", long: "Montag" },
  { day: 2, short: "Di", long: "Dienstag" },
  { day: 3, short: "Mi", long: "Mittwoch" },
  { day: 4, short: "Do", long: "Donnerstag" },
  { day: 5, short: "Fr", long: "Freitag" },
  { day: 6, short: "Sa", long: "Samstag" },
  { day: 7, short: "So", long: "Sonntag" },
];

/** "Mo–Fr", "Mo, Mi, Fr" or "täglich". */
function weekdaysLabel(days: readonly number[]): string {
  const sorted = [...new Set(days)].sort((left, right) => left - right);
  if (sorted.length === 7) return "täglich";
  const short = (day: number) =>
    WEEKDAYS.find((entry) => entry.day === day)?.short ?? "";
  const first = sorted[0] ?? 1;
  const last = sorted[sorted.length - 1] ?? first;
  const consecutive = sorted.length >= 3 && last - first === sorted.length - 1;
  return consecutive
    ? `${short(first)}–${short(last)}`
    : sorted.map(short).join(", ");
}

function deliverySummary(window: DeliveryWindow): string {
  if (window.mode === "always") {
    return "Du erhältst Benachrichtigungen jederzeit.";
  }
  const allDay = window.startHour === 0 && window.endHour === 24;
  const days = weekdaysLabel(window.days);
  const when = allDay
    ? `${days === "täglich" ? "Täglich" : days} ganztags`
    : `${days === "täglich" ? "Täglich" : days} von ${workHourLabel(window.startHour)} bis ${workHourLabel(window.endHour)} Uhr`;
  return `${when}. Was ausserhalb dieser Zeit anfällt, kommt zu Beginn der nächsten Benachrichtigungszeit.`;
}

function workHourLabel(hour: number): string {
  return `${hour.toString().padStart(2, "0")}:00`;
}

export function PersonalSettings({
  employeeView = false,
  onBack,
  onOpenAppearance,
  onSignOut,
  ssoEnforced,
  tenantId,
  user,
}: PersonalSettingsProps) {
  const [openHandbook, setOpenHandbook] = useState<HandbookId | null>(null);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const [otherSessionsState, setOtherSessionsState] = useState<
    "idle" | "confirming" | "signing-out" | "success" | "error"
  >("idle");
  const [otherSessionsMessage, setOtherSessionsMessage] = useState("");
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [pushStatusState, setPushStatusState] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [pushMessage, setPushMessage] = useState("");
  const [pushMessageKind, setPushMessageKind] = useState<"success" | "error">(
    "success",
  );
  const [pendingDeviceRemoval, setPendingDeviceRemoval] =
    useState<PushDevice | null>(null);
  const [removingDeviceId, setRemovingDeviceId] = useState<string | null>(null);
  const [deliveryDraft, setDeliveryDraft] = useState<DeliveryWindow | null>(
    null,
  );
  const [deliverySaving, setDeliverySaving] = useState(false);
  const [pushPreferenceSaving, setPushPreferenceSaving] = useState<
    string | null
  >(null);
  const provider = providerSummary(user, ssoEnforced);
  const email = user.email?.trim() || "Keine E-Mail-Adresse hinterlegt";

  useEffect(() => {
    if (!tenantId) {
      setPushStatus(null);
      setPushStatusState("idle");
      setPushMessage("");
      setPendingDeviceRemoval(null);
      setDeliveryDraft(null);
      setPushPreferenceSaving(null);
      return;
    }

    let mounted = true;
    setPushStatusState("loading");
    setPushMessage("");
    void getStatus(tenantId)
      .then((nextStatus) => {
        if (!mounted) return;
        setPushStatus(nextStatus);
        setPushStatusState("loaded");
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setPushStatus(null);
        setPushStatusState("error");
        setPushMessageKind("error");
        setPushMessage(
          error instanceof Error && error.message
            ? error.message
            : "Push-Benachrichtigungen sind derzeit nicht verfügbar. Bitte versuche es später erneut.",
        );
      });

    return () => {
      mounted = false;
    };
  }, [tenantId]);

  async function removePushDevice() {
    if (!tenantId || !pendingDeviceRemoval || removingDeviceId) return;

    const device = pendingDeviceRemoval;
    setRemovingDeviceId(device.id);
    setPushMessage("");
    try {
      const result = await pushNotificationsRequest<{ removed: boolean }>({
        deviceId: device.id,
        tenantId,
        type: "unregisterDevice",
      });
      setPushStatus((current) =>
        current
          ? {
              ...current,
              devices: current.devices.filter(
                (currentDevice) => currentDevice.id !== device.id,
              ),
            }
          : current,
      );
      setPendingDeviceRemoval(null);
      setPushMessageKind("success");
      setPushMessage(
        result.removed
          ? "Das Gerät wurde für Push-Benachrichtigungen entfernt."
          : "Das Gerät war bereits entfernt.",
      );
    } catch (error) {
      setPushMessageKind("error");
      setPushMessage(
        error instanceof Error && error.message
          ? error.message
          : "Das Gerät konnte nicht entfernt werden. Bitte versuche es später erneut.",
      );
    } finally {
      setRemovingDeviceId(null);
    }
  }

  async function saveDeliveryWindow(window: DeliveryWindow) {
    if (!tenantId || !pushStatus || deliverySaving) return;
    // 00:00–24:00 is "all day"; only identical hours are invalid.
    if (window.mode === "window" && window.startHour === window.endHour) {
      setPushMessageKind("error");
      setPushMessage("Beginn und Ende dürfen nicht gleich sein.");
      return;
    }
    setDeliverySaving(true);
    setPushMessage("");
    try {
      const preferences = await updatePreferences(
        tenantId,
        preferencesWithDeliveryWindow(pushStatus.preferences, window),
      );
      setPushStatus((current) =>
        current ? { ...current, preferences } : current,
      );
      setDeliveryDraft(null);
      setPushMessageKind("success");
      setPushMessage("Deine Benachrichtigungszeit wurde gespeichert.");
    } catch (error) {
      setPushMessageKind("error");
      setPushMessage(
        error instanceof Error && error.message
          ? error.message
          : "Die Benachrichtigungszeit konnte nicht gespeichert werden. Bitte versuche es später erneut.",
      );
    } finally {
      setDeliverySaving(false);
    }
  }

  async function toggleNotification(
    category: PushCategory,
    channel: "push" | "email",
  ) {
    if (!tenantId || !pushStatus || pushPreferenceSaving !== null) return;
    const key = channel === "push" ? "enabledCategories" : "emailCategories";
    const selected = new Set(pushStatus.preferences[key]);
    if (selected.has(category)) selected.delete(category);
    else selected.add(category);

    setPushPreferenceSaving(`${category}:${channel}`);
    setPushMessage("");
    try {
      const preferences = await updatePreferences(tenantId, {
        ...pushStatus.preferences,
        [key]: [...selected],
      });
      setPushStatus((current) =>
        current ? { ...current, preferences } : current,
      );
      setPushMessageKind("success");
      setPushMessage("Deine Benachrichtigungen wurden gespeichert.");
    } catch (error) {
      setPushMessageKind("error");
      setPushMessage(
        error instanceof Error && error.message
          ? error.message
          : "Die Benachrichtigungen konnten nicht gespeichert werden. Bitte versuche es später erneut.",
      );
    } finally {
      setPushPreferenceSaving(null);
    }
  }

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

  if (openHandbook && tenantId) {
    return (
      <HandbookViewer
        handbookId={openHandbook}
        onBack={() => setOpenHandbook(null)}
        tenantId={tenantId}
      />
    );
  }

  return (
    <section
      aria-labelledby="personal-settings-heading"
      className="personal-settings"
    >
      <header className="personal-settings__header">
        <div>
          {/* The page title is shown in the top bar. */}
          <h2 className="sr-only" id="personal-settings-heading">
            Persönliche Einstellungen
          </h2>
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

        <article className="personal-settings__card">
          <div className="personal-settings__card-heading">
            <span className="personal-settings__icon" aria-hidden="true">
              <SlidersHorizontal size={19} strokeWidth={1.9} />
            </span>
            <div>
              <h3>Profil & Darstellung</h3>
              <p>
                Lege Farbschema, Startansicht, Kontrast und Bewegungsreduktion
                fest.
              </p>
            </div>
          </div>
          <button
            className="secondary-button"
            onClick={onOpenAppearance}
            type="button"
          >
            Darstellung anpassen
          </button>
        </article>

        {employeeView ? null : provider.canChangePassword ? (
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

      <HandbookCard onOpen={setOpenHandbook} tenantId={tenantId} />

      {tenantId &&
      (pushStatusState !== "loaded" ||
        pushStatus?.featureEnabled ||
        pushStatus?.emailAvailable ||
        (pushStatus?.devices.length ?? 0) > 0) ? (
        <section
          aria-labelledby="personal-push-heading"
          className="personal-settings__card personal-settings__push"
        >
          <div className="personal-settings__card-heading">
            <span
              className="personal-settings__icon personal-settings__icon--push"
              aria-hidden="true"
            >
              <Smartphone size={19} strokeWidth={1.9} />
            </span>
            <div>
              <h3 id="personal-push-heading">Benachrichtigungen</h3>
              <p>
                Wann und wie du informiert wirst: per Push auf dein iPhone oder
                per E-Mail.
              </p>
            </div>
          </div>

          {pushStatusState === "loading" ? (
            <p aria-live="polite" className="personal-settings__hint">
              Registrierte Geräte werden geladen …
            </p>
          ) : null}
          {pushStatusState === "loaded" && pushStatus
            ? (() => {
                const saved = deliveryWindowFromPreferences(
                  pushStatus.preferences,
                );
                const draft = deliveryDraft ?? saved;
                const draftWindow =
                  draft.mode === "window" ? draft : DEFAULT_DELIVERY_WINDOW;
                const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
                return (
                  <section
                    aria-labelledby="personal-push-window-heading"
                    className="personal-settings__delivery"
                  >
                    <div>
                      <h4 id="personal-push-window-heading">
                        Benachrichtigungszeit
                      </h4>
                      <p className="personal-settings__hint">
                        {deliverySummary(saved)}
                      </p>
                    </div>
                    <div
                      aria-label="Benachrichtigungszeit"
                      className="segmented"
                      role="radiogroup"
                    >
                      <button
                        aria-checked={draft.mode === "always"}
                        className={
                          draft.mode === "always" ? "selected" : undefined
                        }
                        disabled={deliverySaving}
                        onClick={() => setDeliveryDraft({ mode: "always" })}
                        role="radio"
                        type="button"
                      >
                        Jederzeit
                      </button>
                      <button
                        aria-checked={draft.mode === "window"}
                        className={
                          draft.mode === "window" ? "selected" : undefined
                        }
                        disabled={deliverySaving}
                        onClick={() =>
                          setDeliveryDraft({
                            mode: "window",
                            startHour: draftWindow.startHour,
                            endHour: draftWindow.endHour,
                            days: [...draftWindow.days],
                          })
                        }
                        role="radio"
                        type="button"
                      >
                        Nur zu bestimmten Zeiten
                      </button>
                    </div>
                    {draft.mode === "window" ? (
                      <fieldset className="personal-settings__delivery-days">
                        <legend>Tage</legend>
                        <div>
                          {WEEKDAYS.map((weekday) => {
                            const selected = draft.days.includes(weekday.day);
                            return (
                              <button
                                aria-label={weekday.long}
                                aria-pressed={selected}
                                className={selected ? "is-selected" : undefined}
                                disabled={
                                  deliverySaving ||
                                  (selected && draft.days.length === 1)
                                }
                                key={weekday.day}
                                onClick={() =>
                                  setDeliveryDraft({
                                    ...draft,
                                    days: selected
                                      ? draft.days.filter(
                                          (day) => day !== weekday.day,
                                        )
                                      : [...draft.days, weekday.day].sort(
                                          (left, right) => left - right,
                                        ),
                                  })
                                }
                                title={
                                  selected && draft.days.length === 1
                                    ? "Mindestens ein Tag muss ausgewählt bleiben."
                                    : undefined
                                }
                                type="button"
                              >
                                {weekday.short}
                              </button>
                            );
                          })}
                        </div>
                      </fieldset>
                    ) : null}
                    {draft.mode === "window" ? (
                      <div className="personal-settings__delivery-hours">
                        <label>
                          Von
                          <select
                            disabled={deliverySaving}
                            onChange={(event) =>
                              setDeliveryDraft({
                                ...draft,
                                startHour: Number(event.target.value),
                              })
                            }
                            value={draft.startHour}
                          >
                            {Array.from({ length: 24 }, (_, hour) => (
                              <option key={hour} value={hour}>
                                {workHourLabel(hour)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Bis
                          <select
                            disabled={deliverySaving}
                            onChange={(event) =>
                              setDeliveryDraft({
                                ...draft,
                                endHour: Number(event.target.value),
                              })
                            }
                            value={draft.endHour}
                          >
                            {Array.from({ length: 24 }, (_, index) => {
                              const hour = index + 1;
                              return (
                                <option key={hour} value={hour}>
                                  {workHourLabel(hour)}
                                </option>
                              );
                            })}
                          </select>
                        </label>
                        <span className="personal-settings__hint">Uhr</span>
                      </div>
                    ) : null}
                    {dirty ? (
                      <div className="personal-settings__delivery-actions">
                        <button
                          className="primary-button"
                          disabled={deliverySaving}
                          onClick={() => void saveDeliveryWindow(draft)}
                          type="button"
                        >
                          {deliverySaving ? "Wird gespeichert …" : "Speichern"}
                        </button>
                        <button
                          className="secondary-button"
                          disabled={deliverySaving}
                          onClick={() => setDeliveryDraft(null)}
                          type="button"
                        >
                          Abbrechen
                        </button>
                      </div>
                    ) : null}
                  </section>
                );
              })()
            : null}
          {pushStatusState === "loaded" &&
          pushStatus &&
          pushStatus.applicableCategories.length > 0 ? (
            <section
              aria-labelledby="personal-push-categories-heading"
              className="personal-settings__push-categories"
            >
              <div>
                <h4 id="personal-push-categories-heading">
                  Benachrichtigungen
                </h4>
                <p className="personal-settings__hint">
                  Wähle pro Benachrichtigung, ob du sie als Push auf deinem
                  iPhone, per E-Mail oder auf beiden Wegen erhältst.
                </p>
                {!pushStatus.emailAvailable ? (
                  <p className="personal-settings__hint">
                    E-Mail-Benachrichtigungen stehen zur Verfügung, sobald euer
                    Unternehmen ein Exchange-Postfach mit nextDesk verbunden
                    hat.
                  </p>
                ) : null}
              </div>
              <table className="personal-settings__notification-table">
                <thead>
                  <tr>
                    <th scope="col">Benachrichtigung</th>
                    <th scope="col">Push</th>
                    <th scope="col">E-Mail</th>
                  </tr>
                </thead>
                <tbody>
                  {pushStatus.applicableCategories.map((category) => {
                    const meta = pushCategoryMeta[category];
                    const alwaysPush =
                      pushStatus.alwaysDeliveredCategories.includes(category);
                    const channels = [
                      {
                        channel: "push" as const,
                        label: "Push",
                        on: pushStatus.preferences.enabledCategories.includes(
                          category,
                        ),
                        available: true,
                      },
                      {
                        channel: "email" as const,
                        label: "E-Mail",
                        on: pushStatus.preferences.emailCategories.includes(
                          category,
                        ),
                        available: pushStatus.emailAvailable,
                      },
                    ];
                    return (
                      <tr key={category}>
                        <th scope="row">
                          <strong>{meta.label}</strong>
                          <small>{meta.description}</small>
                          {alwaysPush ? (
                            <small>
                              Als Mitglied des Phishing-Teams erhalten Sie diese
                              Mitteilungen immer per Push.
                            </small>
                          ) : null}
                        </th>
                        {channels.map((entry) => (
                          <td key={entry.channel}>
                            <button
                              aria-checked={entry.available && entry.on}
                              aria-label={`${meta.label} per ${entry.label}`}
                              className="personal-settings__switch"
                              disabled={
                                !entry.available ||
                                pushPreferenceSaving !== null
                              }
                              onClick={() =>
                                void toggleNotification(category, entry.channel)
                              }
                              role="switch"
                              type="button"
                            >
                              <span aria-hidden="true" />
                            </button>
                            {pushPreferenceSaving ===
                            `${category}:${entry.channel}` ? (
                              <span
                                aria-live="polite"
                                className="personal-settings__switch-state"
                              >
                                Speichert …
                              </span>
                            ) : null}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ) : null}
          {pushStatusState === "loaded" && pushStatus?.devices.length === 0 ? (
            <p className="personal-settings__hint">
              Für dein Konto sind noch keine iOS-Geräte registriert.
            </p>
          ) : null}
          {pushStatus?.devices.length ? (
            <ul className="personal-settings__device-list">
              {pushStatus.devices.map((device) => {
                const deviceName = device.deviceName?.trim() || "iOS-Gerät";
                const appVersion =
                  device.appVersion?.trim() || "nicht gemeldet";
                const appBuild = device.appBuild?.trim();
                const removalOpen = pendingDeviceRemoval?.id === device.id;
                return (
                  <li key={device.id}>
                    <div className="personal-settings__device-details">
                      <strong>{deviceName}</strong>
                      <span>
                        App-Version: {appVersion}
                        {appBuild ? ` (Build ${appBuild})` : ""}
                      </span>
                      <span>
                        Letzte Registrierung:{" "}
                        {pushDateLabel(device.lastRegisteredAt)}
                      </span>
                      <span
                        className={
                          device.enabled
                            ? "personal-settings__device-status personal-settings__device-status--enabled"
                            : "personal-settings__device-status personal-settings__device-status--disabled"
                        }
                      >
                        {device.enabled
                          ? "Aktiv"
                          : `Deaktiviert: ${pushDisabledReasonLabel(device.disabledReason)}`}
                      </span>
                    </div>
                    {removalOpen ? (
                      <div
                        className="personal-settings__device-confirmation"
                        role="alert"
                      >
                        <p>
                          Möchtest du {deviceName} wirklich für
                          Push-Benachrichtigungen entfernen?
                        </p>
                        <div>
                          <button
                            className="personal-settings__signout-button"
                            disabled={removingDeviceId !== null}
                            onClick={() => void removePushDevice()}
                            type="button"
                          >
                            <Trash2
                              aria-hidden="true"
                              size={16}
                              strokeWidth={1.9}
                            />
                            {removingDeviceId === device.id
                              ? "Wird entfernt …"
                              : "Entfernen bestätigen"}
                          </button>
                          <button
                            disabled={removingDeviceId !== null}
                            onClick={() => setPendingDeviceRemoval(null)}
                            type="button"
                          >
                            Abbrechen
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="secondary-button"
                        disabled={removingDeviceId !== null}
                        onClick={() => setPendingDeviceRemoval(device)}
                        type="button"
                      >
                        <Trash2
                          aria-hidden="true"
                          size={16}
                          strokeWidth={1.9}
                        />
                        Entfernen
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <p className="personal-settings__hint">
            Push-Benachrichtigungen richtest du in der nextDesk-iOS-App unter
            Profil → Benachrichtigungen ein.
          </p>
          {pushMessage ? (
            <p
              aria-live="polite"
              className={
                pushMessageKind === "success"
                  ? "personal-settings__notice personal-settings__notice--success"
                  : "personal-settings__notice personal-settings__notice--error"
              }
              role="status"
            >
              {pushMessage}
            </p>
          ) : null}
        </section>
      ) : null}

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

      {provider.usesSso ? (
        <article className="personal-settings__signout personal-settings__delete-note">
          <div>
            <strong>Konto löschen</strong>
            <span>
              Dein Konto wird von deiner Organisation über SSO verwaltet und
              kann hier nicht gelöscht werden. Wende dich dafür an deine IT.
            </span>
          </div>
        </article>
      ) : (
        <DeleteAccountPanel />
      )}
    </section>
  );
}

/**
 * Account deletion (also offered in the iOS app). Deletes the login, the
 * personal workspace owned by the person and all its data.
 */
function DeleteAccountPanel() {
  const [state, setState] = useState<"idle" | "deleting">("idle");
  const [message, setMessage] = useState("");

  async function removeAccount() {
    if (
      !window.confirm(
        "Konto endgültig löschen?\n\nIhr Konto und Ihre persönlichen Daten werden unwiderruflich gelöscht. Besitzen Sie einen eigenen Arbeitsbereich, wird er mit allen Tickets, Dateien und Einträgen ebenfalls gelöscht. Arbeitsbereiche von Organisationen bleiben bestehen; Sie verlieren nur Ihren Zugriff.",
      )
    )
      return;
    setState("deleting");
    setMessage("");
    try {
      await deleteAccount();
      window.location.assign("/");
    } catch (error) {
      setState("idle");
      setMessage(
        error instanceof Error
          ? error.message
          : "Das Konto konnte nicht gelöscht werden.",
      );
    }
  }

  return (
    <article className="personal-settings__signout personal-settings__delete">
      <div>
        <strong>Konto löschen</strong>
        <span>
          Löscht Ihr Konto, Ihren eigenen Arbeitsbereich und alle darin
          gespeicherten Daten unwiderruflich.
        </span>
        {message && (
          <span
            className="personal-settings__notice personal-settings__notice--error"
            role="alert"
          >
            {message}
          </span>
        )}
      </div>
      <button
        className="personal-settings__signout-button"
        disabled={state === "deleting"}
        onClick={() => void removeAccount()}
        type="button"
      >
        <Trash2 aria-hidden="true" size={17} strokeWidth={1.9} />
        {state === "deleting" ? "Wird gelöscht …" : "Konto löschen"}
      </button>
    </article>
  );
}
