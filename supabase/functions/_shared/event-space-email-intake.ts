import type { EventSpaceEquipment } from "./event-space-schedule.ts";

/**
 * Deterministic intake parser for the room-setup form sent by e-mail.
 *
 * The parser deliberately has no I/O: it does not fetch a SharePoint URL, log
 * its input, call an LLM, or retain the original description. Its output holds
 * only the data needed by a subsequent room-request workflow. When a form is
 * incomplete or ambiguous, no partial request (and consequently no captured
 * contact data) is returned.
 */

export const EVENT_SPACE_EMAIL_INTAKE_TIME_ZONE = "Europe/Zurich";
export const EVENT_SPACE_EMAIL_INTAKE_DURATION_MINUTES = 30;

/**
 * Subset of the existing event-space equipment allow-list which has an
 * unambiguous counterpart in the e-mail form. Internet/SOBE access and a
 * reception laptop remain operational requirements; they are not silently
 * mapped to an unrelated shared-equipment resource.
 */
export const EVENT_SPACE_EMAIL_INTAKE_EQUIPMENT_KEYS = [
  "connections",
  "projector",
  "screen",
  "microphones",
  "reception_laptop",
] as const satisfies readonly EventSpaceEquipment[];

const SUBJECT_PATTERN =
  /^Neuer Auftrag Einrichten\s+([^\r\n]+?)\s+für\s+([^\r\n]+)$/u;
const LEGACY_BRACKETED_SUBJECT_PART_PATTERN = /^\[([^\[\]\r\n]+)\]$/u;
const MAX_DESCRIPTION_LENGTH = 32_000;

const FIELD_BY_LABEL = new Map<string, FieldName>([
  ["erstellende person", "organiser"],
  ["erstellt von", "organiser"],
  ["anlassname", "eventName"],
  ["anlassdatum", "eventDate"],
  ["anlassdatum (jahr monat tag)", "eventDate"],
  ["beginn", "startTime"],
  ["beginn anlass zeit", "startTime"],
  ["ort", "location"],
  ["raumreservation", "roomReservation"],
  ["telefonnummer", "contactPhone"],
  ["ict material", "ictMaterial"],
  ["zugang internet", "internetAccess"],
  ["zugang sobe netzwerk", "sobeNetworkAccess"],
  ["beamer", "projector"],
  ["leinwand", "screen"],
  ["mikrofon", "microphone"],
  ["empfangslaptop", "receptionLaptop"],
  ["bemerkung", "notes"],
  ["link zum auftrag", "orderUrl"],
]);

type FieldName =
  | "organiser"
  | "eventName"
  | "eventDate"
  | "startTime"
  | "location"
  | "roomReservation"
  | "contactPhone"
  | "ictMaterial"
  | "internetAccess"
  | "sobeNetworkAccess"
  | "projector"
  | "screen"
  | "microphone"
  | "receptionLaptop"
  | "notes"
  | "orderUrl";

type RequiredBooleanField =
  | "roomReservation"
  | "ictMaterial"
  | "internetAccess"
  | "sobeNetworkAccess"
  | "projector"
  | "screen"
  | "microphone"
  | "receptionLaptop";

type CivilDate = {
  year: number;
  month: number;
  day: number;
};

type ClockTime = {
  hour: number;
  minute: number;
};

type CivilDateTime = CivilDate & ClockTime;

export type EventSpaceEmailIntakeInput = Readonly<{
  /** Exact e-mail subject with fixed German wording and two variable values. */
  subject: unknown;
  /** Structured form description. Fields use `Label: value` on separate lines. */
  description: unknown;
}>;

export type EventSpaceEmailIntakeSubject = Readonly<{
  sourceOrderNumber: string;
  title: string;
}>;

export type EventSpaceEmailIntakeRequirements = Readonly<{
  roomReservation: boolean;
  ictMaterial: boolean;
  internetAccess: boolean;
  sobeNetworkAccess: boolean;
  projector: boolean;
  screen: boolean;
  microphone: boolean;
  receptionLaptop: boolean;
}>;

