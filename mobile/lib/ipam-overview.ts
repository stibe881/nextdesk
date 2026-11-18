import { invokeNextDesk } from "@/lib/nextdesk-client";
import {
  type IpamOverviewData,
  type IpamPrefixDetailData,
  type IpamSearchResult,
  parseIpamOverview,
  parseIpamPrefixDetail,
  parseIpamSearch,
} from "@/lib/ipam-overview-model";

export * from "@/lib/ipam-overview-model";

/**
 * Lesezugriffe der Übersicht «IP-Adressen» auf die Funktion ipam. Der Server
 * prüft Modul (ipam.management) und Recht (ipam.read); eine Ablehnung kommt
 * als NextDeskRequestError mit Code feature_disabled oder access_denied
 * (siehe isIpamAccessDenied). Unerwartete Antworten werfen einen Fehler.
 */
function incomplete(): Error {
  return new Error("Die Antwort der IP-Adressverwaltung ist unvollständig.");
}

export async function loadIpamOverview(
  tenantId: string,
): Promise<IpamOverviewData> {
  const response = await invokeNextDesk<unknown>("ipam", {
    type: "overview",
    tenantId,
  });
  const parsed = parseIpamOverview(response);
  if (!parsed) throw incomplete();
  return parsed;
}

/** Adressen (IP, Hostname, DNS-Name, Beschreibung, MAC) und Subnetze. */
export async function searchIpam(
  tenantId: string,
  query: string,
): Promise<IpamSearchResult> {
  const response = await invokeNextDesk<unknown>("ipam", {
    type: "search",
    tenantId,
    query: query.trim().slice(0, 100),
  });
  const parsed = parseIpamSearch(response);
  if (!parsed) throw incomplete();
  return parsed;
}

/** Subnetz mit einer Seite Adressen (200 je Seite, Raster-Subnetze ganz). */
export async function loadIpamPrefix(
  tenantId: string,
  prefixId: string,
  page = 0,
): Promise<IpamPrefixDetailData> {
  const response = await invokeNextDesk<unknown>("ipam", {
    type: "prefixDetail",
    tenantId,
    prefixId,
    page,
    query: null,
  });
  const parsed = parseIpamPrefixDetail(response);
  if (!parsed) throw incomplete();
  return parsed;
}
