import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";

export type CustomerOrganizationsProps = {
  tenantId: string;
};

type TicketAccess = "disabled" | "own" | "company";
type MemberAccess = "own" | "company";
type PendingAction = string | null;

type CustomerOrganization = {
  id: string;
  tenant_id: string;
  name: string;
  ticket_access: TicketAccess;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};

type CustomerMembership = {
  customer_organization_id: string;
  user_id: string;
  access: MemberAccess;
  created_at?: string;
};

type TenantDirectoryMember = {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  joinedAt: string | null;
};

type OrganizationForm = {
  id: string | null;
  name: string;
  ticketAccess: TicketAccess;
  active: boolean;
};

type MemberAssignmentForm = {
  userId: string;
  access: MemberAccess;
};

type CustomerOrganizationsAction =
  | { type: "list"; tenantId: string }
  | {
      type: "save";
      tenantId: string;
      id?: string;
      name: string;
      ticketAccess: TicketAccess;
      active: boolean;
    }
  | { type: "archive"; tenantId: string; id: string }
  | { type: "listMembers"; tenantId: string; organizationId: string }
  | {
      type: "setMemberAccess";
      tenantId: string;
      organizationId: string;
      userId: string;
      access: MemberAccess;
    }
  | {
      type: "removeMember";
      tenantId: string;
      organizationId: string;
      userId: string;
    };

type TenantUsersAction = { type: "listUsers"; tenantId: string };

type OrganizationListResponse = {
  organizations: CustomerOrganization[];
};

type OrganizationMembersResponse = {
  organization: CustomerOrganization;
  members: CustomerMembership[];
};

type OrganizationSaveResponse = {
  organization: CustomerOrganization;
};

type MembershipSaveResponse = {
  membership: CustomerMembership;
};

type TenantUserDirectoryResponse = {
  members: TenantDirectoryMember[];
  invitations: unknown[];
};

const emptyOrganizationForm: OrganizationForm = {
  id: null,
  name: "",
  ticketAccess: "own",
  active: true,
};

const emptyMemberAssignmentForm: MemberAssignmentForm = {
  userId: "",
  access: "own",
};

const ticketAccessLabels: Record<TicketAccess, string> = {
  disabled: "Deaktiviert",
  own: "Nur eigene Tickets",
  company: "Alle Tickets der Kundenorganisation",
};

