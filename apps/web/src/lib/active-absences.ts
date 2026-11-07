import { supabase } from "./supabase";

export type ActiveAbsence = { delegateId: string; endsAt: string };

/** Active delegations of the tenant: who is away until when, and who stands in. */
export async function loadActiveAbsences(
  tenantId: string,
): Promise<Map<string, ActiveAbsence>> {
  const absences = new Map<string, ActiveAbsence>();
  if (!supabase) return absences;
  const { data, error } = await supabase.rpc("list_active_delegations", {
    p_tenant_id: tenantId,
  });
  if (error || !Array.isArray(data)) return absences;
  for (const row of data as {
    agent_id?: unknown;
    delegate_id?: unknown;
    ends_at?: unknown;
  }[]) {
    if (
      typeof row.agent_id === "string" &&
      typeof row.delegate_id === "string" &&
      typeof row.ends_at === "string"
    ) {
      absences.set(row.agent_id, {
        delegateId: row.delegate_id,
        endsAt: row.ends_at,
      });
    }
  }
  return absences;
}

/** "Anna (abwesend bis 14.11., vertreten durch Ben)" */
export function absenceLabel(
  name: string,
  absence: ActiveAbsence | undefined,
  nameOf: (id: string) => string | undefined,
): string {
  if (!absence) return name;
  const until = new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Zurich",
  }).format(new Date(absence.endsAt));
  const delegate = nameOf(absence.delegateId);
  return `${name} (abwesend bis ${until}${delegate ? `, vertreten durch ${delegate}` : ""})`;
}
