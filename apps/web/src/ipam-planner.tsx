// Subnetz-Planer (Supernetz aufteilen, Vorschau, in einem Schritt anlegen)
// und IP-Rechner (rein clientseitig).

import { tn } from "./lib/formality";
import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Notice, errorText, useDebounced, useIpamQuery } from "./ipam-ui";
import { ipamCall } from "./lib/ipam-api";
import {
  barTicks,
  buildBar,
  calculate,
  findKnownPrefix,
  formatCountText,
  hostsForLength,
  plannerLengths,
} from "./lib/ipam-calc";
import { percentText } from "./lib/ipam-format";
import type { IpamOverview, IpamPrefix } from "./lib/ipam-model";
import type {
  AddressSpace,
  PlanItem,
  PlanResult,
} from "./lib/ipam-redesign-types";
import { hasChildren } from "./lib/ipam-tree";

type Row = {
  id: number;
  name: string;
  length: number;
  vlan: string;
  zone: string;
};

/** Prefixes that can be split: containers and prefixes with children. */
export function plannerParents(prefixes: IpamPrefix[]): IpamPrefix[] {
  const candidates = prefixes.filter(
    (prefix) =>
      prefix.status !== "deprecated" &&
      (prefix.status === "container" || hasChildren(prefixes, prefix.id)),
  );
  // Containers first (in tree order), then active prefixes with children.
  return [
    ...candidates.filter((prefix) => prefix.status === "container"),
    ...candidates.filter((prefix) => prefix.status !== "container"),
  ];
}

/** Rows → contract items (VLAN only when a number 1–4094 is given). */
export function planItems(rows: Row[]): PlanItem[] {
  return rows.map((row) => {
    const vlan = Number(row.vlan);
    return {
      name: row.name.trim(),
      length: row.length,
      vlanNumber:
        row.vlan.trim() && Number.isInteger(vlan) && vlan >= 1 && vlan <= 4094
          ? vlan
          : null,
      securityZone: row.zone.trim() || null,
    };
  });
}

export function IpamPlannerPage({
  canManage,
  initialParentId,
  onChanged,
  onOpenPrefix,
  overview,
  revision,
  tenantId,
}: {
  canManage: boolean;
  initialParentId: string | null;
  onChanged: (message?: string) => void;
  onOpenPrefix: (prefixId: string) => void;
  overview: IpamOverview;
  revision: number;
  tenantId: string;
}) {
  return (
    <div className="ipam-columns">
      <div className="ipam-columns__main">
        {canManage ? (
          <Planner
            initialParentId={initialParentId}
            onChanged={onChanged}
            onOpenPrefix={onOpenPrefix}
            overview={overview}
            revision={revision}
            tenantId={tenantId}
          />
        ) : (
          <section className="ipam-card">
            <h3>Supernetz aufteilen</h3>
            <p className="ipam-muted">
              {tn(
                "Für den Planer brauchst du das Recht, IP-Adressen, Subnetze und VLANs zu verwalten. Der IP-Rechner steht allen zur Verfügung.",
                "Für den Planer brauchen Sie das Recht, IP-Adressen, Subnetze und VLANs zu verwalten. Der IP-Rechner steht allen zur Verfügung.",
              )}
            </p>
          </section>
        )}
      </div>
      <div className="ipam-columns__side">
        <IpCalculator
          onOpenPrefix={onOpenPrefix}
          prefixes={overview.prefixes}
        />
      </div>
    </div>
  );
}

