// Push-Mitteilungen an Mitglieder, die «Störungen» bestellt haben: iPhone
// direkt über Apple, Android über den Expo-Push-Dienst. Die Datenbank
// entscheidet, wer eine Meldung bekommt (service_incident_push_claim).

import { buildBroadcastPayload, sendApns } from "./apns.ts";
import { type ExpoMessage, sendExpoPush } from "./expo-push.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

export type IncidentPush = {
  noticeId: string;
  tenantId: string;
  title: string;
  userIds: string[];
  services: string[];
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Liest die Antwort von service_incident_push_claim; Ungültiges fällt weg. */
export function parseIncidentPushes(value: unknown): IncidentPush[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;
    if (
      typeof row.noticeId !== "string" || !UUID.test(row.noticeId) ||
      typeof row.tenantId !== "string" || !UUID.test(row.tenantId) ||
      typeof row.title !== "string" || !Array.isArray(row.userIds)
    ) {
      return [];
    }
    const userIds = row.userIds.filter((id): id is string =>
      typeof id === "string" && UUID.test(id)
    );
    if (userIds.length === 0) return [];
    return [{
      noticeId: row.noticeId,
      tenantId: row.tenantId,
      title: row.title,
      userIds,
      services: Array.isArray(row.services)
        ? row.services.filter((name): name is string =>
          typeof name === "string"
        )
        : [],
    }];
  });
}

function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** Titel und Text der Mitteilung (60 bzw. 200 Zeichen). */
export function incidentPushText(
  push: Pick<IncidentPush, "title" | "services">,
): { title: string; body: string } {
  const body = push.services.length === 0
    ? "Details stehen in nextDesk."
    : `${push.services.length === 1 ? "Betroffener Dienst" : "Betroffene Dienste"}: ${
      push.services.join(", ")
    }`;
  return {
    title: shorten(`Störung: ${push.title}`, 60),
    body: shorten(body, 200),
  };
}

/** Versendet die anstehenden Mitteilungen. Liefert Zähler für das Protokoll. */
export async function sendIncidentPushes(
  admin: Admin,
): Promise<{ incidentPushes: number; incidentPushDevices: number }> {
  const claimed = await admin.rpc("service_incident_push_claim", {
    p_limit: 20,
  });
  if (claimed.error) throw new Error("incident_push_claim_failed");
  const pushes = parseIncidentPushes(claimed.data);
  let devices = 0;
  for (const push of pushes) {
    const { title, body } = incidentPushText(push);
    const iosInvalid: string[] = [];
    const androidInvalid: string[] = [];
    for (let index = 0; index < push.userIds.length; index += 200) {
      const slice = push.userIds.slice(index, index + 200);
      const [iosRows, androidRows] = await Promise.all([
        admin
          .from("push_devices")
          .select("id, apns_token, apns_environment")
          .eq("tenant_id", push.tenantId)
          .eq("enabled", true)
          .in("user_id", slice),
        admin
          .from("push_android_devices")
          .select("id, expo_token")
          .eq("tenant_id", push.tenantId)
          .eq("enabled", true)
          .in("user_id", slice),
      ]);
      const ios = (iosRows.data ?? []) as {
        id: string;
        apns_token: string;
        apns_environment: "production" | "development";
      }[];
      const android = (androidRows.data ?? []) as {
        id: string;
        expo_token: string;
      }[];
      const payload = buildBroadcastPayload({
        title,
        body,
        tenantId: push.tenantId,
        broadcastId: push.noticeId,
      });
      for (let start = 0; start < ios.length; start += 20) {
        const batch = ios.slice(start, start + 20);
        const results = await Promise.all(
          batch.map((device) =>
            sendApns(
              device.apns_token,
              device.apns_environment,
              payload,
              push.noticeId,
            )
          ),
        );
        results.forEach((result, position) => {
          if (result.status === 200) {
            devices += 1;
          } else if (
            result.status === 410 ||
            (result.status === 400 &&
              ["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"]
                .includes(result.reason ?? ""))
          ) {
            iosInvalid.push(batch[position]!.id);
          }
        });
      }
      const messages: ExpoMessage[] = android.map((device) => ({
        to: device.expo_token,
        title,
        body,
        data: {
          kind: "broadcast",
          tenantId: push.tenantId,
          notificationId: push.noticeId,
        },
      }));
      const byToken = new Map(
        android.map((device) => [device.expo_token, device.id]),
      );
      for (const result of await sendExpoPush(messages)) {
        if (result.ok) {
          devices += 1;
        } else if (result.error === "DeviceNotRegistered") {
          const id = byToken.get(result.to);
          if (id) androidInvalid.push(id);
        }
      }
    }
    if (iosInvalid.length > 0) {
      await admin
        .from("push_devices")
        .update({ enabled: false, disabled_reason: "apns_unregistered" })
        .in("id", iosInvalid);
    }
    if (androidInvalid.length > 0) {
      await admin
        .from("push_android_devices")
        .update({ enabled: false, disabled_reason: "expo_unregistered" })
        .in("id", androidInvalid);
    }
  }
  return { incidentPushes: pushes.length, incidentPushDevices: devices };
}