/**
 * Minimal, validated data which can be handed to a later workflow. The raw
 * description and unknown fields are intentionally not included.
 */
export type EventSpaceEmailIntake = Readonly<{
  sourceOrderNumber: string;
  title: string;
  organiser: string;
  startAt: string;
  endAt: string;
  requestedSpaceText: string;
  contactPhone?: string;
  notes?: string;
  orderUrl?: string;
  durationMinutes: typeof EVENT_SPACE_EMAIL_INTAKE_DURATION_MINUTES;
  equipmentKeys: EventSpaceEquipment[];
  requirements: EventSpaceEmailIntakeRequirements;
}>;

/**
 * Reason codes and messages intentionally never copy submitted values. This
 * makes them safe for operator-facing clarification prompts without exposing
 * a person's name, phone number, room, title, or URL.
 */
export type EventSpaceEmailIntakeClarificationCode =
  | "subject_not_supported"
  | "invalid_description"
  | "unknown_field"
  | "duplicate_field"
  | "missing_required_field"
  | "missing_start_time"
  | "invalid_date"
  | "invalid_start_time"
  | "invalid_yes_no"
  | "invalid_https_url"
  | "conflicting_event_name"
  | "nonexistent_local_time"
  | "ambiguous_local_time";

export type EventSpaceEmailIntakeClarification = Readonly<{
  code: EventSpaceEmailIntakeClarificationCode;
  message: string;
}>;

export type EventSpaceEmailIntakeResult =
  | Readonly<{
      status: "ready";
      request: EventSpaceEmailIntake;
      clarifications: readonly [];
    }>
  | Readonly<{
      status: "needs_clarification";
      clarifications: readonly EventSpaceEmailIntakeClarification[];
    }>;

const CLARIFICATION_MESSAGES: Record<
  EventSpaceEmailIntakeClarificationCode,
  string
> = {
  subject_not_supported:
    "Der Betreff entspricht nicht dem erwarteten Auftragsformat.",
  invalid_description:
    "Die strukturierte Ticketbeschreibung ist nicht verarbeitbar.",
  unknown_field:
    "Die Beschreibung enthält ein nicht unterstütztes oder unstrukturiertes Feld.",
  duplicate_field:
    "Mindestens ein Feld ist mehrfach angegeben und muss eindeutig sein.",
  missing_required_field: "Mindestens eine erforderliche Angabe fehlt.",
  missing_start_time: "Die Beginnzeit fehlt.",
  invalid_date: "Das Anlassdatum ist kein gültiges Datum im Format YYYY-MM-DD.",
  invalid_start_time: "Die Beginnzeit ist ungültig.",
  invalid_yes_no: "Mindestens eine Ja/Nein-Angabe ist nicht eindeutig.",
  invalid_https_url: "Der Link zum Auftrag ist keine gültige HTTPS-URL.",
  conflicting_event_name:
    "Der Anlassname im Betreff und in der Beschreibung stimmt nicht überein.",
  nonexistent_local_time:
    "Die Beginnzeit existiert in Europe/Zurich wegen der Sommerzeitumstellung nicht.",
  ambiguous_local_time:
    "Die Beginnzeit ist in Europe/Zurich wegen der Sommerzeitumstellung mehrdeutig.",
};

const zurichDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: EVENT_SPACE_EMAIL_INTAKE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function normaliseLabel(value: string): string {
  return value
    .replace(/[\s_-]+/gu, " ")
    .trim()
    .toLocaleLowerCase("de-CH");
}

function normaliseText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function isBoundedText(
  value: string,
  minimum: number,
  maximum: number,
): boolean {
  return (
    value.length >= minimum &&
    value.length <= maximum &&
    !value.includes("\u0000") &&
    value.isWellFormed()
  );
}

function clarification(
  codes: Set<EventSpaceEmailIntakeClarificationCode>,
): readonly EventSpaceEmailIntakeClarification[] {
  return [...codes].map((code) => ({
    code,
    message: CLARIFICATION_MESSAGES[code],
  }));
}

