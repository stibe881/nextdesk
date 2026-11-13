// Versand an Android über den Expo-Push-Dienst (https://docs.expo.dev/push-notifications/sending-notifications/).

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK_SIZE = 100;

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export type ExpoResult = {
  to: string;
  ok: boolean;
  /** Fehlercode von Expo, z. B. «DeviceNotRegistered». */
  error?: string;
};

type FetchLike = typeof fetch;

/** Sendet die Nachrichten in Paketen zu je 100 und liefert pro Nachricht das Ergebnis. */
export async function sendExpoPush(
  messages: readonly ExpoMessage[],
  fetcher: FetchLike = fetch,
): Promise<ExpoResult[]> {
  const results: ExpoResult[] = [];
  for (let index = 0; index < messages.length; index += CHUNK_SIZE) {
    const chunk = messages.slice(index, index + CHUNK_SIZE);
    try {
      const response = await fetcher(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(
          chunk.map((message) => ({
            to: message.to,
            title: message.title,
            body: message.body,
            sound: "default",
            priority: "high",
            channelId: "default",
            ...(message.data ? { data: message.data } : {}),
          })),
        ),
        signal: AbortSignal.timeout(15_000),
      });
      const payload: unknown = await response.json().catch(() => null);
      const tickets =
        response.ok &&
        typeof payload === "object" &&
        payload !== null &&
        Array.isArray((payload as { data?: unknown }).data)
          ? ((payload as { data: unknown[] }).data as unknown[])
          : null;
      chunk.forEach((message, position) => {
        if (!tickets) {
          results.push({
            to: message.to,
            ok: false,
            error: response.ok ? "invalid_response" : `http_${response.status}`,
          });
          return;
        }
        const ticket = tickets[position] as
          { status?: unknown; details?: { error?: unknown } } | undefined;
        if (ticket?.status === "ok") {
          results.push({ to: message.to, ok: true });
        } else {
          const error =
            typeof ticket?.details?.error === "string"
              ? ticket.details.error
              : "unknown_error";
          results.push({ to: message.to, ok: false, error });
        }
      });
    } catch {
      for (const message of chunk) {
        results.push({ to: message.to, ok: false, error: "network_error" });
      }
    }
  }
  return results;
}
