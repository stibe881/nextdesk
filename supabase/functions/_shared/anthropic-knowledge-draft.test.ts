import {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_MESSAGES_URL,
  createKnowledgeDraftRequest,
  generateKnowledgeDraft,
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
    let captured: Request | null = null;
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
