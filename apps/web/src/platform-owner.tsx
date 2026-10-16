import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "./lib/supabase";

export type OwnerAccess =
  "idle" | "checking" | "not_owner" | "mfa_required" | "ready" | "error";

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
    mfa_required: "Die MFA-Sitzung ist abgelaufen. Bitte erneut bestätigen.",
    platform_operator_required:
      "Dieses Konto besitzt keine aktive Plattform-Eigentümerrolle.",
    sso_required: "Für die Eigentümerkonsole ist Gross-ICT-SSO erforderlich.",
    tenant_provisioning_failed:
      "Der Mandant konnte nicht angelegt werden. Slug und Abteilungsnamen prüfen.",
    tenant_update_failed:
      "Der Mandantenstatus konnte nicht gespeichert werden.",
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
  if (code === "mfa_required") return { state: "mfa_required" };
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

export function OwnerMfaScreen({
  onComplete,
  onSignOut,
}: {
  onComplete: () => void;
  onSignOut: () => void;
}) {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("MFA-Zugang wird vorbereitet …");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const authClient = client;
    let mounted = true;
    async function prepareFactor() {
      const { data, error: factorsError } =
        await authClient.auth.mfa.listFactors();
      if (factorsError) throw factorsError;
      const verified = data.totp.find((factor) => factor.status === "verified");
      if (verified) {
        if (mounted) {
          setFactorId(verified.id);
          setMessage(
            "Geben Sie den aktuellen Code aus Ihrer Authenticator-App ein.",
          );
        }
        return;
      }
      const { data: enrollment, error: enrollmentError } =
        await authClient.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "nextDesk Eigentümerzugang",
        });
      if (enrollmentError) throw enrollmentError;
      if (mounted) {
        setFactorId(enrollment.id);
        setQrCode(enrollment.totp.qr_code);
        setMessage(
          "Scannen Sie den QR-Code mit einer Authenticator-App und bestätigen Sie danach den sechsstelligen Code.",
        );
      }
    }
    void prepareFactor()
      .catch((nextError: Error) => {
        if (mounted)
          setError(`MFA konnte nicht vorbereitet werden: ${nextError.message}`);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !factorId) return;
    setLoading(true);
    setError("");
    const { data: challenge, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) {
      setError(challengeError.message);
      setLoading(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    if (verifyError) {
      setError(
        "Der Code ist ungültig oder abgelaufen. Bitte erneut versuchen.",
      );
      setLoading(false);
      return;
    }
    await supabase.auth.refreshSession();
    onComplete();
  }

  return (
    <section className="owner-access-card">
      <p className="eyebrow">EIGENTÜMERZUGANG</p>
      <h1>MFA bestätigen.</h1>
      <p>{message}</p>
      {qrCode && (
        <img
          alt="QR-Code für nextDesk MFA"
          className="mfa-qr-code"
          src={qrCode}
        />
      )}
      {error && <p className="access-message error">{error}</p>}
      <form className="access-form" onSubmit={verify}>
        <label>
          Authenticator-Code
          <input
            autoComplete="one-time-code"
            disabled={loading || !factorId}
            inputMode="numeric"
            maxLength={8}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            required
            value={code}
          />
        </label>
        <button
          className="gross-sso-button"
          disabled={loading || code.trim().length < 6 || !factorId}
          type="submit"
        >
          MFA bestätigen <span aria-hidden="true">→</span>
        </button>
      </form>
      <button className="secondary-button" onClick={onSignOut} type="button">
        Abmelden
      </button>
    </section>
  );
}

export function OwnerConsoleScreen({ onSignOut }: { onSignOut: () => void }) {
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

  async function loadTenants() {
    setLoading(true);
    setError("");
    try {
      const data = await ownerConsoleRequest<TenantList>({
        type: "listTenants",
      });
      setTenants(data.tenants);
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

  return (
    <section className="owner-console" aria-label="Plattform-Eigentümerkonsole">
      <header className="owner-console-header">
        <div>
          <p className="eyebrow">PLATTFORM-EIGENTÜMER · SSO + MFA</p>
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
      <p className="owner-console-footer">
        Website-Bereitstellungen bleiben bis zur Hinterlegung eines
        serverseitigen GitHub-Dispatch-Tokens bewusst deaktiviert.
      </p>
    </section>
  );
}
