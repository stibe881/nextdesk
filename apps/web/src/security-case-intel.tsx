import {
  AlertTriangle,
  Laptop,
  LoaderCircle,
  Network,
  PackagePlus,
  ShieldCheck,
  UserRound,
  Waypoints,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { functionErrorMessage } from "./lib/function-error";
import {
  deviceMeasures,
  INDICATOR_LABELS,
  internalIndicatorLabel,
  MEASURE_CONFIRM_TEXT,
  MEASURE_LABELS,
  parseCampaignList,
  parseIocList,
  parseSecurityContext,
  parseSecurityDetail,
  STATE_LABELS,
  VERDICT_LABELS,
  type MeasureKind,
  type SecurityCampaign,
  type SecurityCaseDetail,
  type SecurityContext,
  type SecurityContextPerson,
  type SecurityIoc,
} from "./lib/security-cases";
import { supabase } from "./lib/supabase";

// Point 12–15 of the security cases: context of the reporting people,
// measures after «I clicked», replacement device, campaigns and IOC list.

async function call(body: Record<string, unknown>): Promise<unknown> {
  if (!supabase) throw new Error("Die Verbindung ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("security-cases", {
    body,
  });
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Die Sicherheitsfälle sind gerade nicht verfügbar.",
      ),
    );
  }
  return data;
}

const DATE_TIME = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Zurich",
});
function dateTime(value: string | null): string {
  return value ? DATE_TIME.format(new Date(value)) : "–";
}

const COMPLIANCE_LABELS: Record<string, string> = {
  compliant: "konform",
  noncompliant: "nicht konform",
  ingraceperiod: "Schonfrist",
  conflict: "Konflikt",
  error: "Fehler",
  unknown: "unbekannt",
};

type PendingMeasure = {
  kind: MeasureKind;
  person: SecurityContextPerson;
  assetId: string | null;
  target: string;
} | null;

/**
 * «Kontext und Massnahmen»: people who reported (profile, manager, last
 * sign-in, devices with Intune and IP data), internal addresses in the mail
 * and the measures with a confirmation step. Every measure is logged.
 */
