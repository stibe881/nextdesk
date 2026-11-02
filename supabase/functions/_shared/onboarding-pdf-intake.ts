// Liest die "Zusammenfassung Eintritt" der Personal-App aus dem Text eines PDFs.
//
// Das PDF stammt aus Power Apps (jsPDF) und hat ein festes Layout: links stehen
// die Bezeichnungen, rechts die Werte. Der Text wird mit Koordinaten gelesen
// (siehe onboarding-pdf-text.ts) und hier zeilenweise zugeordnet. Die
// Funktionen in dieser Datei sind rein und ohne Netzwerk, damit sie sich ohne
// Edge-Umgebung testen lassen.

export type PdfTextItem = { page: number; text: string; x: number; y: number };

export type OnboardingFunction = {
  offer: string;
  role: string;
  special: string;
  team: string;
};

export type OnboardingPdfData = {
  aliasName: string | null;
  doubleName: boolean;
  employeeName: string;
  endDate: string | null;
  filledBy: string | null;
  fixedTerm: boolean;
  functions: OnboardingFunction[];
  gender: string | null;
  groupMailboxes: string | null;
  ictAccess: string | null;
  ictEquipment: string | null;
  jobTitle: string | null;
  needsKey: boolean;
  remarks: string | null;
  room: string | null;
  startDate: string;
  supervisor: string | null;
};

export type OnboardingTaskDraft = { dueOffsetDays: number; title: string };

const VALUE_X = 100;
const LINE_TOLERANCE = 4;

/** Kleinbuchstaben ohne Leerzeichen und Akzente, damit "F unktion" = "Funktion". */
export function normalizeLabel(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/\s+/g, "");
}

/** True, wenn der Text wie eine Eintrittsmeldung der Personal-App aussieht. */
export function looksLikeOnboardingPdf(text: string): boolean {
  return /zusam+enfassungeintritt/.test(normalizeLabel(text));
}

type Field =
  | "filledBy"
  | "employee"
  | "start"
  | "offer"
  | "team"
  | "role"
  | "special"
  | "needsKey"
  | "jobTitle"
  | "supervisor"
  | "gender"
  | "room"
  | "ictEquipment"
  | "ictAccess"
  | "groupMailboxes"
  | "doubleName"
  | "alias"
  | "remarks";

function labelField(
  normalized: string,
): Field | "section1" | "section2" | "ignore" | null {
  if (normalized === "funktion1") return "section1";
  if (normalized === "funktion2") return "section2";
  if (normalized.startsWith("weitereangaben")) return "ignore";
  // Fortsetzungszeilen zweizeiliger Bezeichnungen ("Angebot/ Abteilung" usw.).
  if (normalized === "abteilung" || normalized === "lernende,ziv")
    return "ignore";
  if (normalized.startsWith("zusam")) return "ignore";
  if (normalized.startsWith("ausgefulltvon")) return "filledBy";
  if (normalized.startsWith("arbeitnehmer")) return "employee";
  if (normalized.startsWith("eintrittper")) return "start";
  if (normalized.startsWith("angebot")) return "offer";
  if (normalized === "team") return "team";
  if (normalized === "funktion") return "role";
  if (normalized.startsWith("spia")) return "special";
  if (normalized === "schlussel") return "needsKey";
  if (normalized.startsWith("berufsbezeichnung")) return "jobTitle";
  // Die Vorlage schreibt "driekten Vorgesetzten"; beide Schreibweisen gelten.
  if (/^d[a-z]{3,6}kten?vorgesetzten?$/.test(normalized)) return "supervisor";
  if (normalized === "geschlecht") return "gender";
  if (normalized === "raumnummer") return "room";
  if (normalized === "ictausstattung") return "ictEquipment";
  if (normalized === "ictzugange") return "ictAccess";
  if (normalized === "gruppenpostfacher") return "groupMailboxes";
  if (normalized === "doppelnamen") return "doubleName";
  if (normalized === "bemerkung") return "remarks";
  return null;
}

type Line = { labels: PdfTextItem[]; values: PdfTextItem[] };

