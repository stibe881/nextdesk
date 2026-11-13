// IPAM «Export & Sophos-Objekte» (CSV/JSON und Firewall-Objekte).

import { Download } from "lucide-react";
import { useState } from "react";
import { tn } from "./lib/formality";
import { errorText } from "./ipam-ui";
import { downloadFile, ipamCall } from "./lib/ipam-api";
import type { IpamFile, IpamOverview } from "./lib/ipam-model";

export function IpamExportPanel({
  overview,
  tenantId,
}: {
  overview: IpamOverview;
  tenantId: string;
}) {
  const [scope, setScope] = useState<
    "all" | "prefixes" | "addresses" | "vlans"
  >("all");
  const [vrfFilter, setVrfFilter] = useState<string>("all");
  const [includeHosts, setIncludeHosts] = useState(true);
  const [includeGroups, setIncludeGroups] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      const file = await ipamCall<IpamFile>({ ...body, tenantId });
      downloadFile(file);
      setMessage(
        file.count !== undefined
          ? `${file.filename} mit ${file.count} Objekten heruntergeladen.`
          : `${file.filename} heruntergeladen.`,
      );
    } catch (failure) {
      setError(errorText(failure, "Der Export ist fehlgeschlagen."));
    } finally {
      setBusy(null);
    }
  };
  const prefixIds =
    vrfFilter === "all"
      ? null
      : overview.prefixes
          .filter((prefix) => (prefix.vrfId ?? "global") === vrfFilter)
          .map((prefix) => prefix.id);

  return (
    <div className="ipam-export">
      {error ? (
        <p className="form-message form-message--error">{error}</p>
      ) : null}
      {message ? (
        <p className="form-message form-message--success">{message}</p>
      ) : null}
      <section className="ipam-panel">
        <h3>Daten exportieren</h3>
        <p className="ipam-muted">
          {tn(
            "Subnetze, Adressen und VLANs als CSV (für Excel) oder JSON (für Skripte und Backups). Es werden nur Einträge exportiert, die du sehen darfst.",
            "Subnetze, Adressen und VLANs als CSV (für Excel) oder JSON (für Skripte und Backups). Es werden nur Einträge exportiert, die Sie sehen dürfen.",
          )}
        </p>
        <label className="ipam-export__field">
          Umfang
          <select
            onChange={(event) => setScope(event.target.value as typeof scope)}
            value={scope}
          >
            <option value="all">Alles</option>
            <option value="prefixes">Subnetze</option>
            <option value="addresses">Adressen</option>
            <option value="vlans">VLANs und Standorte</option>
          </select>
        </label>
        <div className="ipam-export__actions">
          <button
            className="secondary-button"
            disabled={busy !== null}
            onClick={() =>
              void run("csv", { type: "export", format: "csv", scope })
            }
            type="button"
          >
            <Download aria-hidden="true" size={15} />
            {busy === "csv" ? "Exportiert …" : "CSV"}
          </button>
          <button
            className="secondary-button"
            disabled={busy !== null}
            onClick={() =>
              void run("json", { type: "export", format: "json", scope })
            }
            type="button"
          >
            <Download aria-hidden="true" size={15} />
            {busy === "json" ? "Exportiert …" : "JSON"}
          </button>
        </div>
      </section>
      <section className="ipam-panel">
        <h3>Firewall-Objekte (Sophos)</h3>
        <p className="ipam-muted">
          {tn(
            "Netzwerke und einzelne Hosts als IP-Host-Objekte für Sophos Firewall (SFOS). Die XML-Datei importierst du unter «Backup & Firmware → Import/Export». Je Subnetz entsteht auf Wunsch eine Hostgruppe mit den dokumentierten Hosts.",
            "Netzwerke und einzelne Hosts als IP-Host-Objekte für Sophos Firewall (SFOS). Die XML-Datei importieren Sie unter «Backup & Firmware → Import/Export». Je Subnetz entsteht auf Wunsch eine Hostgruppe mit den dokumentierten Hosts.",
          )}
        </p>
        <label className="ipam-export__field">
          Adressraum
          <select
            onChange={(event) => setVrfFilter(event.target.value)}
            value={vrfFilter}
          >
            <option value="all">Alle</option>
            <option value="global">Global</option>
            {overview.vrfs.map((vrf) => (
              <option key={vrf.id} value={vrf.id}>
                {vrf.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ipam-export__check">
          <input
            checked={includeHosts}
            onChange={(event) => setIncludeHosts(event.target.checked)}
            type="checkbox"
          />
          Einzelne Hosts (aktiv und reserviert) einschliessen
        </label>
        <label className="ipam-export__check">
          <input
            checked={includeGroups}
            disabled={!includeHosts}
            onChange={(event) => setIncludeGroups(event.target.checked)}
            type="checkbox"
          />
          Hostgruppe je Subnetz
        </label>
        <div className="ipam-export__actions">
          <button
            className="primary-button"
            disabled={busy !== null}
            onClick={() =>
              void run("sophos-xml", {
                type: "exportSophos",
                format: "xml",
                prefixIds,
                includeHosts,
                includeGroups,
              })
            }
            type="button"
          >
            <Download aria-hidden="true" size={15} />
            {busy === "sophos-xml" ? "Exportiert …" : "Sophos-XML"}
          </button>
          <button
            className="secondary-button"
            disabled={busy !== null}
            onClick={() =>
              void run("sophos-csv", {
                type: "exportSophos",
                format: "csv",
                prefixIds,
                includeHosts,
                includeGroups,
              })
            }
            type="button"
          >
            <Download aria-hidden="true" size={15} />
            {busy === "sophos-csv" ? "Exportiert …" : "Objektliste CSV"}
          </button>
        </div>
      </section>
    </div>
  );
}
