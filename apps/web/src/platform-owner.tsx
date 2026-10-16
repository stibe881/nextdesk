import { useEffect, useState, type FormEvent } from "react";
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
      "Der Mandant konnte nicht angelegt werden. Slug und Abteilungsnamen prüfen.",
    tenant_update_failed:
      "Der Mandantenstatus konnte nicht gespeichert werden.",
    tenant_admin_required:
      "Nur ein aktiver Mandantenadministrator darf Benutzer einladen.",
    invitation_email_failed:
      "Der Einladungslink konnte nicht versendet werden. Bitte später erneut versuchen.",
    invitation_create_failed: "Die Einladung konnte nicht gespeichert werden.",
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
  if (!response?.data)
    throw new Error("Die Eigentümerkonsole lieferte keine Daten.");
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
    throw new Error("Die Einladung konnte nicht verarbeitet werden.");
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

export function OwnerConsoleScreen({
  onOpenTenant,
  onSignOut,
}: {
  onOpenTenant: (tenantId: string) => void;
  onSignOut: () => void;
}) {
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    slug: "",
    departments: "ICT, Infrastruktur",
  });
  const [invitation, setInvitation] = useState({ tenantId: "", email: "" });

  async function loadTenants() {
    setLoading(true);
    setError("");
    try {
      const data = await ownerConsoleRequest<TenantList>({
        type: "listTenants",
      });
      setTenants(data.tenants);
      setInvitation((current) => ({
        ...current,
        tenantId: current.tenantId || data.tenants[0]?.id || "",
      }));
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Mandanten konnten nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTenants();
  }, []);

  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const names = form.departments
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    if (!form.name.trim() || !form.slug.trim() || names.length === 0) {
      setError(
        "Name, Slug und mindestens eine Start-Abteilung sind erforderlich.",
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
        departments: names.map((name, index) => ({
          key: makeDepartmentKey(name, index),
          name,
          kind: name.toLowerCase().includes("infra") ? "infrastructure" : "ict",
        })),
      });
      setMessage(`Mandant „${form.name.trim()}“ wurde angelegt.`);
      setForm({ name: "", slug: "", departments: "ICT, Infrastruktur" });
      await loadTenants();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Der Mandant konnte nicht angelegt werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(tenant: PlatformTenant, status: TenantStatus) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await ownerConsoleRequest({
        type: "updateTenant",
        tenantId: tenant.id,
        name: tenant.name,
        status,
      });
      setMessage(`Status von „${tenant.name}“ wurde gespeichert.`);
      await loadTenants();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Der Status konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invitation.tenantId || !invitation.email.trim()) {
      setError(
        "Wählen Sie einen Mandanten und geben Sie eine E-Mail-Adresse ein.",
      );
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await tenantUserRequest({
        type: "inviteUser",
        tenantId: invitation.tenantId,
        email: invitation.email,
      });
      setMessage(
        `Einladungslink wurde an ${invitation.email.trim()} versendet.`,
      );
      setInvitation((current) => ({ ...current, email: "" }));
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

  const activeTenantCount = tenants.filter(
    (tenant) => tenant.status === "active",
  ).length;
  const pausedTenantCount = tenants.filter(
    (tenant) => tenant.status === "suspended",
  ).length;

  return (
    <section className="owner-console" aria-label="Plattform-Eigentümerkonsole">
      <header className="owner-console-header">
        <div>
          <p className="eyebrow">PLATTFORM-EIGENTÜMER · GROSS-ICT-SSO</p>
          <h1>Mandantensteuerung.</h1>
          <p>
            Mandanten werden zentral angelegt und bleiben technisch wie
            organisatorisch voneinander getrennt.
          </p>
        </div>
        <button className="secondary-button" onClick={onSignOut} type="button">
          Abmelden
        </button>
      </header>

      <div className="owner-console-status">
        <span aria-hidden="true" />
        <strong>Eigentümerberechtigung aktiv</strong>
        <small>Jede Änderung wird im Plattform-Audit protokolliert.</small>
      </div>
      <section className="owner-kpis" aria-label="Plattformstatus">
        <article>
          <span>Aktive Mandanten</span>
          <strong>{activeTenantCount}</strong>
          <small>Bereit für den Portalzugriff</small>
        </article>
        <article>
          <span>Pausierte Mandanten</span>
          <strong>{pausedTenantCount}</strong>
          <small>Kein neuer Produktivzugriff</small>
        </article>
        <article>
          <span>Web-Auslieferung</span>
          <strong>Hetzner</strong>
          <small>Statisches Portal · Supabase API</small>
        </article>
        <a
          className="owner-release-link"
          href="https://github.com/stibe881/nextdesk/actions/workflows/deploy-hetzner.yml"
          rel="noreferrer"
          target="_blank"
        >
          GitHub-Auslieferung öffnen <span aria-hidden="true">↗</span>
        </a>
      </section>
      {error && <p className="access-message error">{error}</p>}
      {message && <p className="access-message success">{message}</p>}

      <div className="owner-console-grid">
        <section className="console-panel console-panel-wide">
          <div className="console-panel-heading">
            <div>
              <p className="eyebrow">BESTAND</p>
              <h2>Mandanten</h2>
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
          {loading ? (
            <p className="console-empty">Mandanten werden geladen …</p>
          ) : tenants.length === 0 ? (
            <p className="console-empty">Noch keine Mandanten angelegt.</p>
          ) : (
            <div className="tenant-list">
              {tenants.map((tenant) => (
                <article className="tenant-row" key={tenant.id}>
                  <div>
                    <strong>{tenant.name}</strong>
                    <span>{tenant.slug}</span>
                  </div>
                  <label>
                    Status
                    <select
                      disabled={saving}
                      onChange={(event) =>
                        void changeStatus(
                          tenant,
                          event.target.value as TenantStatus,
                        )
                      }
                      value={tenant.status}
                    >
                      <option value="active">Aktiv</option>
                      <option value="suspended">Pausiert</option>
                      <option value="archived">Archiviert</option>
                    </select>
                  </label>
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
          <p className="eyebrow">NEUER MANDANT</p>
          <h2>Sicher anlegen.</h2>
          <p className="console-copy">
            Sie werden automatisch als erster Mandanteneigentümer mit der Rolle
            „Tenant administrator“ eingesetzt.
          </p>
          <form className="console-form" onSubmit={createTenant}>
            <label>
              Mandantenname
              <input
                disabled={saving}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                placeholder="Beispiel Abteilung ICT"
                required
                value={form.name}
              />
            </label>
            <label>
              Slug
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
                placeholder="beispiel-ict"
                required
                value={form.slug}
              />
            </label>
            <label>
              Start-Abteilungen <small>Kommagetrennt</small>
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
              {saving ? "Wird angelegt …" : "Mandant anlegen"}
              <span aria-hidden="true">→</span>
            </button>
          </form>
        </section>
      </div>
      <section className="console-panel console-invite-panel">
        <p className="eyebrow">BENUTZERVERWALTUNG</p>
        <h2>Person einladen.</h2>
        <p className="console-copy">
          Nur aktive Mandantenadministratoren können Einladungen versenden. Der
          Link wird an die angegebene Arbeitsadresse zugestellt und aktiviert
          nach dem Öffnen automatisch den Mandantenzugang.
        </p>
        <form
          className="console-form console-invite-form"
          onSubmit={inviteUser}
        >
          <label>
            Mandant
            <select
              disabled={saving || tenants.length === 0}
              onChange={(event) =>
                setInvitation({ ...invitation, tenantId: event.target.value })
              }
              required
              value={invitation.tenantId}
            >
              <option value="" disabled>
                Mandant wählen
              </option>
              {tenants
                .filter((tenant) => tenant.status === "active")
                .map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Geschäftliche E-Mail-Adresse
            <input
              disabled={saving || tenants.length === 0}
              onChange={(event) =>
                setInvitation({ ...invitation, email: event.target.value })
              }
              placeholder="name@unternehmen.ch"
              required
              type="email"
              value={invitation.email}
            />
          </label>
          <button
            className="email-access-button"
            disabled={saving || tenants.length === 0}
            type="submit"
          >
            {saving ? "Einladung wird versendet …" : "Zugang einladen"}
          </button>
        </form>
      </section>
      <p className="owner-console-footer">
        Website-Bereitstellungen bleiben bis zur Hinterlegung eines
        serverseitigen GitHub-Dispatch-Tokens bewusst deaktiviert.
      </p>
    </section>
  );
}
