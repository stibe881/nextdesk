Deno.test(
  "Intune provider worker remains fail-closed without Graph or secret access",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./index.ts", import.meta.url),
    );
    if (!source.includes('code: "intune_provider_sync_disabled"')) {
      throw new Error(
        "The disabled Intune worker must return its fail-closed code",
      );
    }
    for (const forbidden of [
      "graph.microsoft.com",
      "INTUNE_GRAPH_CLIENT_ID",
      "INTUNE_GRAPH_CLIENT_SECRET",
      "INTUNE_ASSET_SYNC_SECRET",
      "authorization: `bearer",
    ]) {
      if (source.toLowerCase().includes(forbidden.toLowerCase())) {
        throw new Error(
          `Disabled Intune worker contains forbidden provider code: ${forbidden}`,
        );
      }
    }
  },
);
