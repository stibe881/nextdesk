import { describe, expect, it } from "vitest";
import {
  LABEL_FORMATS,
  assetDeepLink,
  assetIdFromSearch,
  assetLabelItem,
  assetWebLink,
  buildLabelDocument,
  labelContentPlan,
  labelFormat,
  layoutLabels,
  pageCount,
  rackDeepLink,
  rackFromSearch,
  rackLabelItem,
  repeatLabelItems,
} from "./asset-labels";

const ID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

describe("label formats", () => {
  it("fit on their page", () => {
    for (const format of LABEL_FORMATS) {
      const right =
        format.marginLeftMm +
        (format.columns - 1) * format.pitchXMm +
        format.labelWidthMm;
      const bottom =
        format.marginTopMm +
        (format.rows - 1) * format.pitchYMm +
        format.labelHeightMm;
      expect(right).toBeLessThanOrEqual(format.pageWidthMm + 0.01);
      expect(bottom).toBeLessThanOrEqual(format.pageHeightMm + 0.01);
    }
  });

  it("falls back to the first format", () => {
    expect(labelFormat("unknown").id).toBe("avery-l7651");
    expect(labelFormat("roll-62x29").kind).toBe("roll");
  });
});

describe("Avery L6009-20", () => {
  it("48 Etiketten 45,7 × 21,2 mm passen auf A4", () => {
    const format = labelFormat("avery-l6009");
    expect(format.id).toBe("avery-l6009");
    const positions = layoutLabels(format, 48);
    expect(positions).toHaveLength(48);
    expect(new Set(positions.map((p) => p.page))).toEqual(new Set([0]));
    expect(positions[0]).toMatchObject({ xMm: 9.75, yMm: 21.5 });
    const last = positions[47]!;
    expect(last).toMatchObject({ column: 3, row: 11 });
    expect(last.xMm + 45.7).toBeLessThanOrEqual(210);
    expect(last.yMm + 21.2).toBeLessThanOrEqual(297);
    expect(pageCount(format, 49)).toBe(2);
  });
});

describe("layoutLabels", () => {
  const l7651 = labelFormat("avery-l7651");

  it("places labels row by row", () => {
    const positions = layoutLabels(l7651, 7);
    expect(positions[0]).toEqual({
      page: 0,
      column: 0,
      row: 0,
      xMm: 4.75,
      yMm: 10.7,
    });
    expect(positions[4]).toMatchObject({ column: 4, row: 0, xMm: 167.15 });
    expect(positions[5]).toMatchObject({ column: 0, row: 1, yMm: 31.9 });
  });

  it("skips used labels on the first sheet and breaks pages", () => {
    const positions = layoutLabels(l7651, 3, 64);
    expect(positions.map((p) => [p.page, p.row, p.column])).toEqual([
      [0, 12, 4],
      [1, 0, 0],
      [1, 0, 1],
    ]);
    expect(pageCount(l7651, 3, 64)).toBe(2);
    expect(pageCount(l7651, 0)).toBe(0);
  });

  it("clamps skip and ignores it for rolls", () => {
    expect(layoutLabels(l7651, 1, 500)[0]).toMatchObject({ row: 12 });
    expect(layoutLabels(l7651, 1, -3)[0]).toMatchObject({ row: 0 });
    const rollPositions = layoutLabels(labelFormat("roll-62x29"), 3, 5);
    expect(rollPositions.map((p) => p.page)).toEqual([0, 1, 2]);
    expect(rollPositions[2]).toMatchObject({ xMm: 0, yMm: 0 });
  });
});

describe("labelContentPlan", () => {
  it("keeps the QR inside small labels and hides the logo", () => {
    const plan = labelContentPlan(labelFormat("avery-l7651"));
    expect(plan.showLogo).toBe(false);
    expect(plan.qrMm).toBeLessThanOrEqual(21.2 - 2 * plan.paddingMm);
    expect(plan.direction).toBe("row");
  });

  it("shows the logo on larger labels and stacks on tall rolls", () => {
    expect(labelContentPlan(labelFormat("avery-3474")).showLogo).toBe(true);
    const tall = labelContentPlan(labelFormat("roll-62x100"));
    expect(tall.direction).toBe("column");
    expect(tall.qrMm).toBeLessThanOrEqual(62 - 2 * tall.paddingMm);
    expect(tall.maxMetaLines).toBeGreaterThan(0);
  });
});

