import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Copy,
  KeyRound,
  Plus,
  Radar,
  RefreshCw,
  Server,
  ShieldOff,
  Trash2,
} from "lucide-react";

import "./ipam-discovery.css";
import { tn } from "./lib/formality";
import { functionErrorMessage } from "./lib/function-error";
import { useVisibleInterval } from "./lib/use-visible-interval";
import {
  configToForm,
  connectionLabel,
  DNS_ACTION_LABELS,
  DNS_ISSUE_LABELS,
  dnsActionOperation,
  EMPTY_CONFIG,
  emptySnmpRow,
  formToConfig,
  isJobOpen,
  JOB_KIND_LABELS,
  jobStatusLabel,
  jobSummary,
  parseAgent,
  parseDhcpDns,
  parseJob,
  parseOverview,
  relativeTime,
  runDuration,
  runSummary,
  scopeUtilization,
  utilizationTone,
  type ConfigForm,
  type DhcpDnsData,
  type DiscoveryAgent,
  type DiscoveryJob,
  type DiscoveryOverview,
  type DnsDiffRow,
  type PrefixOption,
  type QueueOperation,
  type SnmpRow,
  type Tone,
} from "./lib/ipam-discovery";
import { supabase } from "./lib/supabase";

type Props = { tenantId: string; canManage: boolean; onChanged?: () => void };
type View = "agents" | "scans" | "dhcpdns";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function invoke(body: Record<string, unknown>): Promise<unknown> {
  if (!supabase)
    throw new Error("Die Verbindung zu nextDesk ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke<unknown>(
    "ipam-discovery",
    { body },
  );
  if (error) throw error;
  return data;
}