const memberAccessLabels: Record<MemberAccess, string> = {
  own: "Nur eigene Tickets",
  company: "Alle Tickets der Kundenorganisation",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTicketAccess(value: unknown): value is TicketAccess {
  return value === "disabled" || value === "own" || value === "company";
}

function isMemberAccess(value: unknown): value is MemberAccess {
  return value === "own" || value === "company";
}

function optionalIsoString(value: unknown): string | undefined | null {
  return typeof value === "string" || value === undefined || value === null
    ? value
    : null;
}

function parseOrganization(value: unknown): CustomerOrganization | null {
  if (!isRecord(value)) return null;

  const createdAt = optionalIsoString(value.created_at);
  const updatedAt = optionalIsoString(value.updated_at);
  if (
    typeof value.id !== "string" ||
    typeof value.tenant_id !== "string" ||
    typeof value.name !== "string" ||
    !isTicketAccess(value.ticket_access) ||
    typeof value.active !== "boolean" ||
    createdAt === null ||
    updatedAt === null
  ) {
    return null;
  }

  return {
    id: value.id,
    tenant_id: value.tenant_id,
    name: value.name,
    ticket_access: value.ticket_access,
    active: value.active,
    ...(createdAt !== undefined && createdAt !== null
      ? { created_at: createdAt }
      : {}),
    ...(updatedAt !== undefined && updatedAt !== null
      ? { updated_at: updatedAt }
      : {}),
  };
}

function parseMembership(value: unknown): CustomerMembership | null {
  if (!isRecord(value)) return null;

  const createdAt = optionalIsoString(value.created_at);
  if (
    typeof value.customer_organization_id !== "string" ||
    typeof value.user_id !== "string" ||
    !isMemberAccess(value.access) ||
    createdAt === null
  ) {
    return null;
  }

  return {
    customer_organization_id: value.customer_organization_id,
    user_id: value.user_id,
    access: value.access,
    ...(createdAt !== undefined && createdAt !== null
      ? { created_at: createdAt }
      : {}),
  };
}

function parseOrganizationList(value: unknown): OrganizationListResponse {
  if (!isRecord(value) || !Array.isArray(value.organizations)) {
    throw new Error("Die Organisationsliste hat ein ungültiges Format.");
  }

  const organizations: CustomerOrganization[] = [];
  for (const entry of value.organizations) {
    const organization = parseOrganization(entry);
    if (!organization) {
      throw new Error("Die Organisationsliste enthält ungültige Daten.");
    }
    organizations.push(organization);
  }

  return { organizations };
}

function parseOrganizationMembers(value: unknown): OrganizationMembersResponse {
  if (!isRecord(value) || !Array.isArray(value.members)) {
    throw new Error("Die Mitgliederliste hat ein ungültiges Format.");
  }

  const organization = parseOrganization(value.organization);
  if (!organization) {
    throw new Error("Die Mitgliederliste enthält ungültige Daten.");
  }

  const members: CustomerMembership[] = [];
  for (const entry of value.members) {
    const member = parseMembership(entry);
    if (!member) {
      throw new Error("Die Mitgliederliste enthält ungültige Daten.");
    }
    members.push(member);
  }

  return {
    organization,
    members,
  };
}

function parseOrganizationSave(value: unknown): OrganizationSaveResponse {
  if (!isRecord(value)) {
    throw new Error("Die Organisation konnte nicht gelesen werden.");
  }

  const organization = parseOrganization(value.organization);
  if (!organization) {
    throw new Error("Die Organisation hat ein ungültiges Format.");
  }
  return { organization };
}

function parseMembershipSave(value: unknown): MembershipSaveResponse {
  if (!isRecord(value)) {
    throw new Error("Die Mitgliederzuweisung konnte nicht gelesen werden.");
  }

  const membership = parseMembership(value.membership);
  if (!membership) {
    throw new Error("Die Mitgliederzuweisung hat ein ungültiges Format.");
  }
  return { membership };
}

function parseTenantDirectory(value: unknown): TenantUserDirectoryResponse {
  if (!isRecord(value) || !Array.isArray(value.members)) {
    throw new Error("Das Mandantenverzeichnis hat ein ungültiges Format.");
  }

  const members: TenantDirectoryMember[] = [];
  for (const entry of value.members) {
    if (!isRecord(entry)) {
      throw new Error("Das Mandantenverzeichnis enthält ungültige Daten.");
    }
    const displayName = entry.displayName;
    const joinedAt = entry.joinedAt;
    if (
      typeof entry.id !== "string" ||
      typeof entry.email !== "string" ||
      (typeof displayName !== "string" && displayName !== null) ||
      typeof entry.status !== "string" ||
      (typeof joinedAt !== "string" && joinedAt !== null)
    ) {
      throw new Error("Das Mandantenverzeichnis enthält ungültige Daten.");
    }
    members.push({
      id: entry.id,
      email: entry.email,
      displayName,
      status: entry.status,
      joinedAt,
    });
  }

  return {
    members,
    invitations: Array.isArray(value.invitations) ? value.invitations : [],
  };
}

async function invokeFunction(
  name: "customer-organizations" | "tenant-users",
  body: CustomerOrganizationsAction | TenantUsersAction,
): Promise<unknown> {
  if (!supabase) {
    throw new Error("Die Verbindung zu Supabase ist nicht konfiguriert.");
  }

  const { data, error } = await supabase.functions.invoke<unknown>(name, {
    body,
  });
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Die Kundenorganisationen konnten nicht geladen werden.",
      ),
    );
  }
  if (!isRecord(data) || !("data" in data)) {
    throw new Error(
      "Die Serverfunktion hat keine verwertbaren Daten geliefert.",
    );
  }
  return data.data;
}

