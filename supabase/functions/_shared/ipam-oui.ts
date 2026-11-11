/**
 * MAC addresses and vendor lookup (OUI) for the IPAM discovery.
 *
 * A compact, embedded table of OUIs (first three octets) of vendors that are
 * common in Swiss school and SME networks: switches/APs, firewalls, servers,
 * virtualisation, printers, VoIP, cameras, NAS and clients. It is deliberately
 * not the full IEEE list: the on-prem agent may send the vendor itself when it
 * has the full list (`vendor` in an observation), which takes precedence.
 */

const VENDORS: Record<string, string[]> = {
  "HPE Aruba": [
    "000b86", "001a1e", "00246c", "04bd88", "186472", "204c03", "24dec6",
    "40e3d6", "6cf37f", "703a0e", "84d47e", "94b40f", "9c1c12", "aca31e",
    "b45d50", "d8c7c8", "f05c19", "883a30", "9460d5",
  ],
  "Hewlett Packard Enterprise": [
"548028", "ec9b8b", "1402ec", "9cdc71"],
  "Hewlett Packard (HP)": [
    "001e0b", "3cd92b", "0017a4", "00215a", "00237d", "002481", "0025b3",
    "10604b", "2c4138", "2c44fd", "3863bb", "3ca82a", "645106", "6c3be5",
    "705a0f", "80c16e", "9457a5", "98e7f4", "a0d3c1", "b499ba", "d4c9ef",
    "ecb1d7", "f4ce46", "fc15b4", "000883", "000d9d", "000e7f", "001083",
    "00110a", "001185", "001279", "001321", "001438", "001560", "001635",
    "001708", "001871", "0019bb", "001a4b", "001b78", "001cc4", "001f29",
    "002264", "002347", "0024a8", "002561", "002655", "00306e", "0060b0",
    "080009", "3c5282", "a08cfd", "b05ada", "308d99",
  ],
  Cisco: [
    "00000c", "000142", "000143", "000163", "000164", "000196", "000197",
    "0001c7", "0001c9", "000216", "000217", "00024a", "00024b", "00027d",
    "00027e", "001b54", "00260b", "0021a0", "0022bd", "00239c", "002414",
    "0025b5", "002699", "00270d", "1ce85d", "286f7f", "4c4e35", "5057a8",
    "588d09", "68bdab", "6c416a", "70e422", "7c95f3", "881dfc", "a89d21",
    "b0aa77", "c08c60", "d0c282", "e4c722", "f866f2", "f4cfe2",
  ],
  "Cisco Meraki": ["00180a", "e0553d", "ac17c8"],
  Juniper: ["000585", "0010db", "0019e2", "002159", "28c0da", "3c6104", "ec3ef7"],
  Dell: [
    "001422", "00065b", "000874", "000bdb", "000d56", "000f1f", "001143",
    "00123f", "001372", "0015c5", "00188b", "0019b9", "001aa0", "001c23",
    "001d09", "001e4f", "002170", "002219", "0023ae", "0024e8", "002564",
    "0026b9", "14feb5", "180373", "18a99b", "18dbf2", "24b6fd", "3417eb",
    "5c260a", "782bcb", "842b2b", "90b11c", "b82a72", "b8ca3a", "bc305b",
    "d4ae52", "d4bed9", "f04da2", "f8b156", "f8bc12", "f8db88", "989096",
    "a4badb", "549f35", "e4434b", "ecf4bb", "b083fe", "c81f66",
  ],
  Lenovo: ["005907", "54e1ad", "98fa9b", "507b9d", "8c8caa", "f875a4"],
  "Microsoft Hyper-V": ["00155d"],
  Microsoft: ["281878", "7c1e52", "c0335e", "0003ff", "0050f2", "985fd3"],
  VMware: ["005056", "000c29", "000569", "001c14"],
  "Oracle VirtualBox": ["080027"],
  "Xen (virtuell)": ["00163e"],
  "QEMU/KVM (virtuell)": ["525400"],
  Ubiquiti: [
    "00156d", "002722", "0418d6", "24a43c", "44d9e7", "687251", "788a20",
    "802aa8", "b4fbe4", "dc9fdb", "f09fc2", "fcecda", "7483c2", "e063da",
    "18e829", "245a4c", "602232", "70a741", "784558", "ac8ba9", "d021f9",
    "e43883", "f492bf", "68d79a",
  ],
  Sophos: ["001a8c", "7c5a1c", "c84f86"],
  Fortinet: ["00090f", "085b0e", "704ca5", "906cac", "e81cba", "e023ff", "94ff3c"],
  "Palo Alto Networks": ["001b17", "b40c25", "d41d71", "e4a749"],
  Apple: [
    "000393", "000a27", "000a95", "000d93", "0010fa", "001124", "001451",
    "0016cb", "0017f2", "0019e3", "001b63", "001cb3", "001d4f", "001e52",
    "001ec2", "001f5b", "001ff3", "0021e9", "002241", "002312", "002332",
    "00236c", "0023df", "002436", "002500", "00254b", "0025bc", "002608",
    "00264a", "0026b0", "0026bb", "3c0754", "406c8f", "70cd60", "a45e60",
    "acbc32", "f01898", "f45c89", "8c8590", "28cfe9", "3c15c2", "60fb42",
    "784f43", "88665a", "907240", "a860b6", "bc52b7", "d0817a", "f0b479",
  ],
  Samsung: [
    "0000f0", "000278", "0007ab", "001247", "0012fb", "001377", "001599",
    "001632", "00166b", "00166c", "0017c9", "0017d5", "0018af", "001a8a",
    "001b98", "001c43", "001d25", "001e7d", "001fcc", "002119", "00214c",
    "002339", "002399", "002454", "002490", "0024e9", "002566", "002637",
  ],
  Intel: [
    "0002b3", "000347", "000423", "0007e9", "000cf1", "000e0c", "000e35",
    "001111", "0012f0", "001302", "001320", "0013ce", "0013e8", "001500",
    "001517", "00166f", "001676", "0016ea", "0016eb", "0018de", "0019d1",
    "0019d2", "001b21", "001b77", "001cbf", "001cc0", "001de0", "001de1",
    "001e64", "001e65", "001e67", "001f3b", "001f3c", "00215c", "00215d",
    "00216a", "00216b", "0022fa", "0022fb", "0024d6", "0024d7", "0026c6",
    "0026c7", "002710", "3c970e", "3ca9f4", "4851b7", "5c514f", "606720",
    "648099", "6805ca", "7c7a91", "8086f2", "8ca982", "a0369f", "a44e31",
    "b49691", "f81654",
  ],
  Realtek: ["00e04c"],
  Yealink: ["805ec0", "001565", "249ad8", "44dbd2", "805e0c"],
  Snom: ["000413"],
  "Polycom (HP Poly)": ["0004f2", "64167f", "00e0db"],
  "Axis Communications": ["00408c", "accc8e", "b8a44f", "e82725"],
  Synology: ["001132", "9009d0"],
  QNAP: ["00089b", "245ebe"],
  Siemens: ["000e8c", "001b1b", "001c06", "080006", "0001e3", "286336"],
  Brother: ["008077", "001ba9", "30055c"],
  Kyocera: ["00c0ee", "0017c8"],
  Canon: ["000085", "001e8f", "180cac"],
  Ricoh: ["000074", "002673"],
  "Konica Minolta": ["00206b"],
  Xerox: ["0000aa", "080037"],
  Lexmark: ["000400", "002000"],
  Epson: ["0026ab", "64eb8c"],
  "Raspberry Pi": ["b827eb", "dca632", "e45f01", "28cdc1", "d83add", "2ccf67"],
};

