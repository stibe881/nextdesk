import { describe, expect, it } from "vitest";
import {
  knowledgeBackendMessage,
  knowledgeErrorBackendMessage,
} from "./knowledge-errors";

function functionError(status: number, body: unknown) {
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: new Response(JSON.stringify(body), { status }),
  };
}

describe("knowledge backend messages", () => {
  it("returns the backend's German message", async () => {
    await expect(
      knowledgeErrorBackendMessage(
        functionError(422, {
          error: {
            code: "article_department_required",
            message: "Bitte wählen Sie eine Abteilung.",
          },
        }),
      ),
    ).resolves.toBe("Bitte wählen Sie eine Abteilung.");
  });

  it("falls back without a message, for server errors and odd content", async () => {
    await expect(
      knowledgeErrorBackendMessage(
        functionError(422, { error: { code: "invalid_request" } }),
      ),
    ).resolves.toBeNull();
    await expect(
      knowledgeErrorBackendMessage(
        functionError(500, { error: { code: "x", message: "Fehler" } }),
      ),
    ).resolves.toBeNull();
    await expect(
      knowledgeErrorBackendMessage(new Error("offline")),
    ).resolves.toBeNull();
    expect(
      knowledgeBackendMessage({ error: { message: "<script>x</script>" } }),
    ).toBeNull();
    expect(
      knowledgeBackendMessage({ error: { message: "x".repeat(301) } }),
    ).toBeNull();
  });
});
