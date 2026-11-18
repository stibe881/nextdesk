// Pure parts of «Meine Prioritäten» (testable without the app client).

/** Assigned open Störung or security case (shown above the tickets). */
export type OperationItem = {
  kind: "incident" | "security_case";
  id: string;
  number: string;
  title: string;
  urgent: boolean;
  reason: string;
};

export function parseOperations(value: unknown): OperationItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (
      (row.kind !== "incident" && row.kind !== "security_case") ||
      typeof row.id !== "string" ||
      typeof row.number !== "string"
    ) {
      return [];
    }
    return [
      {
        kind: row.kind,
        id: row.id,
        number: row.number,
        title: typeof row.title === "string" ? row.title : "",
        urgent: row.urgent === true,
        reason: typeof row.reason === "string" ? row.reason : "",
      },
    ];
  });
}
