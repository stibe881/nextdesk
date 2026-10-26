import { describe, expect, it } from "vitest";
import {
  isTrustedTicketInlineImageUrl,
  ticketInlineAttachmentIds,
  ticketInlineMediaSegments,
} from "./ticket-inline-media";

const attachmentId = "11111111-1111-4111-8111-111111111111";

describe("ticketInlineMediaSegments", () => {
  it("interpretiert nur das eigene UUID-Markerformat als Bild", () => {
    expect(
      ticketInlineMediaSegments(
        `Text [[nextdesk-inline-image:${attachmentId}]] Ende`,
      ),
    ).toEqual([
      { kind: "text", value: "Text " },
      { attachmentId, kind: "image" },
      { kind: "text", value: " Ende" },
    ]);
  });

  it("blendet alte CID-Fragmente aus und behandelt fremde Marker als Text", () => {
    expect(
      ticketInlineMediaSegments(
        "Logo.png [cid:old-content-id] cid:old-content-id <cid:old-content-id> [[nextdesk-inline-image:not-a-uuid]]",
      ),
    ).toEqual([
      {
        kind: "text",
        value: "Logo.png [[nextdesk-inline-image:not-a-uuid]]",
      },
    ]);
  });

  it("akzeptiert Bild-URLs nur aus dem privaten nextDesk-Storage", () => {
    const origin = "https://tenant.supabase.co";
    expect(
      isTrustedTicketInlineImageUrl(
        "https://tenant.supabase.co/storage/v1/object/sign/ticket-attachments/a?token=x",
        origin,
      ),
    ).toBe(true);
    expect(
      isTrustedTicketInlineImageUrl(
        "https://example.invalid/storage/v1/object/sign/ticket-attachments/a?token=x",
        origin,
      ),
    ).toBe(false);
  });

  it("sammelt eindeutige private Bildanhänge aus Beschreibung und Verlauf", () => {
    expect(
      ticketInlineAttachmentIds([
        `[[nextdesk-inline-image:${attachmentId}]]`,
        `Nochmals [[nextdesk-inline-image:${attachmentId}]]`,
      ]),
    ).toEqual([attachmentId]);
  });
});
