import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { useEffect, useState } from "react";
import {
  loadQueueLevels,
  supportLevelLabel,
  type SupportLevel,
  type SupportLevelFilter,
} from "./lib/support-levels";

export type TicketSortControl<Key extends string> = {
  options: readonly { value: Key; label: string }[];
  sortBy: Key;
  sortDirection: "asc" | "desc";
  onChange: (sortBy: Key, sortDirection: "asc" | "desc") => void;
};

/**
 * Leiste über der Ticketliste: links die Stufen-Warteschlangen (z. B.
 * «2nd Level»), nur wenn die Person in Teams mehrerer Supportstufen arbeitet;
 * rechts für alle «Sortieren nach».
 */
export function SupportLevelQueueFilter<Key extends string>({
  onChange,
  sort,
  tenantId,
  value,
}: {
  onChange: (value: SupportLevelFilter) => void;
  sort: TicketSortControl<Key>;
  tenantId: string;
  value: SupportLevelFilter;
}) {
  const [levels, setLevels] = useState<{
    tenantId: string;
    levels: SupportLevel[];
  } | null>(null);

  useEffect(() => {
    let active = true;
    loadQueueLevels(tenantId)
      .then((next) => {
        if (active) setLevels({ tenantId, levels: next });
      })
      .catch(() => {
        if (active) setLevels({ tenantId, levels: [] });
      });
    return () => {
      active = false;
    };
  }, [tenantId]);

  const available = levels?.tenantId === tenantId ? levels.levels : [];
  useEffect(() => {
    // A stored filter for a level that no longer exists falls back to all.
    if (
      levels?.tenantId === tenantId &&
      value !== "all" &&
      (available.length < 2 ||
        !available.includes(Number(value) as SupportLevel))
    ) {
      onChange("all");
    }
  }, [available, levels, onChange, tenantId, value]);

  // With a single level the tabs would only repeat "Alle Stufen".
  const showLevels = available.length >= 2;
  const ascending = sort.sortDirection === "asc";
  return (
    <div className="queue-tabs support-level-queue">
      {showLevels ? (
        <div
          aria-label="Supportstufen-Warteschlange"
          className="support-level-queue__levels"
          role="group"
        >
          <button
            aria-pressed={value === "all"}
            className={value === "all" ? "queue-tab selected" : "queue-tab"}
            onClick={() => onChange("all")}
            type="button"
          >
            Alle Stufen
          </button>
          {available.map((level) => {
            const key = String(level) as SupportLevelFilter;
            return (
              <button
                aria-pressed={value === key}
                className={value === key ? "queue-tab selected" : "queue-tab"}
                key={level}
                onClick={() => onChange(key)}
                title={`${supportLevelLabel(level)}: Tickets der Teams mit dieser Stufe`}
                type="button"
              >
                {supportLevelLabel(level)}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="support-level-queue__sort">
        <label>
          <span>Sortieren nach:</span>
          <select
            onChange={(event) =>
              sort.onChange(event.target.value as Key, sort.sortDirection)
            }
            value={sort.sortBy}
          >
            {sort.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          aria-label={
            ascending
              ? "Aufsteigend sortiert, auf absteigend umstellen"
              : "Absteigend sortiert, auf aufsteigend umstellen"
          }
          className="support-level-queue__direction"
          onClick={() => sort.onChange(sort.sortBy, ascending ? "desc" : "asc")}
          title={ascending ? "Aufsteigend" : "Absteigend"}
          type="button"
        >
          {ascending ? (
            <ArrowUpNarrowWide aria-hidden="true" size={16} />
          ) : (
            <ArrowDownWideNarrow aria-hidden="true" size={16} />
          )}
        </button>
      </div>
    </div>
  );
}
