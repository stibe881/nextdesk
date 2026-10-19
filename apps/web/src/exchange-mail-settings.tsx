import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Circle,
  CircleCheck,
  ExternalLink,
  FileText,
  LoaderCircle,
  Mail,
  Pause,
  Play,
  RefreshCw,
  Save,
  Send,
  TriangleAlert,
} from "lucide-react";

import { supabase } from "./lib/supabase";

type ExchangeChannelStatus =
  "draft" | "verified" | "active" | "paused" | "error";
type ExchangeAction = "save" | "verify" | "activate" | "pause" | "test";
type ConfirmationAction = "activate" | "pause" | null;
type Feedback = { kind: "success" | "error" | "warning"; message: string };

type ExchangeMailChannel = {
  entraTenantId: string;
  mailboxAddress: string;
  mailboxObjectId: string | null;
  defaultDepartmentId: string | null;
  sendAcknowledgement: boolean;
  sendAgentReplies: boolean;
  sendResolution: boolean;
  status: ExchangeChannelStatus;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  activatedAt: string | null;
  subscriptionExpiresAt: string | null;
  overBroadPermissions: boolean;
};

type ExchangeMailStatus = {
  platformConfigured: boolean;
  appId: string | null;
  webhookUrl: string;
  featureEnabled: boolean;
  suggestedEntraTenantId: string | null;
  channel: ExchangeMailChannel | null;
  departments: { id: string; name: string }[];
  stats: { inbound24h: number; outbound24h: number; failed24h: number };
};

type ExchangeSettingsForm = {
  entraTenantId: string;
  mailboxAddress: string;
  mailboxObjectId: string;
  defaultDepartmentId: string;
  sendAcknowledgement: boolean;
  sendAgentReplies: boolean;
  sendResolution: boolean;
};

type ExchangeConnectionCheck = {
  key: "token" | "mailbox" | "read";
  ok: boolean;
  message: string;
};

type FunctionEnvelope<T> = { data: T };

type ExchangeMailRequest =
  | { action: "getStatus"; tenantId: string }
  | {
      action: "saveSettings";
      tenantId: string;
      entraTenantId: string;
      mailboxAddress: string;
      mailboxObjectId: string | null;
      defaultDepartmentId: string | null;
      sendAcknowledgement: boolean;
      sendAgentReplies: boolean;
      sendResolution: boolean;
    }
  | { action: "verifyConnection"; tenantId: string }
  | { action: "activate"; tenantId: string }
  | { action: "pause"; tenantId: string }
  | { action: "sendTestMail"; tenantId: string };

const emptyForm: ExchangeSettingsForm = {
  entraTenantId: "",
  mailboxAddress: "",
  mailboxObjectId: "",
  defaultDepartmentId: "",
  sendAcknowledgement: true,
  sendAgentReplies: true,
  sendResolution: false,
};

const ERROR_FALLBACKS: Record<string, string> = {
  exchange_platform_not_configured:
    "Die zentrale Exchange-Anbindung von nextDesk ist noch nicht eingerichtet. Bitte wende dich an Gross ICT.",
  feature_disabled:
    "Der E-Mail-Kanal (Exchange Online) ist für diesen Mandanten derzeit deaktiviert.",
  forbidden: "Für diese Aktion fehlt Ihnen die erforderliche Berechtigung.",
  invalid_settings:
    "Bitte prüfen Sie die Microsoft-365-Mandanten-ID, das Support-Postfach und die optionalen Angaben.",
  exchange_verification_required:
    "Prüfen Sie die Verbindung zu Exchange Online erfolgreich, bevor Sie den E-Mail-Kanal aktivieren.",
  exchange_configuration_changed:
    "Die E-Mail-Konfiguration wurde zwischenzeitlich geändert. Laden Sie die Einstellungen neu und prüfen Sie die Verbindung erneut.",
  exchange_overbroad_permissions:
    "Die nextDesk-App besitzt zu weitreichende Microsoft-Graph-Mailberechtigungen. Entfernen Sie Mail.*-Berechtigungen und prüfen Sie die Verbindung erneut.",
  mailbox_in_use:
    "Dieses Support-Postfach wird bereits von einem anderen Mandanten verwendet.",
  exchange_app_not_consented:
    "Die nextDesk-App wurde in diesem Microsoft-365-Mandanten noch nicht freigegeben. Führen Sie die Freigabe aus der Anleitung aus.",
  exchange_mailbox_not_found:
    "Das Support-Postfach wurde nicht gefunden. Bitte prüfen Sie die Adresse oder die Postfach-Objekt-ID.",
  exchange_access_denied:
    "Exchange Online verweigert den Zugriff. Bitte prüfen Sie die RBAC-Zuweisung für das Support-Postfach. Neue Rechte können 30 Minuten bis 2 Stunden benötigen.",
  exchange_throttled:
    "Microsoft 365 begrenzt Anfragen momentan. Bitte versuchen Sie es später erneut.",
  exchange_unavailable:
    "Exchange Online ist vorübergehend nicht erreichbar. Bitte versuchen Sie es später erneut.",
};

