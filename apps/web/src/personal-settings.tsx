import {
  ArrowLeft,
  Download,
  KeyRound,
  Laptop,
  LoaderCircle,
  LogOut,
  Mail,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Trash2,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";

import { supabase } from "./lib/supabase";
import {
  checkIn,
  checkOut,
  getStatus,
  pushNotificationsRequest,
  type PushDevice,
  type PushStatus,
  type WorkHours,
} from "./lib/push-notifications";

type PersonalSettingsProps = {
  onBack: () => void;
  onOpenAppearance: () => void;
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

function workHourLabel(hour: number): string {
  return `${hour.toString().padStart(2, "0")}:00`;
}

function workHoursStatusLabel(workHours: WorkHours): string {
  if (!workHours.required) return "Kein Check-in erforderlich";
  if (!workHours.withinWindow) {
    return `Ausserhalb der Arbeitszeit (${workHourLabel(workHours.startHour)}–${workHourLabel(workHours.endHour)} Uhr)`;
  }
  if (workHours.checkedIn) {
    return `Eingecheckt – Push aktiv bis ${workHourLabel(workHours.endHour)} Uhr`;
  }
  return "Nicht eingecheckt";
}

export function PersonalSettings({
  onBack,
  onOpenAppearance,
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
  const [pushAction, setPushAction] = useState<"check-in" | "check-out" | null>(
    null,
  );
  const provider = providerSummary(user, ssoEnforced);
  const email = user.email?.trim() || "Keine E-Mail-Adresse hinterlegt";

  useEffect(() => {
    if (!tenantId) {
      setPushStatus(null);
      setPushStatusState("idle");
      setPushMessage("");
      setPendingDeviceRemoval(null);
      setPushAction(null);
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

  async function updateCheckIn(action: "check-in" | "check-out") {
    if (!tenantId || pushAction) return;

    setPushAction(action);
    setPushMessage("");
    try {
      const workHours =
        action === "check-in"
          ? await checkIn(tenantId)
          : await checkOut(tenantId);
      setPushStatus((current) =>
        current ? { ...current, workHours } : current,
      );
      setPushMessageKind("success");
      setPushMessage(
        action === "check-in"
          ? "Du bist für heute eingecheckt."
          : "Du bist für heute ausgecheckt.",
      );
    } catch (error) {
      setPushMessageKind("error");
      setPushMessage(
        error instanceof Error && error.message
          ? error.message
          : "Der Check-in-Status konnte nicht aktualisiert werden. Bitte versuche es später erneut.",
      );
    } finally {
      setPushAction(null);
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

        <article className="personal-settings__card">
          <div className="personal-settings__card-heading">
            <span className="personal-settings__icon" aria-hidden="true">
              <SlidersHorizontal size={19} strokeWidth={1.9} />
            </span>
            <div>
              <h3>Profil & Darstellung</h3>
              <p>
                Lege Farbschema, Startansicht, Listendichte und weitere
                persönliche Ansichtsoptionen fest.
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

      {tenantId &&
      (pushStatusState !== "loaded" ||
        pushStatus?.featureEnabled ||
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
              <h3 id="personal-push-heading">Push-Benachrichtigungen</h3>
              <p>
                Verwalte die iOS-Geräte, die mit deinem nextDesk-Konto
                registriert sind.
              </p>
            </div>
          </div>

          {pushStatusState === "loading" ? (
            <p aria-live="polite" className="personal-settings__hint">
              Registrierte Geräte werden geladen …
            </p>
          ) : null}
          {pushStatusState === "loaded" && pushStatus ? (
            <section
              aria-labelledby="personal-push-work-hours-heading"
              className="personal-settings__work-hours"
            >
              <div>
                <h4 id="personal-push-work-hours-heading">Heutiger Status</h4>
                <p
                  className={
                    pushStatus.workHours.active
                      ? "personal-settings__work-hours-status personal-settings__work-hours-status--active"
                      : pushStatus.workHours.withinWindow
                        ? "personal-settings__work-hours-status"
                        : "personal-settings__work-hours-status personal-settings__work-hours-status--outside"
                  }
                >
                  {workHoursStatusLabel(pushStatus.workHours)}
                </p>
              </div>
              {pushStatus.workHours.required ? (
                <div className="personal-settings__work-hours-actions">
                  {pushStatus.workHours.checkedIn ? (
                    <button
                      className="secondary-button"
                      disabled={pushAction !== null}
                      onClick={() => void updateCheckIn("check-out")}
                      type="button"
                    >
                      {pushAction === "check-out"
                        ? "Wird ausgecheckt …"
                        : "Auschecken"}
                    </button>
                  ) : (
                    <button
                      className="primary-button"
                      disabled={pushAction !== null}
                      onClick={() => void updateCheckIn("check-in")}
                      type="button"
                    >
                      {pushAction === "check-in"
                        ? "Wird eingecheckt …"
                        : "Einchecken"}
                    </button>
                  )}
                </div>
              ) : null}
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
