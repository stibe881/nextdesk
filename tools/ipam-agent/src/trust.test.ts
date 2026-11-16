import assert from "node:assert/strict";
import { test } from "node:test";

import { hasScanWork } from "./config.ts";
import { connectionHint, trustSystemCertificates } from "./trust.ts";

test("trustSystemCertificates: ergänzt nur neue Zertifikate, schaltet nichts ab", () => {
  let installed: string[] | null = null;
  const added = trustSystemCertificates({
    getCACertificates: (type) =>
      type === "default" ? ["A", "B"] : ["B", "FIREWALL-CA"],
    setDefaultCACertificates: (certificates) => {
      installed = certificates;
    },
  });
  assert.equal(added, 1);
  assert.deepEqual(installed, ["A", "B", "FIREWALL-CA"]);
});

test("trustSystemCertificates: ohne neue Zertifikate oder ohne Unterstützung passiert nichts", () => {
  let calls = 0;
  assert.equal(
    trustSystemCertificates({
      getCACertificates: () => ["A"],
      setDefaultCACertificates: () => {
        calls += 1;
      },
    }),
    0,
  );
  assert.equal(calls, 0);
  assert.equal(trustSystemCertificates({}), 0);
  assert.equal(
    trustSystemCertificates({
      getCACertificates: () => {
        throw new Error("kein Zugriff");
      },
      setDefaultCACertificates: () => undefined,
    }),
    0,
  );
});

test("connectionHint: erklärt TLS-Fehler hinter einer Firewall", () => {
  const error = new TypeError("fetch failed", {
    cause: Object.assign(
      new Error("self-signed certificate in certificate chain"),
      {
        code: "SELF_SIGNED_CERT_IN_CHAIN",
      },
    ),
  });
  assert.match(
    connectionHint(error) ?? "",
    /Firewall oder ein Proxy entschlüsselt/,
  );
  assert.match(
    connectionHint(Object.assign(new Error("x"), { code: "ENOTFOUND" })) ?? "",
    /DNS/,
  );
  assert.equal(connectionHint(new Error("anderes")), null);
  assert.equal(connectionHint(null), null);
});

test("hasScanWork: eine reine Überwachungs-Sonde scannt nie", () => {
  const local = {
    scan: { subnets: [], reverseDns: true, maxHostsPerRun: 65536 },
    dhcpServers: null,
    dnsServers: null,
  };
  const server = { snmpTargets: [], dhcpServers: [], dnsServers: [] };
  assert.equal(hasScanWork(local, server, []), false);
  assert.equal(hasScanWork(local, server, [{ prefix: "10.0.0.0/24" }]), true);
  assert.equal(
    hasScanWork(
      { ...local, scan: { ...local.scan, subnets: ["10.0.0.0/24"] } },
      server,
      [],
    ),
    true,
  );
  assert.equal(
    hasScanWork(local, { ...server, dnsServers: ["dc1"] }, []),
    true,
  );
  // Eine lokale leere Liste übersteuert die Server aus nextDesk.
  assert.equal(
    hasScanWork(
      { ...local, dnsServers: [] },
      { ...server, dnsServers: ["dc1"] },
      [],
    ),
    false,
  );
});
