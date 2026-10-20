import { describe, expect, it } from "vitest";
import { parseAiGovernanceApprovalResponse } from "./ai-governance";

describe("parseAiGovernanceApprovalResponse", () => {
  it("liest die freigegebene Governance aus der Function-Antworthülle", () => {
    expect(
      parseAiGovernanceApprovalResponse({
        data: {
          provider: "Anthropic",
          approval: {
            enabled: true,
            allowExternalArticleContent: false,
            allowedPurposes: [
              "general_draft",
              "knowledge_article_draft",
              "unbekannter_zweck",
            ],
          },
        },
      }),
    ).toEqual({
      enabled: true,
      allowExternalArticleContent: false,
      allowedPurposes: ["general_draft", "knowledge_article_draft"],
    });
  });

  it("lehnt eine Antwort ohne erwartete Function-Hülle ab", () => {
    expect(() =>
      parseAiGovernanceApprovalResponse({
        approval: {
          enabled: true,
          allowExternalArticleContent: false,
          allowedPurposes: [],
        },
      }),
    ).toThrow("invalid_ai_configuration");
  });

  it("lehnt eine Antwort eines anderen Anbieters ab", () => {
    expect(() =>
      parseAiGovernanceApprovalResponse({
        data: {
          provider: "Unbekannt",
          approval: {
            enabled: true,
            allowExternalArticleContent: false,
            allowedPurposes: [],
          },
        },
      }),
    ).toThrow("invalid_ai_configuration");
  });
});