export function SecurityCaseContextPanel({
  tenantId,
  detail,
  onDetail,
}: {
  tenantId: string;
  detail: SecurityCaseDetail;
  onDetail: (detail: SecurityCaseDetail) => void;
}) {
  const ticketId = detail.ticketId;
  const [context, setContext] = useState<SecurityContext | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingMeasure>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [ordering, setOrdering] = useState<SecurityContextPerson | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const parsed = parseSecurityContext(
        await call({ type: "context", tenantId, ticketId }),
      );
      if (!parsed) throw new Error("Der Kontext konnte nicht gelesen werden.");
      setContext(parsed);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [tenantId, ticketId]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyResult(value: unknown) {
    const parsed = parseSecurityDetail(value);
    if (parsed) onDetail(parsed);
    const data =
      value && typeof value === "object"
        ? (
            value as {
              data?: { measure?: { status?: string; message?: string } };
            }
          ).data
        : undefined;
    const measure = data?.measure;
    if (measure?.message) {
      setResult({ ok: measure.status === "succeeded", text: measure.message });
    }
  }

  async function runPending() {
    if (!pending) return;
    setBusy(true);
    setResult(null);
    try {
      applyResult(
        await call({
          type: "runMeasure",
          tenantId,
          ticketId,
          measure: pending.kind,
          personKey: pending.person.key,
          assetId: pending.assetId,
          confirmed: true,
        }),
      );
    } catch (cause) {
      setResult({ ok: false, text: (cause as Error).message });
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  const closed = detail.state === "closed";
  const clickedPeople =
    context?.people.filter((person) => person.clicked) ?? [];

  return (
    <article className="security-card security-context">
      <div className="security-card__head">
        <h3>Kontext und Massnahmen</h3>
        {context ? (
          <span className="security-muted">
            {context.people.length}{" "}
            {context.people.length === 1 ? "Person" : "Personen"}
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="ticket-detail-message error" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          {error}
        </p>
      ) : null}
      {!context && !error ? (
        <p className="security-muted" role="status">
          <LoaderCircle
            aria-hidden="true"
            className="ticket-detail-spinner"
            size={14}
          />{" "}
          Kontext wird geladen …
        </p>
      ) : null}
      {context && context.indicators.length > 0 ? (
        <div className="security-internal" role="alert">
          <strong>
            <Network aria-hidden="true" size={15} /> Interne Adresse!
          </strong>
          <p>
            Die gemeldete Mail nennt Adressen aus dem eigenen Netz. Das kann auf
            ein kompromittiertes internes Gerät oder Konto hindeuten.
          </p>
          <ul>
            {context.indicators.map((indicator) => (
              <li key={`${indicator.kind}:${indicator.value}`}>
                <code>{indicator.value}</code>
                <small>{internalIndicatorLabel(indicator)}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {clickedPeople.length > 0 && !closed ? (
        <p className="security-muted">
          Für Personen, die geklickt haben: Sitzungen widerrufen, Passwort-Reset
          erzwingen, Gerät synchronisieren und scannen. Ein Gerät isolieren ist
          nur direkt in Microsoft Defender möglich.
        </p>
      ) : null}
      {result ? (
        <p
          className={
            result.ok ? "security-case__notice" : "ticket-detail-message error"
          }
          role="status"
        >
          {result.ok ? (
            <ShieldCheck aria-hidden="true" size={16} />
          ) : (
            <AlertTriangle aria-hidden="true" size={16} />
          )}
          {result.text}
        </p>
      ) : null}
      {pending ? (
        <div className="security-confirm" role="dialog" aria-modal="false">
          <p>
            <strong>{MEASURE_LABELS[pending.kind]}</strong> für{" "}
            <strong>{pending.target}</strong> ausführen?
          </p>
          <p className="security-muted">{MEASURE_CONFIRM_TEXT[pending.kind]}</p>
          <div className="security-confirm__actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setPending(null)}
              type="button"
            >
              Abbrechen
            </button>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void runPending()}
              type="button"
            >
              {busy ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={15}
                />
              ) : null}
              Ausführen
            </button>
          </div>
        </div>
      ) : null}
      {ordering ? (
        <ReplacementOrder
          onCancel={() => setOrdering(null)}
          onDone={(value, ok, text) => {
            if (value) applyResult(value);
            setResult({ ok, text });
            setOrdering(null);
          }}
          person={ordering}
          tenantId={tenantId}
          ticketId={ticketId}
        />
      ) : null}
      {context?.people.map((person) => (
        <section className="security-person" key={person.key}>
          <header>
            <UserRound aria-hidden="true" size={16} />
            <span>
              <strong>{person.name}</strong>
              <small>
                {[person.jobTitle, person.department, person.email]
                  .filter(Boolean)
                  .join(" · ") || "Keine weiteren Angaben"}
              </small>
            </span>
            {person.clicked ? (
              <span className="security-chip security-chip--high">
                Geklickt
              </span>
            ) : null}
          </header>
          <dl className="security-person__facts">
            <dt>Vorgesetzt</dt>
            <dd>{person.managerName ?? "–"}</dd>
            <dt>Letzte Anmeldung</dt>
            <dd>
              {person.lastSignInAt
                ? `${dateTime(person.lastSignInAt)} (Entra)`
                : "keine Entra-Daten"}
            </dd>
            {person.accountEnabled === false ? (
              <>
                <dt>Konto</dt>
                <dd>deaktiviert</dd>
              </>
            ) : null}
          </dl>
          {!person.found ? (
            <p className="security-muted">
              Die Person ist weder als Mitglied noch im Entra-Verzeichnis
              bekannt.
            </p>
          ) : null}
          {person.devicesVisible ? (
            person.devices.length ? (
              <ul className="security-devices">
                {person.devices.map((device) => (
                  <li key={device.id}>
                    <span className="security-devices__name">
                      <Laptop aria-hidden="true" size={14} />
                      <strong>{device.name}</strong>
                      <small>
                        {[
                          device.operatingSystem,
                          device.complianceState
                            ? `Intune: ${COMPLIANCE_LABELS[device.complianceState.toLowerCase()] ?? device.complianceState}`
                            : null,
                          device.lastSyncAt
                            ? `letzte Synchronisation ${dateTime(device.lastSyncAt)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                    {device.network.length ? (
                      <small className="security-devices__net">
                        {device.network
                          .map((entry) =>
                            [
                              entry.address,
                              entry.prefix ? `Subnetz ${entry.prefix}` : null,
                              entry.vlan ? `VLAN ${entry.vlan}` : null,
                              entry.site,
                              entry.switchName
                                ? `${entry.switchName}${entry.switchPort ? ` Port ${entry.switchPort}` : ""}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · "),
                          )
                          .join(" | ")}
                      </small>
                    ) : null}
                    {!closed && deviceMeasures(device).length ? (
                      <span className="security-measures">
                        {deviceMeasures(device).map((kind) => (
                          <button
                            className="secondary-button"
                            disabled={busy || pending !== null}
                            key={kind}
                            onClick={() =>
                              setPending({
                                kind,
                                person,
                                assetId: device.id,
                                target: device.name,
                              })
                            }
                            type="button"
                          >
                            {MEASURE_LABELS[kind]}
                          </button>
                        ))}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="security-muted">Keine Geräte zugeordnet.</p>
            )
          ) : (
            <p className="security-muted">
              Geräte sind nur mit dem Modul Assets sichtbar.
            </p>
          )}
          {!closed ? (
            <span className="security-measures">
              {(
                [
                  "entra_revoke_sessions",
                  "entra_force_password_change",
                ] as const
              ).map((kind) => (
                <button
                  className="secondary-button"
                  disabled={busy || pending !== null}
                  key={kind}
                  onClick={() =>
                    setPending({
                      kind,
                      person,
                      assetId: null,
                      target: person.name,
                    })
                  }
                  type="button"
                >
                  {MEASURE_LABELS[kind]}
                </button>
              ))}
              <button
                className="secondary-button"
                disabled={busy || pending !== null || ordering !== null}
                onClick={() => setOrdering(person)}
                type="button"
              >
                <PackagePlus aria-hidden="true" size={14} />
                Ersatzgerät bestellen
              </button>
            </span>
          ) : null}
        </section>
      ))}
      {context?.measures.intuneMessage ? (
        <p className="security-muted">{context.measures.intuneMessage}</p>
      ) : null}
      {context?.measures.entraMessage ? (
        <p className="security-muted">{context.measures.entraMessage}</p>
      ) : null}
    </article>
  );
}

function ReplacementOrder({
  tenantId,
  ticketId,
  person,
  onCancel,
  onDone,
}: {
  tenantId: string;
  ticketId: string;
  person: SecurityContextPerson;
  onCancel: () => void;
  onDone: (value: unknown, ok: boolean, text: string) => void;
}) {
  const [items, setItems] = useState<
    | {
        id: string;
        name: string;
        category: string | null;
        requiresApproval: boolean;
      }[]
    | null
  >(null);
  const [itemId, setItemId] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void call({ type: "replacementCatalog", tenantId, ticketId })
      .then((value) => {
        if (!active) return;
        const rows = (value as { data?: { items?: unknown } } | null)?.data
          ?.items;
        setItems(
          Array.isArray(rows)
            ? rows.flatMap((row) =>
                row && typeof row === "object" && typeof row.id === "string"
                  ? [
                      {
                        id: row.id as string,
                        name: String(row.name ?? "Artikel"),
                        category:
                          typeof row.category === "string"
                            ? row.category
                            : null,
                        requiresApproval: row.requiresApproval === true,
                      },
                    ]
                  : [],
              )
            : [],
        );
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [tenantId, ticketId]);

  const selected = items?.find((item) => item.id === itemId) ?? null;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const value = await call({
        type: "orderReplacement",
        tenantId,
        ticketId,
        personKey: person.key,
        catalogItemId: itemId,
        comment: comment.trim() || null,
        confirmed: true,
      });
      const measure = (
        value as { data?: { measure?: { status?: string; message?: string } } }
      )?.data?.measure;
      onDone(
        value,
        measure?.status === "succeeded",
        measure?.message ?? "Bestellung erfasst.",
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="security-confirm" role="dialog" aria-modal="false">
      <p>
        <strong>Ersatzgerät bestellen</strong> für{" "}
        <strong>{person.name}</strong>
      </p>
      <p className="security-muted">
        Die Bestellung läuft über den Shop im Namen der Person, mit dem Hinweis
        «Ersatzgerät aus Sicherheitsfall». Verlangt der Artikel eine
        Genehmigung, wird diese wie üblich angefordert.
      </p>
      {error ? (
        <p className="ticket-detail-message error" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          {error}
        </p>
      ) : null}
      {items === null && !error ? (
        <p className="security-muted" role="status">
          Artikel werden geladen …
        </p>
      ) : null}
      {items ? (
        <label className="security-assign">
          <span>Artikel</span>
          <select
            onChange={(event) => setItemId(event.target.value)}
            value={itemId}
          >
            <option value="">Bitte wählen</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.category ? ` (${item.category})` : ""}
                {item.requiresApproval ? " · mit Genehmigung" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="security-assign">
        <span>Bemerkung (optional)</span>
        <input
          maxLength={500}
          onChange={(event) => setComment(event.target.value)}
          value={comment}
        />
      </label>
      {selected?.requiresApproval ? (
        <p className="security-muted">
          Dieser Artikel verlangt eine Genehmigung durch die vorgesetzte Person.
        </p>
      ) : null}
      <div className="security-confirm__actions">
        <button
          className="secondary-button"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          Abbrechen
        </button>
        <button
          className="primary-button"
          disabled={busy || !itemId}
          onClick={() => void submit()}
          type="button"
        >
          {busy ? (
            <LoaderCircle
              aria-hidden="true"
              className="ticket-detail-spinner"
              size={15}
            />
          ) : null}
          Bestellung auslösen
        </button>
      </div>
    </div>
  );
}

/** Campaign, IOC hits and the measures log of one case. */
export function SecurityCaseIntelCards({
  detail,
  onOpenCase,
}: {
  detail: SecurityCaseDetail;
  onOpenCase: (ticketId: string) => void;
}) {
  const campaign = detail.campaign;
  return (
    <>
      {detail.iocHits.length ? (
        <article className="security-card security-card--alert">
          <h3>
            <AlertTriangle aria-hidden="true" size={15} /> Bekannte Indikatoren
          </h3>
          <p className="security-muted">
            Diese Mail enthält Indikatoren aus früheren Fällen (IOC-Liste).
          </p>
          <ul className="security-links">
            {detail.iocHits.map((hit) => (
              <li key={hit.id}>
                <span>
                  {INDICATOR_LABELS[hit.kind]} ·{" "}
                  {VERDICT_LABELS[hit.verdict as keyof typeof VERDICT_LABELS] ??
                    hit.verdict}
                </span>
                <code>{hit.value}</code>
              </li>
            ))}
          </ul>
        </article>
      ) : null}
      {campaign && (campaign.caseCount > 1 || campaign.reporters > 1) ? (
        <article className="security-card">
          <div className="security-card__head">
            <h3>
              <Waypoints aria-hidden="true" size={15} /> Kampagne
            </h3>
            <span className="security-muted">
              {campaign.reports} Meldungen · {campaign.reporters} Personen ·{" "}
              {campaign.caseCount} Fälle
            </span>
          </div>
          <p className="security-muted">
            {[
              campaign.senderDomain
                ? `Absender ${campaign.senderDomain}`
                : null,
              campaign.subjectKey ? `Betreff «${campaign.subjectKey}»` : null,
              campaign.linkDomains.length
                ? `Links ${campaign.linkDomains.slice(0, 3).join(", ")}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {campaign.cases.length ? (
            <ul className="security-campaign-cases">
              {campaign.cases.map((entry) => (
                <li key={entry.ticketId}>
                  <button
                    className="text-button"
                    onClick={() => onOpenCase(entry.ticketId)}
                    type="button"
                  >
                    {entry.ticketNumber ?? "Fall"}
                  </button>
                  <small>
                    {entry.verdict
                      ? VERDICT_LABELS[entry.verdict]
                      : STATE_LABELS[entry.state]}
                  </small>
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      ) : null}
      {detail.measures.length ? (
        <article className="security-card">
          <h3>Ausgeführte Massnahmen</h3>
          <ul className="security-measure-log">
            {detail.measures.map((entry) => (
              <li key={entry.id}>
                <span
                  className={`security-chip security-chip--${entry.status === "succeeded" ? "low" : "high"}`}
                >
                  {entry.status === "succeeded" ? "Erledigt" : "Fehlgeschlagen"}
                </span>
                <span>
                  <strong>{entry.label}</strong>
                  {entry.target ? ` · ${entry.target}` : ""}
                  <small>
                    {[entry.actorName, dateTime(entry.createdAt)]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                  {entry.message ? <small>{entry.message}</small> : null}
                </span>
              </li>
            ))}
          </ul>
        </article>
      ) : null}
    </>
  );
}

/** «Kampagnen & IOC»: campaigns of the last weeks and the IOC list. */
export function SecurityIntelView({
  tenantId,
  onOpenCase,
}: {
  tenantId: string;
  onOpenCase: (ticketId: string) => void;
}) {
  const [tab, setTab] = useState<"campaigns" | "iocs">("campaigns");
  const [campaigns, setCampaigns] = useState<SecurityCampaign[] | null>(null);
  const [iocs, setIocs] = useState<SecurityIoc[] | null>(null);
  const [status, setStatus] = useState<"active" | "harmless" | "all">("active");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError("");
    if (tab === "campaigns") {
      void call({ type: "listCampaigns", tenantId })
        .then((value) => {
          if (active) setCampaigns(parseCampaignList(value) ?? []);
        })
        .catch((cause: Error) => active && setError(cause.message));
    } else {
      const timer = window.setTimeout(() => {
        void call({
          type: "listIocs",
          tenantId,
          status,
          query: query.trim() || null,
        })
          .then((value) => {
            if (active) setIocs(parseIocList(value) ?? []);
          })
          .catch((cause: Error) => active && setError(cause.message));
      }, 250);
      return () => {
        active = false;
        window.clearTimeout(timer);
      };
    }
    return () => {
      active = false;
    };
  }, [query, status, tab, tenantId]);

  async function setIocStatus(ioc: SecurityIoc, next: "active" | "harmless") {
    setBusy(ioc.id);
    setError("");
    try {
      await call({
        type: "setIocStatus",
        tenantId,
        iocId: ioc.id,
        status: next,
      });
      setIocs((current) =>
        (current ?? [])
          .map((entry) =>
            entry.id === ioc.id ? { ...entry, status: next } : entry,
          )
          .filter((entry) => status === "all" || entry.status === status),
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="security-intel">
      <div
        aria-label="Kampagnen oder IOC-Liste"
        className="queue-tabs"
        role="group"
      >
        <button
          aria-pressed={tab === "campaigns"}
          className={tab === "campaigns" ? "queue-tab selected" : "queue-tab"}
          onClick={() => setTab("campaigns")}
          type="button"
        >
          Kampagnen
        </button>
        <button
          aria-pressed={tab === "iocs"}
          className={tab === "iocs" ? "queue-tab selected" : "queue-tab"}
          onClick={() => setTab("iocs")}
          type="button"
        >
          IOC-Liste
        </button>
      </div>
      {error ? (
        <p className="ticket-detail-message error" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          {error}
        </p>
      ) : null}
      {tab === "campaigns" ? (
        campaigns === null ? (
          <p className="security-cases__empty" role="status">
            Kampagnen werden geladen …
          </p>
        ) : campaigns.length === 0 ? (
          <p className="security-cases__empty">
            <ShieldCheck aria-hidden="true" size={18} />
            Noch keine Kampagnen erkannt.
          </p>
        ) : (
          <ul className="security-cases__list">
            {campaigns.map((campaign) => (
              <li className="security-card" key={campaign.id}>
                <div className="security-card__head">
                  <strong>
                    {campaign.subjectKey
                      ? `«${campaign.subjectKey}»`
                      : (campaign.senderDomain ?? "Kampagne")}
                  </strong>
                  <span
                    className={`security-chip security-chip--${campaign.reporters >= 3 ? "high" : "line"}`}
                  >
                    {campaign.reporters} Personen
                  </span>
                </div>
                <small className="security-muted">
                  {[
                    campaign.senderDomain
                      ? `Absender ${campaign.senderDomain}`
                      : null,
                    campaign.linkDomains.length
                      ? `Links ${campaign.linkDomains.slice(0, 3).join(", ")}`
                      : null,
                    `${campaign.reports} Meldungen`,
                    `zuletzt ${dateTime(campaign.lastSeenAt)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
                <ul className="security-campaign-cases">
                  {campaign.cases.map((entry) => (
                    <li key={entry.ticketId}>
                      <button
                        className="text-button"
                        onClick={() => onOpenCase(entry.ticketId)}
                        type="button"
                      >
                        {entry.ticketNumber ?? "Fall"}
                      </button>
                      <small>
                        {entry.verdict
                          ? VERDICT_LABELS[entry.verdict]
                          : STATE_LABELS[entry.state]}
                      </small>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <div className="security-intel__filters">
            <label className="search-field">
              <span className="sr-only">IOC suchen</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Domain, URL, IP oder Absender …"
                value={query}
              />
            </label>
            <select
              aria-label="Status"
              onChange={(event) =>
                setStatus(event.target.value as "active" | "harmless" | "all")
              }
              value={status}
            >
              <option value="active">Aktiv</option>
              <option value="harmless">Als harmlos markiert</option>
              <option value="all">Alle</option>
            </select>
          </div>
          <p className="security-muted">
            Indikatoren aus Fällen mit Urteil Spam, Phishing oder gezielter
            Angriff. Neue Meldungen werden automatisch dagegen geprüft. Werte
            sind entschärft dargestellt.
          </p>
          {iocs === null ? (
            <p className="security-cases__empty" role="status">
              IOC-Liste wird geladen …
            </p>
          ) : iocs.length === 0 ? (
            <p className="security-cases__empty">Keine Einträge.</p>
          ) : (
            <div className="table-scroll">
              <table className="security-ioc-table">
                <thead>
                  <tr>
                    <th scope="col">Art</th>
                    <th scope="col">Wert</th>
                    <th scope="col">Urteil</th>
                    <th scope="col">Fälle</th>
                    <th scope="col">Treffer</th>
                    <th scope="col">Quelle</th>
                    <th scope="col">
                      <span className="sr-only">Aktion</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {iocs.map((ioc) => (
                    <tr
                      className={
                        ioc.status === "harmless" ? "is-harmless" : undefined
                      }
                      key={ioc.id}
                    >
                      <td>{INDICATOR_LABELS[ioc.kind]}</td>
                      <td>
                        <code>{ioc.value}</code>
                      </td>
                      <td>
                        {VERDICT_LABELS[
                          ioc.verdict as keyof typeof VERDICT_LABELS
                        ] ?? ioc.verdict}
                      </td>
                      <td>{ioc.caseCount}</td>
                      <td>
                        {ioc.hitCount}
                        {ioc.lastHitAt ? (
                          <small> · {dateTime(ioc.lastHitAt)}</small>
                        ) : null}
                      </td>
                      <td>
                        {ioc.sourceTicketId ? (
                          <button
                            className="text-button"
                            onClick={() => onOpenCase(ioc.sourceTicketId!)}
                            type="button"
                          >
                            {ioc.sourceTicketNumber ?? "Fall"}
                          </button>
                        ) : (
                          "–"
                        )}
                      </td>
                      <td>
                        <button
                          className="secondary-button"
                          disabled={busy !== null}
                          onClick={() =>
                            void setIocStatus(
                              ioc,
                              ioc.status === "active" ? "harmless" : "active",
                            )
                          }
                          type="button"
                        >
                          {ioc.status === "active"
                            ? "Als harmlos markieren"
                            : "Wieder aktivieren"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
