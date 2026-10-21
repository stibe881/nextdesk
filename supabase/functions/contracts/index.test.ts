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

    for (const forbidden of [
      'type: "delete"',
      ".delete()",
      "notes: old.notes",
    ]) {
      if (source.includes(forbidden)) {
        throw new Error(
          `The contract endpoint contains a forbidden destructive or audit-sensitive path: ${forbidden}`,
        );
      }
    }

    const authorizeStart = source.indexOf("async function authorize(");
    const permissionCheck = source.indexOf(
      '"has_contracts_management_permission"',
      authorizeStart,
    );
    const featureCheck = source.indexOf(
      "resolveTenantFeatureStates(admin, tenantId",
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