function toLines(items: readonly PdfTextItem[]): Line[] {
  const lines: Line[] = [];
  const pages = [...new Set(items.map((item) => item.page))].sort(
    (a, b) => a - b,
  );
  for (const page of pages) {
    const pageItems = items
      .filter((item) => item.page === page && item.text.trim() !== "")
      .sort((a, b) => b.y - a.y || a.x - b.x);
    let current: PdfTextItem[] = [];
    let currentY = Number.POSITIVE_INFINITY;
    const flush = () => {
      if (current.length === 0) return;
      const ordered = [...current].sort((a, b) => a.x - b.x);
      lines.push({
        labels: ordered.filter((item) => item.x < VALUE_X),
        values: ordered.filter((item) => item.x >= VALUE_X),
      });
      current = [];
    };
    for (const item of pageItems) {
      if (Math.abs(item.y - currentY) > LINE_TOLERANCE) {
        flush();
        currentY = item.y;
      }
      current.push(item);
    }
    flush();
  }
  return lines;
}

export function parseSwissDate(
  value: string | null | undefined,
): string | null {
  const match = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(value ?? "");
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const isYes = (value: string | null | undefined): boolean =>
  /^(ja|yes|x|true)$/i.test((value ?? "").trim());

const clean = (value: string | null | undefined): string | null => {
  const text = (value ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\u0000/g, "")
    .trim();
  return text ? text.slice(0, 2000) : null;
};

export function parseOnboardingPdf(
  items: readonly PdfTextItem[],
): OnboardingPdfData | null {
  const lines = toLines(items);
  const text = lines
    .map((line) =>
      [...line.labels, ...line.values].map((item) => item.text).join(" "),
    )
    .join("\n");
  if (!looksLikeOnboardingPdf(text)) return null;

  const values = new Map<Field, string[]>();
  const push = (field: Field, value: string, separator = "\n") => {
    const parts = values.get(field) ?? [];
    if (separator === " " && parts.length > 0) {
      parts[parts.length - 1] = `${parts[parts.length - 1]} ${value}`;
    } else {
      parts.push(value);
    }
    values.set(field, parts);
  };
  const functions: Record<1 | 2, Partial<Record<Field, string>>> = {
    1: {},
    2: {},
  };
  const functionValue = (section: 1 | 2, field: Field, value: string) => {
    functions[section][field] = functions[section][field]
      ? `${functions[section][field]} ${value}`
      : value;
  };

  let section: 1 | 2 | null = null;
  let current: Field | null = null;
  let doubleNameCount = 0;
  let permanent: string | null = null;
  let fixedTerm: string | null = null;
  let endDate: string | null = null;
  const functionFields: Field[] = ["offer", "team", "role", "special"];

  for (const line of lines) {
    const labelText = line.labels.map((item) => item.text).join(" ");
    const normalized = normalizeLabel(labelText);
    const valueText = line.values
      .map((item) => item.text.trim())
      .join(" ")
      .trim();

    // Zeile "unbefristet nein befristet ja bis 02.07.2027"
    if (normalized.startsWith("unbefristet")) {
      const tokens = [...line.labels, ...line.values].map((item) =>
        item.text.trim(),
      );
      const at = (word: string) =>
        tokens.findIndex((token) => normalizeLabel(token) === word);
      const permanentAt = at("unbefristet");
      const fixedAt = at("befristet");
      const untilAt = at("bis");
      permanent = permanentAt >= 0 ? (tokens[permanentAt + 1] ?? null) : null;
      fixedTerm = fixedAt >= 0 ? (tokens[fixedAt + 1] ?? null) : null;
      endDate = untilAt >= 0 ? parseSwissDate(tokens[untilAt + 1]) : null;
      current = null;
      continue;
    }

    if (line.labels.length > 0) {
      const kind = labelField(normalized);
      if (kind === "section1" || kind === "section2") {
        section = kind === "section1" ? 1 : 2;
        current = null;
        continue;
      }
      if (kind === "ignore") continue;
      if (kind) {
        current = kind;
        if (kind === "doubleName") {
          doubleNameCount += 1;
          if (doubleNameCount === 2) current = "alias";
        }
        if (valueText) {
          if (functionFields.includes(current) && section) {
            functionValue(section, current, valueText);
          } else {
            push(current, valueText, " ");
          }
        }
        continue;
      }
      // Freitext ohne Bezeichnung, nur unter "Bemerkung" erwartet.
      if (current === "remarks") {
        push("remarks", [labelText, valueText].filter(Boolean).join(" "));
      }
      continue;
    }

    // Wertzeile ohne Bezeichnung: gehört zur zuletzt gelesenen Bezeichnung.
    if (current && valueText) {
      if (functionFields.includes(current) && section) {
        functionValue(section, current, valueText);
      } else {
        push(current, valueText, current === "remarks" ? "\n" : "\n");
      }
    }
  }

  const get = (field: Field): string | null => {
    const parts = values.get(field);
    return parts ? clean(parts.join("\n")) : null;
  };
  const employeeName = get("employee");
  const startDate = parseSwissDate(get("start"));
  if (!employeeName || !startDate) return null;

  const parsedFunctions: OnboardingFunction[] = ([1, 2] as const)
    .map((index) => ({
      offer: clean(functions[index].offer) ?? "",
      role: clean(functions[index].role) ?? "",
      special: clean(functions[index].special) ?? "",
      team: clean(functions[index].team) ?? "",
    }))
    .filter(
      (entry) => entry.offer || entry.role || entry.special || entry.team,
    );

  const isFixed = isYes(fixedTerm) && !isYes(permanent);
  return {
    aliasName: get("alias"),
    doubleName: isYes(get("doubleName")),
    employeeName,
    endDate: isFixed ? endDate : null,
    filledBy: get("filledBy"),
    fixedTerm: isFixed,
    functions: parsedFunctions,
    gender: get("gender"),
    groupMailboxes: get("groupMailboxes"),
    ictAccess: get("ictAccess"),
    ictEquipment: get("ictEquipment"),
    jobTitle: get("jobTitle"),
    needsKey: isYes(get("needsKey")),
    remarks: get("remarks"),
    room: get("room"),
    startDate,
    supervisor: get("supervisor"),
  };
}

const NOTHING = /^(keine?|keiner|nein|-+|n\/a)\b/i;
const hasContent = (value: string | null): value is string =>
  value !== null && !NOTHING.test(value.trim());

const taskTitle = (label: string, detail: string | null): string => {
  const text = detail
    ? `${label}: ${detail.replace(/\s*\n\s*/g, "; ")}`
    : label;
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
};

/**
 * Zusätzliche Aufgaben aus den Angaben der Eintrittsmeldung. Die Standardvorlage
 * des Mandanten deckt Konto, Gerät, Arbeitsplatz und Übergabe bereits ab; hier
 * kommen die konkreten Wünsche aus dem PDF dazu.
 */
export function buildOnboardingTasks(
  data: OnboardingPdfData,
): OnboardingTaskDraft[] {
  const tasks: OnboardingTaskDraft[] = [];
  if (data.doubleName && data.aliasName) {
    tasks.push({
      dueOffsetDays: -5,
      title: taskTitle(
        "E-Mail-Alias für Doppelnamen einrichten",
        data.aliasName,
      ),
    });
  }
  if (hasContent(data.groupMailboxes)) {
    tasks.push({
      dueOffsetDays: -4,
      title: taskTitle("Gruppenpostfächer berechtigen", data.groupMailboxes),
    });
  }
  if (hasContent(data.ictEquipment)) {
    tasks.push({
      dueOffsetDays: -7,
      title: taskTitle("ICT-Ausstattung bereitstellen", data.ictEquipment),
    });
  }
  if (hasContent(data.ictAccess)) {
    tasks.push({
      dueOffsetDays: -5,
      title: taskTitle("Software und Zugänge einrichten", data.ictAccess),
    });
  }
  const accessLines = (data.remarks ?? "")
    .split("\n")
    .filter((line) =>
      /zugang|zugäng|zugaeng|software|berechtigung/i.test(line),
    );
  if (accessLines.length > 0) {
    tasks.push({
      dueOffsetDays: -5,
      title: taskTitle(
        "Zugänge aus der Bemerkung einrichten",
        accessLines.join("\n"),
      ),
    });
  }
  if (data.needsKey) {
    tasks.push({
      dueOffsetDays: -3,
      title: taskTitle("Schlüssel bereitstellen", data.room),
    });
  }
  return tasks;
}
