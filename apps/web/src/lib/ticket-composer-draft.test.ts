import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTicketComposerDraft,
  parseTicketComposerDraft,
  readTicketComposerDraft,
  writeTicketComposerDraft,
  type TicketComposerDraft,
} from "./ticket-composer-draft";

const TENANT = "0b6a1c1e-4f7a-4d2b-9c1e-2a3b4c5d6e7f";
const OTHER_TENANT = "1c7b2d2f-5a8b-4e3c-8d2f-3b4c5d6e7f80";

const draft: TicketComposerDraft = {
  subject: "VPN geht nicht",
  description: "Seit heute Morgen",
  departmentId: "dep",
  categoryId: "cat",
  subcategoryId: "",
  priorityKey: "high",
  templateId: "",
  assignedAgentId: "",
  requester: { id: "req", displayName: "Anna Muster" },
};

function stubStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  return values;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ticket composer draft", () => {
  it("is stored per user and tenant and cleared explicitly", () => {
    stubStorage();
    expect(writeTicketComposerDraft("user", TENANT, draft)).toBe(true);
    expect(readTicketComposerDraft("user", TENANT)).toEqual(draft);
    expect(readTicketComposerDraft("user", OTHER_TENANT)).toBeNull();
    expect(readTicketComposerDraft("other", TENANT)).toBeNull();
    clearTicketComposerDraft("user", TENANT);
    expect(readTicketComposerDraft("user", TENANT)).toBeNull();
  });

  it("removes an empty draft instead of storing it", () => {
    const values = stubStorage();
    writeTicketComposerDraft("user", TENANT, draft);
    expect(
      writeTicketComposerDraft("user", TENANT, {
        ...draft,
        subject: " ",
        description: "",
      }),
    ).toBe(false);
    expect(values.size).toBe(0);
  });

  it("ignores unavailable or broken storage", () => {
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new Error("SecurityError");
      },
    });
    expect(writeTicketComposerDraft("user", TENANT, draft)).toBe(false);
    expect(readTicketComposerDraft("user", TENANT)).toBeNull();
    expect(() => clearTicketComposerDraft("user", TENANT)).not.toThrow();

    const values = stubStorage();
    values.set(`nextdesk.ticketComposerDraft.v1:user:${TENANT}`, "{kaputt");
    expect(readTicketComposerDraft("user", TENANT)).toBeNull();
  });

  it("parses only known fields of the expected type", () => {
    expect(
      parseTicketComposerDraft({
        subject: "Drucker",
        description: 3,
        requester: { id: "x" },
        attachments: ["file"],
      }),
    ).toEqual({
      subject: "Drucker",
      description: "",
      departmentId: "",
      categoryId: "",
      subcategoryId: "",
      priorityKey: "",
      templateId: "",
      assignedAgentId: "",
      requester: null,
    });
    expect(parseTicketComposerDraft(null)).toBeNull();
  });
});
