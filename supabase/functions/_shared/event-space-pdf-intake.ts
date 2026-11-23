// Bestellung aus der Anlässe-App («Bestellung Anlässe Essen und Einrichten für
// Anlass …»): Die Angaben stehen im angehängten PDF «Anlassdetails», nicht im
// Mailtext. Das PDF wird hier in dasselbe Feldformat übersetzt, das die
// bestehende Übernahme in die Anlassplanung versteht.

export type EventPdfTextItem = {
  page: number;
  text: string;
  x: number;
  y: number;
};

export type EventOrderPdf = EventOrder;

/** Bestellung der Anlässe-App, aus dem PDF oder aus der Mail ans ICT-Team. */
export type EventOrder = {
  orderId: string;
  title: string;
  eventType: string | null;
  costCenterEmail: string | null;
  costCenter: string | null;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  startTime: string;
  endTime: string | null;
  persons: string | null;
  location: string;
  roomRent: boolean;
  infrastructure: string[];
  ict: Record<IctField, string>;
  service: string[];
  articles: string[];
  totalCost: string | null;
  remarks: string | null;
};

type IctField =
  | "ictMaterial"
  | "projector"
  | "screen"
  | "microphone"
  | "receptionLaptop"
  | "presenter"
  | "internetAccess";

const ICT_LABELS: Record<IctField, string> = {
  ictMaterial: "ict material",
  projector: "beamer",
  screen: "leinwand",
  microphone: "mikrofon",
  receptionLaptop: "empfangslaptop",
  presenter: "presenter",
  internetAccess: "zugang internet",
};

type Line = { page: number; y: number; labelX: number; parts: string[] };

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function key(value: string): string {
  return normalize(value).replace(/:$/u, "").trim().toLocaleLowerCase("de-CH");
}

/** Textstücke gleicher Höhe (±2 pt) einer Seite bilden eine Zeile. */
export function pdfLines(items: readonly EventPdfTextItem[]): Line[] {
  const sorted = [...items]
    .filter((item) => item.text.trim() !== "")
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: { page: number; y: number; items: EventPdfTextItem[] }[] = [];
  for (const item of sorted) {
    const line = lines.find(
      (candidate) =>
        candidate.page === item.page && Math.abs(candidate.y - item.y) <= 2,
    );
    if (line) line.items.push(item);
    else lines.push({ page: item.page, y: item.y, items: [item] });
  }
  return lines
    .sort((a, b) => a.page - b.page || b.y - a.y)
    .map((line) => {
      const items = line.items.sort((a, b) => a.x - b.x);
      return {
        page: line.page,
        y: line.y,
        labelX: items[0]?.x ?? 0,
        parts: items.map((item) => normalize(item.text)),
      };
    });
}

const LABELS = [
  "anlassname",
  "anlasstyp",
  "kostenstellen verantwortliche person mail",
  "kunde extern adresse",
  "anlassdatum",
  "anzahl personen",
  "ort / örtlichkeit",
  "ort / örtlichkeit andere",
  "zeit beginn anlass",
  "zeit ende anlass",
  "kostenstelle intern",
  "raummiete",
  "konsumation",
  "bestuhlung",
  "anzahl stühle",
  "anzahl tische",
  "anzahl stehtische",
  "anzahl stellwände",
  "anzahl flipcharts",
  "rednerpult",
  ...Object.values(ICT_LABELS),
  "service",
  "znüni",
  "zvieri",
  "apero",
  "menu",
  "bemerkung",
  "infobildschirm",
] as const;

const SECTION_TITLES = new Set([
  "details infrastruktur",
  "details ict",
  "details service",
  "zusammenfassung bestellung artikel gastro",
]);

function time(parts: readonly string[]): string | null {
  const digits = parts.join(" ").match(/(\d{1,2})\s*:?\s*(\d{2})/u);
  if (!digits) return null;
  const hour = Number(digits[1]);
  const minute = Number(digits[2]);
  return hour <= 23 && minute <= 59
    ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    : null;
}

