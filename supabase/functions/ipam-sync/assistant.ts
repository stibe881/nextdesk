// IPAM-Fragen für den KI-Assistenten (MCP-Connector) und die Web-App.
// Die Frage wird deterministisch einer Abfrage zugeordnet; die Antwort
// stammt immer aus der Datenbank, nie aus einem Sprachmodell.

import { detectNetworkCandidates } from "../_shared/ipam-ticket-detect.ts";

export type AssistantIntent =
  | {
      kind: "freeAddress";
      vlan: number | null;
      vlanName: string | null;
      site: string | null;
    }
  | { kind: "switchPort"; switchName: string; port: string }
  | { kind: "address"; address: string }
  | { kind: "mac"; mac: string }
  | { kind: "host"; name: string }
  | { kind: "fullPrefixes"; threshold: number | null }
  | { kind: "unknown" };

const FULL =
  /(fast|bald|beinahe|nahezu|zu)\s+voll|ausgelastet|auslastung|knapp\s+(an|bei)|voll\b/i;
const NETWORK_WORD = /subnetz|subnet|netz|prefix|präfix|bereich|vlan/i;
const FREE =
  /(frei|nächste|naechste|verfügbar|verfuegbar|neue|reservier)\w*\s+(ip|adresse|ip-adresse)|\bip\b.*\bfrei\b|gib\s+mir\s+(eine\s+)?ip/i;
