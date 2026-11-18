/**
 * Trusted certificate authorities. Node.js ships its own list and ignores the
 * certificate store of the operating system. Behind a firewall that inspects
 * HTTPS (its own CA signs every connection) the connection to nextDesk then
 * fails with SELF_SIGNED_CERT_IN_CHAIN, although the CA is trusted on the
 * machine. The agent therefore adds the system store to the bundled list.
 * Verification itself is never switched off.
 */

import tls from "node:tls";

import { log } from "./log.ts";

type TrustApi = {
  getCACertificates?: (type: "default" | "system") => string[];
  setDefaultCACertificates?: (certificates: string[]) => void;
};

/** Returns how many system certificates were added (0 when unsupported). */
export function trustSystemCertificates(
  api: TrustApi = tls as TrustApi,
): number {
  // Available from Node.js 22.19 / 24.5; older versions keep the bundled list
  // (then NODE_EXTRA_CA_CERTS is the way to add a CA).
  if (!api.getCACertificates || !api.setDefaultCACertificates) return 0;
  try {
    const current = api.getCACertificates("default");
    const known = new Set(current);
    const added = api
      .getCACertificates("system")
      .filter((certificate) => !known.has(certificate));
    if (added.length) api.setDefaultCACertificates([...current, ...added]);
    return added.length;
  } catch (error) {
    log.debug("Zertifikatsspeicher des Systems nicht lesbar", error);
    return 0;
  }
}

const TLS_HINTS: Record<string, string> = {
  SELF_SIGNED_CERT_IN_CHAIN:
    "Eine Firewall oder ein Proxy entschlüsselt die HTTPS-Verbindung, und ihre Zertifizierungsstelle ist auf diesem Server nicht vertrauenswürdig. Entweder das CA-Zertifikat der Firewall im Windows-Zertifikatsspeicher «Vertrauenswürdige Stammzertifizierungsstellen» (Computer) installieren, oder die Adresse von nextDesk in der Firewall von der HTTPS-Entschlüsselung ausnehmen.",
  DEPTH_ZERO_SELF_SIGNED_CERT:
    "Die Gegenstelle zeigt ein selbstsigniertes Zertifikat. Vermutlich antwortet eine Firewall oder ein Proxy statt nextDesk.",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE:
    "Das Zertifikat der Gegenstelle lässt sich nicht prüfen. Vermutlich entschlüsselt eine Firewall die HTTPS-Verbindung.",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY:
    "Die Zertifizierungsstelle der Gegenstelle ist auf diesem Server nicht bekannt. Vermutlich entschlüsselt eine Firewall die HTTPS-Verbindung.",
  CERT_HAS_EXPIRED:
    "Das Zertifikat der Gegenstelle ist abgelaufen (Uhrzeit des Servers prüfen).",
  ENOTFOUND: "Der Name von nextDesk lässt sich nicht auflösen (DNS prüfen).",
  ECONNREFUSED:
    "Die Verbindung wurde abgelehnt (Firewall: ausgehend HTTPS 443 erlauben).",
  ETIMEDOUT: "Keine Antwort (Firewall: ausgehend HTTPS 443 erlauben).",
};

/** A helpful German explanation for a failed connection, or null. */
export function connectionHint(error: unknown): string | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && TLS_HINTS[code]) return TLS_HINTS[code]!;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}
