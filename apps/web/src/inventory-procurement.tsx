import { type FormEvent, useCallback, useEffect, useState } from "react";
import { AlertTriangle, ShieldCheck, ShoppingCart } from "lucide-react";

import { functionErrorMessage } from "./lib/function-error";
import {
  type ProcurementGroup,
  type ProcurementSupplierGroup,
  parseProcurementGroups,
  procurementSummary,
  unorderedBackorderIds,
} from "./lib/procurement";
import { formatDate } from "./lib/shop";
import { supabase } from "./lib/supabase";

type ProcurementAction =
  | {
      type: "manageBackorders";
      tenantId: string;
      operation: "order" | "cancel";
      backorderIds: string[];
      supplier?: string | null;
      expectedOn?: string | null;
      note?: string | null;
    }
  | { type: "allocateBackorders"; tenantId: string; itemId: string };

function amount(value: number, unit: string): string {
  const formatted = new Intl.NumberFormat("de-CH", {
    maximumFractionDigits: 3,
  }).format(value);
  return unit === "each" ? `${formatted} Stück` : `${formatted} ${unit}`;
}

/**
 * Beschaffung: Shop-Bestellzeilen, die nicht aus dem Lager bedient werden
 * konnten. Bei einem Wareneingang reserviert der Server die Ware automatisch
 * für die ältesten Bedarfe und meldet der bestellenden Person «Bereit zur
 * Abholung».
 */
export function InventoryProcurement({ tenantId }: { tenantId: string }) {
  const [groups, setGroups] = useState<ProcurementGroup[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"error" | "success">("error");

  const load = useCallback(async (): Promise<boolean> => {
    if (!supabase) {
      setLoading(false);
      setMessageKind("error");
      setMessage("Die Verbindung zu nextDesk ist nicht konfiguriert.");
      return false;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<unknown>(
        "inventory",
        { body: { tenantId, type: "listBackorders" } },
      );
      if (error) throw error;
      const parsed = parseProcurementGroups(data);
      if (!parsed) {
        throw new Error(
          "Die Beschaffungsliste ist unvollständig oder nicht autorisiert.",
        );
      }
      setGroups(parsed);
      return true;
    } catch (error) {
      setGroups(null);
      setMessageKind("error");
      setMessage(
        await functionErrorMessage(
          error,
          "Die Beschaffungsliste konnte nicht geladen werden.",
        ),
      );
      return false;
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    setGroups(null);
    setMessage("");
    void load();
  }, [load]);

  const run = useCallback(
    async (action: ProcurementAction, success: string): Promise<boolean> => {
      if (!supabase) return false;
      setMessage("");
      try {
        const { error } = await supabase.functions.invoke<unknown>(
          "inventory",
          { body: action },
        );
        if (error) throw error;
        const refreshed = await load();
        setMessageKind(refreshed ? "success" : "error");
        setMessage(
          refreshed
            ? success
            : "Die Aktion wurde gespeichert, aber die Liste konnte nicht aktualisiert werden.",
        );
        return true;
      } catch (error) {
        setMessageKind("error");
        setMessage(
          await functionErrorMessage(
            error,
            "Die Beschaffung konnte nicht aktualisiert werden.",
          ),
        );
        return false;
      }
    },
    [load],
  );

  const summary = groups ? procurementSummary(groups) : null;

  return (
    <section className="inventory__panel panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">BESCHAFFUNG</span>
          <h2>Shop-Bestellungen ohne Lagerbestand</h2>
          <p>
            Kann eine freigegebene Bestellung nicht aus dem Lager bedient
            werden, erscheint sie hier. Beim Wareneingang wird die Ware
            automatisch für die ältesten Bedarfe reserviert und die bestellende
            Person benachrichtigt.
          </p>
        </div>
        <ShoppingCart aria-hidden="true" size={21} />
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

      {loading && !groups ? (
        <p className="inventory__state">Beschaffung wird geladen …</p>
      ) : null}

      {summary ? (
        <p className="inventory__statement">
          <strong>{summary.open}</strong> offen ·{" "}
          <strong>{summary.ordered}</strong> bestellt · {summary.items} Artikel
        </p>
      ) : null}

      {groups && groups.length === 0 ? (
        <p className="inventory__empty">
          Zurzeit wartet keine Shop-Bestellung auf Ware.
        </p>
      ) : null}

      {groups?.map((group) => (
        <article className="inventory__procurement-item" key={group.itemId}>
          <header>
            <div>
              <h3>{group.itemName}</h3>
              <small className="inventory__muted">
                {group.articleNumber
                  ? `Art.-Nr. ${group.articleNumber} · `
                  : ""}
                Bedarf {amount(group.openQuantity, group.unit)} · frei{" "}
                {amount(group.available, group.unit)} ·{" "}
                <strong>
                  fehlt {amount(group.missingQuantity, group.unit)}
                </strong>
              </small>
            </div>
            {group.servableNow > 0 ? (
              <AllocateButton
                count={group.servableNow}
                onAllocate={() =>
                  run(
                    {
                      type: "allocateBackorders",
                      tenantId,
                      itemId: group.itemId,
                    },
                    "Der freie Bestand wurde den wartenden Bestellungen zugeteilt.",
                  )
                }
              />
            ) : null}
          </header>
          {group.suppliers.map((supplier) => (
            <SupplierGroup
              key={`${group.itemId}:${supplier.supplier ?? ""}`}
              onRun={run}
              supplier={supplier}
              tenantId={tenantId}
              unit={group.unit}
            />
          ))}
        </article>
      ))}
    </section>
  );
}

function AllocateButton({
  count,
  onAllocate,
}: {
  count: number;
  onAllocate: () => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await onAllocate();
        setBusy(false);
      }}
      type="button"
    >
      {busy
        ? "Wird zugeteilt …"
        : `Aus Lager zuteilen (${count} ${count === 1 ? "Bestellung" : "Bestellungen"})`}
    </button>
  );
}

