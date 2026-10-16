import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, ExternalLink, Search } from "lucide-react";
import { supabase } from "./lib/supabase";

export type OwnerAccess = "idle" | "checking" | "not_owner" | "ready" | "error";

type OwnerAccessResult = { state: OwnerAccess; message?: string };
type TenantStatus = "active" | "suspended" | "archived";
type PlatformTenant = {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  created_at: string;
  updated_at: string;
};
type TenantList = { tenants: PlatformTenant[]; canTriggerDeployment: boolean };
type DirectoryMember = {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  joinedAt: string | null;
};
type DirectoryInvitation = {
  id: string;
  email: string;
  status: "sent" | "accepted";
  expires_at: string;
  created_at: string;
};
type UserDirectory = {
  members: DirectoryMember[];
  invitations: DirectoryInvitation[];
};

async function edgeErrorCode(error: unknown): Promise<string | null> {
  if (
    typeof error === "object" &&
    error !== null &&
    "context" in error &&
    (error as { context?: unknown }).context instanceof Response
  ) {
    try {
      const payload = (await (
        error as { context: Response }
      ).context.json()) as { error?: { code?: unknown } };
      return typeof payload.error?.code === "string"
        ? payload.error.code
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function readableConsoleError(code: string | null) {
  const messages: Record<string, string> = {
    platform_operator_required:
      "Dieses Konto besitzt keine aktive Plattform-Eigentümerrolle.",
    sso_required: "Für die Eigentümerkonsole ist Gross-ICT-SSO erforderlich.",
    tenant_provisioning_failed:
      "Der Kundenmandant konnte nicht angelegt werden. Slug und Startbereiche prüfen.",
    tenant_update_failed: "Die Kundendaten konnten nicht gespeichert werden.",
    tenant_admin_required:
      "Nur ein aktiver Mandantenadministrator darf diese Benutzeraktion ausführen.",
    invitation_email_failed:
      "Der Einladungslink konnte nicht versendet werden. Bitte später erneut versuchen.",
    invitation_create_failed: "Die Einladung konnte nicht gespeichert werden.",
    user_remove_failed: "Die Benutzerzuordnung konnte nicht entfernt werden.",
    self_removal_forbidden:
      "Sie können Ihren eigenen Eigentümerzugang nicht aus dem Kundenmandanten entfernen.",
    invitation_revoke_failed:
      "Die ausstehende Einladung konnte nicht zurückgezogen werden.",
  };
  return code
    ? (messages[code] ?? "Die Anfrage konnte nicht verarbeitet werden.")
    : "Die Anfrage konnte nicht verarbeitet werden.";
}

export async function resolveOwnerAccess(): Promise<OwnerAccessResult> {
  if (!supabase) return { state: "not_owner" };
  const { error } = await supabase.functions.invoke("owner-access", {
    body: { type: "resolve" },
  });
  if (!error) return { state: "ready" };

  const code = await edgeErrorCode(error);
  if (code === "platform_operator_required" || code === "sso_required") {
    return { state: "not_owner" };
  }
  return { state: "error", message: readableConsoleError(code) };
}

async function ownerConsoleRequest<T>(
  body: Record<string, unknown>,
): Promise<T> {
  if (!supabase) throw new Error("Die Supabase-Konfiguration fehlt.");
  const { data, error } = await supabase.functions.invoke("owner-console", {
    body,
  });
  if (error) throw new Error(readableConsoleError(await edgeErrorCode(error)));
  const response = data as { data?: T } | null;
  if (!response?.data) {
    throw new Error("Die Kundenverwaltung lieferte keine Daten.");
  }
  return response.data;
}

async function tenantUserRequest<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Die Supabase-Konfiguration fehlt.");
  const { data, error } = await supabase.functions.invoke("tenant-users", {
    body,
  });
  if (error) throw new Error(readableConsoleError(await edgeErrorCode(error)));
  const response = data as { data?: T } | null;
  if (!response?.data)
    throw new Error("Die Benutzeraktion lieferte keine Daten.");
  return response.data;
}

function makeDepartmentKey(value: string, index: number) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug.length >= 2 ? slug : `team-${index + 1}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeZone: "Europe/Zurich",
  }).format(new Date(value));
}

export function OwnerConsoleScreen({
  onOpenTenant,
  onSignOut,
}: {
  onOpenTenant: (tenantId: string) => void;
  onSignOut: () => void;
}) {
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [directory, setDirectory] = useState<UserDirectory>({
    members: [],
    invitations: [],
  });
  const [loading, setLoading] = useState(true);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [userTenantId, setUserTenantId] = useState("");
  const [form, setForm] = useState({
    name: "",
    slug: "",
    adminEmail: "",
    departments: "ICT, Infrastruktur",
  });
  const [editForm, setEditForm] = useState({
    tenantId: "",
    name: "",
    status: "active" as TenantStatus,
  });
  const [invitation, setInvitation] = useState({ email: "" });

  const visibleTenants = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("de-CH");
    if (!query) return tenants;
    return tenants.filter((tenant) =>
      `${tenant.name} ${tenant.slug} ${tenant.status}`
        .toLocaleLowerCase("de-CH")
        .includes(query),
    );
  }, [search, tenants]);
  const activeTenantCount = tenants.filter(
    (tenant) => tenant.status === "active",
  ).length;
  const pausedTenantCount = tenants.filter(
    (tenant) => tenant.status === "suspended",
  ).length;
  const selectedUserTenant = tenants.find(
    (tenant) => tenant.id === userTenantId,
  );

  async function loadTenants() {
    setLoading(true);
    setError("");
    try {
      const data = await ownerConsoleRequest<TenantList>({
        type: "listTenants",
      });
      setTenants(data.tenants);
      setUserTenantId((current) => current || data.tenants[0]?.id || "");
      setEditForm((current) =>
        current.tenantId
          ? current
          : {
              tenantId: data.tenants[0]?.id || "",
              name: data.tenants[0]?.name || "",
              status: data.tenants[0]?.status || "active",
            },
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Kunden konnten nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadDirectory(tenantId: string) {
    if (!tenantId) return;
    setDirectoryLoading(true);
    try {
      const data = await tenantUserRequest<UserDirectory>({
        type: "listUsers",
        tenantId,
      });
      setDirectory(data);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Benutzer konnten nicht geladen werden.",
      );
    } finally {
      setDirectoryLoading(false);
    }
  }

  useEffect(() => {
    void loadTenants();
  }, []);

  useEffect(() => {
    if (userTenantId) void loadDirectory(userTenantId);
  }, [userTenantId]);

  function beginEdit(tenant: PlatformTenant) {
    setEditForm({
      tenantId: tenant.id,
      name: tenant.name,
      status: tenant.status,
    });
    setUserTenantId(tenant.id);
  }

  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const names = form.departments
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    if (
      !form.name.trim() ||
      !form.slug.trim() ||
      !form.adminEmail.trim() ||
      names.length === 0
    ) {
      setError(
        "Kundenname, Administratoradresse, Mandantenkennung und mindestens ein Startbereich sind erforderlich.",
      );
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await ownerConsoleRequest({
        type: "createTenant",
        name: form.name,
        slug: form.slug,
        adminEmail: form.adminEmail,
        departments: names.map((name, index) => ({
          key: makeDepartmentKey(name, index),
          name,
          kind: name.toLowerCase().includes("infra") ? "infrastructure" : "ict",
        })),
      });
      setMessage(
        `Kunde „${form.name.trim()}“ wurde angelegt. Der Mandantenadministrator erhält jetzt seinen Zugangslink.`,
      );
      setForm({
        name: "",
        slug: "",
        adminEmail: "",
        departments: "ICT, Infrastruktur",
      });
      await loadTenants();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Der Kundenmandant konnte nicht angelegt werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editForm.tenantId || !editForm.name.trim()) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await ownerConsoleRequest({
        type: "updateTenant",
        tenantId: editForm.tenantId,
        name: editForm.name.trim(),
        status: editForm.status,
      });
      setMessage("Kundendaten und Mandantenstatus wurden gespeichert.");
      await loadTenants();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Kundendaten konnten nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userTenantId || !invitation.email.trim()) {
      setError(
        "Wählen Sie einen Kunden und geben Sie eine E-Mail-Adresse ein.",
      );
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await tenantUserRequest({
        type: "inviteUser",
        tenantId: userTenantId,
        email: invitation.email,
      });
      setMessage(
        `Einladungslink wurde an ${invitation.email.trim()} versendet.`,
      );
      setInvitation({ email: "" });
      await loadDirectory(userTenantId);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Einladung konnte nicht versendet werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeUser(member: DirectoryMember) {
    if (!userTenantId) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await tenantUserRequest({
        type: "removeUser",
        tenantId: userTenantId,
        userId: member.id,
      });
      setMessage(`${member.email} wurde aus dem Kundenmandanten entfernt.`);
      await loadDirectory(userTenantId);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Der Benutzer konnte nicht entfernt werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function revokeInvitation(invite: DirectoryInvitation) {
    if (!userTenantId) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await tenantUserRequest({
        type: "revokeInvitation",
        tenantId: userTenantId,
        invitationId: invite.id,
      });
      setMessage(`Die Einladung an ${invite.email} wurde zurückgezogen.`);
      await loadDirectory(userTenantId);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Einladung konnte nicht zurückgezogen werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="owner-console" aria-label="Gross-ICT-Kundenportal">
      <header className="owner-console-header">
        <div>
          <p className="eyebrow">GROSS ICT · KUNDENPORTAL</p>
          <h1>Kunden &amp; Mandanten.</h1>
          <p>
            Jeder Kunde erhält einen eigenen, technisch getrennten nextDesk-
            Mandanten mit eigenem Benutzer- und Ticketkontext.
          </p>
        </div>
        <button className="secondary-button" onClick={onSignOut} type="button">
          Abmelden
        </button>
      </header>

      <div className="owner-console-status">
        <span aria-hidden="true" />
        <strong>Plattformzugang aktiv</strong>
        <small>
          Änderungen an Kunden, Mandanten und Benutzern werden protokolliert.
        </small>
      </div>
      <section className="owner-kpis" aria-label="Kundenstatus">
        <article>
          <span>Aktive Kunden</span>
          <strong>{activeTenantCount}</strong>
          <small>Mit verfügbarem Kundenportal</small>
        </article>
        <article>
          <span>Pausierte Kunden</span>
          <strong>{pausedTenantCount}</strong>
          <small>Kein neuer Portalzugriff</small>
        </article>
        <article>
          <span>Mandantentrennung</span>
          <strong>RLS</strong>
          <small>Eigene Daten und Benutzer je Kunde</small>
        </article>
        <a
          className="owner-release-link"
          href="https://github.com/stibe881/nextdesk/actions/workflows/deploy-hetzner.yml"
          rel="noreferrer"
          target="_blank"
        >
          GitHub-Auslieferung öffnen
          <ExternalLink aria-hidden="true" size={17} strokeWidth={1.8} />
        </a>
      </section>
      {error && <p className="access-message error">{error}</p>}
      {message && <p className="access-message success">{message}</p>}

      <div className="owner-console-grid">
        <section className="console-panel console-panel-wide">
          <div className="console-panel-heading">
            <div>
              <p className="eyebrow">KUNDENBESTAND</p>
              <h2>Kundenmandanten</h2>
            </div>
            <button
              className="table-action"
              disabled={loading || saving}
              onClick={() => void loadTenants()}
              type="button"
            >
              Aktualisieren
            </button>
          </div>
          <label className="customer-search">
            <Search aria-hidden="true" size={17} strokeWidth={1.8} />
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Kunde, Mandantenkennung oder Status suchen"
              value={search}
            />
          </label>
          {loading ? (
            <p className="console-empty">Kunden werden geladen …</p>
          ) : visibleTenants.length === 0 ? (
            <p className="console-empty">Keine Kunden entsprechen der Suche.</p>
          ) : (
            <div className="tenant-list">
              {visibleTenants.map((tenant) => (
                <article className="tenant-row" key={tenant.id}>
                  <div>
                    <strong>{tenant.name}</strong>
                    <span>Mandant: {tenant.slug}</span>
                  </div>
                  <span className={`customer-status ${tenant.status}`}>
                    {tenant.status === "active"
                      ? "Aktiv"
                      : tenant.status === "suspended"
                        ? "Pausiert"
                        : "Archiviert"}
                  </span>
                  <button
                    className="table-action"
                    onClick={() => beginEdit(tenant)}
                    type="button"
                  >
                    Bearbeiten
                  </button>
                  <button
                    className="table-action"
                    disabled={tenant.status !== "active"}
                    onClick={() => onOpenTenant(tenant.id)}
                    type="button"
                  >
                    Öffnen
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="console-panel">
          <p className="eyebrow">NEUER KUNDE</p>
          <h2>Kundenmandant anlegen.</h2>
          <p className="console-copy">
            Der Kunde erhält einen isolierten Mandanten. Sie werden zunächst als
            Mandantenadministrator eingesetzt und können danach Benutzer
            einladen.
          </p>
          <form className="console-form" onSubmit={createTenant}>
            <label>
              Kundenname
              <input
                disabled={saving}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                placeholder="Muster AG"
                required
                value={form.name}
              />
            </label>
            <label>
              Administratoradresse
              <input
                autoComplete="email"
                disabled={saving}
                onChange={(event) =>
                  setForm({ ...form, adminEmail: event.target.value })
                }
                placeholder="admin@kunde.ch"
                required
                type="email"
                value={form.adminEmail}
              />
              <small>
                Erhält die Einladung und wird Mandantenadministrator.
              </small>
            </label>
            <label>
              Mandantenkennung <small>bleibt dauerhaft</small>
              <input
                disabled={saving}
                onChange={(event) =>
                  setForm({
                    ...form,
                    slug: event.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, ""),
                  })
                }
                pattern="[a-z0-9][a-z0-9-]{0,62}"
                placeholder="muster-ag"
                required
                value={form.slug}
              />
            </label>
            <label>
              Startbereiche <small>Kommagetrennt</small>
              <input
                disabled={saving}
                onChange={(event) =>
                  setForm({ ...form, departments: event.target.value })
                }
                required
                value={form.departments}
              />
            </label>
            <button
              className="gross-sso-button"
              disabled={saving}
              type="submit"
            >
              {saving ? "Wird angelegt …" : "Kundenmandant anlegen"}
              <ArrowRight aria-hidden="true" size={18} strokeWidth={1.8} />
            </button>
          </form>
        </section>
      </div>

      <div className="owner-console-grid customer-detail-grid">
        <section className="console-panel">
          <p className="eyebrow">KUNDENDATEN</p>
          <h2>Mandant anpassen.</h2>
          <form className="console-form" onSubmit={saveCustomer}>
            <label>
              Kunde
              <select
                disabled={saving || tenants.length === 0}
                onChange={(event) => {
                  const tenant = tenants.find(
                    (item) => item.id === event.target.value,
                  );
                  if (tenant) beginEdit(tenant);
                }}
                required
                value={editForm.tenantId}
              >
                <option value="" disabled>
                  Kundenmandant wählen
                </option>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Kundenname
              <input
                disabled={saving || !editForm.tenantId}
                onChange={(event) =>
                  setEditForm({ ...editForm, name: event.target.value })
                }
                required
                value={editForm.name}
              />
            </label>
            <label>
              Mandantenstatus
              <select
                disabled={saving || !editForm.tenantId}
                onChange={(event) =>
                  setEditForm({
                    ...editForm,
                    status: event.target.value as TenantStatus,
                  })
                }
                value={editForm.status}
              >
                <option value="active">Aktiv</option>
                <option value="suspended">Pausiert</option>
                <option value="archived">Archiviert</option>
              </select>
            </label>
            <button
              className="email-access-button"
              disabled={saving || !editForm.tenantId}
              type="submit"
            >
              Kundendaten speichern
            </button>
          </form>
        </section>

        <section className="console-panel customer-user-panel">
          <div className="console-panel-heading">
            <div>
              <p className="eyebrow">BENUTZER</p>
              <h2>{selectedUserTenant?.name ?? "Kundenbenutzer"}</h2>
            </div>
            <button
              className="table-action"
              disabled={directoryLoading || !userTenantId}
              onClick={() => void loadDirectory(userTenantId)}
              type="button"
            >
              Aktualisieren
            </button>
          </div>
          <label>
            Kundenmandant
            <select
              disabled={saving || tenants.length === 0}
              onChange={(event) => setUserTenantId(event.target.value)}
              value={userTenantId}
            >
              {tenants
                .filter((tenant) => tenant.status === "active")
                .map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
            </select>
          </label>
          <form
            className="console-form console-invite-form"
            onSubmit={inviteUser}
          >
            <label>
              Geschäftliche E-Mail-Adresse
              <input
                disabled={saving || !userTenantId}
                onChange={(event) =>
                  setInvitation({ email: event.target.value })
                }
                placeholder="name@kunde.ch"
                required
                type="email"
                value={invitation.email}
              />
            </label>
            <button
              className="email-access-button"
              disabled={saving || !userTenantId}
              type="submit"
            >
              Zugang einladen
            </button>
          </form>
          {directoryLoading ? (
            <p className="console-empty">Benutzer werden geladen …</p>
          ) : (
            <>
              <div className="customer-user-list">
                {directory.members
                  .filter((member) => member.status === "active")
                  .map((member) => (
                    <article key={member.id}>
                      <div>
                        <strong>{member.displayName || member.email}</strong>
                        <span>
                          {member.displayName ? member.email : "Aktiver Zugang"}
                        </span>
                        <small>Seit {formatDate(member.joinedAt)}</small>
                      </div>
                      <button
                        className="danger-action"
                        disabled={saving}
                        onClick={() => void removeUser(member)}
                        type="button"
                      >
                        Entfernen
                      </button>
                    </article>
                  ))}
                {directory.members.filter(
                  (member) => member.status === "active",
                ).length === 0 && (
                  <p className="console-empty">
                    Noch keine aktiven Kundenbenutzer.
                  </p>
                )}
              </div>
              {directory.invitations.filter(
                (invite) => invite.status === "sent",
              ).length > 0 && (
                <div className="pending-invitations">
                  <p className="eyebrow">AUSSTEHENDE EINLADUNGEN</p>
                  {directory.invitations
                    .filter((invite) => invite.status === "sent")
                    .map((invite) => (
                      <div key={invite.id}>
                        <span>
                          {invite.email} · gültig bis{" "}
                          {formatDate(invite.expires_at)}
                        </span>
                        <button
                          className="table-action"
                          disabled={saving}
                          onClick={() => void revokeInvitation(invite)}
                          type="button"
                        >
                          Zurückziehen
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
      <p className="owner-console-footer">
        Die Web-Auslieferung wird über den verlinkten GitHub-Workflow gesteuert.
        Ein serverseitiger Dispatch-Token ist erst für einen direkten
        Ein-Klick-Release nötig.
      </p>
    </section>
  );
}
