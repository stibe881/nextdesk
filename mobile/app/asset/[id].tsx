import { Redirect, useLocalSearchParams } from "expo-router";

import { parseScannedCode } from "@/lib/asset-qr";

/**
 * Target of the app link on printed asset labels
 * (`ch.grossict.nextdesk://asset/<id>`, e.g. opened from the system camera).
 * Forwards to the asset detail, which checks access.
 */
export default function AssetDeepLinkScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const scanned = parseScannedCode(
    `ch.grossict.nextdesk://asset/${typeof id === "string" ? id : ""}`,
  );
  if (scanned.kind !== "asset") {
    return <Redirect href={"/assets/scan" as never} />;
  }
  return <Redirect href={`/assets/${scanned.assetId}` as never} />;
}
