import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { PiggyBank, RefreshCw, Undo2, UserPlus, X } from "lucide-react";

import {
  filterSeatPeople,
  licenseReclaimApi,
  reasonText,
  savingsLabel,
  formatMoney,
  type LicenseSeat,
  type ReclaimCandidate,
  type ReclaimOverview,
  type SeatPerson,
} from "./lib/license-reclaim";
import "./license-reclaim.css";

const formatDateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("de-CH", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "–";

/**
 * «Rückgewinnung»: Lizenzplätze von ausgetretenen oder inaktiven Personen
 * mit geschätzter monatlicher Einsparung und «Zurückgeben».
 */
export function LicenseReclaimPanel({
  tenantId,
  onChanged,
}: {
  tenantId: string;
  onChanged?: () => void;
}) {
  const [overview, setOverview] = useState<ReclaimOverview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [days, setDays] = useState("60");
  const [useEntra, setUseEntra] = useState(true);
  const [allowM365, setAllowM365] = useState(false);
  const [removeM365, setRemoveM365] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    licenseReclaimApi
      .overview(tenantId)
      .then((next) => {
        setOverview(next);
        setDays(String(next.settings.inactivityDays));
        setUseEntra(next.settings.useEntraSignIn);
        setAllowM365(next.settings.allowM365Removal);
        setError("");
      })
      .catch((reason: Error) => setError(reason.message));
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const release = async (candidate: ReclaimCandidate) => {
    const withM365 =
      candidate.m365Removable && removeM365[candidate.assignmentId];
    if (
      !window.confirm(
        `Platz von «${candidate.assigneeLabel}» für «${candidate.licenseTitle}» zurückgeben?${
          withM365
            ? "\n\nDie Microsoft-365-Lizenz wird zusätzlich im Entra-Konto entfernt."
            : ""
        }`,
      )
    )
      return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const result = await licenseReclaimApi.release(
        tenantId,
        candidate.assignmentId,
        Boolean(withM365),
        "Rückgewinnung",
      );
      setNotice(
        result.m365Removed
          ? "Der Platz ist frei und die Microsoft-365-Lizenz wurde entfernt."
          : "Der Platz ist wieder frei.",
      );
      load();
      onChanged?.();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Zurückgeben fehlgeschlagen.",
      );
    } finally {
      setPending(false);
    }
  };

  const saveSettings = async () => {
    const inactivityDays = Number(days);
    if (
      !Number.isInteger(inactivityDays) ||
      inactivityDays < 7 ||
      inactivityDays > 365
    ) {
      setError("Die Anzahl Tage muss zwischen 7 und 365 liegen.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await licenseReclaimApi.saveSettings(tenantId, {
        inactivityDays,
        useEntraSignIn: useEntra,
        allowM365Removal: allowM365,
      });
      setNotice("Einstellungen gespeichert.");
      setSettingsOpen(false);
      load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Speichern fehlgeschlagen.",
      );
    } finally {
      setPending(false);
    }
  };

  const refreshSignIns = async () => {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const result = await licenseReclaimApi.refreshSignIns(tenantId);
      if (result.error) setError(result.error);
      else
        setNotice(
          `Anmeldedaten aus Entra aktualisiert (${result.updated} Personen).`,
        );
      load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Aktualisieren fehlgeschlagen.",
      );
    } finally {
      setPending(false);
    }
  };

  const candidates = overview?.candidates ?? [];
  return (
    <section
      className="license-reclaim"
      aria-labelledby="license-reclaim-heading"
    >
      <header className="license-reclaim__header">
        <div>
          <h2 id="license-reclaim-heading">
            <PiggyBank aria-hidden="true" size={18} /> Rückgewinnung
          </h2>
          <p>
            Plätze von Personen, die ausgetreten sind oder sich seit{" "}
            {overview?.settings.inactivityDays ?? 60} Tagen nicht angemeldet
            haben.
          </p>
        </div>
        <div className="license-reclaim__saving">
          <span>Geschätzte Einsparung</span>
          <strong>
            {overview ? savingsLabel(overview.monthlySavings) : "–"}
          </strong>
        </div>
      </header>
      <div className="license-reclaim__toolbar">
        <button
          className="secondary-button"
          disabled={pending}
          onClick={() => void refreshSignIns()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={15} /> Anmeldedaten aus Entra
          holen
        </button>
        <button
          className="secondary-button"
          onClick={() => setSettingsOpen((open) => !open)}
          type="button"
        >
          Einstellungen
        </button>
        <span className="license-reclaim__muted">
          {overview?.settings.signInsRefreshedAt
            ? `Entra-Anmeldedaten vom ${formatDateTime(overview.settings.signInsRefreshedAt)}`
            : "Ohne Entra-Anmeldedaten zählt die letzte nextDesk-Anmeldung."}
        </span>
      </div>
      {overview?.settings.signInsError ? (
        <p className="license-reclaim__muted">
          {overview.settings.signInsError}
        </p>
      ) : null}
      {settingsOpen ? (
        <fieldset className="license-reclaim__settings">
          <label>
            Inaktiv nach (Tage ohne Anmeldung)
            <input
              inputMode="numeric"
              max={365}
              min={7}
              onChange={(event) => setDays(event.target.value)}
              type="number"
              value={days}
            />
          </label>
          <label className="license-reclaim__check">
            <input
              checked={useEntra}
              onChange={(event) => setUseEntra(event.target.checked)}
              type="checkbox"
            />
            Entra-Anmeldedaten verwenden (signInActivity, braucht
            AuditLog.Read.All und Entra ID P1/P2)
          </label>
          <label className="license-reclaim__check">
            <input
              checked={allowM365}
              onChange={(event) => setAllowM365(event.target.checked)}
              type="checkbox"
            />
            Optional: Microsoft-365-Lizenz beim Zurückgeben in Entra entfernen
            (nur Lizenzen mit SKU-ID, braucht LicenseAssignment.ReadWrite.All)
          </label>
          <div className="form-actions">
            <button
              className="primary-button"
              disabled={pending}
              onClick={() => void saveSettings()}
              type="button"
            >
              Speichern
            </button>
          </div>
        </fieldset>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="form-success" role="status">
          {notice}
        </p>
      ) : null}
      {!overview ? (
        error ? null : (
          <p className="empty-state">Rückgewinnung wird berechnet …</p>
        )
      ) : candidates.length === 0 ? (
        <p className="empty-state">
          Keine Kandidaten: Alle vergebenen Plätze werden genutzt.
        </p>
      ) : (
        <ul className="license-reclaim__list">
          {candidates.map((candidate) => (
            <li key={candidate.assignmentId}>
              <div>
                <strong>{candidate.assigneeLabel}</strong>
                <span className="license-reclaim__muted">
                  {candidate.licenseTitle} · seit{" "}
                  {formatDateTime(candidate.assignedAt)}
                </span>
                <span className="license-reclaim__reasons">
                  {reasonText(candidate).map((text) => (
                    <span className="license-reclaim__reason" key={text}>
                      {text}
                    </span>
                  ))}
                </span>
              </div>
              <div className="license-reclaim__actions">
                <span className="license-reclaim__amount">
                  {candidate.monthlySaving === null
                    ? "Kosten unbekannt"
                    : `${formatMoney(candidate.monthlySaving, candidate.currency)} / Monat`}
                </span>
                {candidate.m365Removable ? (
                  <label className="license-reclaim__check license-reclaim__m365">
                    <input
                      checked={removeM365[candidate.assignmentId] === true}
                      onChange={(event) =>
                        setRemoveM365((current) => ({
                          ...current,
                          [candidate.assignmentId]: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                    Auch in Microsoft 365 entfernen
                  </label>
                ) : null}
                <button
                  className="primary-button"
                  disabled={pending}
                  onClick={() => void release(candidate)}
                  type="button"
                >
                  <Undo2 aria-hidden="true" size={15} /> Zurückgeben
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Plätze einer Lizenz: zuweisen und zurückgeben. */
export function LicenseSeatsDialog({
  tenantId,
  licenseId,
  title,
  readOnly,
  onClose,
}: {
  tenantId: string;
  licenseId: string;
  title: string;
  readOnly: boolean;
  onClose: () => void;
}) {
  const [seats, setSeats] = useState<LicenseSeat[] | null>(null);
  const [quantity, setQuantity] = useState<number | null>(null);
  const [people, setPeople] = useState<SeatPerson[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const load = useCallback(() => {
    licenseReclaimApi
      .seats(tenantId, licenseId)
      .then((data) => {
        setSeats(data.assignments);
        setQuantity(data.quantity);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [licenseId, tenantId]);

  useEffect(() => {
    load();
    if (!readOnly) {
      licenseReclaimApi
        .people(tenantId)
        .then(setPeople)
        .catch(() => setPeople([]));
    }
  }, [load, readOnly, tenantId]);

  const active = (seats ?? []).filter((seat) => !seat.releasedAt);
  const released = (seats ?? []).filter((seat) => seat.releasedAt);
  const assignedKeys = useMemo(
    () =>
      new Set(
        active.flatMap((seat) =>
          [seat.userId, seat.entraObjectId].filter(Boolean),
        ),
      ),
    [active],
  );
  const matches = useMemo(
    () =>
      query.trim()
        ? filterSeatPeople(people, query).filter(
            (person) =>
              !assignedKeys.has(person.userId) &&
              !assignedKeys.has(person.entraObjectId),
          )
        : [],
    [assignedKeys, people, query],
  );

  const assign = async (person: SeatPerson) => {
    setPending(true);
    setError("");
    try {
      await licenseReclaimApi.assign(tenantId, licenseId, person, null);
      setQuery("");
      load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Zuweisen fehlgeschlagen.",
      );
    } finally {
      setPending(false);
    }
  };

  const release = async (seat: LicenseSeat) => {
    if (!window.confirm(`Platz von «${seat.assigneeLabel}» zurückgeben?`))
      return;
    setPending(true);
    setError("");
    try {
      await licenseReclaimApi.release(tenantId, seat.id, false, null);
      load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Zurückgeben fehlgeschlagen.",
      );
    } finally {
      setPending(false);
    }
  };

  return createPortal(
    <div
      className="contracts__dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-label="Lizenzplätze"
        aria-modal="true"
        className="contracts__editor-dialog"
        role="dialog"
      >
        <header className="panel-heading">
          <div>
            <p className="eyebrow">
              Plätze
              {quantity !== null
                ? ` · ${active.length} von ${quantity} vergeben`
                : ` · ${active.length} vergeben`}
            </p>
            <h2>{title}</h2>
          </div>
          <button
            aria-label="Dialog schliessen"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>
        <div className="license-reclaim__seats">
          {!readOnly ? (
            <label>
              Person zuweisen
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name oder E-Mail suchen"
                type="search"
                value={query}
              />
            </label>
          ) : null}
          {matches.length > 0 ? (
            <ul className="license-reclaim__people">
              {matches.map((person) => (
                <li
                  key={`${person.userId ?? ""}-${person.entraObjectId ?? ""}`}
                >
                  <button
                    className="secondary-button"
                    disabled={pending}
                    onClick={() => void assign(person)}
                    type="button"
                  >
                    <UserPlus aria-hidden="true" size={15} /> {person.label}
                    {person.email ? (
                      <span className="license-reclaim__muted">
                        {" "}
                        · {person.email}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          {seats === null ? (
            error ? null : (
              <p className="empty-state">Plätze werden geladen …</p>
            )
          ) : active.length === 0 ? (
            <p className="empty-state">Noch keine Plätze vergeben.</p>
          ) : (
            <ul className="license-reclaim__list">
              {active.map((seat) => (
                <li key={seat.id}>
                  <div>
                    <strong>{seat.assigneeLabel}</strong>
                    <span className="license-reclaim__muted">
                      seit {formatDateTime(seat.assignedAt)}
                      {seat.entraObjectId ? " · Entra-Konto verknüpft" : ""}
                    </span>
                  </div>
                  {!readOnly ? (
                    <button
                      className="secondary-button"
                      disabled={pending}
                      onClick={() => void release(seat)}
                      type="button"
                    >
                      <Undo2 aria-hidden="true" size={15} /> Zurückgeben
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {released.length > 0 ? (
            <details>
              <summary>Zurückgegebene Plätze ({released.length})</summary>
              <ul className="license-reclaim__history">
                {released.map((seat) => (
                  <li key={seat.id}>
                    {seat.assigneeLabel} · {formatDateTime(seat.releasedAt)}
                    {seat.m365RemovedAt ? " · Microsoft 365 entfernt" : ""}
                    {seat.releaseReason ? ` · ${seat.releaseReason}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}
