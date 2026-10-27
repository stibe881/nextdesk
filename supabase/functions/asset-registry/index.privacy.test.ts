Deno.test(
  "Asset registry keeps external device identifiers and Intune snapshots on the server",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./index.ts", import.meta.url),
    );

    for (const required of [
      'admin\n      .from("asset_identifiers")',
      'admin\n      .from("asset_intune_asset_links")',
      "canonical_external_device_id",
      "if (ids.length > 1)",
      'match: "ambiguous"',
    ]) {
      if (!source.includes(required)) {
        throw new Error(
          `Asset registry no longer keeps the required private lookup on the server: ${required}`,
        );
      }
    }

    for (const forbidden of [
      'client\n      .from("asset_identifiers")',
      'client\n      .from("asset_intune_asset_links")',
      "intune_device_id",
      "user_principal_name",
      "user_display_name",
      '"snapshot"',
    ]) {
      if (source.toLowerCase().includes(forbidden.toLowerCase())) {
        throw new Error(
          `Asset registry exposes a private Intune implementation detail: ${forbidden}`,
        );
      }
    }
  },
);

Deno.test(
  "Assetdetail verwendet die eindeutige mandantengebundene Ticketstatusrelation",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./index.ts", import.meta.url),
    );
    const explicitJoin =
      "status:ticket_statuses!tickets_status_tenant_fk!inner(label)";
    if (!source.includes(explicitJoin)) {
      throw new Error(
        "Der Assetdetailpfad muss die mandantengebundene Ticketstatusrelation explizit wählen.",
      );
    }
    if (source.includes("status:ticket_statuses!inner(label)")) {
      throw new Error(
        "Der Assetdetailpfad enthält weiterhin einen mehrdeutigen Ticketstatus-Join.",
      );
    }
    for (const required of [
      '.eq("tenant_id", action.tenantId)',
      '.eq("asset_id", action.assetId)',
    ]) {
      if (!source.includes(required)) {
        throw new Error(
          `Der Assetdetailpfad hat seine Mandanten- oder Assetbindung verloren: ${required}`,
        );
      }
    }
  },
);
