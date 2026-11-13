import { germanPrtgMessage, shortSensorName } from "./prtg-text.ts";

function equal(actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("PRTG messages become short German texts", () => {
  equal(
    germanPrtgMessage("No response (check: firewalls, routing, SNMP settings, IP addresses, SNMP version, community, passwords, etc) (SNMP-Fehler # -2003)"),
    "Keine Antwort (SNMP)",
  );
  equal(germanPrtgMessage("Request timed out (ICMP-Fehler # 11010)"), "Keine Antwort auf Ping (Zeitüberschreitung)");
  equal(germanPrtgMessage("Connection timed out (Socketfehler # 10060)"), "Verbindung: Zeitüberschreitung");
  equal(
    germanPrtgMessage("OK. Certificate Common Name: *.example.ch - Certificate Thumbprint: D850C895"),
    "OK",
  );
  equal(
    germanPrtgMessage("Zeitüberschreitung der Anforderung. Failed to connect to 10.0.1.181 port 443 after 21003 ms: Could not connect to server"),
    "Keine Verbindung zu 10.0.1.181:443 (Zeitüberschreitung nach 21 s)",
  );
  equal(
    germanPrtgMessage("Fehler durch Lookup-Wert 'Unreachable' in Kanal 'Status' (Zeitüberschreitung der Antwort)"),
    "Status: nicht erreichbar",
  );
  equal(
    germanPrtgMessage("24 % (Freier Platz C:) liegt unter dem Grenzwert für Warnungen von 25 % in Freier Platz C:"),
    "Freier Platz C: 24 % (Warnung unter 25 %)",
  );
  equal(
    germanPrtgMessage("10 # (Tage bis zum Ablauf) liegt unter dem Grenzwert für Warnungen von 28 # in Tage bis zum Ablauf. Das Zertifikat wird bald ablaufen. (OK. Certificate Common Name: *.cyon.net)"),
    "Tage bis zum Ablauf: 10 (Warnung unter 28). Das Zertifikat wird bald ablaufen.",
  );
  equal(
    germanPrtgMessage("Die Schnittstelle, die Sie monitoren möchten, ist nicht verbunden: ifOperStatus=down (2) (Code: PE058)"),
    "Schnittstelle nicht verbunden (Link down)",
  );
  equal(germanPrtgMessage("Probe nicht verbunden (Nicht verbunden)"), "Probe nicht verbunden (Nicht verbunden)");
  equal(germanPrtgMessage(null), null);
});

Deno.test("sensor type in brackets is left out", () => {
  equal(shortSensorName("Ping (Ping)"), "Ping");
  equal(shortSensorName("Prozessorlast (Windows CPU-Last)"), "Prozessorlast");
  equal(
    shortSensorName("WMI Laufwerkskapazität (mehrfach) (WMI Freier Speicher (mehrere Datenträger))"),
    "WMI Laufwerkskapazität (mehrfach)",
  );
  equal(shortSensorName("(001) ARUBA_AP165 Traffic (SNMP Datenverkehr)"), "(001) ARUBA_AP165 Traffic");
  equal(shortSensorName("(Ping)"), "(Ping)");
  equal(shortSensorName("HTTPS v2"), "HTTPS v2");
});
