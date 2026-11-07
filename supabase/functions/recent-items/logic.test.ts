import { assertEquals } from "jsr:@std/assert@1";
import {
  assetReadable,
  idsByType,
  MAX_LIST,
  mergeReadableRecentItems,
  parseAction,
  type ReadableItem,
} from "./logic.ts";

const tenantId = "10000000-0000-4000-8000-000000000001";
const a = "20000000-0000-4000-8000-00000000000a";
const b = "20000000-0000-4000-8000-00000000000b";
const c = "20000000-0000-4000-8000-00000000000c";

Deno.test("parseAction validates record and list requests", () => {
  assertEquals(parseAction({ type: "record", tenantId, itemType: "ticket", itemId: a }), {
    type: "record",
    tenantId,
    itemType: "ticket",
    itemId: a,
  });
  assertEquals(parseAction({ type: "record", tenantId, itemType: "user", itemId: a }), null);
  assertEquals(parseAction({ type: "record", tenantId, itemType: "asset", itemId: "x" }), null);
  assertEquals(parseAction({ type: "list", tenantId }), {
    type: "list",
    tenantId,
    limit: MAX_LIST,
  });
  assertEquals(parseAction({ type: "list", tenantId, limit: 500 }), {
    type: "list",
    tenantId,
    limit: MAX_LIST,
  });
  assertEquals(parseAction({ type: "list", tenantId, limit: 1.5 }), null);
  assertEquals(parseAction({ type: "list", tenantId: "nope" }), null);
  assertEquals(parseAction({ type: "clear", tenantId }), { type: "clear", tenantId });
});

Deno.test("mergeReadableRecentItems keeps newest first and drops unreadable entries", () => {
  const rows = [
    { item_type: "ticket", item_id: a, viewed_at: "2026-11-07T08:00:00Z" },
    { item_type: "asset", item_id: b, viewed_at: "2026-11-07T10:00:00Z" },
    { item_type: "knowledge_article", item_id: c, viewed_at: "2026-11-07T09:00:00Z" },
    { item_type: "ticket", item_id: b, viewed_at: "2026-11-07T11:00:00Z" },
  ];
  const item = (title: string): ReadableItem => ({ title, detail: "d" });
  const readable = {
    ticket: new Map([[a, item("Drucker")]]), // ticket b no longer readable
    asset: new Map([[b, item("Laptop")]]),
    knowledge_article: new Map([[c, item("VPN")]]),
  };
  const merged = mergeReadableRecentItems(rows, readable, 20);
  assertEquals(merged.map((entry) => entry.title), ["Laptop", "VPN", "Drucker"]);
  assertEquals(mergeReadableRecentItems(rows, readable, 1).length, 1);
});

Deno.test("idsByType groups and de-duplicates ids", () => {
  const ids = idsByType([
    { item_type: "ticket", item_id: a, viewed_at: "x" },
    { item_type: "ticket", item_id: a, viewed_at: "y" },
    { item_type: "asset", item_id: b, viewed_at: "x" },
    { item_type: "bogus", item_id: c, viewed_at: "x" },
  ]);
  assertEquals(ids, { ticket: [a], asset: [b], knowledge_article: [] });
});

Deno.test("assetReadable builds a compact detail line", () => {
  assertEquals(assetReadable({ name: "NB-12", asset_tag: "A-1", kind: "laptop" }), {
    title: "NB-12",
    detail: "A-1 · laptop",
  });
  assertEquals(assetReadable({ name: "", asset_tag: null, kind: "" }).title, "Gerät");
});
