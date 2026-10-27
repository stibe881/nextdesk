import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleCheck,
  FileText,
  Link2,
  LoaderCircle,
  Mail,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

import { supabase } from "./lib/supabase";

type ExchangeChannelStatus =
  "draft" | "verified" | "active" | "paused" | "error";
type ExchangeAction =
  "connect" | "save" | "verify" | "activate" | "pause" | "test" | "delete";
type Feedback = { kind: "success" | "error" | "warning"; message: string };
type ConfirmationAction = {
  kind: "activate" | "pause" | "delete";
  channelId: string;
} | null;

type ExchangeConnection = {
  id: string;
  entraTenantId: string;
  connectorPrincipal: string;
  status: "connected" | "reauthorization_required" | "disconnected";
  lastConnectedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

type ExchangeMailChannel = {
  id: string;
  connectionId: string | null;
  accessMode: "delegated" | "legacy_rbac";
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
};

type ExchangeMailStatus = {
  platformConfigured: boolean;
  featureEnabled: boolean;
  callbackUrl: string;
  connections: ExchangeConnection[];
  channels: ExchangeMailChannel[];
  departments: { id: string; name: string }[];
  stats: { inbound24h: number; outbound24h: number; failed24h: number };
};

type ExchangeSettingsForm = {
  connectionId: string;
  mailboxAddress: string;
  defaultDepartmentId: string;
  sendAcknowledgement: boolean;
  sendAgentReplies: boolean;
  sendResolution: boolean;
};

type ExchangeConnectionCheck = {
  key: "mailbox" | "read" | "send";
  ok: boolean;
  message: string;
};

type FunctionEnvelope<T> = { data: T };
type ExchangeMailRequest =
  | { action: "getStatus"; tenantId: string }
  | { action: "startMicrosoftConnect"; tenantId: string }
  | {
      action: "saveMailbox";
      tenantId: string;
      channelId: string | null;
      connectionId: string;
      mailboxAddress: string;
      mailboxObjectId: string | null;
      defaultDepartmentId: string | null;
      sendAcknowledgement: boolean;
      sendAgentReplies: boolean;
      sendResolution: boolean;
    }
  | { action: "verifyConnection"; tenantId: string; channelId: string }
  | { action: "activate"; tenantId: string; channelId: string }
  | { action: "pause"; tenantId: string; channelId: string }
  | {
      action: "deleteMailbox";
      tenantId: string;
      channelId: string;
      confirmDelete: true;
    }
  | { action: "sendTestMail"; tenantId: string; channelId: string };

const emptyForm: ExchangeSettingsForm = {
  connectionId: "",
  mailboxAddress: "",
  defaultDepartmentId: "",
  sendAcknowledgement: true,
  sendAgentReplies: true,
  sendResolution: false,
};

const ERROR_FALLBACKS: Record<string, string> = {
  exchange_platform_not_configured:
    "Die zentrale Microsoft-365-Verbindung von nextDesk ist noch nicht vollständig eingerichtet. Bitte wende dich an Gross ICT.",
  feature_disabled:
    "Der E-Mail-Kanal (Microsoft 365) ist für diesen Mandanten derzeit deaktiviert.",
  forbidden: "Für diese Aktion fehlt Ihnen die erforderliche Berechtigung.",
  invalid_settings:
    "Bitte prüfen Sie die gewählte Verbindung und die Angaben zum Support-Postfach.",
  exchange_verification_required:
    "Prüfen Sie dieses Support-Postfach erfolgreich, bevor Sie es aktivieren.",
  exchange_configuration_changed:
    "Die Postfachkonfiguration wurde zwischenzeitlich geändert. Laden Sie die Einstellungen neu und prüfen Sie erneut.",
  mailbox_in_use:
    "Dieses Support-Postfach wird bereits von einem anderen Mandanten verwendet.",
  connection_not_found:
    "Die gewählte Microsoft-365-Verbindung ist nicht verfügbar.",
  exchange_reauthorization_required:
    "Die Microsoft-365-Verbindung muss erneut angemeldet werden.",
  legacy_migration_required:
    "Dieser bisherige E-Mail-Kanal muss zuerst über Microsoft 365 migriert werden.",
  exchange_mailbox_not_found:
    "Das Support-Postfach wurde nicht gefunden. Bitte prüfen Sie die E-Mail-Adresse.",
  exchange_access_denied:
    "Microsoft 365 verweigert den Zugriff. Öffnen Sie Exchange Admin Center und geben Sie dem verbundenen Konto für dieses Support-Postfach Vollzugriff und Senden als.",
  exchange_throttled:
    "Microsoft 365 begrenzt Anfragen momentan. Bitte versuchen Sie es später erneut.",
  exchange_unavailable:
    "Microsoft 365 ist vorübergehend nicht erreichbar. Bitte versuchen Sie es später erneut.",
};

const STATUS_PRESENTATION: Record<
  ExchangeChannelStatus,
  {
    label: string;
    tone: "neutral" | "info" | "success" | "warning" | "danger";
    Icon: typeof Mail;
  }
> = {
  draft: { label: "Noch nicht geprüft", tone: "info", Icon: FileText },
  verified: { label: "Geprüft", tone: "success", Icon: CircleCheck },
  active: { label: "Aktiv", tone: "success", Icon: Play },
  paused: { label: "Pausiert", tone: "warning", Icon: Pause },
  error: { label: "Prüfung fehlgeschlagen", tone: "danger", Icon: AlertCircle },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null | undefined {
  return value === null ? null : typeof value === "string" ? value : undefined;
}

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function isChannelStatus(value: unknown): value is ExchangeChannelStatus {
  return ["draft", "verified", "active", "paused", "error"].includes(
    String(value),
  );
}

function toConnection(value: unknown): ExchangeConnection | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.entraTenantId !== "string" ||
    typeof value.connectorPrincipal !== "string" ||
    !["connected", "reauthorization_required", "disconnected"].includes(
      String(value.status),
    )
  )
    return null;
  const nullable = [
    value.lastConnectedAt,
    value.lastErrorCode,
    value.lastErrorMessage,
  ].map(nullableString);
  if (nullable.some((entry) => entry === undefined)) return null;
  return {
    id: value.id,
    entraTenantId: value.entraTenantId,
    connectorPrincipal: value.connectorPrincipal,
    status: value.status as ExchangeConnection["status"],
    lastConnectedAt: nullable[0] ?? null,
    lastErrorCode: nullable[1] ?? null,
    lastErrorMessage: nullable[2] ?? null,
  };
}

