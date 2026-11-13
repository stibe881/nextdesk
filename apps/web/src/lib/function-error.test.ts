import { describe, expect, it } from "vitest";
import { functionErrorMessage } from "./function-error";
import { setFormality } from "./formality";

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

describe("Teil-Tickets beim Abschluss", () => {
  it("erklärt, warum das Hauptticket noch nicht gelöst werden kann", async () => {
    await expect(
      functionErrorMessage(functionFailure("ticket_children_open"), "Fallback"),
    ).resolves.toContain("alle Teil-Tickets");
  });

  it("spricht in der Sie-Fassung formell an", async () => {
    try {
      await expect(
        functionErrorMessage(functionFailure("forbidden"), "Fallback"),
      ).resolves.toBe(
        "Für diese Aktion fehlt dir die erforderliche Berechtigung.",
      );
      setFormality("sie");
      await expect(
        functionErrorMessage(functionFailure("forbidden"), "Fallback"),
      ).resolves.toBe(
        "Für diese Aktion fehlt Ihnen die erforderliche Berechtigung.",
      );
    } finally {
      setFormality("du");
    }
  });
});
