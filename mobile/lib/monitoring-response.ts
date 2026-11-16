/**
 * The edge function answers `{ data: … }`; invokeNextDesk returns that
 * envelope unchanged. Without unwrapping, the screens read `totals` etc. from
 * the envelope and crash while rendering.
 */
export function monitoringData<T>(response: unknown): T {
  if (
    typeof response === "object" &&
    response !== null &&
    "data" in response &&
    typeof (response as { data?: unknown }).data === "object" &&
    (response as { data?: unknown }).data !== null
  )
    return (response as { data: T }).data;
  throw new Error("Die Überwachung hat eine unerwartete Antwort geliefert.");
}
