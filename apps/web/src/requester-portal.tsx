import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Laptop,
  RefreshCw,
  Ticket,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type JSX } from "react";

import { supabase } from "./lib/supabase";
import "./requester-portal.css";

type IncidentStatus =
  "investigating" | "identified" | "monitoring" | "resolved";

type PortalIncidentNotice = {
  categoryId: string | null;
  departmentId: string | null;
  description: string;
  id: string;
  resolvedAt: string | null;
  startsAt: string;
  status: IncidentStatus;
  title: string;
  updatedAt: string;
};

type Approval = {
  approvalKind: string;
  id: string;
  reason: string;
  requestedAt: string;
  requiredApprovals: number;
  ticketId: string;
};

type Device = {
  detail: string | null;
  id: string | null;
  name: string;
};

type PortalData = {
  approvals: Approval[];
  devices: Device[];
  devicesAvailable: boolean;
  notices: PortalIncidentNotice[];
};

type PortalState = "hidden" | "loading" | "ready" | "unavailable";

type StatusMeta = {
  Icon: LucideIcon;
  label: string;
};

const incidentStatus: Record<IncidentStatus, StatusMeta> = {
  identified: { Icon: AlertTriangle, label: "Ursache identifiziert" },
  investigating: { Icon: RefreshCw, label: "Wird untersucht" },
  monitoring: { Icon: CheckCircle2, label: "Wird überwacht" },
  resolved: { Icon: CheckCircle2, label: "Gelöst" },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function textValue(value: unknown, maxLength = 1000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function nullableUuid(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isUuid(value) ? value : undefined;
}

function nullableIsoDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isIsoDate(value) ? value : undefined;
}

function incidentFromValue(value: unknown): PortalIncidentNotice | null {
  if (!isRecord(value)) return null;
  const status = value.status;
  const categoryId = nullableUuid(value.category_id);
  const departmentId = nullableUuid(value.department_id);
  const resolvedAt = nullableIsoDate(value.resolved_at);
  const id = isUuid(value.id) ? value.id : null;
  const title = textValue(value.title, 240);
  const description = textValue(value.description, 5000);
  const startsAt = isIsoDate(value.starts_at) ? value.starts_at : null;
  const updatedAt = isIsoDate(value.updated_at) ? value.updated_at : null;
  if (
    !id ||
    !title ||
    !description ||
    !startsAt ||
    !updatedAt ||
    categoryId === undefined ||
    departmentId === undefined ||
    resolvedAt === undefined ||
    (status !== "investigating" &&
      status !== "identified" &&
      status !== "monitoring" &&
      status !== "resolved")
  ) {
    return null;
  }
  return {
    categoryId,
    departmentId,
    description,
    id,
    resolvedAt,
    startsAt,
    status,
    title,
    updatedAt,
  };
}

function approvalFromValue(value: unknown): Approval | null {
  if (!isRecord(value)) return null;
  const id = isUuid(value.id) ? value.id : null;
  const ticketId = isUuid(value.ticket_id) ? value.ticket_id : null;
  const approvalKind = textValue(value.approval_kind, 120);
  const reason = textValue(value.reason, 2000);
  const requestedAt = isIsoDate(value.requested_at) ? value.requested_at : null;
  const requiredApprovals = value.required_approvals;
  if (
    !id ||
    !ticketId ||
    !approvalKind ||
    !reason ||
    !requestedAt ||
    typeof requiredApprovals !== "number" ||
    !Number.isSafeInteger(requiredApprovals) ||
    requiredApprovals < 1
  ) {
    return null;
  }
  return { approvalKind, id, reason, requestedAt, requiredApprovals, ticketId };
}

function deviceFromValue(value: unknown, index: number): Device | null {
  if (!isRecord(value)) return null;
  const name =
    textValue(value.name, 240) ??
    textValue(value.display_name, 240) ??
    textValue(value.asset_name, 240) ??
    textValue(value.hostname, 240) ??
    textValue(value.serial_number, 240);
  if (!name) return null;
  const detail =
    textValue(value.model, 240) ??
    textValue(value.serial_number, 240) ??
    textValue(value.asset_tag, 240) ??
    textValue(value.status, 120);
  return {
    detail,
    id: isUuid(value.id) ? value.id : `device-${index}-${name}`,
    name,
  };
}

function portalDataFromResponses(
  incidentsResponse: unknown,
  approvalsResponse: unknown,
  devicesResponse: unknown,
): PortalData {
  if (
    !isRecord(incidentsResponse) ||
    !isRecord(incidentsResponse.data) ||
    !Array.isArray(incidentsResponse.data.notices) ||
    !isRecord(approvalsResponse) ||
    !isRecord(approvalsResponse.data) ||
    !Array.isArray(approvalsResponse.data.approvals) ||
    !isRecord(devicesResponse) ||
    !isRecord(devicesResponse.data) ||
    !Array.isArray(devicesResponse.data.devices) ||
    typeof devicesResponse.data.available !== "boolean"
  ) {
    throw new Error("invalid_requester_portal_response");
  }

  const notices = incidentsResponse.data.notices.map(incidentFromValue);
  const approvals = approvalsResponse.data.approvals.map(approvalFromValue);
  if (
    notices.some((notice) => notice === null) ||
    approvals.some((approval) => approval === null)
  ) {
    throw new Error("invalid_requester_portal_response");
  }

  return {
    approvals: approvals as Approval[],
    devices: devicesResponse.data.devices
      .map((device, index) => deviceFromValue(device, index))
      .filter((device): device is Device => device !== null),
    devicesAvailable: devicesResponse.data.available,
    notices: notices as PortalIncidentNotice[],
  };
}

async function requesterPortalUnavailable(error: unknown): Promise<boolean> {
  const response =
    isRecord(error) && error.context instanceof Response ? error.context : null;
  if (response && [401, 403, 404].includes(response.status)) return true;
  if (isRecord(error) && typeof error.status === "number") {
    return [401, 403, 404].includes(error.status);
  }
  if (!response) return false;

  try {
    const payload = await response.clone().json();
    const code =
      isRecord(payload) && isRecord(payload.error)
        ? payload.error.code
        : undefined;
    return (
      code === "requester_portal_feature_disabled" ||
      code === "requester_portal_not_configured" ||
      code === "tenant_feature_lookup_failed" ||
      code === "tenant_membership_required" ||
      code === "authentication_required"
    );
  } catch {
    return false;
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Zeitpunkt nicht verfügbar";
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function approvalKindLabel(value: string): string {
  const normalized = value.replaceAll(/[_-]+/g, " ").trim();
  return normalized
    ? normalized.charAt(0).toLocaleUpperCase("de-CH") + normalized.slice(1)
    : "Freigabe";
}

export function RequesterPortalPanel(props: { tenantId: string }): JSX.Element {
  const { tenantId } = props;
  const [data, setData] = useState<PortalData | null>(null);
  const [state, setState] = useState<PortalState>(() =>
    supabase ? "loading" : "hidden",
  );
  const [reloadVersion, setReloadVersion] = useState(0);
  const requestVersion = useRef(0);

  useEffect(() => {
    if (!supabase) {
      setData(null);
      setState("hidden");
      return;
    }

    const version = ++requestVersion.current;
    setData(null);
    setState("loading");
    void Promise.all([
      supabase.functions.invoke("requester-portal", {
        body: { tenantId, type: "activeIncidentNotices" },
      }),
      supabase.functions.invoke("requester-portal", {
        body: { tenantId, type: "myApprovals" },
      }),
      supabase.functions.invoke("requester-portal", {
        body: { tenantId, type: "myDevices" },
      }),
    ])
      .then(([incidents, approvals, devices]) => {
        if (incidents.error) throw incidents.error;
        if (approvals.error) throw approvals.error;
        if (devices.error) throw devices.error;
        const nextData = portalDataFromResponses(
          incidents.data,
          approvals.data,
          devices.data,
        );
        if (requestVersion.current !== version) return;
        setData(nextData);
        setState("ready");
      })
      .catch(async (error: unknown) => {
        if (requestVersion.current !== version) return;
        setData(null);
        setState(
          (await requesterPortalUnavailable(error)) ? "hidden" : "unavailable",
        );
      });

    return () => {
      ++requestVersion.current;
    };
  }, [reloadVersion, tenantId]);

  const sortedNotices = useMemo(
    () =>
      [...(data?.notices ?? [])].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    [data?.notices],
  );

  if (state === "hidden") return <></>;

  return (
    <section
      aria-labelledby="requester-portal-heading"
      className="requester-portal"
    >
      <header className="requester-portal__header">
        <div>
          <p className="eyebrow">MEIN BEREICH</p>
          <h2 id="requester-portal-heading">Meine Anfragen</h2>
          <p>
            Behalten Sie aktuelle Störungen, offene Freigaben und Ihre Geräte im
            Blick.
          </p>
        </div>
      </header>

      {state === "loading" ? (
        <div aria-busy="true" className="requester-portal__state" role="status">
          Meine Anfragen werden geladen …
        </div>
      ) : state === "unavailable" ? (
        <div className="requester-portal__state" role="status">
          <AlertTriangle aria-hidden="true" size={20} strokeWidth={1.9} />
          <div>
            <strong>Portal momentan nicht verfügbar</strong>
            <span>
              Ihre persönlichen Angaben konnten nicht geladen werden. Bitte
              versuchen Sie es später erneut.
            </span>
          </div>
          <button
            className="secondary-button"
            onClick={() => setReloadVersion((current) => current + 1)}
            type="button"
          >
            Erneut versuchen
          </button>
        </div>
      ) : (
        <div className="requester-portal__grid">
          <section
            aria-labelledby="requester-incidents-heading"
            className="requester-portal__card requester-portal__card--wide"
          >
            <div className="requester-portal__card-heading">
              <span aria-hidden="true" className="requester-portal__icon">
                <AlertTriangle size={19} strokeWidth={1.9} />
              </span>
              <div>
                <h3 id="requester-incidents-heading">Aktive Störungen</h3>
                <p>Mandantenlokale Informationen zu laufenden Störungen.</p>
              </div>
            </div>
            {sortedNotices.length === 0 ? (
              <p className="requester-portal__empty">
                Derzeit sind keine aktiven Störungen bekannt.
              </p>
            ) : (
              <ul className="requester-portal__list">
                {sortedNotices.map((notice) => {
                  const { Icon, label } = incidentStatus[notice.status];
                  return (
                    <li className="requester-portal__incident" key={notice.id}>
                      <div className="requester-portal__item-heading">
                        <strong>{notice.title}</strong>
                        <span className="requester-portal__status">
                          <Icon aria-hidden="true" size={14} strokeWidth={2} />
                          {label}
                        </span>
                      </div>
                      <p>{notice.description}</p>
                      <time dateTime={notice.updatedAt}>
                        Letzte Aktualisierung: {formatDate(notice.updatedAt)}
                      </time>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section
            aria-labelledby="requester-approvals-heading"
            className="requester-portal__card"
          >
            <div className="requester-portal__card-heading">
              <span aria-hidden="true" className="requester-portal__icon">
                <ClipboardCheck size={19} strokeWidth={1.9} />
              </span>
              <div>
                <h3 id="requester-approvals-heading">Offene Freigaben</h3>
                <p>Ihre noch ausstehenden Entscheidungen.</p>
              </div>
            </div>
            {data?.approvals.length ? (
              <ul className="requester-portal__list">
                {data.approvals.map((approval) => (
                  <li className="requester-portal__approval" key={approval.id}>
                    <strong>{approvalKindLabel(approval.approvalKind)}</strong>
                    <p>{approval.reason}</p>
                    <span>
                      Ticketreferenz: <code>{approval.ticketId}</code>
                    </span>
                    <span>
                      Benötigte Freigaben: {approval.requiredApprovals} ·
                      Angefragt: {formatDate(approval.requestedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="requester-portal__empty">
                Keine offenen Freigaben. Sie müssen derzeit nichts bestätigen.
              </p>
            )}
            <p className="requester-portal__hint">
              Öffnen Sie die Ticketübersicht, um eine Freigabe im zugehörigen
              Ticket zu bearbeiten.
            </p>
          </section>

          <section
            aria-labelledby="requester-devices-heading"
            className="requester-portal__card"
          >
            <div className="requester-portal__card-heading">
              <span aria-hidden="true" className="requester-portal__icon">
                <Laptop size={19} strokeWidth={1.9} />
              </span>
              <div>
                <h3 id="requester-devices-heading">Meine Geräte</h3>
                <p>Aktuell Ihnen zugeordnete Geräte.</p>
              </div>
            </div>
            {!data?.devicesAvailable ? (
              <p className="requester-portal__empty">
                Geräteinformationen sind für diesen Mandanten nicht verfügbar.
              </p>
            ) : data.devices.length === 0 ? (
              <p className="requester-portal__empty">
                Derzeit ist Ihnen kein Gerät zugeordnet.
              </p>
            ) : (
              <ul className="requester-portal__list requester-portal__device-list">
                {data.devices.map((device) => (
                  <li key={device.id ?? device.name}>
                    <strong>{device.name}</strong>
                    {device.detail && <span>{device.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            aria-labelledby="requester-tickets-heading"
            className="requester-portal__card requester-portal__card--tickets"
          >
            <div className="requester-portal__card-heading">
              <span aria-hidden="true" className="requester-portal__icon">
                <Ticket size={19} strokeWidth={1.9} />
              </span>
              <div>
                <h3 id="requester-tickets-heading">Meine Tickets</h3>
                <p>Status und öffentlicher Verlauf Ihrer eigenen Anfragen.</p>
              </div>
            </div>
            <p className="requester-portal__empty">
              Ihre Tickets werden in der Ticketübersicht angezeigt. Dort sehen
              Sie den Status in Klartext und können den öffentlichen Verlauf
              eines Tickets öffnen.
            </p>
          </section>
        </div>
      )}
    </section>
  );
}