function toChannel(value: unknown): ExchangeMailChannel | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.entraTenantId !== "string" ||
    typeof value.mailboxAddress !== "string" ||
    !isChannelStatus(value.status) ||
    (value.accessMode !== "delegated" && value.accessMode !== "legacy_rbac") ||
    typeof value.sendAcknowledgement !== "boolean" ||
    typeof value.sendAgentReplies !== "boolean" ||
    typeof value.sendResolution !== "boolean"
  )
    return null;
  const nullable = [
    value.connectionId,
    value.mailboxObjectId,
    value.defaultDepartmentId,
    value.lastVerifiedAt,
    value.lastErrorCode,
    value.lastErrorMessage,
    value.lastInboundAt,
    value.lastOutboundAt,
    value.activatedAt,
  ].map(nullableString);
  if (nullable.some((entry) => entry === undefined)) return null;
  return {
    id: value.id,
    connectionId: nullable[0] ?? null,
    accessMode: value.accessMode,
    entraTenantId: value.entraTenantId,
    mailboxAddress: value.mailboxAddress,
    mailboxObjectId: nullable[1] ?? null,
    defaultDepartmentId: nullable[2] ?? null,
    sendAcknowledgement: value.sendAcknowledgement,
    sendAgentReplies: value.sendAgentReplies,
    sendResolution: value.sendResolution,
    status: value.status,
    lastVerifiedAt: nullable[3] ?? null,
    lastErrorCode: nullable[4] ?? null,
    lastErrorMessage: nullable[5] ?? null,
    lastInboundAt: nullable[6] ?? null,
    lastOutboundAt: nullable[7] ?? null,
    activatedAt: nullable[8] ?? null,
  };
}

