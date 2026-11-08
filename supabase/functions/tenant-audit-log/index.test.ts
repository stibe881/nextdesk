import { assert, assertEquals } from "jsr:@std/assert@1";

import {
  collectExportRows,
  decodeCursor,
  encodeCursor,
  exportAuditMetadata,
  parseRequest,
  searchParameters,
} from "./index.ts";

const tenantId = "00000000-0000-4000-8000-000000000001";

Deno.test("list requests are limited to 200 entries per page", () => {
  assertEquals(
    parseRequest({ type: "list", tenantId, limit: 200 })?.type,
    "list",
  );
  assertEquals(parseRequest({ type: "list", tenantId, limit: 201 }), null);
  assertEquals(parseRequest({ type: "list", tenantId, limit: 0 }), null);
  assertEquals(parseRequest({ type: "list", tenantId, extra: 1 }), null);
  assertEquals(
    parseRequest({ type: "list", tenantId, filters: { severity: "x" } }),
    null,
  );
});

Deno.test("cursor round-trips with microsecond timestamps", () => {
  const row = {
    id: "00000000-0000-4000-8000-000000000002",
    occurred_at: "2026-01-01T10:00:00.123456+00:00",
  };
  assertEquals(decodeCursor(encodeCursor(row)), {
    id: row.id,
    occurredAt: row.occurred_at,
  });
  assertEquals(decodeCursor("kaputt"), null);
  assertEquals(
    parseRequest({ type: "list", tenantId, cursor: "kaputt" }),
    null,
  );
});

Deno.test("export requests need a known format", () => {
  assertEquals(
    parseRequest({ type: "export", tenantId, format: "csv", filters: {} })
      ?.type,
    "export",
  );
  assertEquals(
    parseRequest({ type: "export", tenantId, format: "xlsx" }),
    null,
  );
  assertEquals(parseRequest({ type: "exportCsv", tenantId }), null);
});

Deno.test("area filters become prefix parameters", () => {
  const parameters = searchParameters(
    tenantId,
    { area: "settings", freeText: "rolle" },
    undefined,
    51,
  );
  assert((parameters.p_action_prefixes as string[]).includes("tenant."));
  assert((parameters.p_excluded_prefixes as string[]).includes("tenant.role."));
  assertEquals(parameters.p_query, "rolle");
  assertEquals(parameters.p_cursor_at, null);
  assertEquals(parameters.p_limit, 51);
});

Deno.test("export metadata records the actual filters", () => {
  assertEquals(
    exportAuditMetadata("json", { severity: "critical" }, 3, false),
    {
      format: "json",
      exportedRows: 3,
      truncated: false,
      maxRows: 10_000,
      filters: { severity: "critical" },
    },
  );
});

Deno.test(
  "export batches stop at the row limit and detect truncation",
  async () => {
    const all = Array.from({ length: 25 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      occurred_at: `2026-01-01T10:00:${String(59 - index).padStart(2, "0")}Z`,
    }));
    const calls: number[] = [];
    const fetchBatch = (cursor: { id: string } | undefined, limit: number) => {
      calls.push(limit);
      const start = cursor
        ? all.findIndex((row) => row.id === cursor.id) + 1
        : 0;
      return Promise.resolve(all.slice(start, start + limit));
    };
    const truncated = await collectExportRows(fetchBatch, 20, 8);
    assertEquals(truncated.rows.length, 20);
    assertEquals(truncated.truncated, true);
    assertEquals(calls, [8, 8, 5]);

    const complete = await collectExportRows(fetchBatch, 30, 10);
    assertEquals(complete.rows.length, 25);
    assertEquals(complete.truncated, false);
  },
);
