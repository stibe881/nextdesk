import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  addressOut,
  apiPath,
  extractApiKey,
  isCidr,
  isIpAddress,
  matchRoute,
  paginationOut,
  parseAddressPatch,
  parseNextPrefixBody,
  parsePagination,
  parseReserveBody,
  parseVrf,
  prefixOut,
  requiredScope,
  reserveError,
} from "./logic.ts";

const PREFIX = "4f1c2b3a-1111-4222-8333-444455556666";

Deno.test("routes map paths and methods", () => {
  assertEquals(apiPath("/functions/v1/ipam-api/prefixes/"), "/prefixes");
  assertEquals(apiPath("/ipam-api"), "/");
  assertEquals(matchRoute("GET", "/ipam-api/prefixes"), {
    route: { name: "listPrefixes" },
  });
  assertEquals(matchRoute("GET", `/ipam-api/prefixes/${PREFIX}/addresses`), {
    route: { name: "prefixAddresses", prefixId: PREFIX },
  });
  assertEquals(
    matchRoute("POST", `/ipam-api/prefixes/${PREFIX}/next-address`),
    {
      route: { name: "nextAddress", prefixId: PREFIX },
    },
  );
  assertEquals(matchRoute("GET", `/ipam-api/prefixes/${PREFIX}/next-address`), {
    status: 405,
    allow: "POST",
  });
  assertEquals(matchRoute("POST", `/ipam-api/prefixes/${PREFIX}/next-prefix`), {
    route: { name: "nextPrefix", prefixId: PREFIX },
  });
  assertEquals(matchRoute("DELETE", "/ipam-api/addresses/10.20.30.22"), {
    route: { name: "releaseAddress", address: "10.20.30.22" },
  });
  assertEquals(matchRoute("PATCH", "/ipam-api/addresses/2001%3Adb8%3A%3A5"), {
    route: { name: "updateAddress", address: "2001:db8::5" },
  });
  assertEquals(matchRoute("GET", "/ipam-api/addresses/kein-host"), {
    status: 404,
  });
  assertEquals(matchRoute("GET", "/ipam-api/prefixes/abc/addresses"), {
    status: 404,
  });
  assertEquals(matchRoute("GET", "/ipam-api/search"), {
    route: { name: "search" },
  });
  assertEquals(matchRoute("POST", "/ipam-api/vlans"), {
    status: 405,
    allow: "GET",
  });
  assertEquals(requiredScope("listPrefixes"), "read");
  assertEquals(requiredScope("releaseAddress"), "write");
});

Deno.test("API key header, pagination and VRF", () => {
  const key = "ndk_ipam_" + "a".repeat(32);
  assertEquals(
    extractApiKey(new Headers({ Authorization: `Bearer ${key}` })),
    key,
  );
  assertEquals(extractApiKey(new Headers({ "X-API-Key": key })), key);
  assertEquals(
    extractApiKey(new Headers({ Authorization: "Bearer eyJhbGciOi" })),
    null,
  );
  assertEquals(parsePagination(new URLSearchParams("")), {
    limit: 100,
    offset: 0,
  });
  assertEquals(parsePagination(new URLSearchParams("limit=500&offset=20")), {
    limit: 500,
    offset: 20,
  });
  assertEquals(parsePagination(new URLSearchParams("limit=501")), null);
  assertEquals(parsePagination(new URLSearchParams("offset=-1")), null);
  assertEquals(paginationOut({ limit: 2, offset: 0 }, 5, 2), {
    limit: 2,
    offset: 0,
    total: 5,
    next_offset: 2,
  });
  assertEquals(paginationOut({ limit: 2, offset: 4 }, 5, 1).next_offset, null);
  assertEquals(parseVrf(new URLSearchParams("vrf=global")), { vrfId: null });
  assertEquals(parseVrf(new URLSearchParams(`vrf=${PREFIX}`)), {
    vrfId: PREFIX,
  });
  assertEquals(parseVrf(new URLSearchParams("vrf=x")), null);
});

Deno.test("IP and CIDR validation", () => {
  assert(isIpAddress("10.0.0.1"));
  assert(isIpAddress("fe80::1"));
  assert(!isIpAddress("10.0.0.256"));
  assert(!isIpAddress("1::2::3"));
  assert(isCidr("10.0.0.0/24"));
  assert(isCidr("2001:db8::/48"));
  assert(!isCidr("10.0.0.0/33"));
});

Deno.test("request bodies are validated strictly", () => {
  assertEquals(
    parseReserveBody({ hostname: "PC-A2-010", mac: "AA-BB-CC-DD-EE-FF" }),
    {
      ok: true,
      value: {
        hostname: "PC-A2-010",
        description: null,
        mac: "aa:bb:cc:dd:ee:ff",
        dnsName: null,
      },
    },
  );
  assertEquals(parseReserveBody(undefined).ok, true);
  assertEquals(parseReserveBody({ hostname: "bad host" }).ok, false);
  assertEquals(parseReserveBody({ owner: "x" }).ok, false);
  assertEquals(parseNextPrefixBody({ length: 26 }), {
    ok: true,
    value: { length: 26, description: null, status: "active" },
  });
  assertEquals(parseNextPrefixBody({ length: 0 }).ok, false);
  assertEquals(parseNextPrefixBody({ length: 26, status: "kaputt" }).ok, false);
  assertEquals(
    parseAddressPatch({
      status: "deprecated",
      mac_address: null,
      reserved_until: "2027-01-31",
    }),
    {
      ok: true,
      value: {
        mac_address: null,
        status: "deprecated",
        reserved_until: "2027-01-31",
      },
    },
  );
  assertEquals(parseAddressPatch({}).ok, false);
  assertEquals(parseAddressPatch({ device_type: "toaster" }).ok, false);
  assertEquals(parseAddressPatch({ prefix_id: PREFIX }).ok, false);
});

Deno.test("output formats and error mapping", () => {
  const address = addressOut({
    id: "a",
    address: "10.0.0.5/32",
    status: "reserved",
    tags: null,
  });
  assertEquals(address.address, "10.0.0.5");
  assertEquals(address.tags, []);
  const prefix = prefixOut(
    { id: "p", prefix: "10.0.0.0/24", status: "active", gateway: "10.0.0.1" },
    {
      used: 50,
      dhcp_size: 77,
      capacity: 254,
    },
  );
  assertEquals(prefix.gateway, "10.0.0.1");
  assertEquals(prefix.utilization, {
    used: 50,
    dhcp_size: 77,
    capacity: 254,
    percent: 50,
  });
  assertEquals(reserveError("53400").status, 409);
  assertEquals(reserveError("P0002").code, "prefix_not_found");
  assertEquals(reserveError("XX000").status, 500);
});
