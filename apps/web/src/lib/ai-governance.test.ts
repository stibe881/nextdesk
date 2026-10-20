import { describe, expect, it } from "vitest";
import { parseAiGovernanceApprovalResponse } from "./ai-governance";

describe("parseAiGovernanceApprovalResponse", () => {
  it("liest Freigabe und serverseitige Anbieterbereitschaft aus der Function-Antworthülle", () => {
    expect(
      parseAiGovernanceApprovalResponse({
        data: {
          provider: "Anthropic",
          providerConfigured: true,
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
      providerConfigured: true,
    });
  });

  it("zeigt eine vorhandene Freigabe nicht als nutzbar, wenn der Provider fehlt", () => {
    expect(
      parseAiGovernanceApprovalResponse({
        data: {
          provider: "Anthropic",
          providerConfigured: false,
          approval: {
            enabled: true,
            allowExternalArticleContent: true,
            allowedPurposes: ["general_draft"],
          },
        },
      }).providerConfigured,
    ).toBe(false);
  });

  it("behandelt ältere Function-Antworten ohne Bereitschaftsangabe als nicht konfiguriert", () => {
    expect(
      parseAiGovernanceApprovalResponse({
        data: {
          provider: "Anthropic",
          approval: {
            enabled: true,
            allowExternalArticleContent: true,
            allowedPurposes: ["general_draft"],
          },
        },
      }).providerConfigured,
    ).toBe(false);
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
          providerConfigured: true,
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
