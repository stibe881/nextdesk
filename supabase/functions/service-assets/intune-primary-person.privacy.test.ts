Deno.test(
  "Service assets resolves Intune primary people only server-side for asset management",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./index.ts", import.meta.url),
    );

    for (const required of [
      'admin\n      .from("asset_intune_primary_person_links")',
      'admin\n      .from("tenant_entra_directory_people")',
      "intune_primary_person_name",
      'p_permission_code: "asset.manage"',
    ]) {
      if (!source.includes(required)) {
        throw new Error(
          `The primary-person response lost its required server-side fence: ${required}`,
        );
      }
    }

    for (const forbidden of [
      'client\n      .from("asset_intune_primary_person_links")',
      'client\n      .from("tenant_entra_directory_people")',
      "user_principal_name",
      "user_display_name",
      "email_address",
    ]) {
      if (source.toLowerCase().includes(forbidden.toLowerCase())) {
        throw new Error(
          `The asset catalog retained a forbidden primary-person detail: ${forbidden}`,
        );
      }
    }
  },
);
