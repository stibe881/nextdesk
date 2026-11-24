/**
 * Mutationen (Art «change») bei Ein- und Austritten: Mutationsarten, ihre
 * Felder, Prüfung und die Kurzfassung für die Liste. Gegenstück auf dem
 * Server: supabase/functions/onboarding (parseChange).
 */

export type ChangeType =
  "name" | "department" | "function" | "location_workload";

export const CHANGE_TYPES: readonly ChangeType[] = [
  "name",
  "department",
  "function",
  "location_workload",
];

export const CHANGE_TYPE_LABELS: Record<ChangeType, string> = {
  name: "Namensänderung",
  department: "Abteilung/Angebot",
  function: "Funktion/Rolle",
  location_workload: "Standort/Pensum",
};

export type ChangeDetailKey =
  | "newName"
  | "previousDepartment"
  | "newDepartment"
  | "previousFunction"
  | "newFunction"
  | "previousLocation"
  | "newLocation"
  | "workload"
  | "note";

export type ChangeField = {
  key: ChangeDetailKey;
  label: string;
  placeholder: string;
  /** Mindestens ein Feld mit «required» der Art muss ausgefüllt sein. */
  required: boolean;
};

/** Felder pro Mutationsart (bisheriger und neuer Wert). */
export const CHANGE_FIELDS: Record<ChangeType, readonly ChangeField[]> = {
  name: [
    {
      key: "newName",
      label: "Neuer Name",
      placeholder: "Vor- und Nachname nach der Änderung",
      required: true,
    },
  ],
  department: [
    {
      key: "previousDepartment",
      label: "Bisherige Abteilung / Angebot",
      placeholder: "z. B. Schule",
      required: false,
    },
    {
      key: "newDepartment",
      label: "Neue Abteilung / Angebot",
      placeholder: "z. B. Internat",
      required: true,
    },
  ],
  function: [
    {
      key: "previousFunction",
      label: "Bisherige Funktion",
      placeholder: "z. B. Lernende*r",
      required: false,
    },
    {
      key: "newFunction",
      label: "Neue Funktion",
      placeholder: "z. B. Fachperson Betreuung",
      required: true,
    },
  ],
  location_workload: [
    {
      key: "previousLocation",
      label: "Bisheriger Standort",
      placeholder: "z. B. Baar (Weststrasse)",
      required: false,
    },
    {
      key: "newLocation",
      label: "Neuer Standort",
      placeholder: "z. B. Baar (Landhausstrasse)",
      required: true,
    },
    {
      key: "workload",
      label: "Neues Pensum / Befristung",
      placeholder: "z. B. 80 %, befristet bis 31.07.2027",
      required: true,
    },
  ],
};

export type ChangeDetails = Partial<Record<ChangeDetailKey, string>>;

/** Nur die Angaben der gewählten Arten, getrimmt, leere weggelassen. */
export function changeDetailsFor(
  types: readonly ChangeType[],
  details: ChangeDetails,
): ChangeDetails {
  const keys = new Set<ChangeDetailKey>(["note"]);
  for (const type of types) {
    for (const field of CHANGE_FIELDS[type]) keys.add(field.key);
  }
  const result: ChangeDetails = {};
  for (const key of keys) {
    const value = details[key]?.trim();
    if (value) result[key] = value;
  }
  return result;
}

/** Arten, bei denen die Pflichtangabe fehlt. */
export function missingChangeTypes(
  types: readonly ChangeType[],
  details: ChangeDetails,
): ChangeType[] {
  return types.filter(
    (type) =>
      !CHANGE_FIELDS[type].some(
        (field) => field.required && details[field.key]?.trim(),
      ),
  );
}

function arrow(previous: string | undefined, next: string | undefined) {
  if (!next) return null;
  return previous ? `${previous} → ${next}` : next;
}

/** Kurzfassung pro Art, z. B. «Name: Anna Muster → Anna Meier». */
export function changeSummary(
  types: readonly ChangeType[],
  details: Record<string, unknown>,
  employeeName: string,
): { type: ChangeType; label: string; text: string }[] {
  const text = (key: ChangeDetailKey) =>
    typeof details[key] === "string" && (details[key] as string).trim()
      ? (details[key] as string).trim()
      : undefined;
  return types.flatMap((type) => {
    let value: string | null = null;
    if (type === "name") value = arrow(employeeName, text("newName"));
    if (type === "department")
      value = arrow(text("previousDepartment"), text("newDepartment"));
    if (type === "function")
      value = arrow(text("previousFunction"), text("newFunction"));
    if (type === "location_workload") {
      value =
        [arrow(text("previousLocation"), text("newLocation")), text("workload")]
          .filter(Boolean)
          .join(" · ") || null;
    }
    return value
      ? [{ type, label: CHANGE_TYPE_LABELS[type], text: value }]
      : [{ type, label: CHANGE_TYPE_LABELS[type], text: "" }];
  });
}
