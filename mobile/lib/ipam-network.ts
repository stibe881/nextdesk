import { invokeNextDesk } from "@/lib/nextdesk-client";
import {
  type MobileNetworkAddress,
  parseMobileAssetNetwork,
} from "@/lib/ipam-network-model";

export * from "@/lib/ipam-network-model";

/**
 * Netzwerkdaten zum Gerät (IP, VLAN, Subnetz, Switch-Port, Funde). Ohne
 * IP-Adressverwaltung, ohne Recht oder ohne Treffer: leere Liste.
 */
export async function getMobileAssetNetwork(
  tenantId: string,
  assetId: string,
): Promise<MobileNetworkAddress[]> {
  const response = await invokeNextDesk<unknown>("ipam-sync", {
    type: "assetNetwork",
    tenantId,
    assetId,
  });
  return parseMobileAssetNetwork(response) ?? [];
}