const PORT =
  /\b(?:port|anschluss|interface|schnittstelle)\s*[:#]?\s*([a-z]{0,12}\s?\d+(?:\/\d+){0,3})/i;
const INTERFACE =
  /\b((?:gi|ge|fa|te|tw|eth|xe|et)[a-z]*\s?\d+(?:\/\d+){1,3})\b/i;

/** Bereinigt Text für Suchen (keine Filter-Sonderzeichen). */
export function searchText(value: unknown, max = 60): string {
  return typeof value === "string"
    ? value
        .replace(/[,()*%_\\"'`;]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";
}

function siteFrom(question: string): string | null {
  // «… in Baar», «… in Haus A», «am Standort Zug»
  const matches = [
    ...question.matchAll(
      /\b(?:in|im\s+haus|am\s+standort|standort|bei)\s+((?:haus\s+)?[A-Za-zÄÖÜäöüé0-9][\wÄÖÜäöüé.-]*(?:\s+[A-Z0-9][\w.-]{0,10})?)/g,
    ),
  ];
  for (const match of matches.reverse()) {
    const value = match[1]!.trim().replace(/[?.!,]+$/, "");
    if (/^(der|dem|den|die|das|vlan|subnetz|netz)$/i.test(value)) continue;
    if (/^vlan\b/i.test(value)) continue;
    return searchText(value, 60) || null;
  }
  return null;
}

export function parseQuestion(raw: string): AssistantIntent {
  const question = raw.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!question) return { kind: "unknown" };

  if (FULL.test(question) && NETWORK_WORD.test(question)) {
    const threshold = question.match(/(\d{2,3})\s*(?:%|prozent)/i);
    const value = threshold ? Number(threshold[1]) : null;
    return {
      kind: "fullPrefixes",
      threshold: value !== null && value >= 1 && value <= 100 ? value : null,
    };
  }

  if (FREE.test(question)) {
    const vlanNumber = question.match(
      /\bvlan\s*(?:nr\.?|nummer)?\s*(\d{1,4})\b/i,
    );
    const vlanName =
      question.match(/\b([A-Za-zÄÖÜäöü]{2,30})-vlan\b/i) ??
      question.match(/\bvlan\s+(?:für|fuer|der|des)\s+([A-Za-zÄÖÜäöü]{2,30})/i);
    const number = vlanNumber ? Number(vlanNumber[1]) : null;
    return {
      kind: "freeAddress",
      vlan: number !== null && number >= 1 && number <= 4094 ? number : null,
      vlanName: vlanName ? searchText(vlanName[1], 30) : null,
      site: siteFrom(question),
    };
  }

  const candidates = detectNetworkCandidates([question]);
  const port =
    question.match(PORT)?.[1] ?? question.match(INTERFACE)?.[1] ?? null;
  if (port) {
    const switchName =
      candidates.hostnames[0] ??
      question.match(
        /\b(?:an|auf|bei|switch)\s+([A-Za-z][\w.-]*\d[\w.-]*)/i,
      )?.[1] ??
      null;
    if (switchName) {
      return {
        kind: "switchPort",
        switchName: switchName.toUpperCase(),
        port: port.replace(/\s+/g, ""),
      };
    }
  }

  const address = candidates.ipv4[0] ?? candidates.ipv6[0];
  if (address) return { kind: "address", address };
  if (candidates.macs[0]) return { kind: "mac", mac: candidates.macs[0] };
  if (candidates.hostnames[0])
    return { kind: "host", name: candidates.hostnames[0] };
  const named = question.match(
    /\b(?:ip|adresse|ip-adresse)\s+(?:hat|von|für|fuer|des|der)\s+(?:gerät\s+|geraet\s+)?([A-Za-z0-9][\w.-]{1,62})/i,
  );
  if (named) return { kind: "host", name: named[1]!.replace(/[?.!,]+$/, "") };
  return { kind: "unknown" };
}

/**
 * Passt ein gespeicherter Switch-Port zur Anfrage? «14» passt zu «14»,
 * «Gi1/0/14», «1/0/14» und «Port 14»; «Gi1/0/14» passt zu «GigabitEthernet1/0/14».
 */
export function portMatches(stored: unknown, requested: string): boolean {
  if (typeof stored !== "string" || !stored.trim()) return false;
  const normalize = (value: string) =>
    value.toLowerCase().replace(/\s+/g, "").replace(/^port/, "");
  const left = normalize(stored);
  const right = normalize(requested);
  if (!right) return false;
  if (left === right) return true;
  if (/^\d+$/.test(right)) {
    const last = left.match(/(\d+)$/)?.[1];
    return last !== undefined && Number(last) === Number(right);
  }
  const numbers = (value: string) => value.replace(/^[a-z]+/, "");
  const leftLetters = left.match(/^[a-z]+/)?.[0] ?? "";
  const rightLetters = right.match(/^[a-z]+/)?.[0] ?? "";
  return (
    numbers(left) === numbers(right) &&
    (!leftLetters ||
      !rightLetters ||
      leftLetters.startsWith(rightLetters) ||
      rightLetters.startsWith(leftLetters))
  );
}

type Address = Record<string, unknown>;

function describeAddress(entry: Address): string {
  const parts = [String(entry.address ?? "")];
  if (entry.hostname) parts.push(`(${entry.hostname})`);
  const vlan = entry.vlan as { number?: unknown; name?: unknown } | null;
  if (vlan?.number)
    parts.push(`VLAN ${vlan.number}${vlan.name ? ` ${vlan.name}` : ""}`);
  if (entry.switch_name) {
    parts.push(
      `an ${entry.switch_name}${entry.switch_port ? ` ${entry.switch_port}` : ""}`,
    );
  }
  if (entry.status) parts.push(`Status ${entry.status}`);
  return parts.join(" · ");
}

/** Kurze deutsche Antwort aus den gefundenen Daten (ohne Erfundenes). */
export function answerText(
  intent: AssistantIntent,
  results: Record<string, unknown>,
): string {
  const list = (key: string) =>
    Array.isArray(results[key]) ? (results[key] as Address[]) : [];
  switch (intent.kind) {
    case "freeAddress": {
      const free = list("free");
      if (!free.length) {
        return "Ich habe kein passendes Subnetz mit freier Adresse gefunden. Bitte VLAN-Nummer oder Standort prüfen.";
      }
      const first = free[0]!;
      return (
        `Frei ist ${first.address} im Subnetz ${first.prefix}` +
        `${(first.vlan as Address | null)?.number ? ` (VLAN ${(first.vlan as Address).number})` : ""}` +
        `${(first.site as Address | null)?.name ? ` in ${(first.site as Address).name}` : ""}. ` +
        "Die Adresse ist noch nicht reserviert; die Reservierung braucht eine Bestätigung."
      );
    }
    case "switchPort": {
      const found = list("addresses");
      return found.length
        ? `An ${intent.switchName} Port ${intent.port}: ${found.map(describeAddress).join("; ")}.`
        : `Für ${intent.switchName} Port ${intent.port} ist im IPAM nichts dokumentiert.`;
    }
    case "address":
    case "mac":
    case "host": {
      const found = list("addresses");
      const label =
        intent.kind === "address"
          ? intent.address
          : intent.kind === "mac"
            ? intent.mac
            : intent.name;
      if (found.length)
        return `${label}: ${found.map(describeAddress).join("; ")}.`;
      const prefixes = list("prefixes");
      if (prefixes.length) {
        return `${label} ist nicht dokumentiert, liegt aber im Subnetz ${prefixes.map((entry) => entry.prefix).join(", ")}.`;
      }
      return `Zu ${label} ist im IPAM nichts dokumentiert.`;
    }
    case "fullPrefixes": {
      const full = list("prefixes");
      return full.length
        ? `Fast voll: ${full
            .slice(0, 10)
            .map((entry) => `${entry.prefix} (${entry.percent} %)`)
            .join(", ")}.`
        : "Kein Subnetz liegt über der Warnschwelle.";
    }
    default:
      return "Diese Frage kann ich nicht zuordnen. Beispiele: «Freie IP im VLAN 67 in Baar?», «Was hängt an SW-A2-01 Port 14?», «Welche IP hat DRU-A2-KOPIE?», «Welche Subnetze sind fast voll?»";
  }
}
