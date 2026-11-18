import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { answerText, parseQuestion, portMatches } from "./assistant.ts";

Deno.test("free address questions with VLAN number, name and site", () => {
  assertEquals(parseQuestion("freie IP im VLAN 67 in Baar?"), {
    kind: "freeAddress",
    vlan: 67,
    vlanName: null,
    site: "Baar",
  });
  assertEquals(
    parseQuestion("Gib mir eine freie IP im Drucker-VLAN in Haus A"),
    {
      kind: "freeAddress",
      vlan: null,
      vlanName: "Drucker",
      site: "Haus A",
    },
  );
  assertEquals(parseQuestion("Nächste freie Adresse im VLAN 4095"), {
    kind: "freeAddress",
    vlan: null,
    vlanName: null,
    site: null,
  });
});

Deno.test("switch port, host, address and MAC questions", () => {
  assertEquals(parseQuestion("Was hängt an SW-A2-01 Port 14?"), {
    kind: "switchPort",
    switchName: "SW-A2-01",
    port: "14",
  });
  assertEquals(parseQuestion("Was hängt an sw-a2-01 Gi1/0/22?"), {
    kind: "switchPort",
    switchName: "SW-A2-01",
    port: "Gi1/0/22",
  });
  assertEquals(parseQuestion("Welche IP hat DRU-A2-KOPIE?"), {
    kind: "host",
    name: "DRU-A2-KOPIE",
  });
  assertEquals(parseQuestion("Welche IP hat Kopierer3?"), {
    kind: "host",
    name: "Kopierer3",
  });
  assertEquals(parseQuestion("Wem gehört 10.20.30.22?"), {
    kind: "address",
    address: "10.20.30.22",
  });
  assertEquals(parseQuestion("Wer hat F0:9F:C2:11:08:3A?"), {
    kind: "mac",
    mac: "f0:9f:c2:11:08:3a",
  });
});

Deno.test("nearly full subnets and unknown questions", () => {
  assertEquals(parseQuestion("Welche Subnetze sind fast voll?"), {
    kind: "fullPrefixes",
    threshold: null,
  });
  assertEquals(parseQuestion("Welche Netze sind über 90 % ausgelastet?"), {
    kind: "fullPrefixes",
    threshold: 90,
  });
  assertEquals(parseQuestion("Wie ist das Wetter?"), { kind: "unknown" });
  assertEquals(parseQuestion("   "), { kind: "unknown" });
});

Deno.test("port matching tolerates interface names", () => {
  assertEquals(portMatches("Gi1/0/14", "14"), true);
  assertEquals(portMatches("Port 14", "14"), true);
  assertEquals(portMatches("Gi1/0/14", "Gi1/0/14"), true);
  assertEquals(portMatches("GigabitEthernet1/0/14", "gi1/0/14"), true);
  assertEquals(portMatches("Gi1/0/41", "14"), false);
  assertEquals(portMatches("Te1/0/14", "Gi1/0/14"), false);
  assertEquals(portMatches(null, "14"), false);
});

Deno.test("answers only repeat found data", () => {
  assertStringIncludes(
    answerText(
      { kind: "freeAddress", vlan: 67, vlanName: null, site: "Baar" },
      {
        free: [
          {
            address: "10.20.67.12",
            prefix: "10.20.67.0/24",
            vlan: { number: 67 },
            site: { name: "Baar" },
          },
        ],
      },
    ),
    "Frei ist 10.20.67.12 im Subnetz 10.20.67.0/24 (VLAN 67) in Baar.",
  );
  assertStringIncludes(
    answerText({ kind: "host", name: "PC-1" }, { addresses: [], prefixes: [] }),
    "nichts dokumentiert",
  );
  assertStringIncludes(
    answerText(
      { kind: "switchPort", switchName: "SW-1", port: "14" },
      {
        addresses: [
          {
            address: "10.0.0.5",
            hostname: "AP-1",
            switch_name: "SW-1",
            switch_port: "Gi1/0/14",
            status: "active",
          },
        ],
      },
    ),
    "10.0.0.5 · (AP-1) · an SW-1 Gi1/0/14",
  );
});
