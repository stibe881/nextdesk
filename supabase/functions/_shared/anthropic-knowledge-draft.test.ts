import {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_MESSAGES_URL,
  classifyAnthropicResponseStatus,
  createKnowledgeDraftRequest,
  generateKnowledgeDraft,
  keepKnownImageReferences,
  parseKnowledgeDraft,
} from "./anthropic-knowledge-draft.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test(
  "Anthropic request fixes the structured title and Markdown contract",
  () => {
    const request = createKnowledgeDraftRequest(
      "VPN funktioniert nicht.",
      "configured-model",
      512,
    );
    assert(
      request.model === "configured-model",
      "Model must be server configured.",
    );
    assert(request.max_tokens === 512, "Output must stay bounded.");
    assert(
      JSON.stringify(request).includes('"bodyMarkdown"'),
      "Structured output must require Markdown only.",
    );
    assert(
      JSON.stringify(request).includes("Fachlicher Rohinhalt"),
      "The raw content must be treated as explicit data.",
    );
  },
);

Deno.test(
  "Anthropic parser accepts only bounded title and Markdown output",
  () => {
    const draft = parseKnowledgeDraft({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            title: "VPN-Verbindung herstellen",
            bodyMarkdown: "Einleitung\n\n## Schritte\n\n1. VPN starten",
          }),
        },
      ],
    });
    assert(
      draft.title === "VPN-Verbindung herstellen",
      "Title must be preserved.",
    );
    assert(
      draft.bodyMarkdown.includes("## Schritte"),
      "Markdown must be preserved.",
    );

    let rejected = false;
    try {
      parseKnowledgeDraft({ content: [{ type: "text", text: "not json" }] });
    } catch {
      rejected = true;
    }
    assert(rejected, "Malformed provider output must fail closed.");
  },
);

Deno.test(
  "Anthropic request stays server-side and does not expose its key",
  async () => {
    // Assigned inside the fetcher callback, so it must not narrow to null.
    let captured = null as Request | null;
    const draft = await generateKnowledgeDraft({
      apiKey: "server-secret",
      model: "configured-model",
      rawContent: "Rohinhalt",
      maxTokens: 128,
      fetcher: async (input, init) => {
        captured = new Request(input, init);
        return new Response(
          JSON.stringify({
            content: [
              {
                type: "text",
                text: JSON.stringify({ title: "Titel", bodyMarkdown: "Text" }),
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    assert(draft.title === "Titel", "The validated draft must be returned.");
    assert(
      captured?.url === ANTHROPIC_MESSAGES_URL,
      "Only Anthropic is contacted.",
    );
    assert(
      captured?.headers.get("anthropic-version") === ANTHROPIC_API_VERSION,
      "The provider API version must be explicit.",
    );
    assert(
      captured?.headers.get("x-api-key") === "server-secret",
      "The key must be confined to the outbound server request.",
    );
  },
);

Deno.test(
  "Anthropic-Ablehnungen bleiben ohne Antworttext sicher klassifiziert",
  () => {
    assert(
      classifyAnthropicResponseStatus(400) === "ai_provider_request_rejected",
      "Invalid requests must remain non-sensitive.",
    );
    assert(
      classifyAnthropicResponseStatus(401) ===
        "ai_provider_authentication_failed",
      "Authentication failures must be actionable.",
    );
    assert(
      classifyAnthropicResponseStatus(403) === "ai_provider_access_denied",
      "Access failures must be actionable.",
    );
    assert(
      classifyAnthropicResponseStatus(404) === "ai_provider_model_not_found",
      "Unknown models must be actionable.",
    );
    assert(
      classifyAnthropicResponseStatus(429) === "ai_provider_rate_limited",
      "Provider throttling must remain retryable.",
    );
    assert(
      classifyAnthropicResponseStatus(503) === "ai_provider_request_failed",
      "Unknown provider failures must stay generic.",
    );
  },
);

Deno.test("sends added images with their ids and keeps only known image references", () => {
  const imageId = "0f0f0f0f-0000-4000-8000-000000000001";
  const request = createKnowledgeDraftRequest(
    "Drucker zeigt Fehler 49",
    "claude-test",
    1000,
    "",
    true,
    [{ id: imageId, mediaType: "image/png", base64: "iVBORw0KGgo=" }],
  ) as { system: string; messages: { content: unknown }[] };
  const content = request.messages[0].content as {
    type: string;
    text?: string;
    source?: { media_type: string; data: string };
  }[];
  if (!Array.isArray(content) || content.length !== 3) {
    throw new Error("The image was not sent as a content block");
  }
  if (
    content[1].text !== `Bild 1, ID ${imageId}:` ||
    content[2].type !== "image" ||
    content[2].source?.media_type !== "image/png"
  ) {
    throw new Error("The image block is wrong");
  }
  if (!request.system.includes("kb-image:<ID>")) {
    throw new Error("The image instructions are missing");
  }
  const cleaned = keepKnownImageReferences(
    `Schritt 1\n![Fehler](kb-image:${imageId})\n![Fremd](kb-image:0f0f0f0f-0000-4000-8000-000000000999)`,
    [imageId],
  );
  if (!cleaned.includes(imageId) || cleaned.includes("000000000999")) {
    throw new Error(`Unknown image references were kept: ${cleaned}`);
  }
});
