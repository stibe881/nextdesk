import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTopology, MACS_PER_PORT } from "./topology.ts";

const iface = (index: number, name: string, up = true) => ({
  index,
  name,
  alias: null,
  up,
  speedMbps: 1000,
});

test("joins interfaces, LLDP and MAC table by port name", () => {
  const result = buildTopology({
    sysName: "asw01",
    interfaces: [iface(1, "1/1/1"), iface(2, "1/1/2", false)],
    lldp: [
      {
        switchName: "asw01",
        localPort: "1/1/1",
        chassisMac: "aa:bb:cc:00:00:01",
        sysName: "dsw01",
        portId: "1/1/24",
        mgmtAddress: "10.0.0.2",
        capabilities: ["bridge"],
      },
    ],
    macTable: [
      { switchName: "asw01", port: "1/1/2", mac: "aa:bb:cc:00:00:09", vlan: 1 },
      {
        switchName: "asw01",
        port: "1/1/2",
        mac: "aa:bb:cc:00:00:09",
        vlan: 20,
      },
    ],
  });
  assert.equal(result.sysName, "asw01");
  assert.deepEqual(result.ports[0]?.lldp, {
    name: "dsw01",
    port: "1/1/24",
    address: "10.0.0.2",
    mac: "aa:bb:cc:00:00:01",
  });
  assert.equal(result.ports[1]?.up, false);
  assert.deepEqual(result.ports[1]?.macs, ["aa:bb:cc:00:00:09"]);
  assert.equal(result.ports[1]?.macCount, 1);
});

test("caps the MAC addresses per port but keeps the count", () => {
  const macTable = Array.from({ length: 30 }, (_, i) => ({
    switchName: "s",
    port: "Trk1",
    mac: `aa:bb:cc:00:01:${i.toString(16).padStart(2, "0")}`,
    vlan: 1,
  }));
  const result = buildTopology({
    sysName: null,
    interfaces: [],
    lldp: [],
    macTable,
  });
  // Port known from the MAC table only: appended without interface data.
  assert.equal(result.ports.length, 1);
  assert.equal(result.ports[0]?.index, null);
  assert.equal(result.ports[0]?.macs.length, MACS_PER_PORT);
  assert.equal(result.ports[0]?.macCount, 30);
});
