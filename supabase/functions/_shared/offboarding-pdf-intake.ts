// Liest die «Zusammenfassung Austritt» der Personal-App aus dem Text eines PDFs.
//
// Gleiches Layout wie die Eintrittsmeldung (Power Apps): links die
// Bezeichnungen, rechts die Werte. Ein Wert kann einige Punkte höher oder
// tiefer als seine Bezeichnung stehen; er gehört zur nächstgelegenen
// Bezeichnung. Rein und ohne Netzwerk, damit sich die Datei ohne
// Edge-Umgebung testen lässt.

import {
  normalizeLabel,
  parseSwissDate,
  type OnboardingTaskDraft,
  type PdfTextItem,
} from "./onboarding-pdf-intake.ts";

export type OffboardingPdfData = {
  employeeName: string;
  employeeNumber: string | null;
  /** Austrittsdatum (ISO, JJJJ-MM-TT). */
  exitDate: string;
  filledBy: string | null;
  groupMailboxes: string | null;
  ictEquipment: string | null;
};

const VALUE_X = 100;
const LINE_TOLERANCE = 4;
const MAX_LABEL_DISTANCE = 14;

/** True, wenn der Text wie eine Austrittsmeldung der Personal-App aussieht. */
export function looksLikeOffboardingPdf(text: string): boolean {
  return /zusam+enfassungaustritt/.test(normalizeLabel(text));
}

type Row = { y: number; text: string };

function toRows(items: readonly PdfTextItem[]): {
  labels: Row[];
  values: Row[];
} {
  const build = (selected: PdfTextItem[]): Row[] => {
    const sorted = [...selected].sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: { y: number; items: PdfTextItem[] }[] = [];
    for (const item of sorted) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(last.y - item.y) <= LINE_TOLERANCE) {
        last.items.push(item);
      } else {
        rows.push({ y: item.y, items: [item] });
      }
    }
    return rows.map((row) => ({
      y: row.y,
      text: [...row.items]
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text.trim())
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    }));
  };
  const first = items.filter(
    (item) => item.page === 1 && item.text.trim() !== "",
  );
  return {
    labels: build(first.filter((item) => item.x < VALUE_X)),
    values: build(first.filter((item) => item.x >= VALUE_X)),
  };
}

function field(
  label: string,
):
  | "filledBy"
  | "employee"
  | "number"
  | "exit"
  | "equipment"
  | "mailboxes"
  | null {
  const normalized = normalizeLabel(label);
  if (normalized.startsWith("ausgefulltvon")) return "filledBy";
  if (normalized.startsWith("arbeitnehmer")) return "employee";
  if (normalized.startsWith("personalnummer")) return "number";
  if (normalized.startsWith("austrittper")) return "exit";
  if (normalized === "ictausstattung") return "equipment";
  if (normalized === "gruppenpostfacher") return "mailboxes";
  return null;
}

const clean = (value: string | undefined): string | null => {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 2000) : null;
};

export function parseOffboardingPdf(
  items: readonly PdfTextItem[],
): OffboardingPdfData | null {
  const allText = items.map((item) => item.text).join(" ");
  if (!looksLikeOffboardingPdf(allText)) return null;
  const { labels, values } = toRows(items);
  const found = new Map<string, string[]>();
  for (const value of values) {
    let best: { name: string; distance: number } | null = null;
    for (const label of labels) {
      const name = field(label.text);
      if (!name) continue;
      const distance = Math.abs(label.y - value.y);
      if (
        distance <= MAX_LABEL_DISTANCE &&
        (!best || distance < best.distance)
      ) {
        best = { name, distance };
      }
    }
    if (best)
      found.set(best.name, [...(found.get(best.name) ?? []), value.text]);
  }
  const get = (name: string) => clean(found.get(name)?.join(" "));
  const employeeName = get("employee");
  const exitDate = parseSwissDate(get("exit"));
  if (!employeeName || !exitDate) return null;
  return {
    employeeName,
    employeeNumber: get("number"),
    exitDate,
    filledBy: get("filledBy"),
    groupMailboxes: get("mailboxes"),
    ictEquipment: get("equipment"),
  };
}

// «Keine Ausstattung», «braucht auf keine Gruppenpostfächer zugriff», «-» …
const NOTHING = /(^|\s)(keine?|keiner|nein|n\/a)(\s|$)|^-+$/i;
const hasContent = (value: string | null): value is string =>
  value !== null && !NOTHING.test(value.trim());

const taskTitle = (label: string, detail: string | null): string => {
  const text = detail ? `${label}: ${detail}` : label;
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
};

/** Aufgaben eines Austritts, fällig relativ zum Austrittsdatum. */
export function buildOffboardingTasks(
  data: OffboardingPdfData,
): OnboardingTaskDraft[] {
  const tasks: OnboardingTaskDraft[] = [];
  if (hasContent(data.ictEquipment)) {
    tasks.push({
      dueOffsetDays: 0,
      title: taskTitle("ICT-Ausstattung zurücknehmen", data.ictEquipment),
    });
  }
  if (hasContent(data.groupMailboxes)) {
    tasks.push({
      dueOffsetDays: 0,
      title: taskTitle("Gruppenpostfächer entfernen", data.groupMailboxes),
    });
  }
  tasks.push({
    dueOffsetDays: 1,
    title: "Konto und Zugriffe deaktivieren",
  });
  return tasks;
}