const STATUS_PRESENTATION: Record<
  ExchangeChannelStatus | "not-connected",
  {
    label: string;
    tone: "neutral" | "info" | "success" | "warning" | "danger";
    Icon: typeof Mail;
  }
> = {
  "not-connected": { label: "Nicht verbunden", tone: "neutral", Icon: Mail },
  draft: { label: "Entwurf", tone: "info", Icon: FileText },
  verified: { label: "Geprüft", tone: "success", Icon: CircleCheck },
  active: { label: "Aktiv", tone: "success", Icon: Play },
  paused: { label: "Pausiert", tone: "warning", Icon: Pause },
  error: { label: "Fehler", tone: "danger", Icon: AlertCircle },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function toSafeCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function isExchangeChannelStatus(
  value: unknown,
): value is ExchangeChannelStatus {
  return (
    value === "draft" ||
    value === "verified" ||
    value === "active" ||
    value === "paused" ||
    value === "error"
  );
}

function toExchangeChannel(value: unknown): ExchangeMailChannel | null {
  const channel = isRecord(value) ? value : null;
  if (
    !channel ||
    typeof channel.entraTenantId !== "string" ||
    typeof channel.mailboxAddress !== "string" ||
    !isExchangeChannelStatus(channel.status) ||
    typeof channel.sendAcknowledgement !== "boolean" ||
    typeof channel.sendAgentReplies !== "boolean" ||
    typeof channel.sendResolution !== "boolean" ||
    typeof channel.overBroadPermissions !== "boolean"
  ) {
    return null;
  }

  const nullableFields = [
    channel.mailboxObjectId,
    channel.defaultDepartmentId,
    channel.lastVerifiedAt,
    channel.lastErrorCode,
    channel.lastErrorMessage,
    channel.lastInboundAt,
    channel.lastOutboundAt,
    channel.activatedAt,
    channel.subscriptionExpiresAt,
  ].map(toNullableString);
  if (nullableFields.some((entry) => entry === undefined)) return null;

  return {
    entraTenantId: channel.entraTenantId,
    mailboxAddress: channel.mailboxAddress,
    mailboxObjectId: nullableFields[0] ?? null,
    defaultDepartmentId: nullableFields[1] ?? null,
    sendAcknowledgement: channel.sendAcknowledgement,
    sendAgentReplies: channel.sendAgentReplies,
    sendResolution: channel.sendResolution,
    status: channel.status,
    lastVerifiedAt: nullableFields[2] ?? null,
    lastErrorCode: nullableFields[3] ?? null,
    lastErrorMessage: nullableFields[4] ?? null,
    lastInboundAt: nullableFields[5] ?? null,
    lastOutboundAt: nullableFields[6] ?? null,
    activatedAt: nullableFields[7] ?? null,
    subscriptionExpiresAt: nullableFields[8] ?? null,
    overBroadPermissions: channel.overBroadPermissions,
  };
}

function toExchangeStatus(value: unknown): ExchangeMailStatus | null {
  const status = isRecord(value) ? value : null;
  if (
    !status ||
    typeof status.platformConfigured !== "boolean" ||
    typeof status.featureEnabled !== "boolean" ||
    typeof status.webhookUrl !== "string"
  ) {
    return null;
  }

  const appId = toNullableString(status.appId);
  const suggestedEntraTenantId = toNullableString(
    status.suggestedEntraTenantId,
  );
  if (appId === undefined || suggestedEntraTenantId === undefined) return null;

  const channel =
    status.channel === null ? null : toExchangeChannel(status.channel);
  if (status.channel !== null && channel === null) return null;

  const departments = Array.isArray(status.departments)
    ? status.departments.flatMap((entry) => {
        if (
          !isRecord(entry) ||
          typeof entry.id !== "string" ||
          typeof entry.name !== "string"
        ) {
          return [];
        }
        return [{ id: entry.id, name: entry.name }];
      })
    : [];
  const stats = isRecord(status.stats) ? status.stats : null;

  return {
    platformConfigured: status.platformConfigured,
    appId,
    webhookUrl: status.webhookUrl,
    featureEnabled: status.featureEnabled,
    suggestedEntraTenantId,
    channel,
    departments,
    stats: {
      inbound24h: toSafeCount(stats?.inbound24h),
      outbound24h: toSafeCount(stats?.outbound24h),
      failed24h: toSafeCount(stats?.failed24h),
    },
  };
}

function toConnectionChecks(value: unknown): ExchangeConnectionCheck[] | null {
  const result = isRecord(value) ? value : null;
  if (!result || !Array.isArray(result.checks)) return null;

  const checks = result.checks.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      (entry.key !== "token" &&
        entry.key !== "mailbox" &&
        entry.key !== "read") ||
      typeof entry.ok !== "boolean" ||
      typeof entry.message !== "string"
    ) {
      return [];
    }
    return [entry as ExchangeConnectionCheck];
  });
  return checks.length === result.checks.length ? checks : null;
}

