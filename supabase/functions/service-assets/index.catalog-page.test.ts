import { assetSearchTerm, parseAction } from "./index.ts";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID = "22222222-2222-4222-8222-222222222222";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("listCatalog bleibt ohne Seitenangaben unverändert und paginiert optional", () => {
  const legacy = parseAction({ type: "listCatalog", tenantId: TENANT_ID });
  assert(legacy?.type === "listCatalog", "legacy request rejected");
  assert(!("assetPage" in legacy) && !("sections" in legacy), "legacy request changed");

  const paged = parseAction({
    type: "listCatalog",
    tenantId: TENANT_ID,
    sections: ["assets", "assets"],
    assetOffset: 100,
    assetLimit: 50,
    assetQuery: "  Drucker ",
    assetServiceId: SERVICE_ID.toUpperCase(),
    assetStatus: "active",
  });
  assert(paged?.type === "listCatalog", "paged request rejected");
  assert(paged.sections?.length === 1, "sections not deduplicated");
  assert(
    paged.assetPage?.offset === 100 && paged.assetPage.limit === 50 &&
      paged.assetPage.query === "Drucker" &&
      paged.assetPage.serviceId === SERVICE_ID &&
      paged.assetPage.status === "active",
    "asset page wrong",
  );
  assert(
    parseAction({
      type: "listCatalog",
      tenantId: TENANT_ID,
      assetLimit: 10,
      assetServiceId: "unassigned",
    })?.type === "listCatalog",
    "unassigned filter rejected",
  );
  for (const invalid of [
    { assetLimit: 0 },
    { assetLimit: 201 },
    { assetOffset: -1 },
    { assetLimit: 10, assetServiceId: "irgendwas" },
    { assetQuery: "ohne Seite" },
    { sections: [] },
    { sections: ["tickets"] },
  ]) {
    assert(
      parseAction({ type: "listCatalog", tenantId: TENANT_ID, ...invalid }) ===
        null,
      `invalid catalog request accepted: ${JSON.stringify(invalid)}`,
    );
  }
});

Deno.test("serviceInsights verlangt eine Dienst-ID", () => {
  assert(
    parseAction({ type: "serviceInsights", tenantId: TENANT_ID, serviceId: SERVICE_ID })
      ?.type === "serviceInsights",
    "insights rejected",
  );
  assert(
    parseAction({ type: "serviceInsights", tenantId: TENANT_ID }) === null,
    "insights without service accepted",
  );
});

Deno.test("Suchbegriffe können den PostgREST-Filter nicht verändern", () => {
  assert(assetSearchTerm("a,b(c)*d%e\"f\\g") === "a b c d e f g", "special chars kept");
  assert(assetSearchTerm("  10.0.0.1  ") === "10.0.0.1", "ip search changed");
});

Deno.test("Asset-Dienste werden über asset_services geschrieben", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  for (const required of [
    'admin.rpc("set_asset_services"',
    "async function applyAssetPrimaryService",
    "asset_services!inner(service_id)",
    'admin.rpc("service_network_dependencies"',
  ]) {
    assert(source.includes(required), `service-assets lost: ${required}`);
  }
  const infrastructure = await Deno.readTextFile(
    new URL("../infrastructure/index.ts", import.meta.url),
  );
  assert(
    infrastructure.includes('admin.rpc("set_asset_services"') &&
      !infrastructure.includes('from("asset_services").delete()'),
    "infrastructure must write services via set_asset_services",
  );
});
