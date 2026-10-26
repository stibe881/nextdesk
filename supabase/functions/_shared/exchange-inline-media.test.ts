import {
  inlineImageMarker,
  normalizeInlineContentId,
  prepareInboundBodyWithInlineMarkers,
  resolveInboundInlineMarkers,
} from "./exchange-inline-media.ts";

Deno.test("normalisiert nur sichere Graph-Content-IDs", () => {
  if (normalizeInlineContentId(" <Logo-1@Mail> ") !== "logo-1@mail") {
    throw new Error("Sichere Content-ID wurde nicht normalisiert.");
  }
  if (normalizeInlineContentId("logo id") !== null) {
    throw new Error("Content-ID mit Leerzeichen wurde akzeptiert.");
  }
  if (normalizeInlineContentId("logo]]") !== null) {
    throw new Error("Marker-terminierende Content-ID wurde akzeptiert.");
  }
});

Deno.test("ersetzt nur bekannte CIDs durch private Inlinebildmarker", () => {
  const prepared = prepareInboundBodyWithInlineMarkers(
    "Signatur [cid:Logo-1@Mail], cid:logo-1@mail, <cid:LOGO-1@MAIL> und [cid:unbekannt]",
    ["logo-1@mail"],
  );
  if (
    prepared !==
    "Signatur [[nextdesk-inline-content:logo-1@mail]], [[nextdesk-inline-content:logo-1@mail]], [[nextdesk-inline-content:logo-1@mail]] und "
  ) {
    throw new Error("CID-Referenzen wurden nicht sicher vorbereitet.");
  }

  const attachmentId = "11111111-1111-4111-8111-111111111111";
  const resolved = resolveInboundInlineMarkers(
    prepared,
    new Map([["logo-1@mail", attachmentId]]),
  );
  if (
    resolved !==
    `Signatur ${inlineImageMarker(attachmentId)}, ${inlineImageMarker(attachmentId)}, ${inlineImageMarker(attachmentId)} und `
  ) {
    throw new Error(
      "Inlinebildmarker wurde nicht auf den privaten Anhang abgebildet.",
    );
  }
});

Deno.test("entfernt nicht auflösbare temporäre CID-Marker", () => {
  const result = resolveInboundInlineMarkers(
    "Logo [[nextdesk-inline-content:unbekannt]]",
    new Map(),
  );
  if (result !== "Logo ") {
    throw new Error("Nicht auflösbare CID-Marker bleiben sichtbar.");
  }
});