function Planner({
  initialParentId,
  onChanged,
  onOpenPrefix,
  overview,
  revision,
  tenantId,
}: {
  initialParentId: string | null;
  onChanged: (message?: string) => void;
  onOpenPrefix: (prefixId: string) => void;
  overview: IpamOverview;
  revision: number;
  tenantId: string;
}) {
  const parents = useMemo(
    () => plannerParents(overview.prefixes),
    [overview.prefixes],
  );
  const [parentId, setParentId] = useState<string>(
    initialParentId && parents.some((prefix) => prefix.id === initialParentId)
      ? initialParentId
      : (parents[0]?.id ?? ""),
  );
  const parent = parents.find((prefix) => prefix.id === parentId) ?? null;
  const lengths = parent ? plannerLengths(parent.prefix) : [];
  const defaultLength =
    lengths.find((length) => length === 24) ??
    lengths[lengths.length - 1] ??
    24;
  const [rows, setRows] = useState<Row[]>([
    { id: 1, name: "", length: defaultLength, vlan: "", zone: "" },
  ]);
  const [nextId, setNextId] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const space = useIpamQuery<AddressSpace>(
    parent ? { type: "addressSpace", tenantId, prefixId: parent.id } : null,
    `${parentId}-${revision}`,
  );
  const items = planItems(rows);
  const itemsKey = JSON.stringify(items);
  const debouncedKey = useDebounced(itemsKey, 350);
  const [preview, setPreview] = useState<PlanResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!parent) return;
    const planned = JSON.parse(debouncedKey) as PlanItem[];
    if (!planned.length) {
      setPreview(null);
      return;
    }
    let active = true;
    setPreviewError(null);
    ipamCall<PlanResult>({
      type: "planPrefixes",
      tenantId,
      parentPrefixId: parent.id,
      items: planned.map((item) => ({ ...item, name: item.name || "Neu" })),
      dryRun: true,
    })
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((failure: unknown) => {
        if (active)
          setPreviewError(
            errorText(failure, "Die Vorschau konnte nicht berechnet werden."),
          );
      });
    return () => {
      active = false;
    };
  }, [debouncedKey, parent, tenantId, revision]);

  const changeParent = (id: string) => {
    setParentId(id);
    setPreview(null);
    const next = parents.find((prefix) => prefix.id === id);
    const nextLengths = next ? plannerLengths(next.prefix) : [];
    setRows((current) =>
      current.map((row) => ({
        ...row,
        length: nextLengths.includes(row.length)
          ? row.length
          : (nextLengths.find((length) => length === 24) ??
            nextLengths[nextLengths.length - 1] ??
            row.length),
      })),
    );
  };
  const update = (id: number, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  const fresh = preview && debouncedKey === itemsKey;
  const results = fresh ? preview.items : null;
  const bar = parent
    ? buildBar(
        parent.prefix,
        (space.data?.segments ?? [])
          .filter((segment) => segment.kind === "child")
          .map((segment) => ({
            cidr: segment.cidr,
            name: segment.name ?? null,
            ...(segment.prefixId ? { prefixId: segment.prefixId } : {}),
          })),
        (results ?? [])
          .filter((item) => item.cidr)
          .map((item) => ({ cidr: item.cidr!, name: item.name })),
      )
    : [];
  const missingName = rows.some((row) => !row.name.trim());
  const hasErrors = (results ?? []).some((item) => item.error || !item.cidr);
  const create = async () => {
    if (!parent) return;
    setBusy(true);
    setError(null);
    try {
      const result = await ipamCall<PlanResult>({
        type: "planPrefixes",
        tenantId,
        parentPrefixId: parent.id,
        items,
        dryRun: false,
      });
      const created = result.items.filter((item) => item.cidr && !item.error);
      setRows([
        { id: nextId, name: "", length: defaultLength, vlan: "", zone: "" },
      ]);
      setNextId(nextId + 1);
      onChanged(
        created.length === 1
          ? `1 Teilnetz in ${parent.prefix} angelegt.`
          : `${created.length} Teilnetze in ${parent.prefix} angelegt.`,
      );
    } catch (failure) {
      setError(
        errorText(failure, "Die Teilnetze konnten nicht angelegt werden."),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!parents.length) {
    return (
      <section className="ipam-card">
        <h3>Supernetz aufteilen</h3>
        <p className="ipam-muted">
          {tn(
            "Es gibt noch kein Supernetz (Status «Container»). Lege zuerst eines an, z. B. 10.20.0.0/16.",
            "Es gibt noch kein Supernetz (Status «Container»). Legen Sie zuerst eines an, z. B. 10.20.0.0/16.",
          )}
        </p>
      </section>
    );
  }

  return (
    <section className="ipam-card ipam-planner">
      <div className="ipam-card__head ipam-card__head--wrap">
        <div>
          <h3>Supernetz aufteilen</h3>
          <p className="ipam-muted">
            Teilnetze planen, Vorschau prüfen, dann in einem Schritt anlegen –
            mit VLAN und Standort des Supernetzes.
          </p>
        </div>
        <label className="ipam-field">
          Supernetz
          <select
            onChange={(event) => changeParent(event.target.value)}
            value={parentId}
          >
            {parents.map((prefix) => (
              <option key={prefix.id} value={prefix.id}>
                {prefix.prefix}
                {prefix.description ? ` · ${prefix.description}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {parent ? (
        <div className="ipam-map">
          <div className="ipam-map__bar ipam-map__bar--tall">
            {bar.map((segment) => (
              <div
                className={`ipam-plan-seg ipam-plan-seg--${segment.kind}`}
                key={`${segment.kind}-${segment.label}`}
                style={{ flexGrow: Math.max(segment.share, 0.004) }}
                title={`${segment.kind === "free" ? "frei: " : ""}${segment.label}${segment.name ? ` ${segment.name}` : ""}`}
              >
                {segment.share >= 0.05 ? (
                  <>
                    <span>{segment.kind === "free" ? "" : segment.name}</span>
                    <span className="ipam-mono">
                      {segment.kind === "free" ? "frei" : segment.label}
                    </span>
                  </>
                ) : null}
              </div>
            ))}
          </div>
          <div aria-hidden="true" className="ipam-map__ticks ipam-mono">
            {barTicks(parent.prefix).map((tick) => (
              <span key={tick}>{tick}</span>
            ))}
          </div>
          <ul className="ipam-legend">
            <li>
              <i className="ipam-plan-seg--existing" />
              bestehend
            </li>
            <li>
              <i className="ipam-plan-seg--planned" />
              geplant
            </li>
            <li>
              <i className="ipam-plan-seg--free" />
              frei
            </li>
            {space.data ? (
              <li>
                bereits vergeben: {percentText(space.data.allocatedPercent)}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="ipam-table-wrap">
        <table className="ipam-table ipam-plan-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Grösse</th>
              <th>VLAN</th>
              <th>Zone</th>
              <th>Ergebnis</th>
              <th>Hosts</th>
              <th>
                <span className="sr-only">Entfernen</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const result = results?.[index] ?? null;
              return (
                <tr key={row.id}>
                  <td>
                    <input
                      aria-label={`Name Zeile ${index + 1}`}
                      maxLength={120}
                      onChange={(event) =>
                        update(row.id, { name: event.target.value })
                      }
                      placeholder="z. B. KAMERA"
                      value={row.name}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`Grösse Zeile ${index + 1}`}
                      onChange={(event) =>
                        update(row.id, { length: Number(event.target.value) })
                      }
                      value={row.length}
                    >
                      {lengths.map((length) => (
                        <option key={length} value={length}>
                          /{length}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`VLAN Zeile ${index + 1}`}
                      className="ipam-input-narrow"
                      inputMode="numeric"
                      onChange={(event) =>
                        update(row.id, { vlan: event.target.value })
                      }
                      value={row.vlan}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Zone Zeile ${index + 1}`}
                      className="ipam-input-narrow"
                      maxLength={60}
                      onChange={(event) =>
                        update(row.id, { zone: event.target.value })
                      }
                      value={row.zone}
                    />
                  </td>
                  <td
                    className={`ipam-mono ${result?.error || (result && !result.cidr) ? "ipam-tone-danger" : "ipam-plan-result"}`}
                  >
                    {result
                      ? (result.cidr ?? result.error ?? "kein Platz")
                      : "…"}
                    {result?.cidr && result.error ? (
                      <small className="ipam-tone-danger">
                        {" "}
                        {result.error}
                      </small>
                    ) : null}
                  </td>
                  <td>
                    {result?.hosts
                      ? formatCountText(result.hosts)
                      : hostsForLength(
                          row.length,
                          parent?.prefix.includes(":") ? 6 : 4,
                        )}
                  </td>
                  <td>
                    <button
                      aria-label={`Zeile ${index + 1} entfernen`}
                      className="icon-button"
                      disabled={rows.length === 1}
                      onClick={() =>
                        setRows((current) =>
                          current.filter((entry) => entry.id !== row.id),
                        )
                      }
                      type="button"
                    >
                      <X aria-hidden="true" size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Notice error={error ?? previewError ?? space.error} />
      <div className="ipam-planner__foot">
        <button
          className="secondary-button"
          disabled={rows.length >= 64}
          onClick={() => {
            setRows([
              ...rows,
              {
                id: nextId,
                name: "",
                length: defaultLength,
                vlan: "",
                zone: "",
              },
            ]);
            setNextId(nextId + 1);
          }}
          type="button"
        >
          <Plus aria-hidden="true" size={15} /> Teilnetz hinzufügen
        </button>
        <span className="ipam-planner__summary">
          {fresh
            ? `Danach frei: ${formatCountText(preview.freeAfter)} Adressen`
            : "Vorschau wird berechnet …"}
        </span>
        <button
          className="primary-button"
          disabled={busy || !fresh || hasErrors || missingName}
          onClick={() => void create()}
          title={
            missingName ? "Bitte jedem Teilnetz einen Namen geben." : undefined
          }
          type="button"
        >
          {busy ? "Wird angelegt …" : "Geplante Teilnetze anlegen"}
        </button>
      </div>
      {parent ? (
        <button
          className="text-button"
          onClick={() => onOpenPrefix(parent.id)}
          type="button"
        >
          {parent.prefix} in «Netze» öffnen
        </button>
      ) : null}
    </section>
  );
}

export function IpCalculator({
  onOpenPrefix,
  prefixes,
}: {
  onOpenPrefix: (prefixId: string) => void;
  prefixes: IpamPrefix[];
}) {
  const [input, setInput] = useState("");
  const result = calculate(input);
  const known = result ? findKnownPrefix(result.cidr, prefixes) : null;
  return (
    <section className="ipam-card ipam-calc">
      <h3>IP-Rechner</h3>
      <label className="ipam-field" htmlFor="ipam-calc-input">
        Adresse mit Präfix
      </label>
      <input
        autoComplete="off"
        id="ipam-calc-input"
        onChange={(event) => setInput(event.target.value)}
        placeholder="z. B. 172.16.68.0/22 oder 10.0.0.5 255.255.255.0"
        spellCheck={false}
        value={input}
      />
      {result ? (
        <dl className="ipam-kv2">
          <div>
            <dt>Netz</dt>
            <dd className="ipam-mono">{result.network}</dd>
          </div>
          {result.mask ? (
            <div>
              <dt>Maske</dt>
              <dd className="ipam-mono">{result.mask}</dd>
            </div>
          ) : null}
          {result.wildcard ? (
            <div>
              <dt>Wildcard</dt>
              <dd className="ipam-mono">{result.wildcard}</dd>
            </div>
          ) : null}
          <div>
            <dt>Erste nutzbare</dt>
            <dd className="ipam-mono">{result.first}</dd>
          </div>
          <div>
            <dt>Letzte nutzbare</dt>
            <dd className="ipam-mono">{result.last}</dd>
          </div>
          {result.broadcast ? (
            <div>
              <dt>Broadcast</dt>
              <dd className="ipam-mono">{result.broadcast}</dd>
            </div>
          ) : null}
          <div>
            <dt>Hosts</dt>
            <dd>{result.hosts}</dd>
          </div>
          <div>
            <dt>In nextDesk</dt>
            <dd>
              {known ? (
                <button
                  className="text-button"
                  onClick={() => onOpenPrefix(known.item.id)}
                  type="button"
                >
                  {known.exact ? "" : "liegt in "}
                  <span className="ipam-mono">{known.item.prefix}</span>
                  {known.item.description ? ` · ${known.item.description}` : ""}
                  {known.item.usage
                    ? ` · ${percentText(known.item.usage.percent)}`
                    : ""}
                </button>
              ) : (
                "nicht erfasst"
              )}
            </dd>
          </div>
        </dl>
      ) : input.trim() ? (
        <p className="ipam-tone-danger" role="alert">
          Bitte eine Adresse mit Präfix eingeben, z. B. 10.20.30.0/24.
        </p>
      ) : (
        <p className="ipam-muted">
          Rechnet Netz, Maske, Bereich und Anzahl Hosts aus – für IPv4 und IPv6.
        </p>
      )}
      {result?.hostBitsSet ? (
        <p className="ipam-muted">
          Hinweis: Die Eingabe enthält Host-Bits; gezeigt wird das Netz.
        </p>
      ) : null}
    </section>
  );
}
