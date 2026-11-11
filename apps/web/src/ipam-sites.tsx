// IPAM «Standorte»: Kacheln, Detail mit VLANs & Netzen, Geräten und
// Netzwerkkarte sowie Netzwerkdokumentation zum Drucken (PDF).

import { FileText, Pencil, Plus, Printer, X } from "lucide-react";
import { useEffect, useState } from "react";
import { SiteDialog, type IpamLookups } from "./ipam-forms";
import {
  Meter,
  Notice,
  Pill,
  SubTabs,
  errorText,
  useIpamQuery,
} from "./ipam-ui";
import { ipamCall } from "./lib/ipam-api";
import {
  AGENT_STATUS_LABEL,
  AGENT_STATUS_TONE,
  percentText,
} from "./lib/ipam-format";
import type { IpamOverview, IpamSite } from "./lib/ipam-model";
import type {
  SiteCard,
  SiteDetail,
  SiteOverview,
  TemplateList,
} from "./lib/ipam-redesign-types";
import {
  deviceKind,
  deviceSubtitle,
  deviceWhere,
  dhcpText,
  uplinkTree,
  type UplinkNode,
} from "./lib/ipam-sites";

type Props = {
  canManage: boolean;
  lookups: IpamLookups;
  onChanged: (message?: string) => void;
  onOpenPrefix: (prefixId: string) => void;
  onSelectSite: (siteId: string | null) => void;
  overview: IpamOverview;
  revision: number;
  selectedSiteId: string | null;
  tenantId: string;
};

export function IpamSitesPage(props: Props) {
  const { canManage, revision, selectedSiteId, tenantId } = props;
  const sites = useIpamQuery<SiteOverview>(
    { type: "siteOverview", tenantId },
    `${tenantId}-${revision}`,
  );
  const templates = useIpamQuery<TemplateList>(
    canManage ? { type: "listTemplates", tenantId } : null,
    `${tenantId}-${revision}-${canManage}`,
  );
  const [dialog, setDialog] = useState<{ site: IpamSite | null } | null>(null);
  const list = sites.data?.sites ?? [];
  const current =
    list.find((site) => site.id === selectedSiteId) ?? list[0] ?? null;

  return (
    <div className="ipam-page">
      <div className="ipam-page__intro">
        <p className="ipam-muted">
          Verknüpfen Sie jeden Standort mit einem Asset-Standort – Geräte, Racks
          und Tickets erscheinen dann automatisch.
        </p>
        {canManage ? (
          <button
            className="primary-button"
            onClick={() => setDialog({ site: null })}
            type="button"
          >
            <Plus aria-hidden="true" size={16} /> Standort
          </button>
        ) : null}
      </div>
      <Notice error={sites.error} />
      {!sites.data && !sites.error ? (
        <p className="ipam-muted">Standorte werden geladen …</p>
      ) : null}
      {sites.data && list.length === 0 ? (
        <div className="ipam-placeholder">
          <h3>Noch keine Standorte</h3>
          <p>
            Standorte gruppieren VLANs und Subnetze nach Gebäude oder Campus.
            Mit einer Standort-Vorlage (Register «VLANs») legen Sie einen neuen
            Standort samt VLANs und Subnetzen in einem Schritt an.
          </p>
        </div>
      ) : null}
      {list.length ? (
        <div className="ipam-site-cards">
          {list.map((site) => (
            <SiteCardButton
              active={site.id === current?.id}
              key={site.id}
              onPick={() => props.onSelectSite(site.id)}
              site={site}
            />
          ))}
        </div>
      ) : null}
      {current ? (
        <SiteDetailView
          {...props}
          assetLocations={sites.data?.assetLocations ?? []}
          key={current.id}
          onEdit={(site) => setDialog({ site })}
          siteId={current.id}
        />
      ) : null}
      {dialog ? (
        <SiteDialog
          assetLocations={sites.data?.assetLocations ?? []}
          initial={dialog.site}
          lookups={props.lookups}
          onClose={() => setDialog(null)}
          onSaved={(message) => props.onChanged(message)}
          templates={templates.data?.templates ?? []}
          tenantId={tenantId}
        />
      ) : null}
    </div>
  );
}

