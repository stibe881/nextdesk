import { supabase } from "./supabase";

export type HandbookId =
  | "mitarbeitende"
  | "agenten"
  | "administratoren"
  | "installation";

export type HandbookSummary = {
  id: HandbookId;
  title: string;
  description: string;
  audienceLabel: string;
  updatedAt: string;
};

export type Handbook = HandbookSummary & { markdown: string };

const HANDBOOK_IDS: readonly string[] = [
  "mitarbeitende",
  "agenten",
  "administratoren",
  "installation",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSummary(value: unknown): HandbookSummary | null {
  if (!isRecord(value)) return null;
  const { id, title, description, audienceLabel, updatedAt } = value;
  if (
    typeof id !== "string" ||
    !HANDBOOK_IDS.includes(id) ||
    typeof title !== "string" ||
    typeof description !== "string" ||
    typeof audienceLabel !== "string" ||
    typeof updatedAt !== "string"
  ) {
    return null;
  }
  return {
    id: id as HandbookId,
    title,
    description,
    audienceLabel,
    updatedAt,
  };
}

export function handbookListFromResponse(
  value: unknown,
): HandbookSummary[] | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const list = value.data.handbooks;
  if (!Array.isArray(list)) return null;
  const parsed = list.map(parseSummary);
  return parsed.every((entry): entry is HandbookSummary => entry !== null)
    ? parsed
    : null;
}

export function handbookFromResponse(value: unknown): Handbook | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const handbook = value.data.handbook;
  const summary = parseSummary(handbook);
  if (!summary || !isRecord(handbook)) return null;
  if (typeof handbook.markdown !== "string") return null;
  return { ...summary, markdown: handbook.markdown };
}

/**
 * Only embedded screenshots (data:image/…) delivered by the handbook
 * Function and ordinary web links are allowed in handbook Markdown.
 */
export function handbookUrlTransform(url: string, key: string): string {
  if (key === "src" && /^data:image\/(png|jpeg|webp);base64,/.test(url)) {
    return url;
  }
  if (/^(https?:|mailto:|#)/i.test(url)) return url;
  return "";
}

export function handbookDateLabel(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Zurich",
  }).format(date);
}

export async function listHandbooks(
  tenantId: string,
): Promise<HandbookSummary[]> {
  if (!supabase) throw new Error("supabase_not_configured");
  const { data, error } = await supabase.functions.invoke("handbooks", {
    body: { type: "list", tenantId },
  });
  if (error) throw error;
  const list = handbookListFromResponse(data);
  if (!list) throw new Error("invalid_handbook_response");
  return list;
}

export async function loadHandbook(
  tenantId: string,
  handbookId: HandbookId,
): Promise<Handbook> {
  if (!supabase) throw new Error("supabase_not_configured");
  const { data, error } = await supabase.functions.invoke("handbooks", {
    body: { type: "get", tenantId, handbookId },
  });
  if (error) throw error;
  const handbook = handbookFromResponse(data);
  if (!handbook) throw new Error("invalid_handbook_response");
  return handbook;
}
