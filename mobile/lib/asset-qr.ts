/**
 * Content of scanned asset labels. nextDesk labels carry an app link
 * (`ch.grossict.nextdesk://asset/<id>`) or a web link (`https://…/?asset=<id>`);
 * everything else (inventory number, serial number, asset tag, other
 * barcodes) is looked up as before.
 */

export const APP_SCHEME = "ch.grossict.nextdesk";

export type ScannedCode =
  | { kind: "asset"; assetId: string }
  | { kind: "rack"; rack: string }
  | { kind: "code"; code: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(value: string | null | undefined): string | null {
  const candidate = value?.trim() ?? "";
  return UUID_PATTERN.test(candidate) ? candidate.toLowerCase() : null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function searchParam(query: string, name: string): string | null {
  for (const part of query.replace(/^\?/, "").split("&")) {
    const [key, ...rest] = part.split("=");
    if (key && safeDecode(key) === name) {
      return safeDecode(rest.join("=").replace(/\+/g, " "));
    }
  }
  return null;
}

function rackName(value: string | null): string | null {
  const name = value?.trim() ?? "";
  return name && name.length <= 120 ? name : null;
}

/** Splits a URL without relying on a full URL implementation (Hermes). */
function splitUrl(
  value: string,
): { scheme: string; path: string; query: string } | null {
  const match = value.match(/^([a-z][a-z0-9+.-]*):\/\/([^?#]*)(\?[^#]*)?/i);
  if (!match) return null;
  return {
    scheme: match[1]!.toLowerCase(),
    path: match[2] ?? "",
    query: match[3] ?? "",
  };
}

export function parseScannedCode(raw: string): ScannedCode {
  const code = raw.trim();
  const url = splitUrl(code);
  if (url?.scheme === APP_SCHEME) {
    // «scheme://asset/<id>» and «scheme:///asset/<id>».
    const segments = url.path.split("/").filter(Boolean);
    if (segments[0]?.toLowerCase() === "asset") {
      const assetId = uuid(safeDecode(segments[1] ?? ""));
      if (assetId) return { kind: "asset", assetId };
    }
    if (segments[0]?.toLowerCase() === "infrastructure") {
      const rack = rackName(searchParam(url.query, "rack"));
      if (rack) return { kind: "rack", rack };
    }
    return { kind: "code", code };
  }
  if (url && (url.scheme === "https" || url.scheme === "http")) {
    const assetId = uuid(searchParam(url.query, "asset"));
    if (assetId) return { kind: "asset", assetId };
    const rack = rackName(searchParam(url.query, "rack"));
    if (rack) return { kind: "rack", rack };
  }
  return { kind: "code", code };
}

/** Prefill for the new-ticket screen from an asset. */
export function ticketPrefillForAsset(asset: {
  id: string;
  name: string;
  inventoryNumber: string | null;
  assetTag: string | null;
  serialNumber: string | null;
  locationName?: string | null;
}): {
  subject: string;
  description: string;
  assetId: string;
  assetName: string;
} {
  return {
    subject: `${asset.name}: `,
    description: [
      `Gerät: ${asset.name}`,
      asset.inventoryNumber ? `Inventarnummer: ${asset.inventoryNumber}` : null,
      asset.assetTag ? `Asset-Tag: ${asset.assetTag}` : null,
      asset.serialNumber ? `Seriennummer: ${asset.serialNumber}` : null,
      asset.locationName ? `Standort: ${asset.locationName}` : null,
      "",
      "Problem:",
    ]
      .filter((line) => line !== null)
      .join("\n"),
    assetId: asset.id,
    assetName: asset.name,
  };
}

/** Validated asset link parameters of the new-ticket screen. */
export function linkedAssetFromParams(params: {
  assetId?: string | string[];
  assetName?: string | string[];
}): { id: string; name: string } | null {
  const id = uuid(typeof params.assetId === "string" ? params.assetId : null);
  if (!id) return null;
  const name =
    typeof params.assetName === "string" && params.assetName.trim()
      ? params.assetName.trim().slice(0, 200)
      : "Gerät";
  return { id, name };
}