export function SiteCardButton({
  active,
  onPick,
  site,
}: {
  active: boolean;
  onPick: () => void;
  site: SiteCard;
}) {
  return (
    <button
      aria-pressed={active}
      className={`ipam-site-card${active ? " is-on" : ""}`}
      onClick={onPick}
      type="button"
    >
      <span className="ipam-site-card__head">
        <span>
          <b>{site.name}</b>
          <small>
            {[site.code, site.address].filter(Boolean).join(" · ") ||
              site.supernet ||
              " "}
          </small>
        </span>
        {site.agent ? (
          <Pill tone={AGENT_STATUS_TONE[site.agent.status]}>
            Agent {AGENT_STATUS_LABEL[site.agent.status].toLowerCase()}
          </Pill>
        ) : (
          <Pill>kein Agent</Pill>
        )}
      </span>
      <span className="ipam-site-card__stats">
        <span>
          <b>{site.vlanCount}</b>VLANs
        </span>
        <span>
          <b>{site.prefixCount}</b>Netze
        </span>
        <span>
          <b>{site.switchCount}</b>Switches
        </span>
        <span>
          <b>{site.apCount}</b>APs
        </span>
      </span>
      <Meter label={site.name} percent={site.percent} />
      <small
        className={site.assetLocation ? "ipam-muted" : "ipam-tone-warning"}
      >
        {site.assetLocation
          ? `Asset-Standort: ${site.assetLocation.name}`
          : "Asset-Standort noch nicht verknüpft"}
      </small>
    </button>
  );
}

type Tab = "nets" | "devices" | "map";