function errorFallback(code: string | null, fallback: string): string {
  return (code && ERROR_FALLBACKS[code]) || fallback;
}

async function errorFromFunction(
  error: unknown,
  fallback: string,
): Promise<Error> {
  const rawError = isRecord(error) ? error : null;
  const context = rawError?.context;
  if (context instanceof Response) {
    try {
      const payload: unknown = await context.clone().json();
      const errorPayload =
        isRecord(payload) && isRecord(payload.error) ? payload.error : null;
      const code =
        typeof errorPayload?.code === "string" ? errorPayload.code : null;
      const message =
        typeof errorPayload?.message === "string"
          ? errorPayload.message.trim()
          : "";
      return new Error(message || errorFallback(code, fallback));
    } catch {
      // The status-specific fallbacks are still preferable to technical errors.
    }
  }

  return new Error(fallback);
}

async function exchangeMailRequest<T>(
  body: ExchangeMailRequest,
  fallback: string,
): Promise<T> {
  if (!supabase) {
    throw new Error("Die Verbindung zu nextDesk ist nicht konfiguriert.");
  }

  const { data, error } = await supabase.functions.invoke<FunctionEnvelope<T>>(
    "exchange-mail-admin",
    { body },
  );
  if (error) throw await errorFromFunction(error, fallback);

  const response: unknown = data;
  if (isRecord(response) && isRecord(response.error)) {
    const code =
      typeof response.error.code === "string" ? response.error.code : null;
    const message =
      typeof response.error.message === "string"
        ? response.error.message.trim()
        : "";
    throw new Error(message || errorFallback(code, fallback));
  }
  if (!isRecord(response) || !("data" in response)) {
    throw new Error(
      "Die Exchange-Einstellungen haben keine verwertbaren Daten geliefert.",
    );
  }

  return response.data as T;
}

function dateLabel(value: string | null): string {
  if (!value) return "Noch nie";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Nicht verfügbar";
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  }).format(date);
}

function formFromStatus(status: ExchangeMailStatus): ExchangeSettingsForm {
  const channel = status.channel;
  if (!channel) return emptyForm;
  return {
    entraTenantId: channel.entraTenantId,
    mailboxAddress: channel.mailboxAddress,
    mailboxObjectId: channel.mailboxObjectId ?? "",
    defaultDepartmentId: channel.defaultDepartmentId ?? "",
    sendAcknowledgement: channel.sendAcknowledgement,
    sendAgentReplies: channel.sendAgentReplies,
    sendResolution: channel.sendResolution,
  };
}

function actionLabel(action: ExchangeAction): string {
  switch (action) {
    case "save":
      return "Wird gespeichert …";
    case "verify":
      return "Verbindung wird geprüft …";
    case "activate":
      return "Wird aktiviert …";
    case "pause":
      return "Wird pausiert …";
    case "test":
      return "Testmail wird gesendet …";
  }
}