function boundedFieldText(
  value: string | undefined,
  codes: Set<EventSpaceEmailIntakeClarificationCode>,
  minimum: number,
  maximum: number,
): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (!isBoundedText(value, minimum, maximum)) {
    codes.add("invalid_description");
    return undefined;
  }
  return value;
}

function isKnownLabelLine(value: string): FieldName | undefined {
  return FIELD_BY_LABEL.get(normaliseLabel(value));
}

function collectFields(
  description: unknown,
  codes: Set<EventSpaceEmailIntakeClarificationCode>,
): Map<FieldName, string[]> {
  const fields = new Map<FieldName, string[]>();
  if (
    typeof description !== "string" ||
    description.length > MAX_DESCRIPTION_LENGTH ||
    !description.isWellFormed() ||
    description.includes("\u0000")
  ) {
    codes.add("invalid_description");
    return fields;
  }

  const lines = description.replace(/\r\n?/gu, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;

    const labelled = /^([^:]{1,120}):\s*(.*)$/u.exec(line);
    let field: FieldName | undefined;
    let value: string | undefined;
    if (labelled) {
      field = isKnownLabelLine(labelled[1]);
      value = normaliseText(labelled[2]);
    } else {
      field = isKnownLabelLine(line);
      if (field) {
        const nextLine = lines[index + 1]?.trim();
        if (nextLine && !/^([^:]{1,120}):\s*(.*)$/u.test(nextLine)) {
          value = normaliseText(nextLine);
          index += 1;
        } else {
          value = "";
        }
      }
    }

    if (!field || value === undefined) {
      codes.add("unknown_field");
      continue;
    }
    const values = fields.get(field) ?? [];
    values.push(value);
    fields.set(field, values);
  }

  for (const values of fields.values()) {
    if (values.length > 1) codes.add("duplicate_field");
  }
  return fields;
}

function fieldValue(
  fields: ReadonlyMap<FieldName, string[]>,
  field: FieldName,
): string | undefined {
  return fields.get(field)?.[0];
}

function parseDate(value: string): CivilDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  probe.setUTCHours(0, 0, 0, 0);
  return probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
    ? { year, month, day }
    : null;
}

function parseStartTime(value: string): ClockTime | null {
  const match = /^(\d{1,2})\s*:\s*(\d{2})\s*(?:uhr)?$/iu.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? { hour, minute }
    : null;
}

function parseYesNo(value: string): boolean | null {
  const normalised = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[.]/gu, "")
    .trim()
    .toLocaleLowerCase("de-CH");
  if (["ja", "j", "yes", "y", "true", "1"].includes(normalised)) {
    return true;
  }
  if (["nein", "n", "no", "false", "0"].includes(normalised)) {
    return false;
  }
  return null;
}

