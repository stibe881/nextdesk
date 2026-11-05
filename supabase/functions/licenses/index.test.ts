Deno.test(
  "licenses authorizes with the verified actor, archives instead of deleting and scopes by department",
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
      "applyDepartmentScope(query, scope)",
    ]) {
      if (!source.includes(required)) {
        throw new Error(
          `The license endpoint lost a required authorization or lifecycle fence: ${required}`,
        );
      }
    }

    for (const forbidden of ['type: "delete"', ".delete()"]) {
      if (source.includes(forbidden)) {
        throw new Error(
          `The license endpoint contains a forbidden destructive path: ${forbidden}`,
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
        "Die Lizenzfunktion darf den Feature-Status erst nach der actor-gebundenen Rollenprüfung lesen.",
      );
    }

    // Updates and archiving first check that the license is in the caller's
    // departments (404 otherwise).
    const calls = [...source.matchAll(/await visibleLicenseDepartment\(/g)];
    if (calls.length < 2) {
      throw new Error(
        "Update and archive must check the department of the license.",
      );
    }
  },
);
