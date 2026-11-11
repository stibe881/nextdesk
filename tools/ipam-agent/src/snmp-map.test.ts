import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decodeCapabilities,
  fdbPortName,
  lldpPortName,
  mapBasePorts,
  mapBridgeFdb,
  mapIfNames,
  mapIpNetToMedia,
  mapIpNetToPhysical,
  mapLldpLocalPorts,
  mapLldpRemote,
  mapQBridgeFdb,
  OID,
} from "./snmp-map.ts";

const mac = (text: string) => Buffer.from(text.replaceAll(":", ""), "hex");
const str = (text: string) => Buffer.from(text, "utf8");

test("ARP via ipNetToMediaPhysAddress", () => {
  const entries = mapIpNetToMedia([
    {
      oid: `${OID.ipNetToMediaPhysAddress}.12.10.20.30.21`,
      value: mac("00:1e:0b:7a:41:c9"),
    },
    {
      oid: `.${OID.ipNetToMediaPhysAddress}.12.10.20.30.255`,
      value: mac("ff:ff:ff:ff:ff:ff"),
    },
    {
      oid: `${OID.ipNetToMediaPhysAddress}.12.169.254.1.1`,
      value: mac("00:1e:0b:7a:41:ca"),
    },
    {
      oid: "1.3.6.1.2.1.4.22.1.3.12.10.20.30.21",
      value: mac("00:1e:0b:7a:41:c9"),
    },
  ]);
  assert.deepEqual(entries, [
    { ifIndex: 12, address: "10.20.30.21", mac: "00:1e:0b:7a:41:c9" },
  ]);
});

test("ARP/NDP via ipNetToPhysicalPhysAddress (IPv4 and IPv6)", () => {
  const v6 = [0xfd, 0x12, 0x34, 0x56, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x21];
  const entries = mapIpNetToPhysical([
    {
      oid: `${OID.ipNetToPhysicalPhysAddress}.12.1.4.10.20.30.22`,
      value: mac("f0:9f:c2:11:08:3a"),
    },
    {
      oid: `${OID.ipNetToPhysicalPhysAddress}.12.2.16.${v6.join(".")}`,
      value: mac("00:1e:0b:7a:41:c9"),
    },
    {
      oid: `${OID.ipNetToPhysicalPhysAddress}.12.2.16.254.128.0.0.0.0.0.0.0.0.0.0.0.0.0.1`,
      value: mac("00:1e:0b:7a:41:c9"),
    },
    {
      oid: `${OID.ipNetToPhysicalPhysAddress}.12.1.4.10.20`,
      value: mac("00:1e:0b:7a:41:c9"),
    },
  ]);
  assert.deepEqual(entries, [
    { ifIndex: 12, address: "10.20.30.22", mac: "f0:9f:c2:11:08:3a" },
    { ifIndex: 12, address: "fd12:3456::21", mac: "00:1e:0b:7a:41:c9" },
  ]);
});

test("MAC table via Q-BRIDGE (status self skipped) and BRIDGE-MIB", () => {
  const macIndex = "0.30.11.122.65.201"; // 00:1e:0b:7a:41:c9
  const fdb = mapQBridgeFdb(
    [
      { oid: `${OID.dot1qTpFdbPort}.30.${macIndex}`, value: 14 },
      { oid: `${OID.dot1qTpFdbPort}.30.136.58.48.0.0.1`, value: 0 },
      { oid: `${OID.dot1qTpFdbPort}.1.136.58.48.0.0.2`, value: 49 },
    ],
    [
      { oid: `${OID.dot1qTpFdbStatus}.30.${macIndex}`, value: 3 },
      { oid: `${OID.dot1qTpFdbStatus}.1.136.58.48.0.0.2`, value: 4 },
    ],
  );
  assert.deepEqual(fdb, [{ mac: "00:1e:0b:7a:41:c9", basePort: 14, vlan: 30 }]);
  assert.deepEqual(
    mapBridgeFdb([{ oid: `${OID.dot1dTpFdbPort}.${macIndex}`, value: 7 }]),
    [{ mac: "00:1e:0b:7a:41:c9", basePort: 7, vlan: null }],
  );

  const ifNames = mapIfNames([
    { oid: `${OID.ifName}.1014`, value: str("1/1/14") },
    { oid: `${OID.ifName}.24`, value: str("A24") },
  ]);
  const basePorts = mapBasePorts([
    { oid: `${OID.dot1dBasePortIfIndex}.14`, value: 1014 },
  ]);
  assert.equal(fdbPortName(14, basePorts, ifNames), "1/1/14");
  // ProCurve: bridge port = ifIndex.
  assert.equal(fdbPortName(24, new Map(), ifNames), "A24");
  assert.equal(fdbPortName(99, new Map(), ifNames), "99");
});

test("LLDP neighbours with capabilities and management address", () => {
  const row = (column: number) => `${OID.lldpRemTable}.${column}.0.22.1`;
  const neighbors = mapLldpRemote(
    [
      { oid: row(4), value: 4 },
      { oid: row(5), value: mac("20:4c:03:00:00:01") },
      { oid: row(6), value: 5 },
      { oid: row(7), value: str("eth0") },
      { oid: row(9), value: str("AP-A2-02") },
      { oid: row(12), value: Buffer.from([0x30, 0x00]) }, // bridge + wlanAccessPoint
      { oid: `${OID.lldpRemTable}.4.0.49.2`, value: 7 },
      { oid: `${OID.lldpRemTable}.9.0.49.2`, value: str("SOBE-BAAR-CSW01") },
      {
        oid: `${OID.lldpRemTable}.12.0.49.2`,
        value: Buffer.from([0x28, 0x00]),
      }, // bridge + router
    ],
    [{ oid: `${OID.lldpRemManAddrTable}.3.0.22.1.1.4.10.20.30.22`, value: 2 }],
  );
  assert.deepEqual(neighbors, [
    {
      localPortNum: 22,
      chassisMac: "20:4c:03:00:00:01",
      sysName: "AP-A2-02",
      portId: "eth0",
      mgmtAddress: "10.20.30.22",
      capabilities: ["bridge", "wlanAccessPoint"],
    },
    {
      localPortNum: 49,
      chassisMac: null,
      sysName: "SOBE-BAAR-CSW01",
      portId: null,
      mgmtAddress: null,
      capabilities: ["bridge", "router"],
    },
  ]);
  assert.deepEqual(decodeCapabilities(Buffer.from([0x04, 0x00])), [
    "telephone",
  ]);
  assert.deepEqual(decodeCapabilities(Buffer.from([0x01])), ["station"]);

  const ifNames = new Map([
    [1022, "1/1/22"],
    [22, "22"],
  ]);
  const local = mapLldpLocalPorts([
    { oid: `${OID.lldpLocPortTable}.3.22`, value: str("1/1/22") },
    { oid: `${OID.lldpLocPortTable}.4.22`, value: str("Access A2") },
  ]);
  assert.equal(lldpPortName(22, local, ifNames), "1/1/22");
  assert.equal(lldpPortName(23, local, new Map([[23, "A23"]])), "A23");
  assert.equal(lldpPortName(5, new Map(), new Map()), "5");
});
