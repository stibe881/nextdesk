export type AiPurpose = "general_draft" | "knowledge_article_draft";

export type AiGovernanceApproval = {
  enabled: boolean;
  allowExternalArticleContent: boolean;
  allowedPurposes: AiPurpose[];
};

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The JWT-protected ai-assist Function returns regular success payloads inside
 * `{ data: ... }`. Validate that envelope before exposing its approval state to
 * the settings UI.
 */
export function parseAiGovernanceApprovalResponse(
  value: unknown,
): AiGovernanceApproval {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    value.data.provider !== "Anthropic" ||
    !isRecord(value.data.approval)
  ) {
    throw new Error("invalid_ai_configuration");
  }

  const approval = value.data.approval;
  const allowedPurposes = Array.isArray(approval.allowedPurposes)
    ? approval.allowedPurposes.filter(
        (purpose): purpose is AiPurpose =>
          purpose === "general_draft" || purpose === "knowledge_article_draft",
      )
    : [];

  if (
    typeof approval.enabled !== "boolean" ||
    typeof approval.allowExternalArticleContent !== "boolean"
  ) {
    throw new Error("invalid_ai_configuration");
  }

  return {
    enabled: approval.enabled,
    allowExternalArticleContent: approval.allowExternalArticleContent,
    allowedPurposes,
  };
}