export function ExchangeMailSettings({ tenantId }: { tenantId: string }) {
  const [status, setStatus] = useState<ExchangeMailStatus | null>(null);
  const [form, setForm] = useState<ExchangeSettingsForm>(emptyForm);
  const [checks, setChecks] = useState<ExchangeConnectionCheck[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<ExchangeAction | null>(
    null,
  );
  const [confirmationAction, setConfirmationAction] =
    useState<ConfirmationAction>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await exchangeMailRequest<unknown>(
        { action: "getStatus", tenantId },
        "Der Status des E-Mail-Kanals konnte nicht geladen werden.",
      );
      const nextStatus = toExchangeStatus(response);
      if (!nextStatus) {
        throw new Error("Der Status des E-Mail-Kanals ist unvollständig.");
      }
      setStatus(nextStatus);
      setForm(formFromStatus(nextStatus));
      return true;
    } catch (error) {
      setStatus(null);
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Der Status des E-Mail-Kanals konnte nicht geladen werden.",
      });
      return false;
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const formDisabled =
    loading ||
    pendingAction !== null ||
    !status?.platformConfigured ||
    !status.featureEnabled;
  const hasChannel = Boolean(status?.channel);
  const operationDisabled = formDisabled || !hasChannel;
  const canVerify = status?.channel?.status !== "active";
  const canActivate =
    status?.channel?.status === "verified" &&
    !status.channel.overBroadPermissions;
  const statusKey = status?.channel?.status ?? "not-connected";
  const statusPresentation = STATUS_PRESENTATION[statusKey];
  const StatusIcon = statusPresentation.Icon;
  const activeMailbox =
    form.mailboxAddress.trim() || status?.channel?.mailboxAddress || "";
  const consentUrl =
    status?.appId && form.entraTenantId.trim()
      ? `https://login.microsoftonline.com/${encodeURIComponent(form.entraTenantId.trim())}/adminconsent?client_id=${encodeURIComponent(status.appId)}`
      : null;

  function updateForm<Key extends keyof ExchangeSettingsForm>(
    key: Key,
    value: ExchangeSettingsForm[Key],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function refreshAfterAction(successMessage: string) {
    if (await load()) {
      setFeedback({ kind: "success", message: successMessage });
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!status?.platformConfigured || !status.featureEnabled) return;

    const entraTenantId = form.entraTenantId.trim();
    const mailboxAddress = form.mailboxAddress.trim();
    if (!entraTenantId || !mailboxAddress) {
      setFeedback({
        kind: "error",
        message:
          "Microsoft-365-Mandanten-ID und Support-Postfach sind erforderlich.",
      });
      return;
    }

    setPendingAction("save");
    setFeedback(null);
    setChecks(null);
    try {
      await exchangeMailRequest<unknown>(
        {
          action: "saveSettings",
          tenantId,
          entraTenantId,
          mailboxAddress,
          mailboxObjectId: form.mailboxObjectId.trim() || null,
          defaultDepartmentId: form.defaultDepartmentId || null,
          sendAcknowledgement: form.sendAcknowledgement,
          sendAgentReplies: form.sendAgentReplies,
          sendResolution: form.sendResolution,
        },
        "Die Einstellungen des E-Mail-Kanals konnten nicht gespeichert werden.",
      );
      await refreshAfterAction(
        "Die Einstellungen des E-Mail-Kanals wurden gespeichert.",
      );
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Die Einstellungen des E-Mail-Kanals konnten nicht gespeichert werden.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function verifyConnection() {
    setPendingAction("verify");
    setFeedback(null);
    try {
      const response = await exchangeMailRequest<unknown>(
        { action: "verifyConnection", tenantId },
        "Die Verbindung zu Exchange Online konnte nicht geprüft werden.",
      );
      const nextChecks = toConnectionChecks(response);
      if (!nextChecks) {
        throw new Error(
          "Die Verbindungsprüfung hat keine verwertbaren Ergebnisse geliefert.",
        );
      }
      setChecks(nextChecks);
      if (await load()) {
        setFeedback({
          kind: nextChecks.every((check) => check.ok) ? "success" : "warning",
          message: nextChecks.every((check) => check.ok)
            ? "Die Verbindung zu Exchange Online wurde erfolgreich geprüft."
            : "Die Verbindung konnte noch nicht vollständig geprüft werden.",
        });
      }
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Die Verbindung zu Exchange Online konnte nicht geprüft werden.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function runConfirmedAction(action: Exclude<ConfirmationAction, null>) {
    setConfirmationAction(null);
    setPendingAction(action);
    setFeedback(null);
    try {
      await exchangeMailRequest<unknown>(
        { action, tenantId },
        action === "activate"
          ? "Der E-Mail-Kanal konnte nicht aktiviert werden."
          : "Der E-Mail-Kanal konnte nicht pausiert werden.",
      );
      await refreshAfterAction(
        action === "activate"
          ? "Der E-Mail-Kanal wurde aktiviert."
          : "Der E-Mail-Kanal wurde pausiert.",
      );
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : action === "activate"
              ? "Der E-Mail-Kanal konnte nicht aktiviert werden."
              : "Der E-Mail-Kanal konnte nicht pausiert werden.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function sendTestMail() {
    setPendingAction("test");
    setFeedback(null);
    try {
      await exchangeMailRequest<unknown>(
        { action: "sendTestMail", tenantId },
        "Die Testmail konnte nicht gesendet werden.",
      );
      await refreshAfterAction(
        "Die Testmail wurde an Ihre hinterlegte E-Mail-Adresse gesendet.",
      );
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Die Testmail konnte nicht gesendet werden.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section
      aria-labelledby="exchange-mail-settings-heading"
      className="exchange-mail-settings"
    >
      <div className="exchange-mail-settings__heading">
        <div>
          <span className="eyebrow">E-MAIL-INTEGRATION</span>
          <h3 id="exchange-mail-settings-heading">
            E-Mail-Kanal (Exchange Online)
          </h3>
          <p>
            Verbinden Sie ein einzelnes Support-Postfach Ihres
            Microsoft-365-Mandanten mit nextDesk.
          </p>
        </div>
        <Mail aria-hidden="true" size={23} />
      </div>

      {loading ? (
        <p className="exchange-mail-settings__state" role="status">
          <LoaderCircle
            aria-hidden="true"
            className="exchange-mail-settings__spinner"
            size={16}
          />
          Status des E-Mail-Kanals wird geladen …
        </p>
      ) : null}

      {status ? (
        <>
          <section
            className="exchange-mail-settings__status-card"
            aria-label="Status des E-Mail-Kanals"
          >
            <div className="exchange-mail-settings__status-heading">
              <span
                className={`exchange-mail-settings__status-badge exchange-mail-settings__status-badge--${statusPresentation.tone}`}
              >
                <StatusIcon aria-hidden="true" size={16} />
                {statusPresentation.label}
              </span>
              {status.channel?.lastVerifiedAt ? (
                <span>
                  Zuletzt geprüft: {dateLabel(status.channel.lastVerifiedAt)}
                </span>
              ) : null}
            </div>
            <dl className="exchange-mail-settings__status-details">
              <div>
                <dt>Support-Postfach</dt>
                <dd>
                  {status.channel?.mailboxAddress || "Noch nicht hinterlegt"}
                </dd>
              </div>
              <div>
                <dt>Letzte eingegangene E-Mail</dt>
                <dd>{dateLabel(status.channel?.lastInboundAt ?? null)}</dd>
              </div>
              <div>
                <dt>Letzte versendete E-Mail</dt>
                <dd>{dateLabel(status.channel?.lastOutboundAt ?? null)}</dd>
              </div>
              <div>
                <dt>Abo-Ablauf</dt>
                <dd>
                  {dateLabel(status.channel?.subscriptionExpiresAt ?? null)}
                </dd>
              </div>
            </dl>
            {status.channel?.lastErrorMessage ? (
              <p className="exchange-mail-settings__last-error" role="status">
                <AlertCircle aria-hidden="true" size={16} />
                <span>
                  <strong>
                    Letzter Fehler
                    {status.channel.lastErrorCode
                      ? ` (${status.channel.lastErrorCode})`
                      : ""}
                    :
                  </strong>{" "}
                  {status.channel.lastErrorMessage}
                </span>
              </p>
            ) : null}
            <div
              className="exchange-mail-settings__stats"
              aria-label="Kennzahlen der letzten 24 Stunden"
            >
              <span>
                <strong>{status.stats.inbound24h}</strong> eingegangen (24 h)
              </span>
              <span>
                <strong>{status.stats.outbound24h}</strong> versendet (24 h)
              </span>
              <span
                className={
                  status.stats.failed24h > 0 ? "is-warning" : undefined
                }
              >
                <strong>{status.stats.failed24h}</strong> fehlgeschlagen (24 h)
              </span>
            </div>
          </section>

          {!status.platformConfigured ? (
            <p
              className="exchange-mail-settings__notice exchange-mail-settings__notice--info"
              role="status"
            >
              <AlertCircle aria-hidden="true" size={17} />
              Die zentrale Exchange-Anbindung von nextDesk ist noch nicht
              eingerichtet. Bitte wende dich an Gross ICT.
            </p>
          ) : null}
          {!status.featureEnabled ? (
            <p
              className="exchange-mail-settings__notice exchange-mail-settings__notice--warning"
              role="status"
            >
              <TriangleAlert aria-hidden="true" size={17} />
              Aktivieren Sie zuerst den Funktionsschalter für den E-Mail-Kanal,
              bevor Sie die Verbindung konfigurieren.
            </p>
          ) : null}
          {status.channel &&
          status.channel.status !== "verified" &&
          status.channel.status !== "active" ? (
            <p
              className="exchange-mail-settings__notice exchange-mail-settings__notice--warning"
              role="status"
            >
              <TriangleAlert aria-hidden="true" size={17} />
              Prüfen Sie die Verbindung erfolgreich, bevor Sie den E-Mail-Kanal
              aktivieren.
            </p>
          ) : null}
          {consentUrl &&
          status.channel &&
          status.channel.status !== "verified" &&
          status.channel.status !== "active" ? (
            <p
              className="exchange-mail-settings__notice exchange-mail-settings__notice--warning"
              role="status"
            >
              <TriangleAlert aria-hidden="true" size={17} />
              <span>
                Die nextDesk-App ist in diesem Microsoft-365-Mandanten noch
                nicht freigegeben. Öffnen Sie die Freigabe mit einer
                berechtigten Microsoft-365-Administration und prüfen Sie die
                Verbindung anschliessend erneut.{" "}
                <a href={consentUrl} rel="noreferrer" target="_blank">
                  Microsoft-365-Freigabe öffnen{" "}
                  <ExternalLink aria-hidden="true" size={14} />
                </a>
              </span>
            </p>
          ) : null}
          {status.channel?.overBroadPermissions ? (
            <p
              className="exchange-mail-settings__notice exchange-mail-settings__notice--warning"
              role="alert"
            >
              <TriangleAlert aria-hidden="true" size={17} />
              Für die nextDesk-App wurden zu weitreichende Mail-Berechtigungen
              erkannt. Bitte entfernen Sie Mail.*-Berechtigungen aus Entra; die
              Einschränkung muss ausschliesslich über Exchange Online RBAC
              erfolgen.
            </p>
          ) : null}

          <form className="exchange-mail-settings__form" onSubmit={save}>
            <fieldset disabled={formDisabled}>
              <legend>Postfach konfigurieren</legend>
              <div className="exchange-mail-settings__form-grid">
                <label>
                  Microsoft-365-Mandanten-ID
                  <input
                    autoComplete="off"
                    onChange={(event) =>
                      updateForm("entraTenantId", event.target.value)
                    }
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    required
                    value={form.entraTenantId}
                  />
                  {status.suggestedEntraTenantId ? (
                    <span className="exchange-mail-settings__suggestion">
                      Vorschlag aus SSO:{" "}
                      <code>{status.suggestedEntraTenantId}</code>
                      <button
                        className="text-button"
                        onClick={() =>
                          updateForm(
                            "entraTenantId",
                            status.suggestedEntraTenantId ?? "",
                          )
                        }
                        type="button"
                      >
                        Übernehmen
                      </button>
                    </span>
                  ) : null}
                </label>
                <label>
                  Support-Postfach
                  <input
                    autoComplete="email"
                    inputMode="email"
                    onChange={(event) =>
                      updateForm("mailboxAddress", event.target.value)
                    }
                    placeholder="support@unternehmen.ch"
                    required
                    type="email"
                    value={form.mailboxAddress}
                  />
                </label>
                <label>
                  Postfach-Objekt-ID <span>(optional)</span>
                  <input
                    autoComplete="off"
                    onChange={(event) =>
                      updateForm("mailboxObjectId", event.target.value)
                    }
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={form.mailboxObjectId}
                  />
                </label>
                <label>
                  Ziel-Abteilung für neue Tickets
                  <select
                    onChange={(event) =>
                      updateForm("defaultDepartmentId", event.target.value)
                    }
                    value={form.defaultDepartmentId}
                  >
                    <option value="">Standard-Abteilung verwenden</option>
                    {status.departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="exchange-mail-settings__switches">
                <label>
                  <input
                    checked={form.sendAcknowledgement}
                    onChange={(event) =>
                      updateForm("sendAcknowledgement", event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>
                    <strong>Eingangsbestätigung senden</strong>
                    <small>
                      Neue E-Mail-Tickets werden unmittelbar bestätigt.
                    </small>
                  </span>
                </label>
                <label>
                  <input
                    checked={form.sendAgentReplies}
                    onChange={(event) =>
                      updateForm("sendAgentReplies", event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>
                    <strong>Agentenantworten per E-Mail senden</strong>
                    <small>
                      Externe Antworten aus dem Ticket-Chat werden zugestellt.
                    </small>
                  </span>
                </label>
                <label>
                  <input
                    checked={form.sendResolution}
                    onChange={(event) =>
                      updateForm("sendResolution", event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>
                    <strong>Lösungsmitteilung senden</strong>
                    <small>
                      Beim Lösen eines Tickets wird eine E-Mail versendet.
                    </small>
                  </span>
                </label>
              </div>
            </fieldset>
            <div className="exchange-mail-settings__actions">
              <button disabled={formDisabled} type="submit">
                {pendingAction === "save" ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="exchange-mail-settings__spinner"
                    size={16}
                  />
                ) : (
                  <Save aria-hidden="true" size={16} />
                )}
                {pendingAction === "save" ? actionLabel("save") : "Speichern"}
              </button>
              <button
                disabled={operationDisabled || !canVerify}
                onClick={() => void verifyConnection()}
                type="button"
              >
                {pendingAction === "verify" ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="exchange-mail-settings__spinner"
                    size={16}
                  />
                ) : (
                  <RefreshCw aria-hidden="true" size={16} />
                )}
                {pendingAction === "verify"
                  ? actionLabel("verify")
                  : "Verbindung prüfen"}
              </button>
              <button
                disabled={operationDisabled || !canActivate}
                onClick={() => setConfirmationAction("activate")}
                type="button"
              >
                {pendingAction === "activate" ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="exchange-mail-settings__spinner"
                    size={16}
                  />
                ) : (
                  <Play aria-hidden="true" size={16} />
                )}
                {pendingAction === "activate"
                  ? actionLabel("activate")
                  : "Aktivieren"}
              </button>
              <button
                disabled={
                  operationDisabled || status.channel?.status === "paused"
                }
                onClick={() => setConfirmationAction("pause")}
                type="button"
              >
                {pendingAction === "pause" ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="exchange-mail-settings__spinner"
                    size={16}
                  />
                ) : (
                  <Pause aria-hidden="true" size={16} />
                )}
                {pendingAction === "pause" ? actionLabel("pause") : "Pausieren"}
              </button>
              <button
                disabled={
                  operationDisabled || status.channel?.status !== "active"
                }
                onClick={() => void sendTestMail()}
                type="button"
              >
                {pendingAction === "test" ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="exchange-mail-settings__spinner"
                    size={16}
                  />
                ) : (
                  <Send aria-hidden="true" size={16} />
                )}
                {pendingAction === "test"
                  ? actionLabel("test")
                  : "Testmail an mich senden"}
              </button>
            </div>
          </form>

          {checks ? (
            <section
              aria-labelledby="exchange-mail-checks-heading"
              className="exchange-mail-settings__checks"
            >
              <h4 id="exchange-mail-checks-heading">
                Ergebnis der Verbindungsprüfung
              </h4>
              <ul>
                {checks.map((check) => (
                  <li
                    className={check.ok ? "is-ok" : "is-failed"}
                    key={check.key}
                  >
                    {check.ok ? (
                      <CircleCheck aria-hidden="true" size={17} />
                    ) : (
                      <AlertCircle aria-hidden="true" size={17} />
                    )}
                    <span>{check.message}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {feedback ? (
            <p
              className={`exchange-mail-settings__feedback exchange-mail-settings__feedback--${feedback.kind}`}
              role={feedback.kind === "error" ? "alert" : "status"}
            >
              {feedback.kind === "success" ? (
                <CircleCheck aria-hidden="true" size={17} />
              ) : feedback.kind === "warning" ? (
                <TriangleAlert aria-hidden="true" size={17} />
              ) : (
                <AlertCircle aria-hidden="true" size={17} />
              )}
              {feedback.message}
            </p>
          ) : null}

          <details className="exchange-mail-settings__guide">
            <summary>So richtest du den E-Mail-Kanal ein</summary>
            <div>
              <p>
                Dieser Bereich führt dich durch die Konfiguration für genau ein
                Support-Postfach. Dein Mandant sieht und ändert nur seine eigene
                E-Mail-Konfiguration.
              </p>
              <p className="exchange-mail-settings__guide-hint">
                Das Client-Secret der zentralen nextDesk-App bleibt
                ausschliesslich im sicheren nextDesk-Secret-Store von Gross ICT.
                Es wird weder angezeigt noch von dir oder deinen Mitarbeitenden
                benötigt.
              </p>
              <ol>
                <li>
                  Trage Microsoft-365-Mandanten-ID und Support-Postfach ein und
                  wähle <strong>Speichern</strong>.
                </li>
                <li>
                  Öffne danach die Microsoft-365-Freigabe und bestätige sie mit
                  einer berechtigten Microsoft-365-Administration.
                </li>
                <li>
                  Lasse den Exchange-Zugriff auf genau dieses Support-Postfach
                  beschränken. Der Zugriff darf nicht für alle Postfächer deines
                  Unternehmens gelten.
                </li>
                <li>
                  Warte nach der Microsoft-Freigabe kurz und wähle hier
                  <strong>Verbindung prüfen</strong>. Erst bei erfolgreicher
                  Prüfung wird <strong>Aktivieren</strong> freigeschaltet.
                </li>
              </ol>
              {consentUrl ? (
                <p>
                  <a href={consentUrl} rel="noreferrer" target="_blank">
                    Microsoft-365-Freigabe für diesen Mandanten öffnen{" "}
                    <ExternalLink aria-hidden="true" size={14} />
                  </a>
                </p>
              ) : (
                <p className="exchange-mail-settings__guide-hint">
                  Der Freigabelink erscheint, sobald die
                  Microsoft-365-Mandanten-ID eingetragen ist.
                </p>
              )}
              <p className="exchange-mail-settings__guide-hint">
                Microsoft kann neue Exchange-Berechtigungen erst nach 30 Minuten
                bis 2 Stunden bereitstellen.
              </p>
              <p className="exchange-mail-settings__guide-warning">
                Bitte erteile der nextDesk-App in Entra keine allgemeinen
                Mail-Berechtigungen. Der Zugriff muss auf dieses eine
                Support-Postfach beschränkt bleiben.
              </p>
            </div>
          </details>
        </>
      ) : null}
      {!status && feedback ? (
        <p
          className={`exchange-mail-settings__feedback exchange-mail-settings__feedback--${feedback.kind}`}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          <AlertCircle aria-hidden="true" size={17} />
          {feedback.message}
        </p>
      ) : null}

      {confirmationAction ? (
        <div
          aria-labelledby="exchange-mail-confirmation-title"
          aria-modal="true"
          className="tenant-admin-settings__confirmation-dialog"
          role="dialog"
        >
          <h2 id="exchange-mail-confirmation-title">
            {confirmationAction === "activate"
              ? "E-Mail-Kanal aktivieren?"
              : "E-Mail-Kanal pausieren?"}
          </h2>
          <p>
            {confirmationAction === "activate"
              ? `nextDesk überwacht ${activeMailbox || "dieses Support-Postfach"} künftig auf neue E-Mails. Bereits vorhandene E-Mails werden nicht importiert.`
              : `nextDesk beendet die Überwachung von ${activeMailbox || "diesem Support-Postfach"}. Bereits laufende Ticket- und Versandvorgänge bleiben erhalten.`}
          </p>
          <button
            disabled={pendingAction !== null}
            onClick={() => void runConfirmedAction(confirmationAction)}
            type="button"
          >
            {pendingAction === confirmationAction
              ? actionLabel(confirmationAction)
              : confirmationAction === "activate"
                ? "Jetzt aktivieren"
                : "Jetzt pausieren"}
          </button>
          <button
            disabled={pendingAction !== null}
            onClick={() => setConfirmationAction(null)}
            type="button"
          >
            Abbrechen
          </button>
        </div>
      ) : null}
    </section>
  );
}