function SiteDetailView({
  assetLocations,
  canManage,
  onChanged,
  onEdit,
  onOpenPrefix,
  revision,
  siteId,
  tenantId,
}: Props & {
  assetLocations: SiteOverview["assetLocations"];
  onEdit: (site: IpamSite) => void;
  siteId: string;
}) {
  const detail = useIpamQuery<SiteDetail>(
    { type: "siteDetail", tenantId, siteId },
    `${siteId}-${revision}`,
  );
  const [tab, setTab] = useState<Tab>("nets");
  const [doc, setDoc] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = detail.data;
  if (!data) {
    return (
      <section className="ipam-card">
        <Notice error={detail.error} />
        {!detail.error ? (
          <p className="ipam-muted">Standort wird geladen …</p>
        ) : null}
      </section>
    );
  }
  const site = data.site;
  const asIpamSite: IpamSite = {
    id: site.id,
    name: site.name,
    code: site.code,
    address: site.address,
    description: site.description,
    departmentId: site.departmentId,
    assetLocationId: site.assetLocation?.id ?? null,
    vlanBase: site.vlanBase,
    supernetPrefixId: site.supernetPrefixId,
    templateId: site.templateId,
  };
  const linkLocation = async (assetLocationId: string) => {
    setError(null);
    try {
      await ipamCall({
        type: "saveSite",
        tenantId,
        site: { ...asIpamSite, assetLocationId: assetLocationId || null },
      });
      onChanged(
        assetLocationId ? "Asset-Standort verknüpft." : "Verknüpfung entfernt.",
      );
    } catch (failure) {
      setError(
        errorText(failure, "Der Asset-Standort konnte nicht verknüpft werden."),
      );
    }
  };
  const locationOptions = assetLocations.filter(
    (location) => !location.linkedSiteId || location.linkedSiteId === site.id,
  );

  return (
    <section
      aria-label={`Standort ${site.name}`}
      className="ipam-card ipam-detail2"
    >
      <header className="ipam-detail2__head">
        <div>
          <h3>{site.name}</h3>
          <p>
            {[
              site.address,
              site.supernet ? `Supernetz ${site.supernet}` : null,
              site.vlanBase ? `VLAN-Basis ${site.vlanBase}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "Ohne Adresse"}
          </p>
        </div>
        <div className="ipam-detail2__actions">
          {canManage ? (
            <label className="ipam-field ipam-field--inline">
              Asset-Standort
              <select
                onChange={(event) => void linkLocation(event.target.value)}
                value={site.assetLocation?.id ?? ""}
              >
                <option value="">nicht verknüpft</option>
                {locationOptions.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {canManage ? (
            <button
              className="secondary-button"
              onClick={() => onEdit(asIpamSite)}
              type="button"
            >
              <Pencil aria-hidden="true" size={15} /> Bearbeiten
            </button>
          ) : null}
          <button
            className="secondary-button"
            onClick={() => setDoc(true)}
            type="button"
          >
            <FileText aria-hidden="true" size={15} /> Dokumentation (PDF)
          </button>
        </div>
      </header>
      <Notice error={error} />
      <SubTabs
        label="Standort"
        onChange={setTab}
        tabs={[
          { value: "nets", label: "VLANs & Netze" },
          { value: "devices", label: `Geräte (${data.devices.length})` },
          { value: "map", label: "Netzwerkkarte" },
        ]}
        value={tab}
      />
      {tab === "nets" ? (
        <NetsTable detail={data} onOpenPrefix={onOpenPrefix} />
      ) : null}
      {tab === "devices" ? <DeviceCards devices={data.devices} /> : null}
      {tab === "map" ? <UplinkMap devices={data.devices} /> : null}
      {doc ? (
        <SiteDocumentation detail={data} onClose={() => setDoc(false)} />
      ) : null}
    </section>
  );
}

function NetsTable({
  detail,
  onOpenPrefix,
}: {
  detail: SiteDetail;
  onOpenPrefix?: (prefixId: string) => void;
}) {
  const rows = siteNetRows(detail);
  if (!rows.length)
    return (
      <p className="ipam-muted">
        Noch keine VLANs oder Netze an diesem Standort.
      </p>
    );
  return (
    <div className="ipam-table-wrap">
      <table className="ipam-table ipam-table--wide">
        <thead>
          <tr>
            <th>VLAN</th>
            <th>Name</th>
            <th>Subnetz</th>
            <th>Gateway</th>
            <th>DHCP</th>
            {onOpenPrefix ? (
              <th className="ipam-col-meter">Auslastung</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>
                <b>{row.vlan}</b>
              </td>
              <td>{row.name}</td>
              <td className="ipam-mono">
                {row.prefixId && onOpenPrefix ? (
                  <button
                    className="text-button ipam-mono"
                    onClick={() => onOpenPrefix(row.prefixId!)}
                    type="button"
                  >
                    {row.prefix}
                  </button>
                ) : (
                  row.prefix
                )}
              </td>
              <td className="ipam-mono">{row.gateway}</td>
              <td>{row.dhcp}</td>
              {onOpenPrefix ? (
                <td>
                  {row.percent !== null ? <Meter percent={row.percent} /> : "–"}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One row per VLAN subnet (VLAN without subnet: one row), then the rest. */
export function siteNetRows(detail: SiteDetail) {
  const rows: {
    key: string;
    vlan: string;
    name: string;
    prefix: string;
    prefixId: string | null;
    gateway: string;
    dhcp: string;
    percent: number | null;
  }[] = [];
  for (const vlan of [...detail.vlans].sort(
    (a, b) => a.vlanNumber - b.vlanNumber,
  )) {
    if (!vlan.prefixes.length) {
      rows.push({
        key: vlan.id,
        vlan: String(vlan.vlanNumber),
        name: vlan.name,
        prefix: "–",
        prefixId: null,
        gateway: "–",
        dhcp: "–",
        percent: null,
      });
    }
    for (const prefix of vlan.prefixes) {
      rows.push({
        key: `${vlan.id}-${prefix.id}`,
        vlan: String(vlan.vlanNumber),
        name: vlan.name,
        prefix: prefix.prefix,
        prefixId: prefix.id,
        gateway: prefix.gateway ?? "–",
        dhcp: dhcpText(prefix.dhcpStart, prefix.dhcpEnd),
        percent: prefix.percent,
      });
    }
  }
  for (const prefix of detail.prefixesWithoutVlan) {
    rows.push({
      key: prefix.id,
      vlan: "–",
      name: prefix.name ?? "",
      prefix: prefix.prefix,
      prefixId: prefix.id,
      gateway: "–",
      dhcp: "–",
      percent: prefix.percent,
    });
  }
  return rows;
}

function DeviceCards({ devices }: { devices: SiteDetail["devices"] }) {
  if (!devices.length) {
    return (
      <p className="ipam-muted">
        Keine Geräte gefunden. Geräte erscheinen hier, wenn der Standort mit
        einem Asset-Standort verknüpft ist oder ihre IP in einem Netz des
        Standorts liegt.
      </p>
    );
  }
  return (
    <ul className="ipam-device-cards">
      {devices.map((device) => (
        <li key={device.assetId}>
          <span className="ipam-device-cards__head">
            <b>{device.name}</b>
            <small>{deviceSubtitle(device)}</small>
          </span>
          {device.ipAddress ? (
            <span className="ipam-mono">{device.ipAddress}</span>
          ) : null}
          {deviceWhere(device) ? (
            <small className="ipam-muted">{deviceWhere(device)}</small>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function UplinkMap({ devices }: { devices: SiteDetail["devices"] }) {
  const tree = uplinkTree(
    devices.filter(
      (device) => deviceKind(device) !== "ap" || !device.uplinkAssetId,
    ),
  );
  const apsByUplink = new Map<string, number>();
  for (const device of devices) {
    if (deviceKind(device) === "ap" && device.uplinkAssetId) {
      apsByUplink.set(
        device.uplinkAssetId,
        (apsByUplink.get(device.uplinkAssetId) ?? 0) + 1,
      );
    }
  }
  if (!tree.length) {
    return (
      <p className="ipam-muted">
        Für eine Karte braucht es Geräte mit Uplink-Switch.
      </p>
    );
  }
  const render = (node: UplinkNode) => (
    <li key={node.device.assetId}>
      <span className={`ipam-uplink ipam-uplink--${deviceKind(node.device)}`}>
        <b>{node.device.name}</b>
        <small>
          {[
            node.device.ipAddress,
            node.device.locationNote,
            apsByUplink.get(node.device.assetId)
              ? `${apsByUplink.get(node.device.assetId)} APs`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
      </span>
      {node.children.length ? <ul>{node.children.map(render)}</ul> : null}
    </li>
  );
  return (
    <div className="ipam-uplink-map">
      <ul>{tree.map(render)}</ul>
      <p className="ipam-muted">
        Die vollständige Karte mit Ports finden Sie unter Infrastruktur →
        Netzwerkkarte.
      </p>
    </div>
  );
}

/**
 * Printable network documentation. Only this block is printed
 * (body.ipam-printing + print CSS). No passwords or WLAN keys.
 */
export function SiteDocumentation({
  detail,
  onClose,
}: {
  detail: SiteDetail;
  onClose: () => void;
}) {
  useEffect(() => {
    document.body.classList.add("ipam-printing");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("ipam-printing");
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const site = detail.site;
  const today = new Date().toLocaleDateString("de-CH");
  const rows = siteNetRows(detail);
  return (
    <div className="ipam-doc-backdrop" role="presentation">
      <div
        aria-labelledby="ipam-doc-title"
        aria-modal="true"
        className="ipam-doc-dialog"
        role="dialog"
      >
        <div className="ipam-doc-bar">
          <b id="ipam-doc-title">Vorschau Netzwerkdokumentation</b>
          <span>
            <button
              className="primary-button"
              onClick={() => window.print()}
              type="button"
            >
              <Printer aria-hidden="true" size={15} /> Drucken / als PDF
              speichern
            </button>
            <button
              aria-label="Schliessen"
              className="secondary-button"
              onClick={onClose}
              type="button"
            >
              <X aria-hidden="true" size={15} />
            </button>
          </span>
        </div>
        <article className="ipam-doc">
          <header>
            <h1>Netzwerkdokumentation {site.name}</h1>
            <span>Stand {today}</span>
          </header>
          <p className="ipam-doc__meta">
            {[
              site.address,
              site.supernet ? `Supernetz ${site.supernet}` : null,
              `Asset-Standort ${site.assetLocation?.name ?? "nicht verknüpft"}`,
              `${site.vlanCount} VLANs`,
              `${site.switchCount} Switches`,
              `${site.apCount} Access Points`,
              site.percent !== null
                ? `Auslastung ${percentText(site.percent)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <h2>VLANs und Netze</h2>
          <table>
            <thead>
              <tr>
                <th>VLAN</th>
                <th>Name</th>
                <th>Subnetz</th>
                <th>Gateway</th>
                <th>DHCP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.vlan}</td>
                  <td>{row.name}</td>
                  <td>{row.prefix}</td>
                  <td>{row.gateway}</td>
                  <td>{row.dhcp}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.devices.length ? (
            <>
              <h2>Geräte</h2>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Typ / Modell</th>
                    <th>Seriennummer</th>
                    <th>IP</th>
                    <th>Ort</th>
                    <th>Uplink</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.devices.map((device) => (
                    <tr key={device.assetId}>
                      <td>{device.name}</td>
                      <td>{deviceSubtitle(device) || "–"}</td>
                      <td>{device.serialNumber ?? "–"}</td>
                      <td>{device.ipAddress ?? "–"}</td>
                      <td>{device.locationNote ?? "–"}</td>
                      <td>{device.uplinkName ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h2>Netzwerkkarte</h2>
              <UplinkMap devices={detail.devices} />
            </>
          ) : null}
          <p className="ipam-doc__foot">
            Erstellt mit nextDesk. Enthält keine Passwörter oder WLAN-Schlüssel.
          </p>
        </article>
      </div>
    </div>
  );
}
