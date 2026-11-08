import { describe, expect, it } from "vitest";

import {
  linkedAssetFromParams,
  parseScannedCode,
  ticketPrefillForAsset,
} from "../lib/asset-qr";

const ID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

describe("parseScannedCode", () => {
  it("recognises app links", () => {
    expect(parseScannedCode(`ch.grossict.nextdesk://asset/${ID}`)).toEqual({
      kind: "asset",
      assetId: ID,
    });
    expect(
      parseScannedCode(` CH.GROSSICT.NEXTDESK:///asset/${ID.toUpperCase()} `),
    ).toEqual({ kind: "asset", assetId: ID });
    expect(
      parseScannedCode("ch.grossict.nextdesk://infrastructure?rack=A%2001"),
    ).toEqual({ kind: "rack", rack: "A 01" });
  });

  it("recognises web fallback links", () => {
    expect(parseScannedCode(`https://app.nextdesk.ch/?asset=${ID}#x`)).toEqual({
      kind: "asset",
      assetId: ID,
    });
    expect(
      parseScannedCode("https://app.nextdesk.ch/nextdesk/?rack=R+2"),
    ).toEqual({ kind: "rack", rack: "R 2" });
  });

  it("keeps inventory numbers, serials and foreign codes as lookup codes", () => {
    expect(parseScannedCode("  INV-4711 ")).toEqual({
      kind: "code",
      code: "INV-4711",
    });
    expect(parseScannedCode("4006381333931")).toEqual({
      kind: "code",
      code: "4006381333931",
    });
    expect(parseScannedCode("https://vendor.example/device/123")).toEqual({
      kind: "code",
      code: "https://vendor.example/device/123",
    });
    expect(parseScannedCode("ch.grossict.nextdesk://asset/not-a-uuid")).toEqual(
      { kind: "code", code: "ch.grossict.nextdesk://asset/not-a-uuid" },
    );
    expect(parseScannedCode("https://x.example/?asset=%E0%A4%A")).toEqual({
      kind: "code",
      code: "https://x.example/?asset=%E0%A4%A",
    });
  });
});

describe("ticket prefill", () => {
  it("builds subject, description and the asset link", () => {
    const prefill = ticketPrefillForAsset({
      id: ID,
      name: "Notebook 12",
      inventoryNumber: "4711",
      assetTag: null,
      serialNumber: "SN1",
      locationName: "Büro 2",
    });
    expect(prefill.subject).toBe("Notebook 12: ");
    expect(prefill.description).toBe(
      "Gerät: Notebook 12\nInventarnummer: 4711\nSeriennummer: SN1\nStandort: Büro 2\n\nProblem:",
    );
    expect(prefill.assetId).toBe(ID);
  });

  it("validates link parameters", () => {
    expect(linkedAssetFromParams({ assetId: ID, assetName: " NB " })).toEqual({
      id: ID,
      name: "NB",
    });
    expect(linkedAssetFromParams({ assetId: ID })).toEqual({
      id: ID,
      name: "Gerät",
    });
    expect(linkedAssetFromParams({ assetId: "x" })).toBeNull();
    expect(linkedAssetFromParams({ assetId: [ID] })).toBeNull();
  });
});