/** Erkennt das PDF «Anlassdetails» der Anlässe-App und liest die Angaben. */
export function parseEventOrderPdf(
  items: readonly EventPdfTextItem[],
): EventOrderPdf | null {
  const lines = pdfLines(items);
  const all = lines.map((line) => line.parts.join(" ")).join("\n");
  if (
    !/anlassname/iu.test(all) ||
    !/anlassdatum/iu.test(all) ||
    !/zeit beginn anlass/iu.test(all)
  ) {
    return null;
  }
  const orderId = /\bID\s+(\d{1,10})\b/u.exec(all)?.[1] ?? null;

  // Werte je Feld: Der Wert steht in derselben Zeile hinter dem Label oder
  // (leicht versetzt) in der nächsten Zeile ohne eigenes Label.
  const values = new Map<string, string[]>();
  const service: string[] = [];
  const articles: string[] = [];
  let current: string | null = null;
  let inArticles = false;
  let pendingArticle: string | null = null;
  const remarks: string[] = [];
  let totalCost: string | null = null;

  for (const line of lines) {
    const first = key(line.parts[0] ?? "");
    const label =
      LABELS.find((candidate) => candidate === first) ??
      // «Allgmeine Details Anlass…» und ähnliche Kopfzeilen überspringen.
      null;
    if (SECTION_TITLES.has(first)) {
      inArticles = first === "zusammenfassung bestellung artikel gastro";
      current = null;
      continue;
    }
    if (/^totale k ?osten ganzer anlass/iu.test(line.parts.join(" "))) {
      inArticles = false;
      current = null;
      continue;
    }
    if (/^totale kosten essens/iu.test(first)) {
      inArticles = false;
      current = "total";
      continue;
    }
    if (inArticles) {
      if (first === "artikel") continue;
      const isNumbers = line.parts.every((part) => /^[\d.,]+$/u.test(part));
      if (isNumbers && pendingArticle) {
        const [quantity] = line.parts;
        articles.push(`${quantity}× ${pendingArticle}`);
        pendingArticle = null;
      } else if (!isNumbers) {
        const tail = line.parts.slice(1);
        if (tail.length >= 1 && /^\d+$/u.test(tail[0] ?? "")) {
          articles.push(`${tail[0]}× ${line.parts[0]}`);
        } else {
          pendingArticle = line.parts.join(" ");
        }
      }
      continue;
    }
    if (current === "total") {
      totalCost ??= line.parts.join(" ");
      current = null;
      continue;
    }
    if (label === "service") {
      // «Service: … Kosten Service: 0 CHF Total Dienstleistungen: 0 CHF»
      const text = line.parts.slice(1).join(" ");
      const cost = /Kosten Service:\s*([^T]+?)\s*(?:Total|$)/u.exec(text)?.[1];
      if (cost && !/^0\s*CHF$/u.test(cost)) service.push(`Service: ${cost}`);
      current = null;
      continue;
    }
    if (label && ["znüni", "zvieri", "apero", "menu"].includes(label)) {
      const rest = line.parts
        .slice(1)
        .filter((part) => !/^Lieferzeit/u.test(part));
      const value = rest.filter((part) => !/^[\d:]+$/u.test(part)).join(" ");
      current = label;
      values.set(label, value ? [value] : []);
      continue;
    }
    if (current && ["znüni", "zvieri", "apero", "menu"].includes(current)) {
      // Lieferzeit «00 : 00» in der Folgezeile
      const at = time(line.parts);
      const value = values.get(current)?.[0];
      if (value) {
        const name = current[0]!.toLocaleUpperCase("de-CH") + current.slice(1);
        service.push(
          at && at !== "00:00"
            ? `${name}: ${value} (Lieferung ${at})`
            : `${name}: ${value}`,
        );
      }
      current = null;
      continue;
    }
    if (label === "bemerkung") {
      current = "bemerkung";
      const rest = line.parts.slice(1).join(" ");
      if (rest) remarks.push(rest);
      continue;
    }
    if (label === "infobildschirm") {
      current = null;
      continue;
    }
    if (current === "bemerkung" && !label) {
      remarks.push(line.parts.join(" "));
      continue;
    }
    if (label) {
      current = label;
      values.set(label, line.parts.slice(1));
      continue;
    }
    if (current && (values.get(current)?.length ?? 0) === 0) {
      values.set(current, line.parts);
      continue;
    }
    if (current === "zeit beginn anlass" || current === "zeit ende anlass") {
      values.set(current, [...(values.get(current) ?? []), ...line.parts]);
    }
  }

  const text = (label: string): string | null => {
    const value = (values.get(label) ?? []).join(" ").trim();
    return value && value !== ":" ? value : null;
  };
  const title = text("anlassname");
  const dateText = text("anlassdatum");
  const date = dateText
    ? /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/u.exec(dateText)
    : null;
  const startTime = time(values.get("zeit beginn anlass") ?? []);
  const location =
    text("ort / örtlichkeit andere") ?? text("ort / örtlichkeit");
  if (!orderId || !title || !date || !startTime || !location) return null;

  const infrastructure: string[] = [];
  const seating = text("bestuhlung");
  if (seating && !/^keine$/iu.test(seating)) {
    infrastructure.push(`Bestuhlung: ${seating}`);
  }
  for (const [label, name] of [
    ["anzahl stühle", "Stühle"],
    ["anzahl tische", "Tische"],
    ["anzahl stehtische", "Stehtische"],
    ["anzahl stellwände", "Stellwände"],
    ["anzahl flipcharts", "Flipcharts"],
  ] as const) {
    const value = text(label);
    if (value && value !== "0") infrastructure.push(`${name}: ${value}`);
  }
  const lectern = text("rednerpult");
  if (lectern && !/^nein$/iu.test(lectern)) {
    infrastructure.push(`Rednerpult: ${lectern}`);
  }

  const ict = Object.fromEntries(
    (Object.entries(ICT_LABELS) as [IctField, string][]).map(
      ([field, label]) => [field, text(label) ?? ""],
    ),
  ) as Record<IctField, string>;

  return {
    orderId,
    title,
    eventType: text("anlasstyp"),
    costCenterEmail: text("kostenstellen verantwortliche person mail"),
    costCenter: text("kostenstelle intern"),
    date: `${date[3]}-${date[2]!.padStart(2, "0")}-${date[1]!.padStart(2, "0")}`,
    startTime,
    endTime: time(values.get("zeit ende anlass") ?? []),
    persons: text("anzahl personen"),
    location,
    roomRent: /^ja$/iu.test(text("raummiete") ?? ""),
    infrastructure,
    ict,
    service,
    articles,
    totalCost,
    remarks: remarks.join("\n").trim() || null,
  };
}

