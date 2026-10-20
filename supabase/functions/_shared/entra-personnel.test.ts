import {
  resolveEntraPersonnelForMember,
  type EntraPersonnelRecord,
} from "./entra-personnel.ts";

const currentUser = "10000000-0000-4000-8000-000000000001";
const otherUser = "10000000-0000-4000-8000-000000000002";

function person(
  overrides: Partial<EntraPersonnelRecord> = {},
): EntraPersonnelRecord {
  return {
    email: "person@example.org",
    local_user_id: null,
    job_title: "Funktion",
    source_department_name: "Organisation",
    account_enabled: true,
    inactive_at: null,
    ...overrides,
  };
}

Deno.test(
  "resolves active Entra data only by the verified local account",
  () => {
    const resolved = resolveEntraPersonnelForMember(
      [
        person({ local_user_id: otherUser, email: "person@example.org" }),
        person({ local_user_id: currentUser, email: "anderes@example.org" }),
      ],
      currentUser,
    );
    if (resolved?.local_user_id !== currentUser) {
      throw new Error("The direct tenant-scoped local-user link must win.");
    }
  },
);

Deno.test(
  "never resolves an unlinked Entra record merely because its e-mail matches",
  () => {
    const resolved = resolveEntraPersonnelForMember(
      [person({ email: "Person@Example.org", local_user_id: null })],
      currentUser,
    );
    if (resolved !== null) {
      throw new Error(
        "The listing path must wait for the SSO-confirmed local-user link.",
      );
    }
  },
);

Deno.test(
  "never exposes Entra metadata linked to another account or a disabled identity",
  () => {
    const linkedElsewhere = resolveEntraPersonnelForMember(
      [person({ local_user_id: otherUser })],
      currentUser,
    );
    const disabled = resolveEntraPersonnelForMember(
      [person({ account_enabled: false })],
      currentUser,
    );
    if (linkedElsewhere !== null || disabled !== null) {
      throw new Error(
        "Different-account and disabled Entra records must not resolve.",
      );
    }
  },
);
