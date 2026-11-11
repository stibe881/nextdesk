import { Pencil, Ticket, Unlock, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CustomFieldsEditor } from "./ipam-forms";
import { ipamCall } from "./lib/ipam-api";
import {
  ADDRESS_STATUS_LABEL,
  customFieldRows,
  customFieldsFromRows,
  DEVICE_TYPE_LABEL,
  eventSummary,
  FINDING_KIND_LABEL,
  formatDay,
  formatRelative,
  vlanLabel,
  type FieldRow,
  type IpamAddressDetail,
} from "./lib/ipam-model";

type Props = {
  tenantId: string;
  /** Either an address id or a free IP (with VRF) to show. */
  addressId: string | null;
  ip: string | null;
  vrfId: string | null;
  canManage: boolean;
  onClose: () => void;
  onEdit: (detail: IpamAddressDetail) => void;
  onReserve: (detail: IpamAddressDetail) => void;
  onChanged: (message: string) => void;
  onOpenTicket?: ((ticketId: string) => void) | undefined;
};

/** IP detail drawer: status, device, links in nextDesk, own fields, history. */
export function IpamAddressDrawer({
  addressId,
  canManage,
  ip,
  onChanged,
  onClose,
  onEdit,
  onOpenTicket,
  onReserve,
  tenantId,
  vrfId,
}: Props) {
  const [detail, setDetail] = useState<IpamAddressDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [fieldsDirty, setFieldsDirty] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await ipamCall<IpamAddressDetail>({
        type: "addressDetail",
        tenantId,
        addressId,
        address: addressId ? null : ip,
        vrfId,
      });
      setDetail(result);
      setFields(customFieldRows(result.address?.customFields));
      setFieldsDirty(false);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Die Adresse konnte nicht geladen werden.",
      );
    }
  }, [addressId, ip, tenantId, vrfId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const record = detail?.address ?? null;
  const act = async (work: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      const message = await work();
      if (!message) return;
      onChanged(message);
      await load();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Die Aktion konnte nicht ausgeführt werden.",
      );
    } finally {
      setBusy(false);
    }
  };

  const release = () =>
    act(async () => {
      if (!record) return "";
      if (
        !window.confirm(
          `${record.address} freigeben? Die Adresse wird als «Veraltet» markiert und wieder als frei vorgeschlagen; der Verlauf bleibt erhalten.`,
        )
      ) {
        return "";
      }
      await ipamCall({
        type: "releaseAddress",
        tenantId,
        addressId: record.id,
      });
      return `${record.address} freigegeben.`;
    });

  const createTicket = () =>
    act(async () => {
      if (!record) return "";
      const result = await ipamCall<{ ticketId: string; ticketNumber: string }>(
        { type: "addressTicket", tenantId, addressId: record.id },
      );
      onOpenTicket?.(result.ticketId);
      return `Ticket ${result.ticketNumber} erstellt.`;
    });

  const saveFields = () =>
    act(async () => {
      if (!record) return "";
      await ipamCall({
        type: "saveAddress",
        tenantId,
        address: {
          ...record,
          customFields: customFieldsFromRows(fields),
        },
      });
      return "Eigene Felder gespeichert.";
    });

  const title = record?.address ?? detail?.ip ?? ip ?? "";
  const row = (label: string, value: string | null | undefined) =>
    value ? (
      <div key={label}>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    ) : null;

  return (
    <div
      className="ipam-drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside aria-label={`IP-Adresse ${title}`} className="ipam-drawer">
        <header>
          <div>
            <h3 className="ipam-mono">{title}</h3>
            <p>{record?.dnsName ?? record?.hostname ?? "Nicht dokumentiert"}</p>
          </div>
          <span
            className={`ipam-status ipam-status--${record ? record.status : "free"}`}
          >
            {record ? ADDRESS_STATUS_LABEL[record.status] : "Frei"}
          </span>
          <button
            aria-label="Schliessen"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        {error ? (
          <p className="form-message form-message--error" role="alert">
            {error}
          </p>
        ) : null}
        {!detail && !error ? (
          <p className="empty-state">Adresse wird geladen …</p>
        ) : null}

        {detail ? (
          <>
            <dl className="ipam-kv">
              {row(
                "Gerätetyp",
                record?.deviceType
                  ? (DEVICE_TYPE_LABEL[record.deviceType] ?? record.deviceType)
                  : null,
              )}
              {row("Hostname", record?.hostname)}
              {row("MAC", record?.macAddress?.toUpperCase())}
              {row("Hersteller", record?.vendor)}
              {row(
                "Switch-Port",
                record?.switchName
                  ? `${record.switchName}${record.switchPort ? ` · ${record.switchPort}` : ""}`
                  : record?.switchPort,
              )}
              {row(
                "Subnetz",
                detail.prefix
                  ? `${detail.prefix.prefix}${detail.prefix.description ? ` · ${detail.prefix.description}` : ""}`
                  : "Ausserhalb der erfassten Subnetze",
              )}
              {row("VLAN", vlanLabel(detail.vlan))}
              {row("Standort", detail.site?.name)}
              {row(
                "Verantwortlich",
                [
                  record?.ownerName,
                  record?.teamName ? `Team ${record.teamName}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || null,
              )}
              {row(
                "Reserviert bis",
                record?.reservedUntil ? formatDay(record.reservedUntil) : null,
              )}
              {record
                ? row(
                    "Zuletzt gesehen",
                    `${formatRelative(record.lastSeenAt)}${record.lastSeenSource ? ` (${record.lastSeenSource})` : ""}`,
                  )
                : null}
              {row("Beschreibung", record?.description)}
              {row(
                "Schlagwörter",
                record?.tags.length ? record.tags.join(", ") : null,
              )}
            </dl>

            {detail.findings.some((finding) => finding.status === "open") ? (
              <section className="ipam-box ipam-box--alert">
                <h4>Offene Funde</h4>
                <ul>
                  {detail.findings
                    .filter((finding) => finding.status === "open")
                    .map((finding) => (
                      <li key={finding.id}>
                        {FINDING_KIND_LABEL[finding.kind] ?? finding.kind}
                        {finding.lastSeenAt
                          ? ` · ${formatRelative(finding.lastSeenAt)}`
                          : ""}
                      </li>
                    ))}
                </ul>
              </section>
            ) : null}

            <section className="ipam-box">
              <h4>Verknüpft in nextDesk</h4>
              {detail.devices.length === 0 &&
              !detail.asset &&
              !detail.service &&
              detail.tickets.length === 0 ? (
                <p className="ipam-muted">Keine Verknüpfungen gefunden.</p>
              ) : (
                <ul>
                  {detail.devices.map((device) => (
                    <li key={`device-${device.id}`}>
                      Infrastruktur: {device.name}
                      {device.hostname ? ` (${device.hostname})` : ""}
                    </li>
                  ))}
                  {detail.asset ? (
                    <li>
                      Asset:{" "}
                      {detail.asset.assetTag
                        ? `${detail.asset.assetTag} · `
                        : ""}
                      {detail.asset.name}
                    </li>
                  ) : null}
                  {detail.service ? (
                    <li>Dienst: {detail.service.name}</li>
                  ) : null}
                  {detail.tickets.map((ticket) => (
                    <li key={`ticket-${ticket.id}`}>
                      Ticket:{" "}
                      {onOpenTicket ? (
                        <button
                          className="text-button"
                          onClick={() => onOpenTicket(ticket.id)}
                          type="button"
                        >
                          {ticket.ticketNumber} «{ticket.subject}»
                        </button>
                      ) : (
                        `${ticket.ticketNumber} «${ticket.subject}»`
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {record ? (
              <section className="ipam-box">
                <h4>Eigene Felder</h4>
                {canManage ? (
                  <>
                    <CustomFieldsEditor
                      onChange={(rows) => {
                        setFields(rows);
                        setFieldsDirty(true);
                      }}
                      rows={fields}
                    />
                    {fieldsDirty ? (
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => void saveFields()}
                        type="button"
                      >
                        Felder speichern
                      </button>
                    ) : null}
                  </>
                ) : fields.length ? (
                  <dl className="ipam-kv">
                    {fields.map((field) => row(field.key, field.value))}
                  </dl>
                ) : (
                  <p className="ipam-muted">Keine eigenen Felder.</p>
                )}
              </section>
            ) : null}

            {detail.events.length ? (
              <section className="ipam-box">
                <h4>Verlauf</h4>
                <ol className="ipam-timeline">
                  {detail.events.map((event) => (
                    <li key={event.id}>
                      <time dateTime={event.at}>{formatDay(event.at)}</time>
                      <span>
                        {eventSummary(event)}
                        {event.actorName ? ` – ${event.actorName}` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {canManage ? (
              <footer className="ipam-drawer__actions">
                {record ? (
                  <>
                    {record.status !== "deprecated" ? (
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => void release()}
                        type="button"
                      >
                        <Unlock aria-hidden="true" size={15} /> Freigeben
                      </button>
                    ) : null}
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void createTicket()}
                      type="button"
                    >
                      <Ticket aria-hidden="true" size={15} /> Ticket erstellen
                    </button>
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() => onEdit(detail)}
                      type="button"
                    >
                      <Pencil aria-hidden="true" size={15} /> Bearbeiten
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="secondary-button"
                      onClick={() => onEdit(detail)}
                      type="button"
                    >
                      Erfassen
                    </button>
                    <button
                      className="primary-button"
                      onClick={() => onReserve(detail)}
                      type="button"
                    >
                      Reservieren …
                    </button>
                  </>
                )}
              </footer>
            ) : null}
          </>
        ) : null}
      </aside>
    </div>
  );
}
