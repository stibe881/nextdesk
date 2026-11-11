import { type FormEvent, useCallback, useEffect, useState } from "react";
import { AlertTriangle, Settings2, ShieldCheck } from "lucide-react";

import { functionErrorMessage } from "./lib/function-error";
import {
  type AutomationDraft,
  type InventoryAutomation as Automation,
  draftFromAutomation,
  parseInventoryAutomation,
  saveRequest,
} from "./lib/inventory-automation";
import { formatDate } from "./lib/shop";
import { supabase } from "./lib/supabase";

function amount(value: number, unit: string): string {
  const formatted = new Intl.NumberFormat("de-CH", {
    maximumFractionDigits: 3,
  }).format(value);
  return unit === "each" ? `${formatted} Stück` : `${formatted} ${unit}`;
}

/**
 * Lager-Automatik: Standard-Lagerort für Rücknahmen (Austritt,
 * Shop-Ausleihen), Nachbestellung bei Mindestbestand, Haltefrist für
 * Reservationen und Inventur-Erinnerung pro Lagerort.
 */
export function InventoryAutomation({ tenantId }: { tenantId: string }) {
  const [automation, setAutomation] = useState<Automation | null>(null);
  const [draft, setDraft] = useState<AutomationDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"error" | "success">("error");

  const apply = useCallback((data: unknown): boolean => {
    const parsed = parseInventoryAutomation(data);
    if (!parsed) return false;
    setAutomation(parsed);
    setDraft(draftFromAutomation(parsed));
    return true;
  }, []);

  const invoke = useCallback(
    async (body: Record<string, unknown>, success: string | null) => {
      if (!supabase) {
        setMessageKind("error");
        setMessage("Die Verbindung zu nextDesk ist nicht konfiguriert.");
        return false;
      }
      try {
        const { data, error } = await supabase.functions.invoke<unknown>(
          "inventory",
          { body },
        );
        if (error) throw error;
        if (!apply(data)) {
          throw new Error("Die Antwort der Lager-Automatik ist unvollständig.");
        }
        if (success) {
          setMessageKind("success");
          setMessage(success);
        }
        return true;
      } catch (error) {
        setMessageKind("error");
        setMessage(
          await functionErrorMessage(
            error,
            "Die Lager-Automatik konnte nicht geladen oder gespeichert werden.",
          ),
        );
        return false;
      }
    },
    [apply],
  );

  useEffect(() => {
    setAutomation(null);
    setMessage("");
    setLoading(true);
    void invoke({ type: "getInventoryAutomation", tenantId }, null).finally(
      () => setLoading(false),
    );
  }, [invoke, tenantId]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || busy) return;
    const request = saveRequest(tenantId, draft);
    if ("error" in request) {
      setMessageKind("error");
      setMessage(request.error);
      return;
    }
    setBusy("save");
    await invoke(request.body, "Die Lager-Automatik wurde gespeichert.");
    setBusy(null);
  };

  const handle = async (
    requestId: string,
    status: "ordered" | "done" | "dismissed",
  ) => {
    if (busy) return;
    setBusy(requestId);
    await invoke(
      { type: "manageReorderRequest", tenantId, requestId, status },
      status === "ordered"
        ? "Die Nachbestellung wurde als bestellt markiert."
        : status === "done"
          ? "Die Nachbestellung ist erledigt."
          : "Die Nachbestellung wurde verworfen.",
    );
    setBusy(null);
  };

  const activeLocations =
    automation?.locations.filter((row) => row.active) ?? [];

  return (
    <section className="inventory__panel panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">AUTOMATIK</span>
          <h2>Lager-Automatik</h2>
          <p>
            Rücknahmen, Nachbestellungen, Reservationen und Inventuren laufen
            nach diesen Regeln automatisch.
          </p>
        </div>
        <Settings2 aria-hidden="true" size={21} />
      </div>

      {message ? (
        <div
          className={`inventory__state${
            messageKind === "error" ? " inventory__state--error" : ""
          }`}
          role={messageKind === "error" ? "alert" : "status"}
        >
          {messageKind === "error" ? (
            <AlertTriangle aria-hidden="true" size={18} />
          ) : (
            <ShieldCheck aria-hidden="true" size={18} />
          )}
          <span>{message}</span>
        </div>
      ) : null}
      {loading ? (
        <p className="inventory__state">Lager-Automatik wird geladen …</p>
      ) : null}

      {automation && automation.reorderRequests.length ? (
        <div className="inventory__procurement-supplier">
          <h3>Nachbestellungen</h3>
          <ul className="inventory__list">
            {automation.reorderRequests.map((request) => (
              <li key={request.id}>
                <div>
                  <strong>
                    {request.itemName} ·{" "}
                    {amount(request.suggestedQuantity, request.unit)}
                  </strong>
                  <small>
                    {request.articleNumber
                      ? `Art.-Nr. ${request.articleNumber} · `
                      : ""}
                    {request.supplier ? `${request.supplier} · ` : ""}
                    unter Mindestbestand seit {formatDate(request.createdAt)}
                    {request.status === "ordered" ? " · bestellt" : ""}
                  </small>
                </div>
                <div>
                  {request.status === "open" ? (
                    <button
                      disabled={busy !== null}
                      onClick={() => void handle(request.id, "ordered")}
                      type="button"
                    >
                      Bestellt
                    </button>
                  ) : null}
                  <button
                    disabled={busy !== null}
                    onClick={() => void handle(request.id, "done")}
                    type="button"
                  >
                    Erledigt
                  </button>
                  <button
                    disabled={busy !== null}
                    onClick={() => void handle(request.id, "dismissed")}
                    type="button"
                  >
                    Verwerfen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {automation && draft ? (
        <form
          className="inventory__form"
          onSubmit={(event) => void save(event)}
        >
          <h3>Rücknahmen</h3>
          <p className="inventory__muted">
            Geräte aus einem Austritt und zurückgegebene Shop-Ausleihen werden
            an diesen Lagerort gebucht, sofern bei der Rückgabe kein anderer
            gewählt wird.
          </p>
          <label>
            Standard-Lagerort
            <select
              onChange={(event) =>
                setDraft({
                  ...draft,
                  defaultReturnLocationId: event.target.value,
                })
              }
              value={draft.defaultReturnLocationId}
            >
              <option value="">Kein Standard-Lagerort</option>
              {activeLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          {automation.departments.map((department) => (
            <label key={department.id}>
              Lagerort für {department.name}
              <select
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    departmentLocations: {
                      ...draft.departmentLocations,
                      [department.id]: event.target.value,
                    },
                  })
                }
                value={draft.departmentLocations[department.id] ?? ""}
              >
                <option value="">Standard-Lagerort verwenden</option>
                {activeLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
          ))}

          <h3>Mindestbestand</h3>
          <label className="inventory__checkbox">
            <input
              checked={draft.reorderNotify}
              onChange={(event) =>
                setDraft({ ...draft, reorderNotify: event.target.checked })
              }
              type="checkbox"
            />
            Lagerverwaltung benachrichtigen («Nachbestellen»)
          </label>
          <label className="inventory__checkbox">
            <input
              checked={draft.reorderCreateTask}
              onChange={(event) =>
                setDraft({ ...draft, reorderCreateTask: event.target.checked })
              }
              type="checkbox"
            />
            Nachbestell-Aufgabe anlegen (bis zum Sollbestand)
          </label>

          <h3>Reservationen</h3>
          <label>
            Offene Reservationen automatisch freigeben nach (Tagen)
            <input
              inputMode="numeric"
              onChange={(event) =>
                setDraft({ ...draft, reservationHoldDays: event.target.value })
              }
              placeholder="nie"
              value={draft.reservationHoldDays}
            />
          </label>
          <p className="inventory__muted">
            Reservationen aus Shop-Bestellungen, Eintritten und Raumbuchungen
            bleiben bestehen, bis sie ausgegeben oder storniert werden.
          </p>

          <h3>Inventur</h3>
          {automation.locations.length === 0 ? (
            <p className="inventory__empty">Noch keine Lagerorte erfasst.</p>
          ) : null}
          {automation.locations.map((location) => (
            <label key={location.id}>
              {location.name}: Inventur alle … Tage
              <input
                inputMode="numeric"
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    countIntervals: {
                      ...draft.countIntervals,
                      [location.id]: event.target.value,
                    },
                  })
                }
                placeholder="keine Erinnerung"
                value={draft.countIntervals[location.id] ?? ""}
              />
              <small className="inventory__muted">
                {location.lastCountedAt
                  ? `Letzte Inventur ${formatDate(location.lastCountedAt)}`
                  : "Noch keine abgeschlossene Inventur"}
                {location.nextCountDue
                  ? ` · nächste fällig ${formatDate(location.nextCountDue)}`
                  : ""}
              </small>
            </label>
          ))}

          <button disabled={busy !== null} type="submit">
            {busy === "save" ? "Wird gespeichert …" : "Speichern"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