async function customerOrganizationsRequest(
  body: CustomerOrganizationsAction,
): Promise<unknown> {
  return invokeFunction("customer-organizations", body);
}

async function tenantUsersRequest(body: TenantUsersAction): Promise<unknown> {
  return invokeFunction("tenant-users", body);
}

function errorStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  const context = error.context;
  if (context instanceof Response) return context.status;
  if (
    typeof context === "object" &&
    context !== null &&
    "status" in context &&
    typeof context.status === "number"
  ) {
    return context.status;
  }
  return null;
}

function isForbiddenError(error: unknown): boolean {
  return errorStatus(error) === 403;
}

function errorMessage(error: unknown, fallback: string): string {
  if (isForbiddenError(error)) {
    return "Sie haben keine Berechtigung, Kundenorganisationen für diesen Mandanten zu verwalten.";
  }
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

function personLabel(person: TenantDirectoryMember): string {
  return person.displayName?.trim()
    ? `${person.displayName} (${person.email})`
    : person.email;
}

function memberCountLabel(count: number | undefined): string {
  if (count === undefined) return "Anzahl nicht verfügbar";
  return `${count} ${count === 1 ? "Mitglied" : "Mitglieder"}`;
}

export function CustomerOrganizations({
  tenantId,
}: CustomerOrganizationsProps) {
  const [organizations, setOrganizations] = useState<CustomerOrganization[]>(
    [],
  );
  const [membersByOrganization, setMembersByOrganization] = useState<
    Record<string, OrganizationMembersResponse>
  >({});
  const [directory, setDirectory] = useState<TenantDirectoryMember[]>([]);
  const [organizationForm, setOrganizationForm] = useState<OrganizationForm>(
    emptyOrganizationForm,
  );
  const [memberAssignmentForm, setMemberAssignmentForm] =
    useState<MemberAssignmentForm>(emptyMemberAssignmentForm);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [success, setSuccess] = useState("");

  const selectedOrganization = useMemo(
    () =>
      organizations.find(
        (organization) => organization.id === selectedOrganizationId,
      ) ?? null,
    [organizations, selectedOrganizationId],
  );
  const selectedMembers = selectedOrganizationId
    ? (membersByOrganization[selectedOrganizationId]?.members ?? [])
    : [];
  const memberCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [organizationId, details] of Object.entries(
      membersByOrganization,
    )) {
      counts[organizationId] = details.members.length;
    }
    return counts;
  }, [membersByOrganization]);
  const activeTenantUsers = useMemo(
    () => directory.filter((member) => member.status === "active"),
    [directory],
  );
  const peopleById = useMemo(
    () => new Map(directory.map((person) => [person.id, person])),
    [directory],
  );

  const loadMemberDetails = useCallback(
    async (organizationId: string): Promise<OrganizationMembersResponse> => {
      const response = await customerOrganizationsRequest({
        type: "listMembers",
        tenantId,
        organizationId,
      });
      const details = parseOrganizationMembers(response);
      setMembersByOrganization((current) => ({
        ...current,
        [organizationId]: details,
      }));
      return details;
    },
    [tenantId],
  );

  const loadData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    setForbidden(false);
    try {
      const [organizationValue, directoryValue] = await Promise.all([
        customerOrganizationsRequest({ type: "list", tenantId }),
        tenantUsersRequest({ type: "listUsers", tenantId }),
      ]);
      const organizationList = parseOrganizationList(organizationValue);
      const tenantDirectory = parseTenantDirectory(directoryValue);
      const memberships = await Promise.all(
        organizationList.organizations.map(async (organization) => {
          const details = parseOrganizationMembers(
            await customerOrganizationsRequest({
              type: "listMembers",
              tenantId,
              organizationId: organization.id,
            }),
          );
          return [organization.id, details] as const;
        }),
      );
      const nextMembersByOrganization: Record<
        string,
        OrganizationMembersResponse
      > = {};
      for (const [organizationId, details] of memberships) {
        nextMembersByOrganization[organizationId] = details;
      }

      setOrganizations(organizationList.organizations);
      setDirectory(tenantDirectory.members);
      setMembersByOrganization(nextMembersByOrganization);
      setSelectedOrganizationId((current) =>
        current &&
        organizationList.organizations.some(({ id }) => id === current)
          ? current
          : null,
      );
    } catch (nextError) {
      setOrganizations([]);
      setDirectory([]);
      setMembersByOrganization({});
      setSelectedOrganizationId(null);
      setForbidden(isForbiddenError(nextError));
      setError(
        errorMessage(
          nextError,
          "Kundenorganisationen konnten nicht geladen werden.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setOrganizationForm(emptyOrganizationForm);
    setMemberAssignmentForm(emptyMemberAssignmentForm);
    setSelectedOrganizationId(null);
    setSuccess("");
  }, [tenantId]);

  function beginAction(action: string) {
    setPendingAction(action);
    setError("");
    setForbidden(false);
    setSuccess("");
  }

  function resetOrganizationForm() {
    setOrganizationForm(emptyOrganizationForm);
    setError("");
    setForbidden(false);
    setSuccess("");
  }

  function startEditing(organization: CustomerOrganization) {
    setSelectedOrganizationId(organization.id);
    setOrganizationForm({
      id: organization.id,
      name: organization.name,
      ticketAccess: organization.ticket_access,
      active: organization.active,
    });
    setError("");
    setForbidden(false);
    setSuccess("");
  }

  async function saveOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = organizationForm.name.trim();
    const nameLength = Array.from(name).length;
    if (nameLength < 1 || nameLength > 160) {
      setError(
        "Der Organisationsname muss zwischen 1 und 160 Zeichen lang sein.",
      );
      return;
    }

    beginAction("organization:save");
    try {
      const response = await customerOrganizationsRequest({
        type: "save",
        tenantId,
        ...(organizationForm.id ? { id: organizationForm.id } : {}),
        name,
        ticketAccess: organizationForm.ticketAccess,
        active: organizationForm.active,
      });
      const { organization } = parseOrganizationSave(response);
      setSelectedOrganizationId(organization.id);
      setOrganizationForm(emptyOrganizationForm);
      await loadData();
      setSuccess(
        organizationForm.id
          ? `Die Kundenorganisation „${organization.name}“ wurde gespeichert.`
          : `Die Kundenorganisation „${organization.name}“ wurde angelegt.`,
      );
    } catch (nextError) {
      setForbidden(isForbiddenError(nextError));
      setError(
        errorMessage(
          nextError,
          "Die Kundenorganisation konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function archiveOrganization(organization: CustomerOrganization) {
    beginAction(`organization:archive:${organization.id}`);
    try {
      const response = await customerOrganizationsRequest({
        type: "archive",
        tenantId,
        id: organization.id,
      });
      const { organization: archivedOrganization } =
        parseOrganizationSave(response);
      await loadData();
      setSuccess(
        `Die Kundenorganisation „${archivedOrganization.name}“ wurde archiviert.`,
      );
    } catch (nextError) {
      setForbidden(isForbiddenError(nextError));
      setError(
        errorMessage(
          nextError,
          "Die Kundenorganisation konnte nicht archiviert werden.",
        ),
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function setMemberAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrganization) {
      setError("Wählen Sie zuerst eine Kundenorganisation aus.");
      return;
    }
    const person = activeTenantUsers.find(
      (member) => member.id === memberAssignmentForm.userId,
    );
    if (!person) {
      setError("Wählen Sie eine aktive Mandantenbenutzer*in aus.");
      return;
    }

    beginAction(`member:save:${selectedOrganization.id}:${person.id}`);
    try {
      const response = await customerOrganizationsRequest({
        type: "setMemberAccess",
        tenantId,
        organizationId: selectedOrganization.id,
        userId: person.id,
        access: memberAssignmentForm.access,
      });
      parseMembershipSave(response);
      await loadMemberDetails(selectedOrganization.id);
      setMemberAssignmentForm(emptyMemberAssignmentForm);
      setSuccess(
        `Der Ticketzugriff für ${personLabel(person)} wurde gespeichert.`,
      );
    } catch (nextError) {
      setForbidden(isForbiddenError(nextError));
      setError(
        errorMessage(
          nextError,
          "Der Ticketzugriff konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function removeMember(membership: CustomerMembership) {
    if (!selectedOrganization) return;
    const person = peopleById.get(membership.user_id);
    beginAction(
      `member:remove:${selectedOrganization.id}:${membership.user_id}`,
    );
    try {
      await customerOrganizationsRequest({
        type: "removeMember",
        tenantId,
        organizationId: selectedOrganization.id,
        userId: membership.user_id,
      });
      await loadMemberDetails(selectedOrganization.id);
      setSuccess(
        person
          ? `${personLabel(person)} wurde aus der Kundenorganisation entfernt.`
          : "Die Benutzer*in wurde aus der Kundenorganisation entfernt.",
      );
    } catch (nextError) {
      setForbidden(isForbiddenError(nextError));
      setError(
        errorMessage(
          nextError,
          "Die Benutzer*in konnte nicht entfernt werden.",
        ),
      );
    } finally {
      setPendingAction(null);
    }
  }

  const controlsDisabled = loading || pendingAction !== null;

  return (
    <section
      aria-labelledby="customer-organizations-title"
      className="customer-organizations"
    >
      <header className="customer-organizations__header">
        <div>
          <p className="customer-organizations__eyebrow">Mandantenverwaltung</p>
          <h1 id="customer-organizations-title">Kundenorganisationen</h1>
          <p>
            Verwalten Sie Ticketzugriff und Personen für die echten
            Kundenorganisationen dieses Mandanten.
          </p>
        </div>
        <button
          disabled={controlsDisabled}
          onClick={() => void loadData()}
          type="button"
        >
          {loading ? "Wird geladen …" : "Aktualisieren"}
        </button>
      </header>

      {forbidden ? (
        <section
          aria-labelledby="customer-organizations-forbidden-title"
          className="customer-organizations__notice customer-organizations__notice--forbidden"
          role="alert"
        >
          <h2 id="customer-organizations-forbidden-title">
            Zugriff verweigert
          </h2>
          <p>{error}</p>
        </section>
      ) : error ? (
        <p
          className="customer-organizations__notice customer-organizations__notice--error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {success ? (
        <p
          className="customer-organizations__notice customer-organizations__notice--success"
          role="status"
        >
          {success}
        </p>
      ) : null}

      {loading ? (
        <p aria-live="polite" className="customer-organizations__loading">
          Kundenorganisationen werden geladen …
        </p>
      ) : null}

      {!loading && !forbidden ? (
        <div className="customer-organizations__layout">
          <section
            aria-labelledby="customer-organizations-list-title"
            className="customer-organizations__section"
          >
            <div className="customer-organizations__section-heading">
              <div>
                <h2 id="customer-organizations-list-title">Organisationen</h2>
                <p>
                  Ticketzugriff, Status und aktuelle Anzahl zugewiesener
                  Mitglieder.
                </p>
              </div>
              <button
                disabled={controlsDisabled}
                onClick={resetOrganizationForm}
                type="button"
              >
                Neue Organisation
              </button>
            </div>

            {organizations.length === 0 ? (
              <p className="customer-organizations__empty-state">
                Für diesen Mandanten sind noch keine Kundenorganisationen
                vorhanden.
              </p>
            ) : (
              <div className="customer-organizations__table-wrapper">
                <table>
                  <caption className="sr-only">
                    Kundenorganisationen dieses Mandanten
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Kundenorganisation</th>
                      <th scope="col">Ticketzugriff</th>
                      <th scope="col">Status</th>
                      <th scope="col">Anzahl</th>
                      <th scope="col">Aktionen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {organizations.map((organization) => (
                      <tr
                        aria-current={
                          selectedOrganizationId === organization.id
                            ? "true"
                            : undefined
                        }
                        key={organization.id}
                      >
                        <td>{organization.name}</td>
                        <td>
                          {ticketAccessLabels[organization.ticket_access]}
                        </td>
                        <td>{organization.active ? "Aktiv" : "Archiviert"}</td>
                        <td>
                          {memberCountLabel(memberCounts[organization.id])}
                        </td>
                        <td>
                          <div className="customer-organizations__actions">
                            <button
                              aria-pressed={
                                selectedOrganizationId === organization.id
                              }
                              disabled={controlsDisabled}
                              onClick={() => {
                                setSelectedOrganizationId(organization.id);
                                setError("");
                                setForbidden(false);
                              }}
                              type="button"
                            >
                              Details
                            </button>
                            <button
                              disabled={controlsDisabled}
                              onClick={() => startEditing(organization)}
                              type="button"
                            >
                              Bearbeiten
                            </button>
                            {organization.active ? (
                              <button
                                disabled={controlsDisabled}
                                onClick={() =>
                                  void archiveOrganization(organization)
                                }
                                type="button"
                              >
                                {pendingAction ===
                                `organization:archive:${organization.id}`
                                  ? "Wird archiviert …"
                                  : "Archivieren"}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section
            aria-labelledby="customer-organization-form-title"
            className="customer-organizations__section"
          >
            <h2 id="customer-organization-form-title">
              {organizationForm.id
                ? "Kundenorganisation bearbeiten"
                : "Kundenorganisation anlegen"}
            </h2>
            <form onSubmit={(event) => void saveOrganization(event)}>
              <label>
                Name der Kundenorganisation
                <input
                  disabled={controlsDisabled}
                  maxLength={160}
                  onChange={(event) =>
                    setOrganizationForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  required
                  type="text"
                  value={organizationForm.name}
                />
              </label>
              <label>
                Ticketzugriff
                <select
                  disabled={controlsDisabled}
                  onChange={(event) =>
                    setOrganizationForm((current) => ({
                      ...current,
                      ticketAccess: event.target.value as TicketAccess,
                    }))
                  }
                  value={organizationForm.ticketAccess}
                >
                  <option value="disabled">Deaktiviert</option>
                  <option value="own">Nur eigene Tickets</option>
                  <option value="company">
                    Alle Tickets der Kundenorganisation
                  </option>
                </select>
              </label>
              <label>
                <input
                  checked={organizationForm.active}
                  disabled={controlsDisabled}
                  onChange={(event) =>
                    setOrganizationForm((current) => ({
                      ...current,
                      active: event.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                Organisation ist aktiv
              </label>
              <p className="customer-organizations__hint">
                Archivierte Organisationen erhalten keinen neuen aktiven
                Ticketzugriff. Das Archivieren ist für die Standardorganisation
                eines Mandanten möglicherweise nicht zulässig.
              </p>
              <div className="customer-organizations__actions">
                <button disabled={controlsDisabled} type="submit">
                  {pendingAction === "organization:save"
                    ? "Wird gespeichert …"
                    : organizationForm.id
                      ? "Änderungen speichern"
                      : "Organisation anlegen"}
                </button>
                {organizationForm.id ? (
                  <button
                    disabled={controlsDisabled}
                    onClick={resetOrganizationForm}
                    type="button"
                  >
                    Abbrechen
                  </button>
                ) : null}
              </div>
            </form>
          </section>

          <section
            aria-labelledby="customer-organization-members-title"
            className="customer-organizations__section customer-organizations__section--members"
          >
            <h2 id="customer-organization-members-title">
              Mitglieder und Zugriffsarten
            </h2>
            {!selectedOrganization ? (
              <p className="customer-organizations__empty-state">
                Wählen Sie in der Organisationsliste eine Kundenorganisation
                aus, um ihre Mitglieder zu verwalten.
              </p>
            ) : (
              <>
                <h3>{selectedOrganization.name}</h3>
                <p>
                  Ticketzugriff der Organisation:{" "}
                  <strong>
                    {ticketAccessLabels[selectedOrganization.ticket_access]}
                  </strong>
                  {selectedOrganization.active ? " · aktiv" : " · archiviert"}
                </p>

                {selectedMembers.length === 0 ? (
                  <p className="customer-organizations__empty-state">
                    Dieser Kundenorganisation sind noch keine Personen
                    zugewiesen.
                  </p>
                ) : (
                  <ul className="customer-organizations__member-list">
                    {selectedMembers.map((membership) => {
                      const person = peopleById.get(membership.user_id);
                      const removalTarget = `member:remove:${selectedOrganization.id}:${membership.user_id}`;
                      return (
                        <li key={membership.user_id}>
                          <div>
                            <strong>
                              {person
                                ? personLabel(person)
                                : `Benutzer-ID: ${membership.user_id}`}
                            </strong>
                            <p>{memberAccessLabels[membership.access]}</p>
                          </div>
                          <button
                            disabled={controlsDisabled}
                            onClick={() => void removeMember(membership)}
                            type="button"
                          >
                            {pendingAction === removalTarget
                              ? "Wird entfernt …"
                              : "Entfernen"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <form
                  aria-labelledby="customer-organization-member-form-title"
                  className="customer-organizations__member-form"
                  onSubmit={(event) => void setMemberAccess(event)}
                >
                  <h3 id="customer-organization-member-form-title">
                    Aktive Mandantenbenutzer*in zuweisen
                  </h3>
                  {activeTenantUsers.length === 0 ? (
                    <p className="customer-organizations__empty-state">
                      Es sind keine aktiven Mandantenbenutzer*innen für eine
                      Zuweisung verfügbar.
                    </p>
                  ) : (
                    <>
                      <label>
                        Mandantenbenutzer*in
                        <select
                          disabled={controlsDisabled}
                          onChange={(event) =>
                            setMemberAssignmentForm((current) => ({
                              ...current,
                              userId: event.target.value,
                            }))
                          }
                          required
                          value={memberAssignmentForm.userId}
                        >
                          <option disabled value="">
                            Bitte auswählen
                          </option>
                          {activeTenantUsers.map((person) => (
                            <option key={person.id} value={person.id}>
                              {personLabel(person)}
                              {selectedMembers.some(
                                (membership) =>
                                  membership.user_id === person.id,
                              )
                                ? " (bereits zugewiesen)"
                                : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Zugriffsart
                        <select
                          disabled={controlsDisabled}
                          onChange={(event) =>
                            setMemberAssignmentForm((current) => ({
                              ...current,
                              access: event.target.value as MemberAccess,
                            }))
                          }
                          value={memberAssignmentForm.access}
                        >
                          <option value="own">Nur eigene Tickets</option>
                          <option value="company">
                            Alle Tickets der Kundenorganisation
                          </option>
                        </select>
                      </label>
                      <button disabled={controlsDisabled} type="submit">
                        {pendingAction?.startsWith("member:save:")
                          ? "Wird gespeichert …"
                          : "Zugriff zuweisen"}
                      </button>
                    </>
                  )}
                </form>
              </>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
