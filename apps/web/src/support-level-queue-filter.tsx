import { useEffect, useState } from "react";
import {
  loadQueueLevels,
  supportLevelLabel,
  type SupportLevel,
  type SupportLevelFilter,
} from "./lib/support-levels";

/**
 * Stufen-Warteschlangen (z. B. «2nd Level Warteschlange»). Erscheint nur,
 * wenn die Person in Teams mehrerer Supportstufen arbeitet.
 */
export function SupportLevelQueueFilter({
  onChange,
  tenantId,
  value,
}: {
  onChange: (value: SupportLevelFilter) => void;
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
  if (available.length < 2) return null;
  return (
    <div
      aria-label="Supportstufen-Warteschlange"
      className="queue-tabs support-level-queue"
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
            title={`${supportLevelLabel(level)} Warteschlange: Tickets der Teams mit dieser Stufe`}
            type="button"
          >
            {supportLevelLabel(level)} Warteschlange
          </button>
        );
      })}
    </div>
  );
}