function SupplierGroup({
  onRun,
  supplier,
  tenantId,
  unit,
}: {
  onRun: (action: ProcurementAction, success: string) => Promise<boolean>;
  supplier: ProcurementSupplierGroup;
  tenantId: string;
  unit: string;
}) {
  const unordered = unorderedBackorderIds(supplier);
  const targetIds = unordered.length
    ? unordered
    : supplier.backorders.map((backorder) => backorder.id);
  const firstExpected =
    supplier.backorders.find((backorder) => backorder.expectedOn)?.expectedOn ??
    "";
  const [supplierName, setSupplierName] = useState(supplier.supplier ?? "");
  const [expectedOn, setExpectedOn] = useState(firstExpected);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const markOrdered = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy("order");
    const done = await onRun(
      {
        type: "manageBackorders",
        tenantId,
        operation: "order",
        backorderIds: targetIds,
        supplier: supplierName.trim() || null,
        expectedOn: expectedOn || null,
        note: note.trim() || null,
      },
      unordered.length
        ? "Die Bedarfe wurden als bestellt markiert."
        : "Der Liefertermin wurde aktualisiert.",
    );
    setBusy(null);
    if (done) setNote("");
  };

  const cancel = async (backorderId: string) => {
    if (busy) return;
    if (
      !window.confirm(
        "Diesen Bedarf wirklich stornieren? Die Shop-Bestellung bleibt bestehen, die Ware wird aber nicht mehr automatisch reserviert.",
      )
    ) {
      return;
    }
    setBusy(backorderId);
    await onRun(
      {
        type: "manageBackorders",
        tenantId,
        operation: "cancel",
        backorderIds: [backorderId],
      },
      "Der Bedarf wurde storniert.",
    );
    setBusy(null);
  };

  return (
    <div className="inventory__procurement-supplier">
      <h4>
        {supplier.supplier ?? "Ohne Lieferant"} ·{" "}
        {amount(supplier.quantity, unit)}
      </h4>
      <ul className="inventory__list">
        {supplier.backorders.map((backorder) => (
          <li key={backorder.id}>
            <div>
              <strong>
                {amount(backorder.quantity, unit)}
                {backorder.orderNumber ? ` · ${backorder.orderNumber}` : ""}
              </strong>
              <small>
                {backorder.requesterName ?? "Unbekannte Person"} · erfasst{" "}
                {formatDate(backorder.createdAt)}
                {backorder.status === "ordered"
                  ? ` · bestellt${
                      backorder.expectedOn
                        ? `, voraussichtlich am ${formatDate(backorder.expectedOn)}`
                        : ""
                    }`
                  : " · noch nicht bestellt"}
                {backorder.note ? ` · ${backorder.note}` : ""}
              </small>
            </div>
            <div>
              <button
                disabled={busy !== null}
                onClick={() => void cancel(backorder.id)}
                type="button"
              >
                {busy === backorder.id ? "Wird storniert …" : "Stornieren"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <details className="inventory__form">
        <summary>
          {unordered.length
            ? `Als bestellt markieren (${unordered.length})`
            : "Liefertermin aktualisieren"}
        </summary>
        <form onSubmit={(event) => void markOrdered(event)}>
          <label>
            Lieferant
            <input
              autoComplete="off"
              maxLength={160}
              onChange={(event) => setSupplierName(event.target.value)}
              value={supplierName}
            />
          </label>
          <label>
            Voraussichtlich am
            <input
              onChange={(event) => setExpectedOn(event.target.value)}
              type="date"
              value={expectedOn}
            />
          </label>
          <label>
            Notiz (z. B. Bestellnummer)
            <input
              autoComplete="off"
              maxLength={1000}
              onChange={(event) => setNote(event.target.value)}
              value={note}
            />
          </label>
          <button disabled={busy !== null} type="submit">
            {busy === "order"
              ? "Wird gespeichert …"
              : unordered.length
                ? "Als bestellt markieren"
                : "Liefertermin speichern"}
          </button>
        </form>
      </details>
    </div>
  );
}
