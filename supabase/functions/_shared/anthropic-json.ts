import {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_MESSAGES_URL,
  AnthropicKnowledgeDraftError,
  classifyAnthropicResponseStatus,
} from "./anthropic-knowledge-draft.ts";

/**
 * Small structured-output call to Claude: returns the parsed JSON object that
 * matches `schema`. The caller validates the shape again before using it.
 */
export async function generateStructuredJson(input: {
  apiKey: string;
  model: string;
  system: string;
  content: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 30_000);
  const outputConfig: Record<string, unknown> = {};
  const base: Record<string, unknown> = {
    model: input.model,
    max_tokens: input.maxTokens,
    system: input.system,
    messages: [{ role: "user", content: input.content }],
  };
  if (input.model.startsWith("claude-sonnet-5-5")) {
    base.thinking = { type: "between_tools" };
  } else {
    outputConfig.effort = "low";
  }
  const body = (structured: boolean) =>
    JSON.stringify({
      ...base,
      ...(structured
        ? {
          output_config: {
            ...outputConfig,
            format: { type: "json_schema", schema: input.schema },
          },
        }
        : {
          system: `${input.system} Antworte ausschliesslich mit einem JSON-Objekt nach diesem Schema, ohne weiteren Text: ${
            JSON.stringify(input.schema)
          }`,
          ...(Object.keys(outputConfig).length
            ? { output_config: outputConfig }
            : {}),
        }),
    });
  try {
    const send = (structured: boolean) =>
      (input.fetcher ?? fetch)(ANTHROPIC_MESSAGES_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": input.apiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
        },
        body: body(structured),
        signal: controller.signal,
      });
    let response = await send(true);
    if (response.status === 400) response = await send(false);
    if (!response.ok) {
      console.error("anthropic_json_request_failed", {
        status: response.status,
        model: input.model,
      });
      throw new AnthropicKnowledgeDraftError(
        classifyAnthropicResponseStatus(response.status),
        "Die KI ist im Moment nicht verfügbar.",
      );
    }
    const payload = (await response.json()) as { content?: unknown };
    const text = Array.isArray(payload.content)
      ? (payload.content as { type?: unknown; text?: unknown }[])
        .filter((block) => block?.type === "text" && typeof block.text === "string")
        .map((block) => block.text as string)
        .join("")
        .trim()
      : "";
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) {
      throw new AnthropicKnowledgeDraftError(
        "ai_provider_response_invalid",
        "Die KI-Antwort war unvollständig.",
      );
    }
    try {
      return JSON.parse(json);
    } catch {
      throw new AnthropicKnowledgeDraftError(
        "ai_provider_response_invalid",
        "Die KI-Antwort war unvollständig.",
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

/** Reads the configured Anthropic credentials of the deployment. */
export function anthropicCredentials(): { apiKey: string; model: string } | null {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")?.trim();
  const model = Deno.env.get("ANTHROPIC_MODEL")?.trim();
  return apiKey && model ? { apiKey, model } : null;
}