describe("QR payloads", () => {
  it("builds app and web links", () => {
    expect(assetDeepLink(ID.toUpperCase())).toBe(
      `ch.grossict.nextdesk://asset/${ID}`,
    );
    expect(rackDeepLink(" A 01 ")).toBe(
      "ch.grossict.nextdesk://infrastructure?rack=A%2001",
    );
    expect(assetWebLink("https://app.nextdesk.ch/?x=1#y", ID)).toBe(
      `https://app.nextdesk.ch/?asset=${ID}`,
    );
  });

  it("reads web fallback parameters", () => {
    expect(assetIdFromSearch(`?asset=${ID.toUpperCase()}`)).toBe(ID);
    expect(assetIdFromSearch("?asset=nope")).toBeNull();
    expect(rackFromSearch("?rack=A%2001")).toBe("A 01");
    expect(rackFromSearch("?rack=")).toBeNull();
  });

  it("creates label items with available identifiers", () => {
    const item = assetLabelItem(
      {
        id: ID,
        name: "Notebook 12",
        assetTag: "NB-12",
        inventoryNumber: " ",
        serialNumber: "SN1",
      },
      "app",
      "https://app.nextdesk.ch/",
    );
    expect(item.meta).toEqual(["Tag: NB-12", "S/N: SN1"]);
    expect(item.qrText).toBe(assetDeepLink(ID));
    const rack = rackLabelItem(
      { name: "R1", locationName: "Keller", deviceCount: 1 },
      "web",
      "https://app.nextdesk.ch/",
    );
    expect(rack.title).toBe("Rack R1");
    expect(rack.meta).toEqual(["Keller", "1 Gerät"]);
    expect(rack.qrText).toBe("https://app.nextdesk.ch/?rack=R1");
  });
});

describe("buildLabelDocument", () => {
  it("escapes text, embeds only the svg and sets the page size", () => {
    const item = assetLabelItem(
      { id: ID, name: "<b>Drucker</b>", assetTag: null, inventoryNumber: "1" },
      "app",
      "https://app.nextdesk.ch/",
    );
    const html = buildLabelDocument({
      format: labelFormat("avery-3474"),
      items: [item],
      qrSvgs: new Map([
        [item.key, '<?xml version="1.0"?><svg viewBox="0 0 1 1"></svg>'],
      ]),
      branding: { name: "Muster AG", logoUrl: "http://insecure/logo.png" },
      autoPrint: false,
    });
    expect(html).toContain("@page { size: 210mm 297mm");
    expect(html).toContain("&lt;b&gt;Drucker&lt;/b&gt;");
    expect(html).toContain('<svg viewBox="0 0 1 1"></svg>');
    expect(html).not.toContain("<?xml");
    expect(html).not.toContain("insecure");
    expect(html).toContain("Muster AG");
    expect(html).not.toContain("window.print");
  });

  it("drops svg markup with scripts", () => {
    const item = assetLabelItem(
      { id: ID, name: "X", assetTag: null, inventoryNumber: null },
      "app",
      "https://app.nextdesk.ch/",
    );
    const html = buildLabelDocument({
      format: labelFormat("roll-62x29"),
      items: [item],
      qrSvgs: new Map([[item.key, "<svg onload=alert(1)></svg>"]]),
    });
    expect(html).not.toContain("onload=alert");
    expect(html).toContain("window.print");
  });
});

describe("repeatLabelItems", () => {
  it("wiederholt jedes Etikett und begrenzt die Anzahl", () => {
    expect(repeatLabelItems(["a", "b"], 3)).toEqual([
      "a",
      "a",
      "a",
      "b",
      "b",
      "b",
    ]);
    expect(repeatLabelItems(["a"], 0)).toEqual(["a"]);
    expect(repeatLabelItems(["a"], Number.NaN)).toEqual(["a"]);
    expect(repeatLabelItems(["a"], 10_000)).toHaveLength(200);
  });
});
