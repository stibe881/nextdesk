/** Läuft eine Abfrage sofort, wenn die App wieder in den Vordergrund kommt? */
export function shouldRunOnWake(
  state: string,
  lastRun: number,
  now: number,
  intervalMs: number,
): boolean {
  return state === "active" && intervalMs > 0 && now - lastRun >= intervalMs / 2;
}
