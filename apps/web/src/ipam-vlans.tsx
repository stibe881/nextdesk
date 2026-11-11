// IPAM «VLANs»: Matrix Funktion × Standort gegen die Standort-Vorlage,
// Liste nach Standort, Vorlagen-Editor und «Standort aus Vorlage».

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  FormCard,
  FormDialog,
  FormField,
  FormGrid,
  FormNote,
} from "./form-kit";
import {
  Meter,
  Notice,
  Segmented,
  errorText,
  useDebounced,
  useIpamQuery,
  type IpamDialog,
} from "./ipam-ui";
import { ipamCall } from "./lib/ipam-api";
import { freeBlocksOfLength } from "./lib/ipam-calc";
import { parseCidr } from "./lib/ipam-cidr";
import {
  cellFor,
  emptyTemplateEntry,
  groupVlansBySite,
  matrixCellView,
  validateTemplate,
} from "./lib/ipam-matrix";
import type { IpamOverview } from "./lib/ipam-model";
import type {
  AddressSpace,
  SiteFromTemplateResult,
  SiteOverview,
  SiteTemplate,
  TemplateEntry,
  TemplateList,
  VlanMatrix,
} from "./lib/ipam-redesign-types";

type Props = {
  canManage: boolean;
  onChanged: (message?: string) => void;
  onDialog: (dialog: IpamDialog) => void;
  onOpenPrefix: (prefixId: string) => void;
  onOpenSite: (siteId: string) => void;
  overview: IpamOverview;
  revision: number;
  tenantId: string;
};

