export type EntraPersonnelRecord = {
  email: string;
  local_user_id: string | null;
  job_title: string | null;
  source_department_name: string | null;
  account_enabled: boolean;
  inactive_at: string | null;
};

function isActiveDirectoryPerson(person: EntraPersonnelRecord): boolean {
  return person.account_enabled === true && person.inactive_at === null;
}

/**
 * Resolves Entra personnel metadata only for an active, tenant-scoped source
 * record after the SSO path has stored a direct local-user link. An unlinked
 * record is intentionally never resolved by e-mail in this listing path: only
 * the SSO path can establish that Entra identity trust boundary.
 */
export function resolveEntraPersonnelForMember(
  people: readonly EntraPersonnelRecord[],
  userId: string,
): EntraPersonnelRecord | null {
  return (
    people.find(
      (person) =>
        isActiveDirectoryPerson(person) && person.local_user_id === userId,
    ) ?? null
  );
}
