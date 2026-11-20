import { functionErrorMessage } from "./function-error";
import { supabase } from "./supabase";

/** Bestellung der Push-Mitteilungen «Störungen» einer Person. */
export type IncidentPushSettings = {
  enabled: boolean;
  /** `null`: alle externen Dienste. */
  serviceIds: string[] | null;
  services: { id: string; name: string }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseIncidentPushSettings(
  value: unknown,
): IncidentPushSettings | null {
  if (!isRecord(value) || typeof value.enabled !== "boolean") return null;
  if (!Array.isArray(value.services)) return null;
  const services = value.services.flatMap((entry) =>
    isRecord(entry) &&
    typeof entry.id === "string" &&
    typeof entry.name === "string"
      ? [{ id: entry.id, name: entry.name }]
      : [],
  );
  const serviceIds = Array.isArray(value.serviceIds)
    ? value.serviceIds.filter((id): id is string => typeof id === "string")
    : null;
  return { enabled: value.enabled, serviceIds, services };
}

/** Schaltet einen Dienst um; sind danach alle gewählt, gilt wieder «alle». */
export function toggleIncidentService(
  settings: IncidentPushSettings,
  serviceId: string,
): string[] | null {
  const all = settings.services.map((service) => service.id);
  const current = new Set(settings.serviceIds ?? all);
  if (current.has(serviceId)) current.delete(serviceId);
  else current.add(serviceId);
  const next = all.filter((id) => current.has(id));
  return next.length === all.length ? null : next;
}

async function request(body: Record<string, unknown>) {
  const fallback =
    "Die Einstellung für Störungen ist derzeit nicht verfügbar. Bitte später erneut versuchen.";
  if (!supabase) throw new Error(fallback);
  const { data, error } = await supabase.functions.invoke("requester-portal", {
    body,
  });
  if (error) throw new Error(await functionErrorMessage(error, fallback));
  const parsed = parseIncidentPushSettings(
    isRecord(data) ? data.data : undefined,
  );
  if (!parsed) throw new Error(fallback);
  return parsed;
}

export function getIncidentPushSettings(tenantId: string) {
  return request({ tenantId, type: "incidentPushSettings" });
}

export function saveIncidentPushSettings(
  tenantId: string,
  settings: Pick<IncidentPushSettings, "enabled" | "serviceIds">,
) {
  return request({
    tenantId,
    type: "saveIncidentPushSettings",
    enabled: settings.enabled,
    serviceIds: settings.serviceIds,
  });
}