export function IpamVlansPage(props: Props) {
  const { canManage, overview, revision, tenantId } = props;
  const [view, setView] = useState<"matrix" | "list">("matrix");
  const [templateId, setTemplateId] = useState<string>("");
  const [editor, setEditor] = useState<SiteTemplate | null>(null);
  const [fromTemplate, setFromTemplate] = useState(false);
  const templates = useIpamQuery<TemplateList>(
    { type: "listTemplates", tenantId },
    `${tenantId}-${revision}`,
  );
  const matrix = useIpamQuery<VlanMatrix>(
    view === "matrix"
      ? { type: "vlanMatrix", tenantId, ...(templateId ? { templateId } : {}) }
      : null,
    `${tenantId}-${revision}-${view}-${templateId}`,
  );
  const list = templates.data?.templates ?? [];
  const activeTemplate =
    matrix.data?.template ??
    list.find((entry) => entry.id === templateId) ??
    list[0] ??
    null;

  const openEditor = () =>
    setEditor(
      activeTemplate ??
        templates.data?.suggested ?? {
          name: "Standard-Standort",
          description: null,
          prefixLength: 19,
          entries: [emptyTemplateEntry(0)],
        },
    );

  return (
    <div className="ipam-page">
      <div className="ipam-card ipam-toolbar">
        <Segmented
          label="Ansicht"
          onChange={setView}
          options={[
            { value: "matrix", label: "Matrix" },
            { value: "list", label: "Liste" },
          ]}
          value={view}
        />
        {view === "matrix" ? (
          <span className="ipam-muted">
            Zeilen = Funktion aus der Standort-Vorlage, Spalten = Standorte
          </span>
        ) : null}
        {list.length > 1 && view === "matrix" ? (
          <select
            aria-label="Vorlage"
            onChange={(event) => setTemplateId(event.target.value)}
            value={templateId || activeTemplate?.id || ""}
          >
            {list.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        ) : null}
        <span className="ipam-toolbar__spacer" />
        {canManage ? (
          <>
            <button
              className="secondary-button"
              onClick={openEditor}
              type="button"
            >
              Standort-Vorlage
            </button>
            <button
              className="secondary-button"
              disabled={!list.length}
              onClick={() => setFromTemplate(true)}
              title={
                list.length
                  ? undefined
                  : "Zuerst eine Standort-Vorlage speichern."
              }
              type="button"
            >
              <Plus aria-hidden="true" size={15} /> Standort aus Vorlage
            </button>
            <button
              className="primary-button"
              onClick={() => props.onDialog({ kind: "vlan", vlan: null })}
              type="button"
            >
              <Plus aria-hidden="true" size={16} /> VLAN
            </button>
          </>
        ) : null}
      </div>

      {view === "matrix" ? (
        <MatrixSection
          {...props}
          error={matrix.error}
          matrix={matrix.data}
          onEditTemplate={openEditor}
          suggested={templates.data?.suggested ?? null}
        />
      ) : (
        <VlanList {...props} />
      )}

      {editor ? (
        <TemplateEditor
          initial={editor}
          onClose={() => setEditor(null)}
          onSaved={(message, id) => {
            setEditor(null);
            if (id) setTemplateId(id);
            props.onChanged(message);
          }}
          tenantId={tenantId}
        />
      ) : null}
      {fromTemplate && list.length ? (
        <SiteFromTemplateDialog
          onClose={() => setFromTemplate(false)}
          onCreated={(message, siteId) => {
            setFromTemplate(false);
            props.onChanged(message);
            if (siteId) props.onOpenSite(siteId);
          }}
          overview={overview}
          templates={list}
          tenantId={tenantId}
          initialTemplateId={activeTemplate?.id ?? list[0]?.id ?? ""}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Matrix

export function MatrixSection({
  canManage,
  error,
  matrix,
  onChanged,
  onDialog,
  onEditTemplate,
  onOpenPrefix,
  onOpenSite,
  overview,
  suggested,
  tenantId,
}: Props & {
  error: string | null;
  matrix: VlanMatrix | null;
  onEditTemplate: () => void;
  suggested: SiteTemplate | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  if (error) return <Notice error={error} />;
  if (!matrix) return <p className="ipam-muted">Matrix wird geladen …</p>;
  const create = async (siteId: string, fn: string) => {
    if (!matrix.template?.id) return;
    setBusy(`${siteId}-${fn}`);
    setActionError(null);
    try {
      await ipamCall({
        type: "createFromTemplate",
        tenantId,
        siteId,
        function: fn,
        templateId: matrix.template.id,
      });
      onChanged(`${fn} angelegt.`);
    } catch (failure) {
      setActionError(
        errorText(failure, "Das VLAN konnte nicht angelegt werden."),
      );
    } finally {
      setBusy(null);
    }
  };
  const siteName = new Map(matrix.sites.map((site) => [site.id, site.name]));

  if (!matrix.template) {
    return (
      <section className="ipam-card">
        <h3>Noch keine Standort-Vorlage</h3>
        <p className="ipam-muted">
          Eine Vorlage beschreibt, welche VLANs und Subnetze jeder Standort hat
          (z. B. MGMT = Basis + 0, Subnetz /24 am Anfang des
          Standort-Supernetzes). Dann zeigt die Matrix je Standort, was
          übereinstimmt, abweicht oder fehlt.
          {suggested
            ? ` Aus Ihren Daten lässt sich eine Vorlage mit ${suggested.entries.length} Funktionen ableiten.`
            : ""}
        </p>
        {canManage ? (
          <button
            className="primary-button"
            onClick={onEditTemplate}
            type="button"
          >
            {suggested ? "Vorgeschlagene Vorlage prüfen" : "Vorlage erstellen"}
          </button>
        ) : null}
        <OtherVlans
          matrix={matrix}
          onOpenSite={onOpenSite}
          siteName={siteName}
        />
      </section>
    );
  }

  return (
    <section className="ipam-card">
      <ul className="ipam-legend">
        <li>
          <i className="ipam-mx--ok" />
          wie Vorlage
        </li>
        <li>
          <i className="ipam-mx--diff" />
          Name oder Grösse weicht ab
        </li>
        <li>
          <i className="ipam-mx--missing" />
          fehlt
        </li>
      </ul>
      <Notice error={actionError} />
      <div className="ipam-table-wrap">
        <table className="ipam-matrix">
          <thead>
            <tr>
              <th scope="col">Funktion</th>
              {matrix.sites.map((site) => (
                <th key={site.id} scope="col">
                  <button
                    className="text-button"
                    onClick={() => onOpenSite(site.id)}
                    type="button"
                  >
                    {site.name}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.function}>
                <th scope="row">
                  {row.function}
                  {row.zone ? <small>{row.zone}</small> : null}
                </th>
                {matrix.sites.map((site) => {
                  const cell = cellFor(row, site.id);
                  const view = matrixCellView(cell, row.function, site.name);
                  if (view.state === "na") {
                    return (
                      <td
                        aria-label={view.label}
                        className="ipam-mx-na"
                        key={site.id}
                      >
                        –
                      </td>
                    );
                  }
                  if (view.state === "missing") {
                    return (
                      <td key={site.id}>
                        <div className="ipam-mx ipam-mx--missing">
                          <span>
                            fehlt
                            {cell.suggestion
                              ? ` · Vorschlag ${cell.suggestion.vlanNumber} · ${cell.suggestion.prefix}`
                              : ""}
                          </span>
                          {canManage && cell.suggestion ? (
                            <button
                              aria-label={`${row.function} an ${site.name} anlegen`}
                              className="secondary-button ipam-btn-small"
                              disabled={busy !== null}
                              onClick={() => void create(site.id, row.function)}
                              type="button"
                            >
                              {busy === `${site.id}-${row.function}`
                                ? "Wird angelegt …"
                                : "+ anlegen"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    );
                  }
                  const vlan = overview.vlans.find(
                    (entry) => entry.id === cell.vlanId,
                  );
                  return (
                    <td key={site.id}>
                      <button
                        aria-label={view.label}
                        className={`ipam-mx ipam-mx--${view.state}`}
                        onClick={() => {
                          if (cell.prefixId) onOpenPrefix(cell.prefixId);
                          else if (vlan && canManage)
                            onDialog({ kind: "vlan", vlan });
                        }}
                        type="button"
                      >
                        <span className="ipam-mx__top">
                          <b>{view.title}</b>
                          {view.percent ? <small>{view.percent}</small> : null}
                        </span>
                        {view.prefix ? (
                          <span className="ipam-mono">{view.prefix}</span>
                        ) : null}
                        {view.note ? (
                          <small className="ipam-mx__note">{view.note}</small>
                        ) : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <OtherVlans matrix={matrix} onOpenSite={onOpenSite} siteName={siteName} />
    </section>
  );
}

function OtherVlans({
  matrix,
  onOpenSite,
  siteName,
}: {
  matrix: VlanMatrix;
  onOpenSite: (siteId: string) => void;
  siteName: Map<string, string>;
}) {
  if (!matrix.otherVlans.length) return null;
  const bySite = new Map<string, VlanMatrix["otherVlans"]>();
  for (const entry of matrix.otherVlans) {
    const list = bySite.get(entry.siteId) ?? [];
    list.push(entry);
    bySite.set(entry.siteId, list);
  }
  return (
    <details className="ipam-other">
      <summary>
        Weitere VLANs ausserhalb der Vorlage ({matrix.otherVlans.length})
      </summary>
      {[...bySite].map(([siteId, entries]) => (
        <div key={siteId || "none"}>
          {siteId ? (
            <button
              className="text-button"
              onClick={() => onOpenSite(siteId)}
              type="button"
            >
              {siteName.get(siteId) ?? "Standort"}
            </button>
          ) : (
            <strong>Ohne Standort</strong>
          )}
          <ul>
            {entries
              .slice()
              .sort((a, b) => a.vlanNumber - b.vlanNumber)
              .map((entry) => (
                <li key={entry.vlanId}>
                  <b>{entry.vlanNumber}</b> {entry.name}
                  {entry.prefix ? (
                    <span className="ipam-mono"> · {entry.prefix}</span>
                  ) : null}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </details>
  );
}

// ---------------------------------------------------------------------------
// List

function VlanList({
  canManage,
  onChanged,
  onDialog,
  onOpenPrefix,
  overview,
  tenantId,
}: Props) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(
    () =>
      groupVlansBySite(
        overview.vlans,
        overview.sites,
        overview.prefixes,
        query,
      ),
    [overview, query],
  );
  const remove = async (id: string, label: string) => {
    if (!window.confirm(`${label} entfernen?`)) return;
    try {
      await ipamCall({ type: "delete", tenantId, entity: "vlan", id });
      onChanged(`${label} entfernt.`);
    } catch (failure) {
      setError(errorText(failure, "Das VLAN konnte nicht entfernt werden."));
    }
  };
  return (
    <section className="ipam-card">
      <input
        aria-label="VLANs filtern"
        className="ipam-filter-input"
        onChange={(event) => setQuery(event.target.value)}
        placeholder="VLAN-ID oder Name filtern"
        value={query}
      />
      <Notice error={error} />
      {groups.length === 0 ? (
        <p className="ipam-muted">
          {overview.vlans.length
            ? "Keine VLANs für diesen Filter."
            : "Noch keine VLANs erfasst."}
        </p>
      ) : null}
      {groups.map((group, index) => (
        <details
          className="ipam-group"
          key={group.key}
          open={index === 0 || Boolean(query)}
        >
          <summary>
            <b>{group.name}</b>
            <span className="ipam-muted">
              {group.items.length} {group.items.length === 1 ? "VLAN" : "VLANs"}
            </span>
          </summary>
          <div className="ipam-table-wrap">
            <table className="ipam-table ipam-table--wide">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Beschreibung</th>
                  <th>Zone</th>
                  <th>Subnetz</th>
                  <th className="ipam-col-meter">Auslastung</th>
                  {canManage ? <th aria-label="Aktionen" /> : null}
                </tr>
              </thead>
              <tbody>
                {group.items.map((item) => (
                  <tr key={item.vlan.id}>
                    <td>
                      <b>{item.vlan.vlanNumber}</b>
                    </td>
                    <td>{item.vlan.name}</td>
                    <td className="ipam-muted-cell">
                      {item.vlan.description ?? "–"}
                    </td>
                    <td>{item.zone ?? "–"}</td>
                    <td>
                      {item.prefixes.length
                        ? item.prefixes.map((prefix) => (
                            <button
                              className="text-button ipam-mono"
                              key={prefix.id}
                              onClick={() => onOpenPrefix(prefix.id)}
                              type="button"
                            >
                              {prefix.prefix}
                            </button>
                          ))
                        : "–"}
                    </td>
                    <td>
                      {item.percent !== null ? (
                        <Meter
                          label={`VLAN ${item.vlan.vlanNumber}`}
                          percent={item.percent}
                        />
                      ) : (
                        "–"
                      )}
                    </td>
                    {canManage ? (
                      <td className="ipam-table__actions">
                        <button
                          aria-label={`VLAN ${item.vlan.vlanNumber} bearbeiten`}
                          className="icon-button"
                          onClick={() =>
                            onDialog({ kind: "vlan", vlan: item.vlan })
                          }
                          type="button"
                        >
                          <Pencil aria-hidden="true" size={15} />
                        </button>
                        <button
                          aria-label={`VLAN ${item.vlan.vlanNumber} entfernen`}
                          className="icon-button"
                          onClick={() =>
                            void remove(
                              item.vlan.id,
                              `VLAN ${item.vlan.vlanNumber}`,
                            )
                          }
                          type="button"
                        >
                          <Trash2 aria-hidden="true" size={15} />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Template editor

function TemplateEditor({
  initial,
  onClose,
  onSaved,
  tenantId,
}: {
  initial: SiteTemplate;
  onClose: () => void;
  onSaved: (message: string, id: string | null) => void;
  tenantId: string;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [prefixLength, setPrefixLength] = useState(initial.prefixLength);
  const [entries, setEntries] = useState<TemplateEntry[]>(
    initial.entries.length ? initial.entries : [emptyTemplateEntry(0)],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const template: SiteTemplate = {
    ...(initial.id ? { id: initial.id } : {}),
    name: name.trim(),
    description: description.trim() || null,
    prefixLength,
    entries: entries.map((entry) => ({
      ...entry,
      function: entry.function.trim(),
      description: entry.description?.trim() || null,
      zone: entry.zone?.trim() || null,
    })),
  };
  const problems = validateTemplate(template);
  const update = (index: number, patch: Partial<TemplateEntry>) =>
    setEntries((current) =>
      current.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry,
      ),
    );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (problems.length) return;
    setBusy(true);
    setError(null);
    try {
      const result = await ipamCall<{ id: string }>({
        type: "saveTemplate",
        tenantId,
        template,
      });
      onSaved(
        initial.id ? "Vorlage gespeichert." : "Vorlage angelegt.",
        result.id,
      );
    } catch (failure) {
      setError(
        errorText(failure, "Die Vorlage konnte nicht gespeichert werden."),
      );
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!initial.id || !window.confirm(`Vorlage «${initial.name}» entfernen?`))
      return;
    setBusy(true);
    try {
      await ipamCall({ type: "deleteTemplate", tenantId, id: initial.id });
      onSaved("Vorlage entfernt.", null);
    } catch (failure) {
      setError(errorText(failure, "Die Vorlage konnte nicht entfernt werden."));
      setBusy(false);
    }
  };
  return (
    <FormDialog
      error={error ?? (touched && problems.length ? problems.join(" ") : null)}
      eyebrow="IP-Adressen"
      footerLeft={
        initial.id ? (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void remove()}
            type="button"
          >
            Vorlage entfernen
          </button>
        ) : null
      }
      onClose={onClose}
      onSubmit={(event) => void submit(event)}
      submitting={busy}
      title={initial.id ? "Standort-Vorlage bearbeiten" : "Standort-Vorlage"}
    >
      <FormCard title="Vorlage">
        {!initial.id ? (
          <FormNote>
            {initial.entries.length > 1
              ? "Dieser Vorschlag wurde aus dem Standort mit den meisten VLANs abgeleitet. Prüfen und speichern Sie ihn."
              : "Erfassen Sie je Funktion den VLAN-Versatz zur VLAN-Basis des Standorts und die Lage des Subnetzes im Standort-Supernetz."}
          </FormNote>
        ) : null}
        <FormGrid>
          <FormField label="Name" required>
            <input
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </FormField>
          <FormField
            hint="Grösse des Supernetzes je Standort, z. B. /19."
            label="Standort-Supernetz"
          >
            <select
              onChange={(event) => setPrefixLength(Number(event.target.value))}
              value={prefixLength}
            >
              {Array.from({ length: 23 }, (_, index) => index + 8).map(
                (length) => (
                  <option key={length} value={length}>
                    /{length}
                  </option>
                ),
              )}
            </select>
          </FormField>
        </FormGrid>
        <FormField label="Beschreibung" optional>
          <input
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
            value={description}
          />
        </FormField>
      </FormCard>
      <FormCard
        sub="VLAN-ID = Basis + Versatz · Subnetz = Supernetz-Start + Versatz × /24"
        title="Funktionen"
      >
        <div className="ipam-table-wrap">
          <table className="ipam-table ipam-template-table">
            <thead>
              <tr>
                <th>Funktion</th>
                <th>Beschreibung</th>
                <th>VLAN +</th>
                <th>/24 +</th>
                <th>Grösse</th>
                <th>Zone</th>
                <th>DHCP</th>
                <th>
                  <span className="sr-only">Entfernen</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={index}>
                  <td>
                    <input
                      aria-label={`Funktion Zeile ${index + 1}`}
                      maxLength={60}
                      onChange={(event) =>
                        update(index, { function: event.target.value })
                      }
                      value={entry.function}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Beschreibung Zeile ${index + 1}`}
                      maxLength={200}
                      onChange={(event) =>
                        update(index, { description: event.target.value })
                      }
                      value={entry.description ?? ""}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`VLAN-Versatz Zeile ${index + 1}`}
                      className="ipam-input-narrow"
                      min={0}
                      onChange={(event) =>
                        update(index, {
                          vlanOffset: Number(event.target.value),
                        })
                      }
                      type="number"
                      value={entry.vlanOffset}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Subnetz-Versatz Zeile ${index + 1}`}
                      className="ipam-input-narrow"
                      min={0}
                      onChange={(event) =>
                        update(index, { offset24: Number(event.target.value) })
                      }
                      type="number"
                      value={entry.offset24}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`Grösse Zeile ${index + 1}`}
                      onChange={(event) =>
                        update(index, { length: Number(event.target.value) })
                      }
                      value={entry.length}
                    >
                      {Array.from(
                        { length: 31 - prefixLength },
                        (_, offset) => prefixLength + offset,
                      )
                        .filter((length) => length <= 30)
                        .map((length) => (
                          <option key={length} value={length}>
                            /{length}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`Zone Zeile ${index + 1}`}
                      className="ipam-input-narrow"
                      maxLength={60}
                      onChange={(event) =>
                        update(index, { zone: event.target.value })
                      }
                      value={entry.zone ?? ""}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`DHCP Zeile ${index + 1}`}
                      checked={entry.dhcp}
                      onChange={(event) =>
                        update(index, { dhcp: event.target.checked })
                      }
                      type="checkbox"
                    />
                  </td>
                  <td>
                    <button
                      aria-label={`Zeile ${index + 1} entfernen`}
                      className="icon-button"
                      disabled={entries.length === 1}
                      onClick={() =>
                        setEntries((current) =>
                          current.filter((_, position) => position !== index),
                        )
                      }
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          className="secondary-button"
          onClick={() =>
            setEntries([...entries, emptyTemplateEntry(entries.length)])
          }
          type="button"
        >
          <Plus aria-hidden="true" size={15} /> Funktion hinzufügen
        </button>
      </FormCard>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// New site from template

function SiteFromTemplateDialog({
  initialTemplateId,
  onClose,
  onCreated,
  overview,
  templates,
  tenantId,
}: {
  initialTemplateId: string;
  onClose: () => void;
  onCreated: (message: string, siteId: string | null) => void;
  overview: IpamOverview;
  templates: SiteTemplate[];
  tenantId: string;
}) {
  const [templateId, setTemplateId] = useState(initialTemplateId);
  const template =
    templates.find((entry) => entry.id === templateId) ?? templates[0]!;
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [supernet, setSupernet] = useState("");
  const [vlanBase, setVlanBase] = useState("");
  const [assetMode, setAssetMode] = useState("new");
  const [functions, setFunctions] = useState<Set<string>>(
    new Set(template.entries.map((entry) => entry.function)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sites = useIpamQuery<SiteOverview>(
    { type: "siteOverview", tenantId },
    tenantId,
  );
  const freeLocations = (sites.data?.assetLocations ?? []).filter(
    (location) => !location.linkedSiteId,
  );
  const candidates = useFreeSupernets(
    overview,
    tenantId,
    template.prefixLength,
  );

  useEffect(() => {
    setFunctions(new Set(template.entries.map((entry) => entry.function)));
  }, [template]);
  useEffect(() => {
    if (!supernet && candidates[0]) setSupernet(candidates[0]);
  }, [candidates, supernet]);

  const base = Number(vlanBase);
  const validBase = Number.isInteger(base) && base >= 1 && base <= 4094;
  const validSupernet =
    parseCidr(supernet.trim()) !== null && !supernet.includes(":");
  const request = {
    templateId: template.id,
    name: name.trim(),
    code: code.trim() || null,
    address: address.trim() || null,
    supernet: supernet.trim(),
    vlanBase: base,
    assetLocation:
      assetMode === "none"
        ? { mode: "none" as const }
        : assetMode === "new"
          ? { mode: "new" as const }
          : { mode: "existing" as const, id: assetMode },
    functions: template.entries
      .map((entry) => entry.function)
      .filter((fn) => functions.has(fn)),
  };
  const ready = validBase && validSupernet && request.functions.length > 0;
  const requestKey = useDebounced(JSON.stringify(request), 400);
  const [preview, setPreview] = useState<
    SiteFromTemplateResult["preview"] | null
  >(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  useEffect(() => {
    const body = JSON.parse(requestKey) as typeof request;
    const bodyReady =
      Number.isInteger(body.vlanBase) &&
      body.vlanBase >= 1 &&
      body.vlanBase <= 4094 &&
      parseCidr(body.supernet) !== null &&
      !body.supernet.includes(":") &&
      body.functions.length > 0;
    if (!bodyReady) {
      setPreview(null);
      return;
    }
    let active = true;
    setPreviewError(null);
    ipamCall<SiteFromTemplateResult>({
      type: "createSiteFromTemplate",
      tenantId,
      ...body,
      name: body.name || "Neuer Standort",
      dryRun: true,
    })
      .then((result) => {
        if (!active) return;
        setPreview(result.preview);
        if (result.conflicts?.length) {
          setPreviewError(
            `Überschneidung mit bestehenden Subnetzen: ${result.conflicts.join(", ")}.`,
          );
        }
      })
      .catch((failure: unknown) => {
        if (active) {
          setPreview(null);
          setPreviewError(
            errorText(failure, "Die Vorschau konnte nicht berechnet werden."),
          );
        }
      });
    return () => {
      active = false;
    };
  }, [requestKey, tenantId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || !request.name) return;
    setBusy(true);
    setError(null);
    try {
      const result = await ipamCall<SiteFromTemplateResult>({
        type: "createSiteFromTemplate",
        tenantId,
        ...request,
        dryRun: false,
      });
      onCreated(
        `Standort ${request.name} mit ${request.functions.length} VLANs angelegt.`,
        result.siteId ?? null,
      );
    } catch (failure) {
      setError(
        errorText(failure, "Der Standort konnte nicht angelegt werden."),
      );
    } finally {
      setBusy(false);
    }
  };
  const byFunction = new Map(
    (preview ?? []).map((entry) => [entry.function, entry]),
  );

  return (
    <FormDialog
      error={error ?? previewError}
      eyebrow="IP-Adressen"
      onClose={onClose}
      onSubmit={(event) => void submit(event)}
      submitDisabled={!ready || !request.name}
      submitLabel={`Standort mit ${request.functions.length} VLANs anlegen`}
      submitting={busy}
      title={`Neuer Standort aus Vorlage «${template.name}»`}
    >
      <FormCard title="Standort">
        <FormNote>
          VLAN-ID = Basis + Versatz, Subnetz = Versatz im Standort-Supernetz.
          Funktionen lassen sich vor dem Anlegen abwählen.
        </FormNote>
        <FormGrid>
          {templates.length > 1 ? (
            <FormField label="Vorlage">
              <select
                onChange={(event) => setTemplateId(event.target.value)}
                value={templateId}
              >
                {templates.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}
          <FormField label="Name" required>
            <input
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </FormField>
          <FormField label="Kürzel" optional>
            <input
              maxLength={40}
              onChange={(event) => setCode(event.target.value)}
              value={code}
            />
          </FormField>
          <FormField label="Adresse" optional>
            <input
              maxLength={300}
              onChange={(event) => setAddress(event.target.value)}
              value={address}
            />
          </FormField>
          <FormField
            hint={
              candidates.length
                ? `Freie /${template.prefixLength}-Blöcke werden vorgeschlagen.`
                : `IPv4-Supernetz /${template.prefixLength}, z. B. 10.20.32.0/${template.prefixLength}.`
            }
            label={`Supernetz (/${template.prefixLength})`}
            required
          >
            <input
              list="ipam-free-supernets"
              onChange={(event) => setSupernet(event.target.value)}
              required
              spellCheck={false}
              value={supernet}
            />
            <datalist id="ipam-free-supernets">
              {candidates.map((cidr) => (
                <option key={cidr} value={cidr}>
                  {cidr} (frei)
                </option>
              ))}
            </datalist>
          </FormField>
          <FormField label="VLAN-Basis" required>
            <input
              inputMode="numeric"
              max={4094}
              min={1}
              onChange={(event) => setVlanBase(event.target.value)}
              required
              type="number"
              value={vlanBase}
            />
          </FormField>
          <FormField label="Asset-Standort">
            <select
              onChange={(event) => setAssetMode(event.target.value)}
              value={assetMode}
            >
              <option value="new">neu anlegen</option>
              <option value="none">nicht verknüpfen</option>
              {freeLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </FormField>
        </FormGrid>
      </FormCard>
      <FormCard title="Vorschau">
        <div className="ipam-table-wrap">
          <table className="ipam-table ipam-table--wide">
            <thead>
              <tr>
                <th>Übernehmen</th>
                <th>Funktion</th>
                <th>VLAN</th>
                <th>Subnetz</th>
                <th>Gateway</th>
              </tr>
            </thead>
            <tbody>
              {template.entries.map((entry) => {
                const row = byFunction.get(entry.function);
                const on = functions.has(entry.function);
                return (
                  <tr key={entry.function}>
                    <td>
                      <input
                        aria-label={`${entry.function} übernehmen`}
                        checked={on}
                        onChange={() =>
                          setFunctions((current) => {
                            const next = new Set(current);
                            if (next.has(entry.function))
                              next.delete(entry.function);
                            else next.add(entry.function);
                            return next;
                          })
                        }
                        type="checkbox"
                      />
                    </td>
                    <td>
                      <b>{entry.function}</b>
                    </td>
                    <td>
                      {row?.vlanNumber ??
                        (validBase ? base + entry.vlanOffset : "–")}
                    </td>
                    <td className="ipam-mono">
                      {on ? (row?.prefix ?? "…") : "–"}
                    </td>
                    <td className="ipam-mono">
                      {on ? (row?.gateway ?? "…") : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </FormCard>
    </FormDialog>
  );
}

/**
 * Free IPv4 blocks of the template length in the top-level containers
 * (address space of up to five containers).
 */
function useFreeSupernets(
  overview: IpamOverview,
  tenantId: string,
  length: number,
): string[] {
  const containers = useMemo(
    () =>
      overview.prefixes
        .filter(
          (prefix) =>
            prefix.status === "container" &&
            !prefix.parentId &&
            !prefix.prefix.includes(":") &&
            Number(prefix.prefix.split("/")[1]) < length,
        )
        .slice(0, 5),
    [overview.prefixes, length],
  );
  const [result, setResult] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    void Promise.all(
      containers.map((prefix) =>
        ipamCall<AddressSpace>({
          type: "addressSpace",
          tenantId,
          prefixId: prefix.id,
        })
          .then((space) => freeBlocksOfLength(space.segments, length, 4))
          .catch(() => [] as string[]),
      ),
    ).then((lists) => {
      if (active) setResult(lists.flat().slice(0, 12));
    });
    return () => {
      active = false;
    };
  }, [containers, length, tenantId]);
  return result;
}
