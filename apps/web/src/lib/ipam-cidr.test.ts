import { describe, expect, it } from "vitest";
import serverCopy from "../../../../supabase/functions/_shared/ipam-cidr.ts?raw";
import webCopy from "./ipam-cidr.ts?raw";
import {
  compareCidrText,
  containingPrefix,
  formatCidr,
  nestPrefixes,
  normalizeAddress,
  normalizeCidr,
  parseCidr,
  splitCidr,
} from "./ipam-cidr";

describe("ipam-cidr", () => {
  it("web and edge function copies are identical", () => {
    expect(webCopy).toBe(serverCopy);
  });

  it("normalizes IPv4 and IPv6", () => {
    expect(normalizeCidr("10.20.30.0/24")).toBe("10.20.30.0/24");
    expect(normalizeCidr("10.20.30.1/24")).toBeNull();
    expect(normalizeAddress("FD12:0:0::1")).toBe("fd12::1");
  });

  it("nests, sorts and splits prefixes", () => {
    const items = [
      { id: "b", prefix: "10.20.30.0/24", vrfId: null },
      { id: "a", prefix: "10.20.0.0/16", vrfId: null },
    ];
    expect(nestPrefixes(items).map((entry) => entry.depth)).toEqual([0, 1]);
    expect(containingPrefix(items, "10.20.30.7")?.id).toBe("b");
    expect(["10.20.0.0/16", "10.3.0.0/16"].sort(compareCidrText)).toEqual([
      "10.3.0.0/16",
      "10.20.0.0/16",
    ]);
    expect(splitCidr(parseCidr("10.0.0.0/24")!, 26)?.map(formatCidr)).toEqual([
      "10.0.0.0/26",
      "10.0.0.64/26",
      "10.0.0.128/26",
      "10.0.0.192/26",
    ]);
  });
});
