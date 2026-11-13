import { supabase } from "./supabase";

/** Push-Mitteilungen an iPhone und Android (Einstellungen → Funktionen → Push-Benachrichtigungen). */

export const TITLE_MAX = 60;
export const BODY_MAX = 200;

export type AudienceKind = "all" | "roles" | "departments";
export type Audience = { kind: AudienceKind; ids: string[] };

export type PushContext = {
  departments: { id: string; name: string }[];
  roles: { id: string; name: string }[];
  iosDevices: number;
  androidDevices: number;
  apnsConfigured: boolean;
};

export type PushReach = {
  people: number;
  peopleReachable: number;
  iosDevices: number;
  androidDevices: number;
};

export type PushBroadcast = {
  id: string;
  title: string;
  body: string;
  audienceKind: AudienceKind;
  audienceCount: number;
  status: "sending" | "sent" | "failed";
  people: number;
  iosDevices: number;
  androidDevices: number;
  delivered: number;
  failed: number;
  createdAt: string;
  createdBy: string | null;
};

const errors: Record<string, string> = {
  tenant_admin_required: "Nur Administratoren dürfen Push-Mitteilungen senden.",
  push_feature_disabled:
    "Push-Benachrichtigungen sind für diesen Arbeitsbereich ausgeschaltet.",
  audience_invalid: "Bitte eine Zielgruppe wählen.",
  title_invalid: `Bitte einen Titel mit 1 bis ${TITLE_MAX} Zeichen eingeben.`,
  body_invalid: `Bitte einen Text mit 1 bis ${BODY_MAX} Zeichen eingeben.`,
  too_fast: "Es wurde gerade eben eine Mitteilung gesendet. Bitte kurz warten.",
  no_devices:
    "Die Zielgruppe hat keine Geräte, die Push empfangen. Die Personen müssen Push in der App eingeschaltet haben.",
};

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("nextDesk ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("push-broadcast", {
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
        .catch(() => null)) as { error?: { code?: unknown } } | null;
      const code = payload?.error?.code;
      if (typeof code === "string") {
        throw new Error(
          errors[code] ?? `Die Aktion wurde abgelehnt (${code.slice(0, 60)}).`,
        );
      }
    }
    throw new Error("Push-Mitteilungen sind gerade nicht erreichbar.");
  }
  return (data as { data: T }).data;
}

export const pushBroadcastApi = {
  context: (tenantId: string) =>
    call<PushContext>({ type: "getContext", tenantId }),
  preview: (tenantId: string, audience: Audience) =>
    call<PushReach>({ type: "preview", tenantId, audience }),
  send: (
    tenantId: string,
    input: { title: string; body: string; audience: Audience },
  ) =>
    call<PushReach & { id: string; delivered: number; failed: number }>({
      type: "send",
      tenantId,
      ...input,
    }),
  list: (tenantId: string) =>
    call<{ broadcasts: PushBroadcast[] }>({ type: "list", tenantId }),
};

export function charCount(value: string): number {
  return [...value.replace(/\s+/g, " ").trim()].length;
}

/** Fehler im Entwurf als Text, leer wenn alles passt. */
export function broadcastIssue(draft: {
  title: string;
  body: string;
  audience: Audience;
}): string {
  const title = charCount(draft.title);
  if (title < 1 || title > TITLE_MAX) {
    return `Bitte einen Titel mit 1 bis ${TITLE_MAX} Zeichen eingeben.`;
  }
  const body = charCount(draft.body);
  if (body < 1 || body > BODY_MAX) {
    return `Bitte einen Text mit 1 bis ${BODY_MAX} Zeichen eingeben.`;
  }
  if (draft.audience.kind !== "all" && draft.audience.ids.length === 0) {
    return draft.audience.kind === "roles"
      ? "Bitte mindestens eine Rolle wählen."
      : "Bitte mindestens eine Abteilung wählen.";
  }
  return "";
}

export function audienceLabel(kind: AudienceKind, count: number): string {
  if (kind === "all") return "Alle";
  return kind === "roles"
    ? `${count} ${count === 1 ? "Rolle" : "Rollen"}`
    : `${count} ${count === 1 ? "Abteilung" : "Abteilungen"}`;
}