function toStatus(value: unknown): ExchangeMailStatus | null {
  if (
    !isRecord(value) ||
    typeof value.platformConfigured !== "boolean" ||
    typeof value.featureEnabled !== "boolean" ||
    typeof value.callbackUrl !== "string"
  )
    return null;
  const connections = Array.isArray(value.connections)
    ? value.connections.flatMap((item) => {
        const connection = toConnection(item);
        return connection ? [connection] : [];
      })
    : [];
  const channels = Array.isArray(value.channels)
    ? value.channels.flatMap((item) => {
        const channel = toChannel(item);
        return channel ? [channel] : [];
      })
    : [];
  if (
    connections.length !==
      (Array.isArray(value.connections) ? value.connections.length : -1) ||
    channels.length !==
      (Array.isArray(value.channels) ? value.channels.length : -1)
  )
    return null;
  const departments = Array.isArray(value.departments)
    ? value.departments.flatMap((item) =>
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.name === "string"
          ? [{ id: item.id, name: item.name }]
          : [],
      )
    : [];
  const stats = isRecord(value.stats) ? value.stats : null;
  return {
    platformConfigured: value.platformConfigured,
    featureEnabled: value.featureEnabled,
    callbackUrl: value.callbackUrl,
    connections,
    channels,
    departments,
    stats: {
      inbound24h: safeCount(stats?.inbound24h),
      outbound24h: safeCount(stats?.outbound24h),
      failed24h: safeCount(stats?.failed24h),
    },
  };
}

function toChecks(value: unknown): ExchangeConnectionCheck[] | null {
  if (!isRecord(value) || !Array.isArray(value.checks)) return null;
  const checks = value.checks.flatMap((item) =>
    isRecord(item) &&
    (item.key === "mailbox" || item.key === "read" || item.key === "send") &&
    typeof item.ok === "boolean" &&
    typeof item.message === "string"
      ? [
          {
            key: item.key,
            ok: item.ok,
            message: item.message,
          } as ExchangeConnectionCheck,
        ]
      : [],
  );
  return checks.length === value.checks.length ? checks : null;
}

function errorFallback(code: string | null, fallback: string): string {
  return (code && ERROR_FALLBACKS[code]) || fallback;
}

async function functionError(error: unknown, fallback: string): Promise<Error> {
  const raw = isRecord(error) ? error : null;
  if (raw?.context instanceof Response) {
    try {
      const payload: unknown = await raw.context.clone().json();
      const failure =
        isRecord(payload) && isRecord(payload.error) ? payload.error : null;
      const code = typeof failure?.code === "string" ? failure.code : null;
      const detail =
        typeof failure?.message === "string" ? failure.message.trim() : "";
      return new Error(detail || errorFallback(code, fallback));
    } catch {
      // Status-specific fallbacks remain safer than technical provider errors.
    }
  }
  return new Error(fallback);
}

