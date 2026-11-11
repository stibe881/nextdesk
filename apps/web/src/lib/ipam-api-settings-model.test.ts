import { describe, expect, it } from "vitest";
import {
  deliveryStatusLabel,
  ipamApiBaseUrl,
  parseIpamApiSettings,
  webhookEventLabel,
  webhookStatusLabel,
  webhookUrlProblem,
} from "./ipam-api-settings-model";

describe("parseIpamApiSettings", () => {
  it("liest Schlüssel, Webhooks und Zustellungen", () => {
    const settings = parseIpamApiSettings({
      keys: [
        {
          id: "k1",
          name: "Ansible",
          key_prefix: "ndk_ipam_AbCd1234",
          scopes: ["read", "write", "admin"],
          created_at: "2026-11-01T10:00:00Z",
          last_used_at: null,
          revoked_at: null,
        },
        { id: "k2", name: "ohne Präfix" },
      ],
      webhooks: [
        {
          id: "w1",
          name: "Automation",
          url: "https://hooks.example.com/ipam",
          events: ["address.reserved", "unbekannt"],
          active: true,
          last_status: 204,
        },
      ],
      deliveries: [
        {
          id: 5,
          webhook_id: "w1",
          event: "address.reserved",
          status: "pending",
          attempts: 2,
          created_at: "2026-11-11T08:00:00Z",
        },
        { id: 6, webhook_id: "w1", status: "kaputt", created_at: "x" },
      ],
    });
    expect(settings?.keys).toEqual([
      {
        id: "k1",
        name: "Ansible",
        prefix: "ndk_ipam_AbCd1234",
        scopes: ["read", "write"],
        createdAt: "2026-11-01T10:00:00Z",
        lastUsedAt: null,
        revokedAt: null,
      },
    ]);
    expect(settings?.webhooks[0]?.events).toEqual(["address.reserved"]);
    expect(webhookStatusLabel(settings!.webhooks[0]!)).toBe("OK (HTTP 204)");
    expect(deliveryStatusLabel(settings!.deliveries[0]!)).toBe(
      "Wird wiederholt (2. Versuch)",
    );
    expect(settings?.deliveries).toHaveLength(1);
    expect(parseIpamApiSettings({ keys: [] })).toBeNull();
  });

  it("prüft Webhook-Adressen und beschriftet Ereignisse", () => {
    expect(webhookUrlProblem("https://hooks.example.com/x")).toBeNull();
    expect(webhookUrlProblem("http://hooks.example.com/x")).toBe(
      "Nur HTTPS-Adressen sind erlaubt.",
    );
    expect(webhookUrlProblem("https://192.168.1.5/x")).toBe(
      "Interne Adressen sind nicht erlaubt.",
    );
    expect(webhookUrlProblem("kein link")).toContain("https://");
    expect(webhookEventLabel("prefix.created")).toBe("Subnetz angelegt");
    expect(webhookEventLabel("ping")).toBe("Test");
    expect(
      webhookStatusLabel({
        id: "w",
        name: "n",
        url: "https://x.ch",
        events: [],
        active: false,
        lastStatus: null,
        lastError: null,
        lastDeliveryAt: null,
      }),
    ).toBe("Pausiert");
    expect(ipamApiBaseUrl("https://abc.supabase.co/")).toBe(
      "https://abc.supabase.co/functions/v1/ipam-api",
    );
  });
});
