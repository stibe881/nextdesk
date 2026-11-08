import { supabase } from "./supabase";

/** Client for the `license-reclaim` Edge Function (Lizenzplätze, Rückgewinnung). */

export type ReclaimReason =
  "membership_inactive" | "entra_disabled" | "offboarded" | "inactive";

export type ReclaimCandidate = {
  assignmentId: string;
  licenseId: string;
  licenseTitle: string;
  userId: string | null;
  assigneeLabel: string;
  assignedAt: string;
  reasons: ReclaimReason[];
  lastSignInAt: string | null;
  signInSource: "entra" | "nextdesk" | null;
  monthlySaving: number | null;
  currency: string;
  m365Removable: boolean;
};

export type ReclaimSettings = {
  inactivityDays: number;
  useEntraSignIn: boolean;
  allowM365Removal: boolean;
  signInsRefreshedAt: string | null;
  signInsError: string | null;
};

export type ReclaimOverview = {
  settings: ReclaimSettings;
  candidates: ReclaimCandidate[];
  monthlySavings: Record<string, number>;
};

export type LicenseSeat = {
  id: string;
  userId: string | null;
  entraObjectId: string | null;
  assigneeLabel: string;
  note: string | null;
  assignedAt: string;
  releasedAt: string | null;
  releaseReason: string | null;
  m365RemovedAt: string | null;
};

export type SeatPerson = {
  userId: string | null;
  entraObjectId: string | null;
  label: string;
  email: string | null;
};

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("nextDesk ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("license-reclaim", {
    body,
  });
  if (error) {
    const context =
      typeof error === "object" && error !== null && "context" in error
        ? (error as { context?: unknown }).context
        : undefined;
    if (context instanceof Response) {
      const payload = (await context
        .clone()
        .json()
        .catch(() => null)) as { error?: { message?: unknown } } | null;
      if (typeof payload?.error?.message === "string") {
        throw new Error(payload.error.message);
      }
    }
    throw new Error("Die Lizenz-Rückgewinnung ist derzeit nicht verfügbar.");
  }
  return (data as { data: T }).data;
}

export const licenseReclaimApi = {
  overview: (tenantId: string) =>
    call<ReclaimOverview>({ type: "overview", tenantId }),
  seats: (tenantId: string, licenseId: string) =>
    call<{
      quantity: number | null;
      m365SkuId: string | null;
      assignments: LicenseSeat[];
    }>({ type: "listAssignments", tenantId, licenseId }),
  people: (tenantId: string) =>
    call<{ people: SeatPerson[] }>({ type: "listPeople", tenantId }).then(
      (data) => data.people,
    ),
  assign: (
    tenantId: string,
    licenseId: string,
    person: { userId: string | null; entraObjectId: string | null },
    note: string | null,
  ) =>
    call<{ id: string }>({
      type: "assign",
      tenantId,
      licenseId,
      userId: person.userId,
      entraObjectId: person.entraObjectId,
      note,
    }),
  release: (
    tenantId: string,
    assignmentId: string,
    removeM365: boolean,
    reason: string | null,
  ) =>
    call<{ released: true; m365Removed: boolean }>({
      type: "release",
      tenantId,
      assignmentId,
      removeM365,
      reason,
    }),
  saveSettings: (
    tenantId: string,
    settings: Pick<
      ReclaimSettings,
      "inactivityDays" | "useEntraSignIn" | "allowM365Removal"
    >,
  ) =>
    call<{ settings: ReclaimSettings }>({
      type: "saveSettings",
      tenantId,
      ...settings,
    }).then((data) => data.settings),
  refreshSignIns: (tenantId: string) =>
    call<{ updated: number; error: string | null }>({
      type: "refreshSignIns",
      tenantId,
    }),
};

export const RECLAIM_REASON_LABEL: Record<ReclaimReason, string> = {
  membership_inactive: "Kein aktives Mitglied mehr",
  entra_disabled: "Entra-Konto deaktiviert",
  offboarded: "Austritt abgeschlossen",
  inactive: "Keine Anmeldung",
};

/** «Keine Anmeldung seit 92 Tagen» bzw. «Nie angemeldet». */
export function reasonText(
  candidate: Pick<
    ReclaimCandidate,
    "reasons" | "lastSignInAt" | "signInSource"
  >,
  now: Date = new Date(),
): string[] {
  return candidate.reasons.map((reason) => {
    if (reason !== "inactive") return RECLAIM_REASON_LABEL[reason] ?? reason;
    const source = candidate.signInSource === "entra" ? "Entra" : "nextDesk";
    if (!candidate.lastSignInAt) return `Nie angemeldet (${source})`;
    const days = Math.floor(
      (now.getTime() - new Date(candidate.lastSignInAt).getTime()) / 86_400_000,
    );
    return `Keine Anmeldung seit ${days} Tagen (${source})`;
  });
}

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("de-CH", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

/** «CHF 120.00 / Monat» für alle Währungen der Kandidaten. */
export function savingsLabel(totals: Record<string, number>): string {
  const entries = Object.entries(totals).filter(([, value]) => value > 0);
  if (entries.length === 0) return "Keine Kosten erfasst";
  return entries
    .map(([currency, value]) => `${formatMoney(value, currency)} / Monat`)
    .join(" · ");
}

export const COST_PERIOD_LABEL: Record<string, string> = {
  monthly: "pro Monat",
  quarterly: "pro Quartal",
  yearly: "pro Jahr",
  one_time: "einmalig",
};

/** Sucht Personen für die Platz-Zuweisung (Name oder E-Mail). */
export function filterSeatPeople(
  people: SeatPerson[],
  query: string,
  limit = 30,
): SeatPerson[] {
  const needle = query.trim().toLocaleLowerCase("de");
  return (
    needle
      ? people.filter((person) =>
          `${person.label} ${person.email ?? ""}`
            .toLocaleLowerCase("de")
            .includes(needle),
        )
      : people
  ).slice(0, limit);
}