/** Leerer Wert heisst «nicht bestellt»; jeder andere Wert ausser «Nein» «Ja». */
function yesNo(value: string): "Ja" | "Nein" {
  const normalized = value.trim().toLocaleLowerCase("de-CH");
  return !normalized || normalized === "nein" || normalized === "n"
    ? "Nein"
    : "Ja";
}

export const EVENT_ORDER_NUMBER_PREFIX = "Anlass-";

/**
 * Übersetzt die Bestellung in Betreff und Feldtext der bestehenden Übernahme
 * («Neuer Auftrag Einrichten <Nr> für <Titel>», Zeilen «Label: Wert»).
 */
export function eventOrderIntakeInput(
  order: EventOrderPdf,
  organiser: string,
): { subject: string; description: string; notes: string } {
  const subject = `Neuer Auftrag Einrichten ${EVENT_ORDER_NUMBER_PREFIX}${order.orderId} für ${order.title}`;
  const description = [
    `Erstellende Person: ${organiser}`,
    `Anlassname: ${order.title}`,
    `Anlassdatum: ${order.date}`,
    `Beginn: ${order.startTime}`,
    `Ort: ${order.location}`,
    `Raumreservation: ${order.roomRent ? "Ja" : "Nein"}`,
    `ICT Material: ${
      [
        order.ict.ictMaterial,
        order.ict.projector,
        order.ict.screen,
        order.ict.microphone,
        order.ict.receptionLaptop,
        order.ict.presenter,
      ].some((value) => yesNo(value) === "Ja")
        ? "Ja"
        : "Nein"
    }`,
    `Zugang Internet: ${yesNo(order.ict.internetAccess)}`,
    `Zugang SOBE Netzwerk: Nein`,
    `Beamer: ${yesNo(order.ict.projector)}`,
    `Leinwand: ${yesNo(order.ict.screen)}`,
    `Mikrofon: ${yesNo(order.ict.microphone)}`,
    `Empfangslaptop: ${yesNo(order.ict.receptionLaptop)}`,
  ].join("\n");

  const ictDetails = (
    [
      ["ICT Material", order.ict.ictMaterial],
      ["Beamer", order.ict.projector],
      ["Leinwand", order.ict.screen],
      ["Mikrofon", order.ict.microphone],
      ["Empfangslaptop", order.ict.receptionLaptop],
      ["Presenter", order.ict.presenter],
      ["Zugang Internet", order.ict.internetAccess],
    ] as const
  )
    .filter(([, value]) => value.trim() && !/^(ja|nein)$/iu.test(value.trim()))
    .map(([label, value]) => `${label}: ${value}`);
  if (order.ict.presenter && /^ja$/iu.test(order.ict.presenter.trim())) {
    ictDetails.push("Presenter: Ja");
  }

  const notes = [
    `${order.articles.length ? "Bestellung (PDF)" : "Bestellung"} aus der Anlässe-App (ID ${order.orderId})${
      order.eventType ? `, ${order.eventType}` : ""
    }`,
    `Anlass: ${order.startTime}${order.endTime ? `–${order.endTime}` : ""} Uhr${
      order.persons ? `, ${order.persons} Personen` : ""
    }`,
    order.infrastructure.length
      ? `Infrastruktur: ${order.infrastructure.join(", ")}`
      : "",
    ictDetails.length ? `ICT: ${ictDetails.join(", ")}` : "",
    order.service.length ? `Service: ${order.service.join(", ")}` : "",
    order.articles.length
      ? `Gastro: ${order.articles.join(", ")}${
          order.totalCost ? ` (Total ${order.totalCost})` : ""
        }`
      : "",
    order.remarks ? `Bemerkung: ${order.remarks}` : "",
    order.costCenter || order.costCenterEmail
      ? `Kostenstelle: ${[order.costCenter, order.costCenterEmail]
          .filter(Boolean)
          .join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4_000);
  return { subject, description, notes };
}

const TEXT_ORDER_SUBJECT =
  /^(?:(?:WG|FW|FWD|AW|RE|TR)\s*:\s*)*Neue Bestellung Einrichten Anl(?:ä|ae)sse\s+(\d{1,10})\s*$/iu;
const PDF_ORDER_SUBJECT =
  /^(?:(?:WG|FW|FWD|AW|RE|TR)\s*:\s*)*Bestellung Anl(?:ä|ae)sse Essen und Einrichten f(?:ü|ue)r Anlass\s+(.{3,240}?)\s*$/iu;

/** Titel aus «Bestellung Anlässe Essen und Einrichten für Anlass <Titel>». */
export function eventOrderSubjectTitle(subject: string): string | null {
  return PDF_ORDER_SUBJECT.exec(normalize(subject))?.[1] ?? null;
}

/**
 * Mail «Neue Bestellung Einrichten Anlässe <ID>» ans ICT-Team: dieselben
 * Angaben wie im PDF, als Zeilen «Label: Wert» im Mailtext.
 */
export function parseEventOrderText(
  subject: string,
  body: string,
): EventOrder | null {
  const orderId = TEXT_ORDER_SUBJECT.exec(normalize(subject))?.[1];
  if (!orderId) return null;
  const fields = new Map<string, string>();
  const remarks: string[] = [];
  let inRemarks = false;
  let organiser: string | null = null;
  for (const raw of body.replace(/\r\n?/gu, "\n").split("\n")) {
    const line = normalize(raw);
    if (!line) continue;
    const by =
      /neue Bestellung f(?:ü|ue)r Anl(?:ä|ae)sse.* von (.{2,120})$/iu.exec(
        line,
      );
    if (by) {
      organiser = by[1]!.trim();
      continue;
    }
    const match = /^([^:]{2,60}):\s*(.*)$/u.exec(line);
    const label = match ? key(match[1]!) : null;
    if (label === "bemerkungen" || label === "bemerkung") {
      inRemarks = true;
      if (match![2]) remarks.push(match![2]);
      continue;
    }
    if (inRemarks) {
      remarks.push(line);
      continue;
    }
    if (match && label) {
      // «Zeit Beginn: 13:00/ Zeit Ende: 17:00» steht in einer Zeile.
      const times = /^zeit beginn$/u.test(label)
        ? /^(\d{1,2}:\d{2})\s*\/?\s*(?:Zeit Ende:\s*(\d{1,2}:\d{2}))?/iu.exec(
            match[2] ?? "",
          )
        : null;
      if (times) {
        fields.set("zeit beginn", times[1]!);
        if (times[2]) fields.set("zeit ende", times[2]);
        continue;
      }
      fields.set(label, (match[2] ?? "").trim());
    }
  }
  const value = (label: string): string | null =>
    fields.get(label)?.trim() || null;
  const title = value("anlassname");
  const date = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/u.exec(
    value("anlassdatum") ?? "",
  );
  const startTime = time([value("zeit beginn") ?? ""]);
  const location =
    value("ort räumlichkeiten") ?? value("ort / örtlichkeit") ?? value("ort");
  if (!title || !date || !startTime || !location) return null;

  const infrastructure: string[] = [];
  const seating = value("bestuhlung");
  if (seating && !/^keine$/iu.test(seating))
    infrastructure.push(`Bestuhlung: ${seating}`);
  for (const [label, name] of [
    ["anzahl stühle", "Stühle"],
    ["anzahl tische", "Tische"],
    ["anzahl stehtische", "Stehtische"],
    ["anzahl stellwände", "Stellwände"],
    ["anzahl flipcharts", "Flipcharts"],
  ] as const) {
    const count = value(label);
    if (count && count !== "0") infrastructure.push(`${name}: ${count}`);
  }
  const lectern = value("redner*innenpult") ?? value("rednerpult");
  if (lectern && !/^nein$/iu.test(lectern))
    infrastructure.push(`Rednerpult: ${lectern}`);

  return {
    orderId,
    title,
    eventType: null,
    costCenterEmail: organiser,
    costCenter: null,
    date: `${date[3]}-${date[2]!.padStart(2, "0")}-${date[1]!.padStart(2, "0")}`,
    startTime,
    endTime: time([value("zeit ende") ?? ""]),
    persons: value("anzahl personen"),
    location,
    roomRent: false,
    infrastructure,
    ict: {
      ictMaterial: value("ict material") ?? "",
      projector: value("beamer") ?? "",
      screen: value("leinwand") ?? "",
      microphone: value("mikrofon") ?? "",
      receptionLaptop: value("empfangslaptop") ?? "",
      presenter: value("presenter") ?? "",
      internetAccess: value("zugang internet") ?? "",
    },
    service: [],
    articles: [],
    totalCost: null,
    remarks: remarks.join("\n").trim() || null,
  };
}