async function request<T>(
  body: ExchangeMailRequest,
  fallback: string,
): Promise<T> {
  if (!supabase)
    throw new Error("Die Verbindung zu nextDesk ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke<FunctionEnvelope<T>>(
    "exchange-mail-admin",
    { body },
  );
  if (error) throw await functionError(error, fallback);
  const response: unknown = data;
  if (isRecord(response) && isRecord(response.error)) {
    const code =
      typeof response.error.code === "string" ? response.error.code : null;
    const detail =
      typeof response.error.message === "string"
        ? response.error.message.trim()
        : "";
    throw new Error(detail || errorFallback(code, fallback));
  }
  if (!isRecord(response) || !("data" in response))
    throw new Error(
      "Die E-Mail-Einstellungen haben keine verwertbaren Daten geliefert.",
    );
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

function formFromChannel(
  channel: ExchangeMailChannel | null,
): ExchangeSettingsForm {
  if (!channel) return emptyForm;
  return {
    connectionId: channel.connectionId ?? "",
    mailboxAddress: channel.mailboxAddress,
    defaultDepartmentId: channel.defaultDepartmentId ?? "",
    sendAcknowledgement: channel.sendAcknowledgement,
    sendAgentReplies: channel.sendAgentReplies,
    sendResolution: channel.sendResolution,
  };
}

function actionLabel(action: ExchangeAction): string {
  return {
    connect: "Microsoft 365 wird geöffnet …",
    save: "Postfach wird gespeichert …",
    verify: "Postfach wird geprüft …",
    activate: "Kanal wird aktiviert …",
    pause: "Kanal wird pausiert …",
    test: "Testmail wird vorbereitet …",
    delete: "Postfach wird gelöscht …",
  }[action];
}

export function ExchangeMailSettings({ tenantId }: { tenantId: string }) {
  const [status, setStatus] = useState<ExchangeMailStatus | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    null,
  );
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<ExchangeSettingsForm>(emptyForm);
  const [checks, setChecks] = useState<ExchangeConnectionCheck[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<ExchangeAction | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState<ConfirmationAction>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const selectedChannel = useMemo(
    () =>
      status?.channels.find((channel) => channel.id === selectedChannelId) ??
      null,
    [selectedChannelId, status?.channels],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await request<unknown>(
        { action: "getStatus", tenantId },
        "Die Einstellungen des E-Mail-Kanals konnten nicht geladen werden.",
      );
      const parsed = toStatus(response);
      if (!parsed)
        throw new Error("Die E-Mail-Einstellungen sind unvollständig.");
      setStatus(parsed);
      setSelectedChannelId((current) =>
        current && parsed.channels.some((channel) => channel.id === current)
          ? current
          : null,
      );
      return true;
    } catch (error) {
      setStatus(null);
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Die E-Mail-Einstellungen konnten nicht geladen werden.",
      });
      return false;
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateForm<Key extends keyof ExchangeSettingsForm>(
    key: Key,
    value: ExchangeSettingsForm[Key],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function startCreate() {
    setIsCreating(true);
    setSelectedChannelId(null);
    setChecks(null);
    setFeedback(null);
    setForm({
      ...emptyForm,
      connectionId:
        status?.connections.find((item) => item.status === "connected")?.id ??
        "",
    });
  }

  function editChannel(channel: ExchangeMailChannel) {
    setIsCreating(false);
    setSelectedChannelId(channel.id);
    setChecks(null);
    setFeedback(null);
    setForm(formFromChannel(channel));
  }

  function cancelEdit() {
    setIsCreating(false);
    setSelectedChannelId(null);
    setChecks(null);
    setForm(emptyForm);
  }

  async function connectMicrosoft365() {
    setPendingAction("connect");
    setFeedback(null);
    try {
      const response = await request<{ authorizationUrl?: unknown }>(
        { action: "startMicrosoftConnect", tenantId },
        "Die Microsoft-365-Anmeldung konnte nicht gestartet werden.",
      );
      if (typeof response.authorizationUrl !== "string")
        throw new Error(
          "Microsoft 365 hat keine gültige Anmeldeseite geliefert.",
        );
      window.location.assign(response.authorizationUrl);
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Die Microsoft-365-Anmeldung konnte nicht gestartet werden.",
      });
      setPendingAction(null);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !status?.featureEnabled ||
      !form.connectionId ||
      !form.mailboxAddress.trim()
    )
      return;
    setPendingAction("save");
    setFeedback(null);
    setChecks(null);
    try {
      await request<unknown>(
        {
          action: "saveMailbox",
          tenantId,
          channelId: selectedChannel?.id ?? null,
          connectionId: form.connectionId,
          mailboxAddress: form.mailboxAddress.trim(),
          mailboxObjectId: null,
          defaultDepartmentId: form.defaultDepartmentId || null,
          sendAcknowledgement: form.sendAcknowledgement,
          sendAgentReplies: form.sendAgentReplies,
          sendResolution: form.sendResolution,
        },
        "Das Support-Postfach konnte nicht gespeichert werden.",
      );
      const refreshed = await load();
      if (refreshed) {
        setIsCreating(false);
        setSelectedChannelId(null);
        setForm(emptyForm);
        setFeedback({
          kind: "success",
          message:
            "Das Support-Postfach wurde gespeichert. Prüfen Sie es jetzt, bevor Sie es aktivieren.",
        });
      }
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Das Support-Postfach konnte nicht gespeichert werden.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function verify(channel: ExchangeMailChannel) {
    setPendingAction("verify");
    setFeedback(null);
    try {
      const response = await request<unknown>(
        { action: "verifyConnection", tenantId, channelId: channel.id },
        "Das Support-Postfach konnte nicht geprüft werden.",
      );
      const nextChecks = toChecks(response);
      if (!nextChecks)
        throw new Error(
          "Die Verbindungsprüfung hat keine verwertbaren Ergebnisse geliefert.",
        );
      setChecks(nextChecks);
      await load();
      setFeedback({
        kind: nextChecks.every((item) => item.ok) ? "success" : "warning",
        message: nextChecks.every((item) => item.ok)
          ? "Vollzugriff und Senden als für dieses Support-Postfach wurden erfolgreich geprüft."
          : "Die Postfachprüfung konnte nicht vollständig abgeschlossen werden.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Das Support-Postfach konnte nicht geprüft werden.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function runConfirmation() {
    if (!confirmation) return;
    const { kind, channelId } = confirmation;
    setConfirmation(null);
    setPendingAction(kind);
    setFeedback(null);
    try {
      await request<unknown>(
        kind === "delete"
          ? {
              action: "deleteMailbox",
              tenantId,
              channelId,
              confirmDelete: true,
            }
          : { action: kind, tenantId, channelId },
        kind === "activate"
          ? "Der E-Mail-Kanal konnte nicht aktiviert werden."
          : kind === "pause"
            ? "Der E-Mail-Kanal konnte nicht pausiert werden."
            : "Das Support-Postfach konnte nicht gelöscht werden.",
      );
      if (await load()) {
        if (kind === "delete" && selectedChannelId === channelId) cancelEdit();
        setFeedback({
          kind: "success",
          message:
            kind === "activate"
              ? "Der E-Mail-Kanal ist aktiv. Eingehende E-Mails werden periodisch abgerufen."
              : kind === "pause"
                ? "Der E-Mail-Kanal wurde pausiert. Es werden keine weiteren E-Mails verarbeitet."
                : "Das Support-Postfach wurde aus der Konfiguration entfernt. Bereits vorhandene Tickets behalten ihre E-Mail-Herkunft.",
        });
      }
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Die Kanalaktion konnte nicht ausgeführt werden.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function sendTest(channel: ExchangeMailChannel) {
    setPendingAction("test");
    setFeedback(null);
    try {
      await request<unknown>(
        { action: "sendTestMail", tenantId, channelId: channel.id },
        "Die Testmail konnte nicht vorbereitet werden.",
      );
      await load();
      setFeedback({
        kind: "success",
        message:
          "Die Testmail wurde in die Versandwarteschlange gestellt und geht an Ihre hinterlegte nextDesk-E-Mail-Adresse.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Die Testmail konnte nicht vorbereitet werden.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  const formVisible = isCreating || selectedChannel !== null;
  const formDisabled =
    loading ||
    pendingAction !== null ||
    !status?.platformConfigured ||
    !status.featureEnabled;
  const connectedConnections =
    status?.connections.filter(
      (connection) => connection.status === "connected",
    ) ?? [];

  return (
    <section
      aria-labelledby="exchange-mail-settings-heading"
      className="exchange-mail-settings"
    >
      <div className="exchange-mail-settings__heading">
        <div>
          <span className="eyebrow">MICROSOFT 365</span>
          <h3 id="exchange-mail-settings-heading">E-Mail-Kanäle</h3>
          <p>
            Verbinden Sie Microsoft 365 einmal und fügen Sie danach mehrere
            Support-Postfächer hinzu. Jedes Ticket bleibt beim ursprünglichen
            Postfach.
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
          E-Mail-Kanäle werden geladen …
        </p>
      ) : null}
      {feedback ? (
        <p
          className={`exchange-mail-settings__notice exchange-mail-settings__notice--${feedback.kind}`}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.kind === "error" ? (
            <AlertCircle aria-hidden="true" size={17} />
          ) : (
            <CheckCircle2 aria-hidden="true" size={17} />
          )}
          {feedback.message}
        </p>
      ) : null}

      {status ? (
        <>
          {!status.platformConfigured ? (
            <p
              className="exchange-mail-settings__notice exchange-mail-settings__notice--info"
              role="status"
            >
              <AlertCircle aria-hidden="true" size={17} />
              Die zentrale Microsoft-365-Verbindung von nextDesk ist noch nicht
              vollständig eingerichtet. Bitte wenden Sie sich an Gross ICT.
            </p>
          ) : null}
          {!status.featureEnabled ? (
            <p
              className="exchange-mail-settings__notice exchange-mail-settings__notice--warning"
              role="status"
            >
              <TriangleAlert aria-hidden="true" size={17} />
              Aktivieren Sie zuerst den Funktionsschalter für E-Mail-Kanäle.
            </p>
          ) : null}

          <section
            className="exchange-mail-settings__status-card"
            aria-label="Microsoft-365-Verbindung"
          >
            <div className="exchange-mail-settings__status-heading">
              <span className="exchange-mail-settings__status-badge exchange-mail-settings__status-badge--info">
                <Link2 aria-hidden="true" size={16} />
                Microsoft-365-Verbindung
              </span>
              <button
                disabled={formDisabled}
                onClick={() => void connectMicrosoft365()}
                type="button"
              >
                {pendingAction === "connect" ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="exchange-mail-settings__spinner"
                    size={16}
                  />
                ) : (
                  <ShieldCheck aria-hidden="true" size={16} />
                )}
                {pendingAction === "connect"
                  ? actionLabel("connect")
                  : status.connections.some(
                        (item) => item.status === "connected",
                      )
                    ? "Weitere Verbindung anmelden"
                    : "Microsoft 365 verbinden"}
              </button>
            </div>
            {status.connections.length ? (
              <div className="exchange-mail-settings__connection-list">
                {status.connections.map((connection) => (
                  <div
                    className="exchange-mail-settings__connection"
                    key={connection.id}
                  >
                    <span>
                      <strong>{connection.connectorPrincipal}</strong>
                      <small>
                        Microsoft-365-Mandant: {connection.entraTenantId}
                      </small>
                    </span>
                    <span
                      className={`exchange-mail-settings__status-badge exchange-mail-settings__status-badge--${connection.status === "connected" ? "success" : "warning"}`}
                    >
                      {connection.status === "connected"
                        ? "Verbunden"
                        : "Erneute Anmeldung nötig"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="exchange-mail-settings__empty">
                Noch keine Microsoft-365-Verbindung vorhanden. Melden Sie sich
                mit dem Konto an, dem Sie in Exchange Zugriff auf die
                Support-Postfächer geben.
              </p>
            )}
          </section>

          <section
            className="exchange-mail-settings__status-card"
            aria-label="Support-Postfächer"
          >
            <div className="exchange-mail-settings__status-heading">
              <span className="exchange-mail-settings__status-badge exchange-mail-settings__status-badge--neutral">
                <Mail aria-hidden="true" size={16} />
                Support-Postfächer
              </span>
              <button
                disabled={formDisabled || connectedConnections.length === 0}
                onClick={startCreate}
                type="button"
              >
                <Plus aria-hidden="true" size={16} />
                Postfach hinzufügen
              </button>
            </div>
            {status.channels.length ? (
              <div className="exchange-mail-settings__channel-list">
                {status.channels.map((channel) => {
                  const presentation = STATUS_PRESENTATION[channel.status];
                  const Icon = presentation.Icon;
                  const delegated = channel.accessMode === "delegated";
                  return (
                    <article
                      className="exchange-mail-settings__channel"
                      key={channel.id}
                    >
                      <div>
                        <div className="exchange-mail-settings__channel-title">
                          <strong>{channel.mailboxAddress}</strong>
                          <span
                            className={`exchange-mail-settings__status-badge exchange-mail-settings__status-badge--${presentation.tone}`}
                          >
                            <Icon aria-hidden="true" size={15} />
                            {presentation.label}
                          </span>
                        </div>
                        <p>
                          Letzter Eingang: {dateLabel(channel.lastInboundAt)} ·
                          Letzter Versand: {dateLabel(channel.lastOutboundAt)}
                        </p>
                        {!delegated ? (
                          <p>
                            Bisheriger RBAC-Kanal. Für weitere Prüfungen oder
                            eine Reaktivierung zuerst über Microsoft 365
                            migrieren.
                          </p>
                        ) : null}
                        {channel.lastErrorMessage ? (
                          <p className="exchange-mail-settings__last-error">
                            <AlertCircle aria-hidden="true" size={15} />
                            {channel.lastErrorMessage}
                          </p>
                        ) : null}
                      </div>
                      <div className="exchange-mail-settings__actions">
                        <button
                          disabled={
                            formDisabled ||
                            (!delegated && connectedConnections.length === 0)
                          }
                          onClick={() => editChannel(channel)}
                          type="button"
                        >
                          <Pencil aria-hidden="true" size={16} />
                          {delegated ? "Bearbeiten" : "Microsoft 365 migrieren"}
                        </button>
                        {delegated ? (
                          <>
                            <button
                              disabled={
                                formDisabled ||
                                pendingAction !== null ||
                                channel.status === "active"
                              }
                              onClick={() => void verify(channel)}
                              type="button"
                            >
                              <RefreshCw aria-hidden="true" size={16} />
                              Prüfen
                            </button>
                            <button
                              disabled={
                                formDisabled ||
                                pendingAction !== null ||
                                channel.status !== "verified"
                              }
                              onClick={() =>
                                setConfirmation({
                                  kind: "activate",
                                  channelId: channel.id,
                                })
                              }
                              type="button"
                            >
                              <Play aria-hidden="true" size={16} />
                              Aktivieren
                            </button>
                          </>
                        ) : null}
                        <button
                          disabled={
                            formDisabled ||
                            pendingAction !== null ||
                            channel.status === "paused"
                          }
                          onClick={() =>
                            setConfirmation({
                              kind: "pause",
                              channelId: channel.id,
                            })
                          }
                          type="button"
                        >
                          <Pause aria-hidden="true" size={16} />
                          Pausieren
                        </button>
                        <button
                          disabled={
                            formDisabled ||
                            pendingAction !== null ||
                            channel.status !== "active"
                          }
                          onClick={() => void sendTest(channel)}
                          type="button"
                        >
                          <Send aria-hidden="true" size={16} />
                          Testmail
                        </button>
                        <button
                          className="exchange-mail-settings__delete-button"
                          disabled={loading || pendingAction !== null}
                          onClick={() =>
                            setConfirmation({
                              kind: "delete",
                              channelId: channel.id,
                            })
                          }
                          type="button"
                        >
                          <Trash2 aria-hidden="true" size={16} />
                          Löschen
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="exchange-mail-settings__empty">
                Noch kein Support-Postfach hinzugefügt.
              </p>
            )}
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

          {formVisible ? (
            <form className="exchange-mail-settings__form" onSubmit={save}>
              <fieldset disabled={formDisabled}>
                <legend>
                  {selectedChannel
                    ? "Support-Postfach bearbeiten"
                    : "Support-Postfach hinzufügen"}
                </legend>
                <div className="exchange-mail-settings__form-grid">
                  <label>
                    Microsoft-365-Verbindung
                    <select
                      onChange={(event) =>
                        updateForm("connectionId", event.target.value)
                      }
                      required
                      value={form.connectionId}
                    >
                      <option value="">Verbindung wählen …</option>
                      {status.connections.map((connection) => (
                        <option
                          disabled={connection.status !== "connected"}
                          key={connection.id}
                          value={connection.id}
                        >
                          {connection.connectorPrincipal}
                          {connection.status === "connected"
                            ? ""
                            : " (erneut anmelden)"}
                        </option>
                      ))}
                    </select>
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
                        Externe Antworten aus dem Ticket-Chat werden über genau
                        dieses Postfach zugestellt.
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
                        Beim Lösen eines zugeordneten Tickets wird eine E-Mail
                        versendet.
                      </small>
                    </span>
                  </label>
                </div>
              </fieldset>
              <div className="exchange-mail-settings__actions">
                <button
                  disabled={formDisabled || !form.connectionId}
                  type="submit"
                >
                  {pendingAction === "save" ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="exchange-mail-settings__spinner"
                      size={16}
                    />
                  ) : (
                    <Save aria-hidden="true" size={16} />
                  )}
                  {pendingAction === "save"
                    ? actionLabel("save")
                    : "Postfach speichern"}
                </button>
                <button
                  disabled={pendingAction !== null}
                  onClick={cancelEdit}
                  type="button"
                >
                  <X aria-hidden="true" size={16} />
                  Abbrechen
                </button>
              </div>
              <p className="exchange-mail-settings__notice exchange-mail-settings__notice--info">
                <ShieldCheck aria-hidden="true" size={17} />
                Für dieses Postfach benötigt das verbundene Konto im Exchange
                Admin Center <strong>Vollzugriff</strong> und{" "}
                <strong>Senden als</strong>. Die Rechte werden pro Postfach
                vergeben; dafür sind keine PowerShell-Befehle in nextDesk nötig.
                Die anschliessende Prüfung sendet eine kurze
                Berechtigungs-Bestätigung an das verbundene Microsoft-365-Konto.
              </p>
            </form>
          ) : null}

          {checks ? (
            <section
              className="exchange-mail-settings__checks"
              aria-label="Letzte Postfachprüfung"
            >
              <h4>Letzte Prüfung</h4>
              {checks.map((check) => (
                <p key={check.key}>
                  <CircleCheck aria-hidden="true" size={16} />
                  <strong>
                    {check.key === "mailbox"
                      ? "Postfach"
                      : check.key === "read"
                        ? "Lesen"
                        : "Senden als"}
                  </strong>
                  <span>{check.message}</span>
                </p>
              ))}
            </section>
          ) : null}
        </>
      ) : null}

      {confirmation ? (
        <div
          className="exchange-mail-settings__confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="exchange-mail-confirm-title"
        >
          <div>
            <h4 id="exchange-mail-confirm-title">
              {confirmation.kind === "activate"
                ? "E-Mail-Kanal aktivieren?"
                : confirmation.kind === "pause"
                  ? "E-Mail-Kanal pausieren?"
                  : "Support-Postfach löschen?"}
            </h4>
            <p>
              {confirmation.kind === "activate"
                ? "Neue E-Mails dieses Postfachs werden periodisch abgerufen. Antworten und Statusmails bleiben an dieses Postfach gebunden."
                : confirmation.kind === "pause"
                  ? "Die Verarbeitung dieses Postfachs stoppt sofort. Bereits verbundene Tickets behalten ihre Herkunft, bis der Kanal wieder aktiviert wird."
                  : "Dieses Postfach wird aus der Konfiguration entfernt. Neue E-Mails und ausstehende Zustellungen über dieses Postfach werden nicht mehr verarbeitet; bereits begonnene Zustellungen können noch enden. Die Microsoft-365-Verbindung und bereits vorhandene Tickets bleiben erhalten."}
            </p>
            <div className="exchange-mail-settings__actions">
              <button
                className={
                  confirmation.kind === "delete"
                    ? "exchange-mail-settings__delete-button"
                    : undefined
                }
                onClick={() => void runConfirmation()}
                type="button"
              >
                {confirmation.kind === "activate"
                  ? "Aktivieren"
                  : confirmation.kind === "pause"
                    ? "Pausieren"
                    : "Postfach löschen"}
              </button>
              <button onClick={() => setConfirmation(null)} type="button">
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