function parseHttpsUrl(value: string): string | null {
  const unwrapped = /^<(.+)>$/u.exec(value)?.[1] ?? value;
  try {
    const url = new URL(unwrapped);
    return url.protocol === "https:" &&
      url.hostname.length > 0 &&
      !url.username &&
      !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function utcMilliseconds(parts: CivilDateTime): number {
  // Date.UTC treats years 0–99 as 1900–1999. setUTCFullYear does not.
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, 0, 0);
  return date.getTime();
}

function localParts(instantMs: number): CivilDateTime {
  const byName = new Map(
    zurichDateTimeFormatter
      .formatToParts(new Date(instantMs))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: byName.get("year") ?? 0,
    month: byName.get("month") ?? 0,
    day: byName.get("day") ?? 0,
    hour: byName.get("hour") ?? 0,
    minute: byName.get("minute") ?? 0,
  };
}

function sameCivilDateTime(
  first: CivilDateTime,
  second: CivilDateTime,
): boolean {
  return (
    first.year === second.year &&
    first.month === second.month &&
    first.day === second.day &&
    first.hour === second.hour &&
    first.minute === second.minute
  );
}

function offsetAt(instantMs: number): number {
  return utcMilliseconds(localParts(instantMs)) - instantMs;
}

/**
 * Resolves a civil Europe/Zurich time without guessing around DST. We sample
 * offsets before and after the requested local date, then retain only instants
 * that format back to precisely the supplied civil time. Thus a spring-forward
 * gap yields zero candidates and a fall-back overlap yields two candidates.
 */
function resolveZurichLocalTime(value: CivilDateTime): number[] {
  const civilMs = utcMilliseconds(value);
  const offsets = new Set<number>();
  for (const hours of [-48, -24, -12, 0, 12, 24, 48]) {
    offsets.add(offsetAt(civilMs + hours * 60 * 60 * 1_000));
  }
  const candidates = new Set<number>();
  for (const offset of offsets) {
    const candidate = civilMs - offset;
    if (sameCivilDateTime(localParts(candidate), value)) {
      candidates.add(candidate);
    }
  }
  return [...candidates].sort((first, second) => first - second);
}

function requestEquipmentKeys(
  requirements: EventSpaceEmailIntakeRequirements,
): EventSpaceEquipment[] {
  const keys: EventSpaceEquipment[] = [];
  if (requirements.ictMaterial) keys.push("connections");
  if (requirements.projector) keys.push("projector");
  if (requirements.screen) keys.push("screen");
  if (requirements.microphone) keys.push("microphones");
  if (requirements.receptionLaptop) keys.push("reception_laptop");
  return keys;
}

function hasCompleteBooleanValues(
  value: Record<RequiredBooleanField, boolean | null>,
): value is Record<RequiredBooleanField, boolean> {
  return Object.values(value).every((item) => typeof item === "boolean");
}

/**
 * Parses the fixed room-setup e-mail form.
 *
 * Accepted body syntax is one field per line in the form `Label: value`; the
 * same label followed by a non-label line is accepted for text-only exports.
 * The supported labels are the German labels in FIELD_BY_LABEL. `Anlassname`
 * may be repeated in the body only as a consistency check; the subject is the
 * authoritative source for `title`.
 */
export function eventSpaceEmailIntakeSubject(
  subject: unknown,
): EventSpaceEmailIntakeSubject | null {
  if (typeof subject !== "string") return null;
  const subjectMatch = SUBJECT_PATTERN.exec(subject);
  const rawOrderNumber = subjectMatch ? normaliseText(subjectMatch[1]) : "";
  const rawTitle = subjectMatch ? normaliseText(subjectMatch[2]) : "";
  const legacyOrderNumber = LEGACY_BRACKETED_SUBJECT_PART_PATTERN.exec(
    rawOrderNumber,
  )?.[1];
  const legacyTitle = LEGACY_BRACKETED_SUBJECT_PART_PATTERN.exec(rawTitle)?.[1];
  if (Boolean(legacyOrderNumber) !== Boolean(legacyTitle)) return null;
  if (
    !legacyOrderNumber &&
    (/[\[\]]/u.test(rawOrderNumber) || /[\[\]]/u.test(rawTitle))
  ) {
    return null;
  }
  const sourceOrderNumber = normaliseText(legacyOrderNumber ?? rawOrderNumber);
  const title = normaliseText(legacyTitle ?? rawTitle);
  return sourceOrderNumber &&
    title &&
    isBoundedText(sourceOrderNumber, 1, 80) &&
    isBoundedText(title, 3, 240)
    ? { sourceOrderNumber, title }
    : null;
}

export function parseEventSpaceEmailIntake(
  input: EventSpaceEmailIntakeInput,
): EventSpaceEmailIntakeResult {
  const codes = new Set<EventSpaceEmailIntakeClarificationCode>();
  const subject = eventSpaceEmailIntakeSubject(input?.subject);
  const sourceOrderNumber = subject?.sourceOrderNumber;
  const title = subject?.title;
  if (!subject) {
    codes.add("subject_not_supported");
  }

  const fields = collectFields(input?.description, codes);
  const organiser = boundedFieldText(
    fieldValue(fields, "organiser"),
    codes,
    2,
    160,
  );
  const requestedSpaceText = boundedFieldText(
    fieldValue(fields, "location"),
    codes,
    2,
    160,
  );
  if (!organiser || !requestedSpaceText) codes.add("missing_required_field");

  const bodyEventName = boundedFieldText(
    fieldValue(fields, "eventName"),
    codes,
    3,
    240,
  );
  if (bodyEventName && title && bodyEventName !== title) {
    codes.add("conflicting_event_name");
  }

  const dateValue = fieldValue(fields, "eventDate");
  const eventDate = dateValue ? parseDate(dateValue) : null;
  if (!dateValue) {
    codes.add("missing_required_field");
  } else if (!eventDate) {
    codes.add("invalid_date");
  }

  const startTimeValue = fieldValue(fields, "startTime");
  const startTime = startTimeValue ? parseStartTime(startTimeValue) : null;
  if (!startTimeValue) {
    codes.add("missing_start_time");
  } else if (!startTime) {
    codes.add("invalid_start_time");
  }

  const booleanValues = {} as Record<RequiredBooleanField, boolean | null>;
  const booleanFields: readonly RequiredBooleanField[] = [
    "roomReservation",
    "ictMaterial",
    "internetAccess",
    "sobeNetworkAccess",
    "projector",
    "screen",
    "microphone",
    "receptionLaptop",
  ];
  for (const field of booleanFields) {
    const value = fieldValue(fields, field);
    if (!value) {
      codes.add("missing_required_field");
      booleanValues[field] = null;
      continue;
    }
    booleanValues[field] = parseYesNo(value);
    if (booleanValues[field] === null) codes.add("invalid_yes_no");
  }

  const contactPhone = boundedFieldText(
    fieldValue(fields, "contactPhone"),
    codes,
    3,
    80,
  );
  const notes = boundedFieldText(fieldValue(fields, "notes"), codes, 1, 4_000);
  const orderUrlValue = fieldValue(fields, "orderUrl");
  const orderUrl = orderUrlValue ? parseHttpsUrl(orderUrlValue) : undefined;
  if (orderUrlValue && !orderUrl) codes.add("invalid_https_url");

  let startAt: string | undefined;
  let endAt: string | undefined;
  if (eventDate && startTime) {
    const candidates = resolveZurichLocalTime({ ...eventDate, ...startTime });
    if (candidates.length === 0) {
      codes.add("nonexistent_local_time");
    } else if (candidates.length > 1) {
      codes.add("ambiguous_local_time");
    } else {
      startAt = new Date(candidates[0]).toISOString();
      endAt = new Date(
        candidates[0] + EVENT_SPACE_EMAIL_INTAKE_DURATION_MINUTES * 60 * 1_000,
      ).toISOString();
    }
  }

  if (
    codes.size > 0 ||
    !sourceOrderNumber ||
    !title ||
    !organiser ||
    !requestedSpaceText ||
    !startAt ||
    !endAt ||
    !hasCompleteBooleanValues(booleanValues)
  ) {
    return {
      status: "needs_clarification",
      clarifications: clarification(codes),
    };
  }

  const requirements: EventSpaceEmailIntakeRequirements = {
    roomReservation: booleanValues.roomReservation,
    ictMaterial: booleanValues.ictMaterial,
    internetAccess: booleanValues.internetAccess,
    sobeNetworkAccess: booleanValues.sobeNetworkAccess,
    projector: booleanValues.projector,
    screen: booleanValues.screen,
    microphone: booleanValues.microphone,
    receptionLaptop: booleanValues.receptionLaptop,
  };
  const request: EventSpaceEmailIntake = {
    sourceOrderNumber,
    title,
    organiser,
    startAt,
    endAt,
    requestedSpaceText,
    ...(contactPhone ? { contactPhone } : {}),
    ...(notes ? { notes } : {}),
    ...(orderUrl ? { orderUrl } : {}),
    durationMinutes: EVENT_SPACE_EMAIL_INTAKE_DURATION_MINUTES,
    equipmentKeys: requestEquipmentKeys(requirements),
    requirements,
  };
  return { status: "ready", request, clarifications: [] };
}