/** Messages of `ipam-discovery` are written for users; others are generic. */
async function errorText(error: unknown, fallback: string): Promise<string> {
  if (isRecord(error) && error.context instanceof Response) {
    try {
      const payload: unknown = await error.context.clone().json();
      if (
        isRecord(payload) &&
        isRecord(payload.error) &&
        typeof payload.error.message === "string"
      ) {
        return payload.error.message;
      }
    } catch {
      // fall through
    }
  }
  return functionErrorMessage(error, fallback);
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function Chip({ tone, children }: { tone: Tone; children: string }) {
  return <span className={`tone-chip tone-chip--${tone}`}>{children}</span>;
}

function dateTime(value: string | null): string {
  if (!value) return "–";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "–"
    : date.toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Discovery im IPAM: Agenten (Token, Konfiguration), Scans und Aufträge,
 * Microsoft DHCP & DNS mit Abgleich gegen die IP-Dokumentation.
 */
export function IpamDiscoveryPanel({ tenantId, canManage, onChanged }: Props) {
  const [view, setView] = useState<View>("agents");
  const [overview, setOverview] = useState<DiscoveryOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const version = useRef(0);

  const load = useCallback(async () => {
    const current = ++version.current;
    try {
      const parsed = parseOverview(
        await invoke({ type: "overview", tenantId }),
      );
      if (!parsed) throw new Error("Die Serverantwort ist unvollständig.");
      if (current === version.current) setOverview(parsed);
    } catch (error) {
      if (current === version.current) {
        setMessage({
          text: await errorText(
            error,
            "Die Discovery konnte nicht geladen werden.",
          ),
          error: true,
        });
      }
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Offene Aufträge: alle 15 s nachladen, sonst jede Minute (nur bei
  // sichtbarem Tab).
  const hasOpenJobs = overview?.jobs.some(isJobOpen) ?? false;
  useVisibleInterval(() => void load(), hasOpenJobs ? 15000 : 60000);

  const manage = canManage && (overview?.canManage ?? canManage);
  const changed = useCallback(async () => {
    await load();
    onChanged?.();
  }, [load, onChanged]);

  const notify = useCallback(
    (text: string, error = false) => setMessage({ text, error }),
    [],
  );

  return (
    <section className="ipam-discovery" aria-busy={loading}>
      <div className="ipam-discovery__head">
        <div
          className="queue-tabs ipam-discovery__tabs"
          role="tablist"
          aria-label="Discovery"
        >
          {(
            [
              ["agents", "Agenten"],
              ["scans", "Scans"],
              ["dhcpdns", "DHCP & DNS"],
            ] as const
          ).map(([key, label]) => (
            <button
              aria-selected={view === key}
              className={view === key ? "active" : ""}
              key={key}
              onClick={() => setView(key)}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="secondary-button"
          disabled={loading}
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} /> Aktualisieren
        </button>
      </div>
      {message ? (
        <p
          className={`ipam-discovery__message${message.error ? " is-error" : ""}`}
          role="status"
        >
          {message.text}
        </p>
      ) : null}
      {loading && !overview ? (
        <p className="ipam-discovery__muted">Discovery wird geladen …</p>
      ) : null}
      {overview ? (
        <>
          {view === "agents" ? (
            <AgentsView
              canManage={manage}
              notify={notify}
              onChanged={changed}
              overview={overview}
              tenantId={tenantId}
            />
          ) : null}
          {view === "scans" ? (
            <ScansView
              canManage={manage}
              notify={notify}
              onChanged={changed}
              overview={overview}
              tenantId={tenantId}
            />
          ) : null}
          {view === "dhcpdns" ? (
            <DhcpDnsView
              canManage={manage}
              notify={notify}
              onChanged={changed}
              overview={overview}
              tenantId={tenantId}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

type ViewProps = {
  tenantId: string;
  canManage: boolean;
  overview: DiscoveryOverview;
  notify: (text: string, error?: boolean) => void;
  onChanged: () => Promise<void>;
};

// ---------------------------------------------------------------------------
// Agenten

function AgentsView({
  tenantId,
  canManage,
  overview,
  notify,
  onChanged,
}: ViewProps) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [token, setToken] = useState<{ agent: string; token: string } | null>(
    null,
  );
  const [confirm, setConfirm] = useState<{
    agentId: string;
    action: "rotateToken" | "revokeAgent";
  } | null>(null);
  const [busy, setBusy] = useState(false);

  async function tokenAction(
    agentId: string,
    action: "rotateToken" | "revokeAgent",
  ) {
    setBusy(true);
    try {
      const data = await invoke({ type: action, tenantId, agentId });
      const payload = isRecord(data) && isRecord(data.data) ? data.data : {};
      const agent = overview.agents.find((entry) => entry.id === agentId);
      if (action === "rotateToken" && typeof payload.token === "string") {
        setToken({ agent: agent?.name ?? "Agent", token: payload.token });
        notify("Der neue Token ist erzeugt. Der bisherige gilt nicht mehr.");
      } else {
        notify("Der Agent wurde widerrufen. Sein Token gilt nicht mehr.");
      }
      setConfirm(null);
      await onChanged();
    } catch (error) {
      notify(await errorText(error, "Die Aktion ist fehlgeschlagen."), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ipam-discovery__stack">
      <div className="ipam-discovery__intro">
        <div>
          <h3>Netzwerkagenten</h3>
          <p>
            {tn(
              "Ein Agent läuft in deinem Netz (Docker oder Windows-Dienst), verbindet sich nur ausgehend per HTTPS und liefert Ping-, ARP-, SNMP- und LLDP-Daten sowie Microsoft DHCP/DNS. SNMP-Schlüssel und Dienstkonto bleiben in der lokalen config.json des Agenten.",
              "Ein Agent läuft in Ihrem Netz (Docker oder Windows-Dienst), verbindet sich nur ausgehend per HTTPS und liefert Ping-, ARP-, SNMP- und LLDP-Daten sowie Microsoft DHCP/DNS. SNMP-Schlüssel und Dienstkonto bleiben in der lokalen config.json des Agenten.",
            )}
          </p>
        </div>
        {canManage ? (
          <button
            className="primary-button"
            onClick={() => setCreating(true)}
            type="button"
          >
            <Plus aria-hidden="true" size={16} /> Agent anlegen
          </button>
        ) : null}
      </div>

      {token ? (
        <div className="ipam-discovery__token" role="alert">
          <KeyRound aria-hidden="true" size={20} />
          <div>
            <strong>
              Token für «{token.agent}» – wird nur jetzt angezeigt
            </strong>
            <p>
              {tn(
                "Trage ihn als «agentToken» in die config.json des Agenten ein.",
                "Tragen Sie ihn als «agentToken» in die config.json des Agenten ein.",
              )}
            </p>
            <code>{token.token}</code>
            <div className="ipam-discovery__actions">
              <button
                className="secondary-button"
                onClick={async () =>
                  notify(
                    (await copyText(token.token))
                      ? "Token kopiert."
                      : tn(
                          "Kopieren war nicht möglich. Bitte markiere den Text.",
                          "Kopieren war nicht möglich. Bitte markieren Sie den Text.",
                        ),
                    false,
                  )
                }
                type="button"
              >
                <Copy aria-hidden="true" size={16} /> Kopieren
              </button>
              <button
                className="text-button"
                onClick={() => setToken(null)}
                type="button"
              >
                Ich habe den Token gespeichert
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {creating ? (
        <AgentForm
          agent={null}
          onCancel={() => setCreating(false)}
          onSaved={async (result) => {
            setCreating(false);
            if (result.token)
              setToken({ agent: result.name, token: result.token });
            notify("Der Agent wurde angelegt.");
            await onChanged();
          }}
          overview={overview}
          tenantId={tenantId}
          notify={notify}
        />
      ) : null}

      {!overview.agents.length && !creating ? (
        <p className="ipam-discovery__empty">
          Noch kein Agent eingerichtet. Ohne Agent funktionieren Subnetze,
          Reservierungen und Import trotzdem; Discovery, Konflikterkennung und
          DHCP/DNS brauchen ihn.
        </p>
      ) : null}

      <div className="ipam-discovery__cards">
        {overview.agents.map((agent) => {
          const connection = connectionLabel(agent);
          return (
            <article className="ipam-agent-card" key={agent.id}>
              <header className="ipam-agent-card__head">
                <Server aria-hidden="true" size={20} />
                <div>
                  <h4>{agent.name}</h4>
                  <span className="ipam-discovery__muted">
                    {agent.hostname ?? "Hostname unbekannt"}
                    {agent.version ? ` · Version ${agent.version}` : ""}
                    {agent.platform
                      ? ` · ${agent.platform === "win32" ? "Windows" : agent.platform}`
                      : ""}
                  </span>
                </div>
                <Chip tone={connection.tone}>{connection.label}</Chip>
              </header>
              <dl className="ipam-discovery__facts">
                <div>
                  <dt>Zuletzt gesehen</dt>
                  <dd title={dateTime(agent.lastSeenAt)}>
                    {relativeTime(agent.lastSeenAt)}
                    {agent.connection === "offline" && agent.offlineNotifiedAt
                      ? " · Ausfall gemeldet"
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt>Letzter Bericht</dt>
                  <dd title={dateTime(agent.lastReportAt)}>
                    {relativeTime(agent.lastReportAt)}
                  </dd>
                </div>
                <div>
                  <dt>Subnetze</dt>
                  <dd>
                    {agent.config.scanAllActive
                      ? "alle aktiven"
                      : `${agent.config.prefixIds.length} ausgewählt`}{" "}
                    · alle {agent.config.scheduleMinutes} Min.
                  </dd>
                </div>
                <div>
                  <dt>SNMP / DHCP / DNS</dt>
                  <dd>
                    {agent.config.snmpTargets.length} Ziele ·{" "}
                    {agent.config.dhcpServers.length || "kein"} DHCP ·{" "}
                    {agent.config.dnsServers.length || "kein"} DNS
                    {agent.config.allowWrites ? " · schreibt" : " · nur lesend"}
                  </dd>
                </div>
                <div>
                  <dt>Token</dt>
                  <dd>
                    {agent.tokenHint ?? "–"} (seit{" "}
                    {dateTime(agent.tokenRotatedAt)})
                  </dd>
                </div>
              </dl>
              {agent.lastError ? (
                <p className="ipam-discovery__warning">
                  Letzte Meldung: {agent.lastError}
                </p>
              ) : null}
              {canManage ? (
                <div className="ipam-discovery__actions">
                  <button
                    className="secondary-button"
                    onClick={() =>
                      setEditing(editing === agent.id ? null : agent.id)
                    }
                    type="button"
                  >
                    Konfigurieren
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      setConfirm({ agentId: agent.id, action: "rotateToken" })
                    }
                    type="button"
                  >
                    <KeyRound aria-hidden="true" size={16} /> Token erneuern
                  </button>
                  <button
                    className="danger-action"
                    disabled={busy}
                    onClick={() =>
                      setConfirm({ agentId: agent.id, action: "revokeAgent" })
                    }
                    type="button"
                  >
                    <ShieldOff aria-hidden="true" size={16} /> Widerrufen
                  </button>
                </div>
              ) : null}
              {confirm?.agentId === agent.id ? (
                <div
                  className="ipam-discovery__confirm"
                  role="alertdialog"
                  aria-label="Bestätigen"
                >
                  <p>
                    {confirm.action === "rotateToken"
                      ? "Neuen Token erzeugen? Der Agent verliert die Verbindung, bis der neue Token in seiner config.json steht."
                      : "Agent widerrufen? Er kann sich danach nicht mehr anmelden; offene Aufträge werden abgebrochen."}
                  </p>
                  <div className="ipam-discovery__actions">
                    <button
                      className={
                        confirm.action === "revokeAgent"
                          ? "danger-action"
                          : "primary-button"
                      }
                      disabled={busy}
                      onClick={() => void tokenAction(agent.id, confirm.action)}
                      type="button"
                    >
                      {confirm.action === "rotateToken"
                        ? "Token erneuern"
                        : "Widerrufen"}
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setConfirm(null)}
                      type="button"
                    >
                      Abbrechen
                    </button>
                  </div>
                </div>
              ) : null}
              {editing === agent.id ? (
                <AgentForm
                  agent={agent}
                  notify={notify}
                  onCancel={() => setEditing(null)}
                  onSaved={async () => {
                    setEditing(null);
                    notify(
                      "Die Konfiguration wurde gespeichert. Der Agent übernimmt sie beim nächsten Kontakt.",
                    );
                    await onChanged();
                  }}
                  overview={overview}
                  tenantId={tenantId}
                />
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function AgentForm({
  tenantId,
  agent,
  overview,
  notify,
  onCancel,
  onSaved,
}: {
  tenantId: string;
  agent: DiscoveryAgent | null;
  overview: DiscoveryOverview;
  notify: (text: string, error?: boolean) => void;
  onCancel: () => void;
  onSaved: (result: { name: string; token: string | null }) => Promise<void>;
}) {
  const [name, setName] = useState(agent?.name ?? "");
  const [form, setForm] = useState<ConfigForm>(() =>
    configToForm(agent?.config ?? EMPTY_CONFIG),
  );
  const [disabled, setDisabled] = useState(agent?.status === "disabled");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = (patch: Partial<ConfigForm>) =>
    setForm((current) => ({ ...current, ...patch }));
  const updateRow = (index: number, patch: Partial<SnmpRow>) =>
    update({
      snmp: form.snmp.map((row, position) =>
        position === index ? { ...row, ...patch } : row,
      ),
    });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!name.trim()) {
      setError(
        tn(
          "Gib dem Agenten einen Namen.",
          "Geben Sie dem Agenten einen Namen.",
        ),
      );
      return;
    }
    const result = formToConfig(form);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSaving(true);
    try {
      const data = await invoke(
        agent
          ? {
              type: "updateAgent",
              tenantId,
              agentId: agent.id,
              name: name.trim(),
              config: result.config,
              status: disabled ? "disabled" : "active",
            }
          : {
              type: "createAgent",
              tenantId,
              name: name.trim(),
              config: result.config,
            },
      );
      const payload = isRecord(data) && isRecord(data.data) ? data.data : {};
      const saved = isRecord(payload.agent) ? parseAgent(payload.agent) : null;
      await onSaved({
        name: saved?.name ?? name.trim(),
        token: typeof payload.token === "string" ? payload.token : null,
      });
    } catch (failure) {
      const text = await errorText(
        failure,
        "Der Agent konnte nicht gespeichert werden.",
      );
      setError(text);
      notify(text, true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="ipam-agent-form" onSubmit={submit}>
      <h4>{agent ? `Konfiguration «${agent.name}»` : "Neuer Agent"}</h4>
      <div className="ipam-agent-form__grid">
        <label>
          Name
          <input
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </label>
        <label>
          Scan alle … Minuten
          <input
            inputMode="numeric"
            max={1440}
            min={5}
            onChange={(event) =>
              update({ scheduleMinutes: event.target.value })
            }
            type="number"
            value={form.scheduleMinutes}
          />
        </label>
        {overview.vrfs.length ? (
          <label>
            VRF des Agenten
            <select
              onChange={(event) => update({ vrfId: event.target.value })}
              value={form.vrfId}
            >
              <option value="">Global</option>
              {overview.vrfs.map((vrf) => (
                <option key={vrf.id} value={vrf.id}>
                  {vrf.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <fieldset>
        <legend>Subnetze</legend>
        <label className="ipam-discovery__check">
          <input
            checked={form.scanAllActive}
            onChange={(event) =>
              update({ scanAllActive: event.target.checked })
            }
            type="checkbox"
          />
          Alle aktiven Subnetze scannen
        </label>
        {!form.scanAllActive ? (
          <PrefixPicker
            prefixes={overview.prefixes}
            selected={form.prefixIds}
            onChange={(prefixIds) => update({ prefixIds })}
          />
        ) : null}
      </fieldset>

      <fieldset>
        <legend>SNMP-Ziele (Switches, Router)</legend>
        <p className="ipam-discovery__muted">
          {tn(
            "Nur Hostname, Version und Benutzer. Community bzw. Schlüssel trägst du in der config.json des Agenten ein.",
            "Nur Hostname, Version und Benutzer. Community bzw. Schlüssel tragen Sie in der config.json des Agenten ein.",
          )}
        </p>
        {form.snmp.map((row, index) => (
          <div className="ipam-agent-form__snmp" key={index}>
            <input
              aria-label="Host"
              onChange={(event) =>
                updateRow(index, { host: event.target.value })
              }
              placeholder="sw-a2-01.schule.local"
              value={row.host}
            />
            <select
              aria-label="Version"
              onChange={(event) =>
                updateRow(index, {
                  version: event.target.value === "v2c" ? "v2c" : "v3",
                })
              }
              value={row.version}
            >
              <option value="v3">SNMPv3</option>
              <option value="v2c">SNMPv2c</option>
            </select>
            {row.version === "v3" ? (
              <>
                <input
                  aria-label="Benutzer"
                  onChange={(event) =>
                    updateRow(index, { user: event.target.value })
                  }
                  placeholder="Benutzer"
                  value={row.user}
                />
                <select
                  aria-label="Authentifizierung"
                  onChange={(event) =>
                    updateRow(index, { authProtocol: event.target.value })
                  }
                  value={row.authProtocol}
                >
                  <option value="">ohne Auth</option>
                  {["sha256", "sha", "sha384", "sha512", "sha224", "md5"].map(
                    (protocol) => (
                      <option key={protocol} value={protocol}>
                        {protocol.toUpperCase()}
                      </option>
                    ),
                  )}
                </select>
                <select
                  aria-label="Verschlüsselung"
                  onChange={(event) =>
                    updateRow(index, { privProtocol: event.target.value })
                  }
                  value={row.privProtocol}
                >
                  <option value="">ohne Priv</option>
                  {["aes", "aes256b", "aes256r", "des"].map((protocol) => (
                    <option key={protocol} value={protocol}>
                      {protocol.toUpperCase()}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            <span className="ipam-agent-form__collect">
              {(["arp", "fdb", "lldp"] as const).map((key) => (
                <label key={key}>
                  <input
                    checked={row[key]}
                    onChange={(event) =>
                      updateRow(index, { [key]: event.target.checked })
                    }
                    type="checkbox"
                  />
                  {key === "fdb" ? "MAC" : key.toUpperCase()}
                </label>
              ))}
            </span>
            <button
              aria-label="SNMP-Ziel entfernen"
              className="text-button"
              onClick={() =>
                update({
                  snmp: form.snmp.filter((_, position) => position !== index),
                })
              }
              type="button"
            >
              <Trash2 aria-hidden="true" size={16} />
            </button>
          </div>
        ))}
        <button
          className="secondary-button"
          onClick={() => update({ snmp: [...form.snmp, emptySnmpRow()] })}
          type="button"
        >
          <Plus aria-hidden="true" size={16} /> SNMP-Ziel
        </button>
      </fieldset>

      <fieldset>
        <legend>Microsoft DHCP & DNS (nur Windows-Agent)</legend>
        <div className="ipam-agent-form__grid">
          <label>
            DHCP-Server (einer pro Zeile)
            <textarea
              onChange={(event) => update({ dhcpServers: event.target.value })}
              rows={2}
              value={form.dhcpServers}
            />
          </label>
          <label>
            DNS-Server
            <textarea
              onChange={(event) => update({ dnsServers: event.target.value })}
              rows={2}
              value={form.dnsServers}
            />
          </label>
          <label>
            DNS-Zonen (leer = alle primären)
            <textarea
              onChange={(event) => update({ dnsZones: event.target.value })}
              rows={2}
              value={form.dnsZones}
            />
          </label>
          <label>
            Standardzone für Hostnamen
            <input
              onChange={(event) =>
                update({ dnsDefaultZone: event.target.value })
              }
              placeholder="schule.local"
              value={form.dnsDefaultZone}
            />
          </label>
        </div>
        <label className="ipam-discovery__check">
          <input
            checked={form.allowWrites}
            onChange={(event) => update({ allowWrites: event.target.checked })}
            type="checkbox"
          />
          Änderungen an DHCP/DNS erlauben (Reservierungen, A- und PTR-Records).
          Zusätzlich muss «allowWrites» in der config.json des Agenten aktiv
          sein.
        </label>
      </fieldset>

      {agent ? (
        <label className="ipam-discovery__check">
          <input
            checked={disabled}
            onChange={(event) => setDisabled(event.target.checked)}
            type="checkbox"
          />
          Agent vorübergehend deaktivieren
        </label>
      ) : null}

      {error ? (
        <p className="ipam-discovery__message is-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="ipam-discovery__actions">
        <button className="primary-button" disabled={saving} type="submit">
          {agent ? "Speichern" : "Agent anlegen und Token erzeugen"}
        </button>
        <button className="text-button" onClick={onCancel} type="button">
          Abbrechen
        </button>
      </div>
    </form>
  );
}

function PrefixPicker({
  prefixes,
  selected,
  onChange,
}: {
  prefixes: PrefixOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [filter, setFilter] = useState("");
  const visible = prefixes.filter((prefix) =>
    `${prefix.prefix} ${prefix.description ?? ""}`
      .toLowerCase()
      .includes(filter.trim().toLowerCase()),
  );
  if (!prefixes.length) {
    return (
      <p className="ipam-discovery__muted">
        Noch keine aktiven Subnetze erfasst.
      </p>
    );
  }
  return (
    <div className="ipam-prefix-picker">
      <input
        aria-label="Subnetze filtern"
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Subnetz oder Beschreibung suchen"
        value={filter}
      />
      <div className="ipam-prefix-picker__list">
        {visible.slice(0, 300).map((prefix) => (
          <label key={prefix.id}>
            <input
              checked={selected.includes(prefix.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, prefix.id]
                    : selected.filter((id) => id !== prefix.id),
                )
              }
              type="checkbox"
            />
            <code>{prefix.prefix}</code> {prefix.description ?? ""}
          </label>
        ))}
      </div>
      <span className="ipam-discovery__muted">
        {selected.length} ausgewählt
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scans und Aufträge

function JobTable({
  jobs,
  agents,
  tenantId,
  canManage,
  notify,
  onChanged,
}: {
  jobs: DiscoveryJob[];
  agents: DiscoveryAgent[];
  tenantId: string;
  canManage: boolean;
  notify: (text: string, error?: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const names = new Map(agents.map((agent) => [agent.id, agent.name]));
  async function jobAction(type: "cancelJob" | "approveJob", jobId: string) {
    try {
      await invoke({ type, tenantId, jobId });
      notify(
        type === "cancelJob"
          ? "Der Auftrag wurde abgebrochen."
          : "Der Auftrag ist freigegeben.",
      );
      await onChanged();
    } catch (error) {
      notify(await errorText(error, "Die Aktion ist fehlgeschlagen."), true);
    }
  }
  if (!jobs.length)
    return <p className="ipam-discovery__empty">Keine Aufträge.</p>;
  return (
    <div className="ipam-discovery__table-wrap">
      <table className="ipam-discovery__table">
        <thead>
          <tr>
            <th scope="col">Auftrag</th>
            <th scope="col">Details</th>
            <th scope="col">Agent</th>
            <th scope="col">Status</th>
            <th scope="col">Erstellt</th>
            <th scope="col">
              <span className="sr-only">Aktion</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const status = jobStatusLabel(job.status);
            return (
              <tr key={job.id}>
                <td>{JOB_KIND_LABELS[job.kind]}</td>
                <td>
                  {jobSummary(job)}
                  {job.error ? (
                    <div className="ipam-discovery__error-line">
                      {job.error}
                    </div>
                  ) : null}
                </td>
                <td>{names.get(job.agentId) ?? "–"}</td>
                <td>
                  <Chip tone={status.tone}>{status.label}</Chip>
                </td>
                <td title={dateTime(job.createdAt)}>
                  {relativeTime(job.createdAt)}
                </td>
                <td>
                  {canManage && job.status === "pending_approval" ? (
                    <button
                      className="text-button"
                      onClick={() => void jobAction("approveJob", job.id)}
                      type="button"
                    >
                      Freigeben
                    </button>
                  ) : null}
                  {canManage &&
                  (job.status === "queued" ||
                    job.status === "pending_approval") ? (
                    <button
                      className="text-button"
                      onClick={() => void jobAction("cancelJob", job.id)}
                      type="button"
                    >
                      Abbrechen
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ScansView({
  tenantId,
  canManage,
  overview,
  notify,
  onChanged,
}: ViewProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const names = new Map(overview.agents.map((agent) => [agent.id, agent.name]));
  const activeAgents = overview.agents.filter(
    (agent) => agent.status === "active",
  );

  async function scanNow(agentId: string) {
    setBusy(agentId);
    try {
      await invoke({ type: "scanNow", tenantId, agentId });
      notify(
        "Der Scan ist geplant und startet beim nächsten Kontakt des Agenten (spätestens nach etwa einer Minute).",
      );
      await onChanged();
    } catch (error) {
      notify(
        await errorText(error, "Der Scan konnte nicht gestartet werden."),
        true,
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="ipam-discovery__stack">
      <div className="ipam-discovery__cards ipam-discovery__cards--compact">
        {activeAgents.map((agent) => {
          const connection = connectionLabel(agent);
          const pending = overview.jobs.some(
            (job) =>
              job.agentId === agent.id &&
              job.kind === "scan_now" &&
              isJobOpen(job),
          );
          return (
            <article className="ipam-agent-card" key={agent.id}>
              <header className="ipam-agent-card__head">
                <Radar aria-hidden="true" size={20} />
                <div>
                  <h4>{agent.name}</h4>
                  <span className="ipam-discovery__muted">
                    Letzter Bericht {relativeTime(agent.lastReportAt)} · alle{" "}
                    {agent.config.scheduleMinutes} Min.
                  </span>
                </div>
                <Chip tone={connection.tone}>{connection.label}</Chip>
              </header>
              {canManage ? (
                <button
                  className="primary-button"
                  disabled={pending || busy === agent.id}
                  onClick={() => void scanNow(agent.id)}
                  type="button"
                >
                  {pending ? "Scan geplant …" : "Jetzt scannen"}
                </button>
              ) : null}
            </article>
          );
        })}
        {!activeAgents.length ? (
          <p className="ipam-discovery__empty">Kein aktiver Agent.</p>
        ) : null}
      </div>

      <h3>Letzte Durchläufe</h3>
      {overview.runs.length ? (
        <div className="ipam-discovery__table-wrap">
          <table className="ipam-discovery__table">
            <thead>
              <tr>
                <th scope="col">Start</th>
                <th scope="col">Agent</th>
                <th scope="col">Auslöser</th>
                <th scope="col">Dauer</th>
                <th scope="col">Ergebnis</th>
              </tr>
            </thead>
            <tbody>
              {overview.runs.map((run) => (
                <tr key={run.id}>
                  <td>{dateTime(run.startedAt)}</td>
                  <td>{names.get(run.agentId) ?? "–"}</td>
                  <td>
                    {run.trigger === "manual"
                      ? "Jetzt scannen"
                      : run.trigger === "startup"
                        ? "Start"
                        : "Zeitplan"}
                  </td>
                  <td>{runDuration(run)}</td>
                  <td>
                    {runSummary(run)}
                    {run.errors.slice(0, 3).map((error) => (
                      <div className="ipam-discovery__error-line" key={error}>
                        {error}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ipam-discovery__empty">Noch keine Scans.</p>
      )}

      <h3>Aufträge</h3>
      <JobTable
        agents={overview.agents}
        canManage={canManage}
        jobs={overview.jobs}
        notify={notify}
        onChanged={onChanged}
        tenantId={tenantId}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// DHCP & DNS

function DhcpDnsView({
  tenantId,
  canManage,
  overview,
  notify,
  onChanged,
}: ViewProps) {
  const [data, setData] = useState<DhcpDnsData | null>(null);
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [queued, setQueued] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const parsed = parseDhcpDns(
        await invoke({
          type: "dhcpDns",
          tenantId,
          scopeId,
          ...(query ? { search: query } : {}),
        }),
      );
      if (!parsed) throw new Error("Die Serverantwort ist unvollständig.");
      setData(parsed);
    } catch (error) {
      notify(
        await errorText(error, "DHCP und DNS konnten nicht geladen werden."),
        true,
      );
    } finally {
      setLoading(false);
    }
  }, [notify, query, scopeId, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const writeJobs = useMemo(
    () => overview.jobs.filter((job) => job.kind !== "scan_now"),
    [overview.jobs],
  );

  async function queue(
    row: DnsDiffRow | { addressId: string },
    operation: QueueOperation,
  ) {
    const key = `${row.addressId}:${operation}`;
    try {
      const response = await invoke({
        type: "queueJob",
        tenantId,
        addressId: row.addressId,
        operation,
      });
      const job =
        isRecord(response) &&
        isRecord(response.data) &&
        isRecord(response.data.job)
          ? parseJob(response.data.job)
          : null;
      setQueued((current) => new Set(current).add(key));
      notify(
        job
          ? `Auftrag «${JOB_KIND_LABELS[job.kind]}» erstellt. Der Agent führt ihn beim nächsten Kontakt aus.`
          : "Der Auftrag wurde erstellt.",
      );
      await onChanged();
    } catch (error) {
      notify(
        await errorText(error, "Der Auftrag konnte nicht erstellt werden."),
        true,
      );
    }
  }

  const selectedScope =
    data?.scopes.find(
      (scope) => scope.id === (data.selectedScopeId ?? scopeId),
    ) ?? null;

  return (
    <div className="ipam-discovery__stack">
      {loading && !data ? (
        <p className="ipam-discovery__muted">DHCP und DNS werden geladen …</p>
      ) : null}
      {data ? (
        <>
          <section>
            <h3>DHCP-Bereiche</h3>
            {data.scopes.length ? (
              <div className="ipam-discovery__table-wrap">
                <table className="ipam-discovery__table">
                  <thead>
                    <tr>
                      <th scope="col">Bereich</th>
                      <th scope="col">Name</th>
                      <th scope="col">Server</th>
                      <th scope="col">Pool</th>
                      <th scope="col">Auslastung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.scopes.map((scope) => {
                      const percent = scopeUtilization(scope);
                      const active =
                        scope.id === (data.selectedScopeId ?? scopeId);
                      return (
                        <tr
                          className={active ? "is-selected" : ""}
                          key={scope.id}
                        >
                          <td>
                            <button
                              className="text-button"
                              onClick={() => setScopeId(scope.id)}
                              type="button"
                            >
                              {scope.scopeId}
                              {scope.subnetMask ? ` / ${scope.subnetMask}` : ""}
                            </button>
                          </td>
                          <td>
                            {scope.name ?? "–"}
                            {scope.state && scope.state !== "Active"
                              ? ` (${scope.state})`
                              : ""}
                          </td>
                          <td>{scope.server}</td>
                          <td>
                            {scope.startRange ?? "?"} – {scope.endRange ?? "?"}
                          </td>
                          <td>
                            <div
                              className="ipam-discovery__meter"
                              data-tone={utilizationTone(percent)}
                            >
                              <span style={{ width: `${percent ?? 0}%` }} />
                            </div>
                            <small>
                              {percent === null
                                ? "unbekannt"
                                : `${percent} % · ${scope.inUse ?? 0} belegt, ${scope.reserved ?? 0} reserviert, ${scope.free ?? 0} frei`}
                            </small>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="ipam-discovery__empty">
                {tn(
                  "Noch keine DHCP-Daten. Trage beim Agenten DHCP-Server ein (Windows-Agent).",
                  "Noch keine DHCP-Daten. Tragen Sie beim Agenten DHCP-Server ein (Windows-Agent).",
                )}
              </p>
            )}
          </section>

          {selectedScope ? (
            <section>
              <h3>
                Leases und Reservierungen {selectedScope.scopeId}
                {selectedScope.name ? ` (${selectedScope.name})` : ""}
              </h3>
              {data.leases.length ? (
                <div className="ipam-discovery__table-wrap">
                  <table className="ipam-discovery__table">
                    <thead>
                      <tr>
                        <th scope="col">Adresse</th>
                        <th scope="col">Hostname</th>
                        <th scope="col">MAC</th>
                        <th scope="col">Art</th>
                        <th scope="col">Läuft ab</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.leases.map((lease) => (
                        <tr key={lease.id}>
                          <td>
                            <code>{lease.address}</code>
                          </td>
                          <td>{lease.hostname ?? "–"}</td>
                          <td>
                            <code>{lease.mac ?? "–"}</code>
                          </td>
                          <td>
                            {lease.reservation ? (
                              <Chip tone="info">Reservierung</Chip>
                            ) : (
                              <Chip tone="neutral">
                                {lease.state ?? "Lease"}
                              </Chip>
                            )}
                          </td>
                          <td>
                            {lease.reservation
                              ? "–"
                              : dateTime(lease.expiresAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="ipam-discovery__empty">
                  Keine Leases in diesem Bereich.
                </p>
              )}
            </section>
          ) : null}

          <section>
            <h3>DNS-Abgleich mit der IP-Dokumentation</h3>
            {!data.zones.length ? (
              <p className="ipam-discovery__empty">
                {tn(
                  "Noch keine DNS-Daten. Trage beim Agenten DNS-Server ein (Windows-Agent).",
                  "Noch keine DNS-Daten. Tragen Sie beim Agenten DNS-Server ein (Windows-Agent).",
                )}
              </p>
            ) : data.diff.length ? (
              <div className="ipam-discovery__table-wrap">
                <table className="ipam-discovery__table">
                  <thead>
                    <tr>
                      <th scope="col">Adresse</th>
                      <th scope="col">Name in nextDesk</th>
                      <th scope="col">Abweichung</th>
                      <th scope="col">Heute im DNS</th>
                      <th scope="col">
                        <span className="sr-only">Aktion</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.diff.map((row) => {
                      const operation = dnsActionOperation(row.action);
                      const key = `${row.addressId}:${operation}`;
                      const open = writeJobs.some(
                        (job) =>
                          job.addressId === row.addressId && isJobOpen(job),
                      );
                      return (
                        <tr key={`${row.addressId}:${row.issue}`}>
                          <td>
                            <code>{row.address}</code>
                          </td>
                          <td>{row.expectedName}</td>
                          <td>
                            <Chip
                              tone={
                                row.issue.startsWith("missing")
                                  ? "warning"
                                  : "danger"
                              }
                            >
                              {DNS_ISSUE_LABELS[row.issue]}
                            </Chip>
                          </td>
                          <td>{row.current.join(", ") || "–"}</td>
                          <td>
                            {canManage ? (
                              <button
                                className="secondary-button"
                                disabled={open || queued.has(key)}
                                onClick={() => void queue(row, operation)}
                                type="button"
                              >
                                {open || queued.has(key)
                                  ? "Auftrag läuft"
                                  : `${DNS_ISSUE_LABELS[row.issue]} – ${DNS_ACTION_LABELS[row.action]}`}
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="ipam-discovery__empty">
                DNS und IP-Dokumentation stimmen überein.
              </p>
            )}
          </section>

          <section>
            <div className="ipam-discovery__intro">
              <h3>DNS-Records</h3>
              <form
                className="ipam-discovery__search"
                onSubmit={(event) => {
                  event.preventDefault();
                  setQuery(search.trim());
                }}
              >
                <input
                  aria-label="DNS-Records suchen"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Name oder Wert"
                  value={search}
                />
                <button className="secondary-button" type="submit">
                  Suchen
                </button>
              </form>
            </div>
            {data.zones.length ? (
              <p className="ipam-discovery__muted">
                Zonen:{" "}
                {data.zones
                  .map((zone) => `${zone.zone} (${zone.records})`)
                  .join(", ")}
              </p>
            ) : null}
            {data.records.length ? (
              <div className="ipam-discovery__table-wrap">
                <table className="ipam-discovery__table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Typ</th>
                      <th scope="col">Wert</th>
                      <th scope="col">Zone</th>
                      <th scope="col">TTL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.records.map((record) => (
                      <tr key={record.id}>
                        <td>{record.name}</td>
                        <td>{record.type}</td>
                        <td>
                          <code>{record.value}</code>
                        </td>
                        <td>{record.zone}</td>
                        <td>{record.ttl ?? "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : data.zones.length ? (
              <p className="ipam-discovery__empty">Keine passenden Records.</p>
            ) : null}
          </section>

          <section>
            <h3>DHCP- und DNS-Aufträge</h3>
            <JobTable
              agents={overview.agents}
              canManage={canManage}
              jobs={writeJobs}
              notify={notify}
              onChanged={onChanged}
              tenantId={tenantId}
            />
          </section>
        </>
      ) : null}
    </div>
  );
}
