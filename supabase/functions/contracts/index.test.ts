Deno.test(
  "contracts authorizes with the verified actor and rejects unsupported actions",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./index.ts", import.meta.url),
    );

    for (const required of [
      "p_tenant_id: tenantId",
      "p_user_id: actorId",
      'type: "archive"',
      'type: "listPeople"',
      'status: "archived"',
    ]) {
      if (!source.includes(required)) {
        throw new Error(
          `The contract endpoint lost a required authorization or lifecycle fence: ${required}`,
        );
      }
    }

    for (const forbidden of ['type: "delete"', "notes: old.notes"]) {
      if (source.includes(forbidden)) {
        throw new Error(
          `The contract endpoint contains a forbidden destructive or audit-sensitive path: ${forbidden}`,
        );
      }
    }

    // Contracts are archived, never deleted. The only allowed delete removes
    // asset links (contract_assets, migration 0152) of a contract.
    const deletes = [...source.matchAll(/\.delete\(\)/g)];
    for (const match of deletes) {
      const before = source.slice(0, match.index);
      const table = [...before.matchAll(/\.from\("([a-z_]+)"\)/g)].at(-1)?.[1];
      if (table !== "contract_assets") {
        throw new Error(
          `The contract endpoint deletes from a table other than contract_assets: ${table}`,
        );
      }
    }

    const authorizeStart = source.indexOf("async function authorize(");
    const permissionCheck = source.indexOf(
      '"has_contracts_management_permission"',
      authorizeStart,
    );
    const featureCheck = source.indexOf(
      "resolveUserFeatureStates(admin, tenantId, actorId",
      authorizeStart,
    );
    if (
      authorizeStart < 0 ||
      permissionCheck < authorizeStart ||
      featureCheck < permissionCheck
    ) {
      throw new Error(
        "Die Vertragsfunktion darf den mandantenspezifischen Feature-Status erst nach der actor-gebundenen Rollenprüfung lesen.",
      );
    }
  },
);
