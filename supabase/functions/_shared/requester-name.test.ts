import { assertEquals } from "jsr:@std/assert@1";

import {
  isDerivedName,
  nameFromAddress,
  pickRequesterName,
  senderName,
} from "./requester-name.ts";

Deno.test("names from addresses are capitalised", () => {
  assertEquals(nameFromAddress("luana.nett@sonnenberg-baar.ch"), "Luana Nett");
  assertEquals(nameFromAddress("hans-peter.muster@x.ch"), "Hans-Peter Muster");
  assertEquals(nameFromAddress("a_syfrigl@x.ch"), "A Syfrigl");
  assertEquals(nameFromAddress("@x.ch"), "E-Mail-Kontakt");
});

Deno.test("derived names are recognised in any case", () => {
  assertEquals(isDerivedName("luana nett", "luana.nett@x.ch"), true);
  assertEquals(isDerivedName("Luana Nett", "luana.nett@x.ch"), true);
  assertEquals(isDerivedName("hans peter muster", "hans-peter.muster@x.ch"), true);
  assertEquals(isDerivedName("Luana Nett-Meier", "luana.nett@x.ch"), false);
  assertEquals(isDerivedName(null, "luana.nett@x.ch"), true);
});

Deno.test("directory and sender names win over the address", () => {
  const address = "katja.roethlin@x.ch";
  assertEquals(
    pickRequesterName({ address, directoryName: "Katja Röthlin", senderName: "katja roethlin" }),
    "Katja Röthlin",
  );
  assertEquals(pickRequesterName({ address, senderName: "Röthlin Katja" }), "Röthlin Katja");
  assertEquals(pickRequesterName({ address, senderName: "katja roethlin" }), "Katja Roethlin");
  assertEquals(pickRequesterName({ address, senderName: "katja.roethlin@x.ch" }), "Katja Roethlin");
  assertEquals(senderName(' "Luana Nett" '), "Luana Nett");
});
