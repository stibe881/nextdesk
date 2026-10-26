function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test(
  "saved ticket views are restricted to their owner and private visibility",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./index.ts", import.meta.url),
    );

    assert(
      source.includes('.eq("owner_id", actorId)'),
      "Die Listenabfrage muss auf die erstellende Person begrenzt sein.",
    );
    assert(
      source.includes('visibility: "private"'),
      "Neue und aktualisierte Ansichten müssen serverseitig privat gesetzt werden.",
    );
    assert(
      !source.includes("visibility: value.visibility"),
      "Eine vom Browser übermittelte Sichtbarkeit darf nicht übernommen werden.",
    );
    assert(
      !source.includes("owner_id !== actorId && !manager"),
      "Mandantenverwaltung darf keine fremden persönlichen Ansichten freigeben.",
    );
  },
);