const OUI_TABLE: Map<string, string> = (() => {
  const table = new Map<string, string>();
  for (const [vendor, prefixes] of Object.entries(VENDORS)) {
    for (const prefix of prefixes) {
      if (!table.has(prefix)) table.set(prefix, vendor);
    }
  }
  return table;
})();

/** Label for randomised (locally administered) MACs, e.g. phones' private Wi-Fi addresses. */
export const PRIVATE_MAC_LABEL = "Private MAC (zufällig)";

/**
 * Normalises «00-1E-0B-7A-41-C9», «001e.0b7a.41c9», «001E0B7A41C9»,
 * «0x001e0b7a41c9» or «0:1e:b:7a:41:c9» to «00:1e:0b:7a:41:c9».
 * Returns null for anything else, all-zero and broadcast/multicast MACs.
 */
export function normalizeMac(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let text = value.trim().toLowerCase();
  if (!text || text.length > 40) return null;
  if (text.startsWith("0x")) text = text.slice(2);
  let hex: string;
  if (/^[0-9a-f]{1,2}([:-][0-9a-f]{1,2}){5}$/.test(text)) {
    hex = text.split(/[:-]/).map((part) => part.padStart(2, "0")).join("");
  } else if (/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/.test(text)) {
    hex = text.replaceAll(".", "");
  } else if (/^[0-9a-f]{12}$/.test(text)) {
    hex = text;
  } else if (/^([0-9a-f]{2} ){5}[0-9a-f]{2}$/.test(text)) {
    hex = text.replaceAll(" ", "");
  } else {
    return null;
  }
  if (hex === "000000000000" || hex === "ffffffffffff") return null;
  // Multicast (I/G bit), e.g. 01:00:5e:… (IPv4 multicast) or 33:33:… (IPv6).
  if (parseInt(hex.slice(0, 2), 16) & 1) return null;
  return hex.match(/../g)!.join(":");
}

/** True for locally administered (randomised) MACs. */
export function isLocallyAdministered(mac: string): boolean {
  const normalized = normalizeMac(mac);
  return normalized !== null && (parseInt(normalized.slice(0, 2), 16) & 2) === 2;
}

/** Vendor for a MAC from the embedded table, or null if unknown. */
export function lookupVendor(mac: unknown): string | null {
  const normalized = normalizeMac(mac);
  if (!normalized) return null;
  if (isLocallyAdministered(normalized)) {
    // VM MACs such as 52:54:00 (QEMU) are locally administered as well.
    return OUI_TABLE.get(normalized.slice(0, 8).replaceAll(":", "")) ?? PRIVATE_MAC_LABEL;
  }
  return OUI_TABLE.get(normalized.slice(0, 8).replaceAll(":", "")) ?? null;
}

/** Number of OUIs in the embedded table (for tests and the UI hint). */
export function ouiTableSize(): number {
  return OUI_TABLE.size;
}
