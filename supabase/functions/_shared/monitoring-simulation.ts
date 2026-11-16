/**
 * Simulated outage: results of a sensor under simulation count as failed, so
 * the whole chain (incident, alerting, service status, notice) can be tested
 * without touching the device.
 */

export const SIMULATION_MESSAGE = "Simulierter Ausfall (Test)";

export type SimulatedSensor = {
  /** Failures in a row until the sensor counts as down. */
  failuresToDown: number;
  /** Already down: no need to reach the threshold again. */
  down: boolean;
};

type Result = {
  id: string;
  at: string;
  ok: boolean;
  value: number | null;
  value2?: number | null;
  message: string | null;
};

/**
 * Replaces the results of simulated sensors by failures. For a sensor that
 * is not down yet, the first failure is repeated (one second apart, before
 * the real time) until the threshold is reached, so the outage shows with
 * the next report instead of after several intervals.
 */
export function simulateResults<T extends Result>(
  results: readonly T[],
  simulated: ReadonlyMap<string, SimulatedSensor>,
): T[] {
  const boosted = new Set<string>();
  return results.flatMap((result) => {
    const sensor = simulated.get(result.id);
    if (!sensor) return [result];
    const failure = { ...result, ok: false, value: null, value2: null, message: SIMULATION_MESSAGE };
    if (sensor.down || boosted.has(result.id)) return [failure];
    boosted.add(result.id);
    const at = Date.parse(result.at);
    const extra = Math.min(Math.max(sensor.failuresToDown - 1, 0), 9);
    return [
      ...Array.from({ length: extra }, (_, index) => ({
        ...failure,
        at: new Date(at - (extra - index) * 1000).toISOString(),
      })),
      failure,
    ];
  });
}

/** Minutes a simulation may run; it always ends by itself. */
export const SIMULATION_MINUTES = [5, 10, 15, 30, 60] as const;
