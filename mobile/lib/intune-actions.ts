import { invokeNextDesk } from "@/lib/nextdesk-client";
import {
  type MobileIntuneAction,
  type MobileIntuneDevice,
  mobileIntuneNeedsConfirmation,
  parseMobileIntuneDevice,
} from "@/lib/intune-actions-model";

export * from "@/lib/intune-actions-model";

export async function getMobileIntuneDevice(
  tenantId: string,
  assetId: string,
): Promise<MobileIntuneDevice | null> {
  const response = await invokeNextDesk<unknown>("intune-actions", {
    type: "listAssetActions",
    tenantId,
    assetIds: [assetId],
  });
  return parseMobileIntuneDevice(response, assetId);
}

export async function runMobileIntuneAction(
  tenantId: string,
  assetId: string,
  action: MobileIntuneAction,
): Promise<void> {
  await invokeNextDesk<unknown>("intune-actions", {
    type: "runAction",
    tenantId,
    assetId,
    ticketId: null,
    action,
    confirmed: mobileIntuneNeedsConfirmation(action),
  });
}
