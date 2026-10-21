import { describe, expect, it } from "vitest";
import { functionErrorMessage } from "./function-error";

function functionFailure(code: string): { context: Response; status: number } {
  const status = 503;
  return {
    context: new Response(JSON.stringify({ error: { code } }), { status }),
    status,
  };
}

describe("sichere KI-Fehlerhinweise", () => {
  it("erklärt ungültige Anbieterzugänge ohne Providerantworttext", async () => {
    await expect(
      functionErrorMessage(
        functionFailure("ai_provider_authentication_failed"),
        "Fallback",
      ),
    ).resolves.toContain("API-Zugang");
  });

  it("erklärt nicht verfügbare Modellkennungen ohne sensible Details", async () => {
    await expect(
      functionErrorMessage(
        functionFailure("ai_provider_model_not_found"),
        "Fallback",
      ),
    ).resolves.toContain("Modellkennung");
  });
});
