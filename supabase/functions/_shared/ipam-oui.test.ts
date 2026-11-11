import { assert, assertEquals } from "jsr:@std/assert@1";

import { isLocallyAdministered, lookupVendor, normalizeMac, ouiTableSize, PRIVATE_MAC_LABEL } from "./ipam-oui.ts";

Deno.test("normalizeMac accepts common notations", () => {
  assertEquals(normalizeMac("00-1E-0B-7A-41-C9"), "00:1e:0b:7a:41:c9");
  assertEquals(normalizeMac("001e.0b7a.41c9"), "00:1e:0b:7a:41:c9");
  assertEquals(normalizeMac("001E0B7A41C9"), "00:1e:0b:7a:41:c9");
  assertEquals(normalizeMac("0x001e0b7a41c9"), "00:1e:0b:7a:41:c9");
  assertEquals(normalizeMac("0:1e:b:7a:41:c9"), "00:1e:0b:7a:41:c9");
  assertEquals(normalizeMac("00 1e 0b 7a 41 c9"), "00:1e:0b:7a:41:c9");
});

Deno.test("normalizeMac rejects invalid, broadcast and multicast MACs", () => {
  assertEquals(normalizeMac("zz:1e:0b:7a:41:c9"), null);
  assertEquals(normalizeMac("00:00:00:00:00:00"), null);
  assertEquals(normalizeMac("ff:ff:ff:ff:ff:ff"), null);
  assertEquals(normalizeMac("01:00:5e:00:00:fb"), null);
  assertEquals(normalizeMac("33:33:00:00:00:01"), null);
  assertEquals(normalizeMac(42), null);
});

Deno.test("lookupVendor knows common vendors", () => {
  assertEquals(lookupVendor("00:15:5d:01:02:03"), "Microsoft Hyper-V");
  assertEquals(lookupVendor("00-50-56-aa-bb-cc"), "VMware");
  assertEquals(lookupVendor("F0:9F:C2:11:08:3A"), "Ubiquiti");
  assertEquals(lookupVendor("00:1e:0b:7a:41:c9"), "Hewlett Packard (HP)");
  assertEquals(lookupVendor("00:0b:86:00:00:01"), "HPE Aruba");
  assertEquals(lookupVendor("00:04:13:00:00:01"), "Snom");
  assertEquals(lookupVendor("52:54:00:12:34:56"), "QEMU/KVM (virtuell)");
  assertEquals(lookupVendor("12:34:56:00:00:01"), PRIVATE_MAC_LABEL);
  assertEquals(lookupVendor("a2:00:00:00:00:01"), PRIVATE_MAC_LABEL);
  assertEquals(lookupVendor("00:aa:bb:00:00:01"), null);
  assert(isLocallyAdministered("da:a1:19:00:00:01"));
  assert(!isLocallyAdministered("00:15:5d:00:00:01"));
  assert(ouiTableSize() > 300);
});
