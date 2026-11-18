// PRTG-Meldungen kurz und auf Deutsch: PRTG liefert je nach Sensor englische
// Texte, Fehlercodes und Prüflisten («check: firewalls, …»). Reine Funktionen.

/** English lookup values of PRTG channels. */
const LOOKUP_VALUES: Record<string, string> = {
  "unreachable": "nicht erreichbar",
  "no secure protocol available": "kein sicheres Protokoll verfügbar",
  "down": "ausgefallen",
  "up": "verfügbar",
  "warning": "Warnung",
  "error": "Fehler",
  "critical": "kritisch",
  "offline": "offline",
  "online": "online",
  "not connected": "nicht verbunden",
  "disconnected": "getrennt",
  "failed": "fehlgeschlagen",
  "degraded": "beeinträchtigt",
  "unknown": "unbekannt",
};

/** Known English messages (start of the text) and their German short form. */
const PHRASES: [RegExp, string | ((match: RegExpMatchArray) => string)][] = [
  [/^no response\b/i, "Keine Antwort (SNMP)"],
  [/^request timed out\b/i, "Keine Antwort auf Ping (Zeitüberschreitung)"],
  [/^connection timed out\b/i, "Verbindung: Zeitüberschreitung"],
  [/^connection refused\b/i, "Verbindung abgelehnt"],
  [/^(no such host is known|host not found|could not resolve host)\b/i, "Host nicht gefunden"],
  [/^destination host unreachable\b/i, "Ziel nicht erreichbar"],
  [/^(the )?sensor is down\b/i, "Sensor ausgefallen"],
  [/^probe (is )?disconnected\b/i, "Probe nicht verbunden"],
  [/^access denied\b/i, "Zugriff verweigert"],
  [/^(the )?operation timed out\b/i, "Zeitüberschreitung"],
  [/^Zeitüberschreitungsfehler: Der Sensor konnte nicht mit dem Zielsystem kommunizieren/i,
    "Zeitüberschreitung: keine Verbindung zum Zielsystem (SNMP)"],
  [/^Die Schnittstelle, die Sie monitoren möchten, ist nicht verbunden/i,
    "Schnittstelle nicht verbunden (Link down)"],
  [/^Die Laufzeit wurde von '.*' empfangen\.?$/i, "Laufzeit empfangen"],
  [/failed to connect to (\S+) port (\d+) after (\d+) ?ms/i, (match) =>
    `Keine Verbindung zu ${match[1]}:${match[2]} (Zeitüberschreitung nach ${Math.round(Number(match[3]) / 1000)} s)`],
  [/^Fehler durch Lookup-Wert '([^']+)' in Kanal '([^']+)'/i, (match) =>
    `${match[2]}: ${LOOKUP_VALUES[match[1]!.toLowerCase()] ?? match[1]}`],
  // «24 % (Freier Platz C:) liegt unter dem Grenzwert für Warnungen von 25 % in …»
  [/^(.+?) \((.+?)\) liegt (unter|über) dem Grenzwert für (Warnungen|Fehler) von (.+?) in .+?(?:\. (.*))?$/i,
    (match) => {
      const value = match[1]!.replace(/\s*#\s*/g, " ").trim();
      const limit = match[5]!.replace(/\s*#\s*/g, " ").trim();
      const channel = match[2]!;
      const kind = match[4]!.toLowerCase() === "fehler" ? "Fehler" : "Warnung";
      const note = (match[6] ?? "").replace(/\s*\(OK\..*$/i, "").trim();
      return `${channel.replace(/:$/, "")}: ${value} (${kind} ${match[3] === "unter" ? "unter" : "über"} ${limit})${note ? `. ${note}` : ""}`;
    }],
];

/** Short German form of a PRTG message; unknown texts are only cleaned. */
export function germanPrtgMessage(message: string | null): string | null {
  if (!message) return message;
  const text = message.replace(/\s+/g, " ").trim();
  if (!text) return null;
  // «OK. Certificate Common Name: … - Certificate Thumbprint: …»: just OK.
  if (/^OK\b/i.test(text)) return "OK";
  for (const [pattern, replacement] of PHRASES) {
    const match = text.match(pattern);
    if (match) {
      return typeof replacement === "string" ? replacement : replacement(match);
    }
  }
  const cleaned = text
    // Checklists and error codes add nothing for the team.
    .replace(/\s*\(check:[^)]*\)/gi, "")
    .replace(/\s*\((?:[A-Za-zÄÖÜäöü-]+-?Fehler|Socketfehler) # ?-?\d+\)/g, "")
    .replace(/\s*\(Code: [A-Z0-9]+\)/g, "")
    .replace(/\s*Bitte überprüfen Sie[^.]*\.?/g, "")
    .trim();
  return cleaned || text;
}

/**
 * Sensor name without the sensor type PRTG appends in brackets
 * («Ping (Ping)», «Prozessorlast (Windows CPU-Last)»).
 */
export function shortSensorName(sensor: string | null): string | null {
  if (!sensor) return sensor;
  const text = sensor.trim();
  if (!text.endsWith(")")) return text;
  // Find the opening bracket of the last (balanced) group.
  let depth = 0;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (char === ")") depth += 1;
    if (char === "(") depth -= 1;
    if (depth === 0) {
      const head = text.slice(0, index).trim();
      return head.length >= 2 ? head : text;
    }
  }
  return text;
}
