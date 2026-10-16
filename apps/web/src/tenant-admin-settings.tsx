import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { supabase } from "./lib/supabase";

export type TenantAdminSettingsProps = {
  tenantId: string;
  onClose: () => void;
};

type SsoProvider = "oidc" | "saml" | "azure_ad";
type SsoProviderSelection = SsoProvider | "";
type SaveTarget = "branding" | "sso" | `feature:${string}`;

type TenantSettings = {
  portal_name: string | null;
  support_email: string | null;
  ticket_access_enabled: boolean | null;
  allow_external_ticket_access: boolean | null;
  updated_at: string | null;
};

type TenantBranding = {
  logo_path?: string | null;
  logo_url?: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
  updated_at: string | null;
};

type SsoConfiguration = {
  provider: SsoProvider;
  enabled: boolean;
  issuer_url: string | null;
  discovery_url: string | null;
  client_id: string | null;
  allowed_email_domains: string[];
  enforce_sso: boolean;
  updated_at?: string;
};

type FeatureCatalogEntry = {
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  default_enabled: boolean;
};

type TenantFeature = {
  feature_key: string;
  enabled: boolean;
  updated_at: string | null;
  feature_catalog: FeatureCatalogEntry | FeatureCatalogEntry[] | null;
};

type TenantRole = {
  id: string;
  name: string;
  scope: string;
  active: boolean;
};

type TenantUser = {
  id: string;
  email: string | null;
  display_name: string | null;
  status: string;
  joined_at: string | null;
};

type SettingsData = {
  tenant_settings: TenantSettings | null;
  tenant_branding: TenantBranding | null;
  tenant_sso_configurations: SsoConfiguration[];
  tenant_feature_flags: TenantFeature[];
  roles: TenantRole[];
};

type UserListData = {
  users: TenantUser[];
  truncated: boolean;
};

type RoleListData = {
  roles: TenantRole[];
};

type FunctionEnvelope<T> = {
  data: T;
};

type BrandingUpdate = {
  portalName: string;
  logoUrl?: string | null;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
};

type TenantAdminRequest =
  | { type: "getSettings"; tenantId: string }
  | { type: "listUsers"; tenantId: string }
  | { type: "listRoles"; tenantId: string }
  | { type: "updateBranding"; tenantId: string; branding: BrandingUpdate }
  | {
      type: "updateSsoConfiguration";
      tenantId: string;
      provider: SsoProvider;
      enabled: boolean;
      issuerUrl: string | null;
      discoveryUrl: string | null;
      clientId: string | null;
      allowedEmailDomains: string[];
      enforceSso: boolean;
    }
  | {
      type: "toggleFeature";
      tenantId: string;
      featureKey: string;
      enabled: boolean;
    };

type BrandingForm = {
  portalName: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
};

type SsoForm = {
  provider: SsoProviderSelection;
  enabled: boolean;
  issuerUrl: string;
  discoveryUrl: string;
  clientId: string;
  allowedEmailDomains: string;
  enforceSso: boolean;
};

const emptyBrandingForm: BrandingForm = {
  portalName: "",
  logoUrl: "",
  primaryColor: "",
  secondaryColor: "",
  accentColor: "",
};

const emptySsoForm: SsoForm = {
  provider: "",
  enabled: false,
  issuerUrl: "",
  discoveryUrl: "",
  clientId: "",
  allowedEmailDomains: "",
  enforceSso: false,
};

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function tenantAdminRequest<T>(body: TenantAdminRequest): Promise<T> {
  if (!supabase) {
    throw new Error("Die Verbindung zu Supabase ist nicht konfiguriert.");
  }

  const { data, error } = await supabase.functions.invoke<FunctionEnvelope<T>>(
    "tenant-admin-settings",
    { body },
  );
  if (error) {
    throw new Error(
      error.message || "Die Einstellungsfunktion ist nicht erreichbar.",
    );
  }
  if (!isRecord(data) || !("data" in data)) {
    throw new Error(
      "Die Einstellungsfunktion hat keine verwertbaren Daten geliefert.",
    );
  }

  return data.data as T;
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function isDomain(value: string): boolean {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(
    value,
  );
}

function formatDate(value: string | null | undefined): string | null {
  if (!value || Number.isNaN(new Date(value).getTime())) return null;
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  }).format(new Date(value));
}

function asFeatureCatalogEntry(
  value: TenantFeature["feature_catalog"],
): FeatureCatalogEntry | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function realValue(value: string | null | undefined): string {
  return value?.trim() || "Nicht hinterlegt";
}

export function TenantAdminSettings({
  tenantId,
  onClose,
}: TenantAdminSettingsProps) {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [roles, setRoles] = useState<TenantRole[]>([]);
  const [usersTruncated, setUsersTruncated] = useState(false);
  const [brandingForm, setBrandingForm] =
    useState<BrandingForm>(emptyBrandingForm);
  const [ssoForm, setSsoForm] = useState<SsoForm>(emptySsoForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<SaveTarget | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextSettings, userList, roleList] = await Promise.all([
        tenantAdminRequest<SettingsData>({ type: "getSettings", tenantId }),
        tenantAdminRequest<UserListData>({ type: "listUsers", tenantId }),
        tenantAdminRequest<RoleListData>({ type: "listRoles", tenantId }),
      ]);
      setSettings(nextSettings);
      setUsers(userList.users);
      setUsersTruncated(userList.truncated);
      setRoles(roleList.roles);

      const branding = nextSettings.tenant_branding;
      setBrandingForm({
        portalName: nextSettings.tenant_settings?.portal_name ?? "",
        logoUrl: branding?.logo_url ?? branding?.logo_path ?? "",
        primaryColor: branding?.primary_color ?? "",
        secondaryColor: branding?.secondary_color ?? "",
        accentColor: branding?.accent_color ?? "",
      });

      const sso = nextSettings.tenant_sso_configurations[0];
      setSsoForm(
        sso
          ? {
              provider: sso.provider,
              enabled: sso.enabled,
              issuerUrl: sso.issuer_url ?? "",
              discoveryUrl: sso.discovery_url ?? "",
              clientId: sso.client_id ?? "",
              allowedEmailDomains: sso.allowed_email_domains.join("\n"),
              enforceSso: sso.enforce_sso,
            }
          : emptySsoForm,
      );
    } catch (nextError) {
      setSettings(null);
      setUsers([]);
      setRoles([]);
      setUsersTruncated(false);
      setError(
        messageFromError(
          nextError,
          "Die Mandanteneinstellungen konnten nicht geladen werden.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const activeUsers = useMemo(
    () => users.filter((user) => user.status === "active"),
    [users],
  );
  const branding = settings?.tenant_branding ?? null;
  const brandingLogoUrl = branding?.logo_url ?? branding?.logo_path ?? null;
  const ssoConfiguration = settings?.tenant_sso_configurations[0] ?? null;

  function beginSave(target: SaveTarget) {
    setSaving(target);
    setError("");
    setSuccess("");
  }

  async function saveBranding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const portalName = brandingForm.portalName.trim();
    if (portalName.length < 2 || portalName.length > 160) {
      setError("Der Portalname muss zwischen 2 und 160 Zeichen lang sein.");
      return;
    }

    const nextBranding: BrandingUpdate = { portalName };
    const logoUrl = brandingForm.logoUrl.trim();
    if (logoUrl) {
      if (!isHttpsUrl(logoUrl)) {
        setError("Die Logo-URL muss eine gültige HTTPS-Adresse sein.");
        return;
      }
      nextBranding.logoUrl = logoUrl;
    } else if (brandingLogoUrl) {
      nextBranding.logoUrl = null;
    }

    const colors: ReadonlyArray<
      readonly [
        keyof Pick<
          BrandingForm,
          "primaryColor" | "secondaryColor" | "accentColor"
        >,
        keyof Pick<
          BrandingUpdate,
          "primaryColor" | "secondaryColor" | "accentColor"
        >,
      ]
    > = [
      ["primaryColor", "primaryColor"],
      ["secondaryColor", "secondaryColor"],
      ["accentColor", "accentColor"],
    ];
    for (const [formKey, payloadKey] of colors) {
      const color = brandingForm[formKey].trim();
      if (!color) continue;
      if (!isHexColor(color)) {
        setError("Brand-Farben müssen im Format #RRGGBB angegeben werden.");
        return;
      }
      nextBranding[payloadKey] = color.toUpperCase();
    }

    beginSave("branding");
    try {
      await tenantAdminRequest<{ updated: boolean }>({
        type: "updateBranding",
        tenantId,
        branding: nextBranding,
      });
      await loadData();
      setSuccess("Corporate Design und Portalname wurden gespeichert.");
    } catch (nextError) {
      setError(
        messageFromError(
          nextError,
          "Corporate Design und Portalname konnten nicht gespeichert werden.",
        ),
      );
    } finally {
      setSaving(null);
    }
  }

  async function saveSsoConfiguration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ssoForm.provider) {
      setError("Wählen Sie einen SSO-Anbieter aus.");
      return;
    }

    const issuerUrl = ssoForm.issuerUrl.trim();
    const discoveryUrl = ssoForm.discoveryUrl.trim();
    const clientId = ssoForm.clientId.trim();
    if (issuerUrl && !isHttpsUrl(issuerUrl)) {
      setError("Die Issuer-URL muss eine gültige HTTPS-Adresse sein.");
      return;
    }
    if (discoveryUrl && !isHttpsUrl(discoveryUrl)) {
      setError("Die Discovery-URL muss eine gültige HTTPS-Adresse sein.");
      return;
    }
    if (ssoForm.enabled && !issuerUrl && !discoveryUrl) {
      setError(
        "Für aktiviertes SSO ist eine Issuer- oder Discovery-URL erforderlich.",
      );
      return;
    }
    if (ssoForm.enforceSso && !ssoForm.enabled) {
      setError("SSO kann nur erzwungen werden, wenn SSO aktiviert ist.");
      return;
    }

    const domains = ssoForm.allowedEmailDomains
      .split(/[\n,]/)
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean);
    if (domains.length > 50 || domains.some((domain) => !isDomain(domain))) {
      setError("Geben Sie höchstens 50 gültige E-Mail-Domains ein.");
      return;
    }

    beginSave("sso");
    try {
      await tenantAdminRequest<{ updated: boolean }>({
        type: "updateSsoConfiguration",
        tenantId,
        provider: ssoForm.provider,
        enabled: ssoForm.enabled,
        issuerUrl: issuerUrl || null,
        discoveryUrl: discoveryUrl || null,
        clientId: clientId || null,
        allowedEmailDomains: [...new Set(domains)],
        enforceSso: ssoForm.enforceSso,
      });
      await loadData();
      setSuccess("Die SSO-Konfiguration wurde gespeichert.");
    } catch (nextError) {
      setError(
        messageFromError(
          nextError,
          "Die SSO-Konfiguration konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setSaving(null);
    }
  }

  async function toggleFeature(feature: TenantFeature) {
    const target: SaveTarget = `feature:${feature.feature_key}`;
    beginSave(target);
    try {
      await tenantAdminRequest<{ updated: boolean }>({
        type: "toggleFeature",
        tenantId,
        featureKey: feature.feature_key,
        enabled: !feature.enabled,
      });
      await loadData();
      setSuccess(`Die Funktion „${feature.feature_key}“ wurde aktualisiert.`);
    } catch (nextError) {
      setError(
        messageFromError(
          nextError,
          "Die Funktion konnte nicht aktualisiert werden.",
        ),
      );
    } finally {
      setSaving(null);
    }
  }

  return (
    <section
      className="tenant-admin-settings"
      aria-labelledby="tenant-settings-title"
    >
      <header className="tenant-admin-settings__header">
        <div>
          <p className="tenant-admin-settings__eyebrow">Mandantenverwaltung</p>
          <h1 id="tenant-settings-title">Einstellungen</h1>
          <p className="tenant-admin-settings__tenant-id">
            Mandanten-ID: {tenantId}
          </p>
        </div>
        <button
          className="tenant-admin-settings__close"
          type="button"
          onClick={onClose}
        >
          Schliessen
        </button>
      </header>

      {error ? (
        <p
          className="tenant-admin-settings__notice tenant-admin-settings__notice--error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {success ? (
        <p
          className="tenant-admin-settings__notice tenant-admin-settings__notice--success"
          role="status"
        >
          {success}
        </p>
      ) : null}

      {loading ? (
        <p className="tenant-admin-settings__loading" aria-live="polite">
          Mandanteneinstellungen werden geladen …
        </p>
      ) : null}

      {!loading && settings ? (
        <div className="tenant-admin-settings__content">
          <section
            className="tenant-admin-settings__section"
            aria-labelledby="tenant-general-heading"
          >
            <h2 id="tenant-general-heading">Mandanteneinstellungen</h2>
            <dl className="tenant-admin-settings__details">
              <div>
                <dt>Portalname</dt>
                <dd>{realValue(settings.tenant_settings?.portal_name)}</dd>
              </div>
              <div>
                <dt>Support-E-Mail</dt>
                <dd>{realValue(settings.tenant_settings?.support_email)}</dd>
              </div>
              <div>
                <dt>Ticketzugang</dt>
                <dd>
                  {settings.tenant_settings?.ticket_access_enabled === null ||
                  settings.tenant_settings?.ticket_access_enabled === undefined
                    ? "Nicht hinterlegt"
                    : settings.tenant_settings.ticket_access_enabled
                      ? "Aktiviert"
                      : "Deaktiviert"}
                </dd>
              </div>
              <div>
                <dt>Externer Ticketzugang</dt>
                <dd>
                  {settings.tenant_settings?.allow_external_ticket_access ===
                    null ||
                  settings.tenant_settings?.allow_external_ticket_access ===
                    undefined
                    ? "Nicht hinterlegt"
                    : settings.tenant_settings.allow_external_ticket_access
                      ? "Aktiviert"
                      : "Deaktiviert"}
                </dd>
              </div>
            </dl>
          </section>

          <section
            className="tenant-admin-settings__section"
            aria-labelledby="tenant-branding-heading"
          >
            <div className="tenant-admin-settings__section-heading">
              <div>
                <h2 id="tenant-branding-heading">Corporate Design</h2>
                <p>
                  Die folgenden Werte stammen aus der aktuellen
                  Mandantenkonfiguration.
                </p>
              </div>
            </div>
            {branding ? (
              <dl className="tenant-admin-settings__details tenant-admin-settings__details--branding">
                {(
                  ["primary_color", "secondary_color", "accent_color"] as const
                ).map((colorKey) => {
                  const color = branding[colorKey];
                  if (!color) return null;
                  const label = {
                    primary_color: "Primärfarbe",
                    secondary_color: "Sekundärfarbe",
                    accent_color: "Akzentfarbe",
                  }[colorKey];
                  return (
                    <div key={colorKey}>
                      <dt>{label}</dt>
                      <dd className="tenant-admin-settings__color-value">
                        {isHexColor(color) ? (
                          <span
                            className="tenant-admin-settings__color-swatch"
                            style={{ backgroundColor: color }}
                            aria-label={`Farbwert ${color}`}
                          />
                        ) : null}
                        {color}
                      </dd>
                    </div>
                  );
                })}
                {brandingLogoUrl ? (
                  <div className="tenant-admin-settings__logo-url">
                    <dt>Logo-URL</dt>
                    <dd>
                      <a
                        href={brandingLogoUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {brandingLogoUrl}
                      </a>
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p>
                Für diesen Mandanten wurde noch kein Corporate Design
                zurückgegeben.
              </p>
            )}

            <form
              className="tenant-admin-settings__form"
              onSubmit={saveBranding}
            >
              <h3>Corporate Design bearbeiten</h3>
              <label>
                Portalname
                <input
                  type="text"
                  value={brandingForm.portalName}
                  minLength={2}
                  maxLength={160}
                  required
                  disabled={saving !== null}
                  onChange={(event) =>
                    setBrandingForm((current) => ({
                      ...current,
                      portalName: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Logo-URL
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://…"
                  value={brandingForm.logoUrl}
                  disabled={saving !== null}
                  onChange={(event) =>
                    setBrandingForm((current) => ({
                      ...current,
                      logoUrl: event.target.value,
                    }))
                  }
                />
                <span className="tenant-admin-settings__hint">
                  Eine leere Logo-URL entfernt ein vorhandenes Logo.
                </span>
              </label>
              <div className="tenant-admin-settings__form-grid">
                <label>
                  Primärfarbe
                  <input
                    type="text"
                    inputMode="text"
                    placeholder="#RRGGBB"
                    value={brandingForm.primaryColor}
                    disabled={saving !== null}
                    onChange={(event) =>
                      setBrandingForm((current) => ({
                        ...current,
                        primaryColor: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Sekundärfarbe
                  <input
                    type="text"
                    inputMode="text"
                    placeholder="#RRGGBB"
                    value={brandingForm.secondaryColor}
                    disabled={saving !== null}
                    onChange={(event) =>
                      setBrandingForm((current) => ({
                        ...current,
                        secondaryColor: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Akzentfarbe
                  <input
                    type="text"
                    inputMode="text"
                    placeholder="#RRGGBB"
                    value={brandingForm.accentColor}
                    disabled={saving !== null}
                    onChange={(event) =>
                      setBrandingForm((current) => ({
                        ...current,
                        accentColor: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <button type="submit" disabled={saving !== null}>
                {saving === "branding"
                  ? "Wird gespeichert …"
                  : "Corporate Design speichern"}
              </button>
            </form>
          </section>

          <section
            className="tenant-admin-settings__section"
            aria-labelledby="tenant-sso-heading"
          >
            <h2 id="tenant-sso-heading">SSO-Konfiguration</h2>
            {ssoConfiguration ? (
              <dl className="tenant-admin-settings__details">
                <div>
                  <dt>Anbieter</dt>
                  <dd>{ssoConfiguration.provider}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    {ssoConfiguration.enabled ? "Aktiviert" : "Deaktiviert"}
                  </dd>
                </div>
                {ssoConfiguration.issuer_url ? (
                  <div>
                    <dt>Issuer-URL</dt>
                    <dd>{ssoConfiguration.issuer_url}</dd>
                  </div>
                ) : null}
                {ssoConfiguration.discovery_url ? (
                  <div>
                    <dt>Discovery-URL</dt>
                    <dd>{ssoConfiguration.discovery_url}</dd>
                  </div>
                ) : null}
                {ssoConfiguration.client_id ? (
                  <div>
                    <dt>Client-ID</dt>
                    <dd>{ssoConfiguration.client_id}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>SSO erzwingen</dt>
                  <dd>{ssoConfiguration.enforce_sso ? "Ja" : "Nein"}</dd>
                </div>
              </dl>
            ) : (
              <p>
                Für diesen Mandanten wurde noch keine SSO-Konfiguration
                zurückgegeben.
              </p>
            )}
            <p className="tenant-admin-settings__security-note">
              Geheime Client-Schlüssel werden hier weder angezeigt noch
              gespeichert. Sie müssen getrennt und sicher serverseitig
              hinterlegt werden.
            </p>

            <form
              className="tenant-admin-settings__form"
              onSubmit={saveSsoConfiguration}
            >
              <h3>SSO-Konfiguration bearbeiten</h3>
              <div className="tenant-admin-settings__form-grid">
                <label>
                  Anbieter
                  <select
                    value={ssoForm.provider}
                    disabled={saving !== null}
                    onChange={(event) =>
                      setSsoForm((current) => ({
                        ...current,
                        provider: event.target.value as SsoProviderSelection,
                      }))
                    }
                  >
                    <option value="">Bitte auswählen</option>
                    <option value="oidc">OpenID Connect (OIDC)</option>
                    <option value="saml">SAML</option>
                    <option value="azure_ad">Microsoft Entra ID</option>
                  </select>
                </label>
                <label>
                  Client-ID
                  <input
                    type="text"
                    value={ssoForm.clientId}
                    maxLength={512}
                    disabled={saving !== null}
                    onChange={(event) =>
                      setSsoForm((current) => ({
                        ...current,
                        clientId: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Issuer-URL
                  <input
                    type="url"
                    inputMode="url"
                    placeholder="https://…"
                    value={ssoForm.issuerUrl}
                    disabled={saving !== null}
                    onChange={(event) =>
                      setSsoForm((current) => ({
                        ...current,
                        issuerUrl: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Discovery-URL
                  <input
                    type="url"
                    inputMode="url"
                    placeholder="https://…"
                    value={ssoForm.discoveryUrl}
                    disabled={saving !== null}
                    onChange={(event) =>
                      setSsoForm((current) => ({
                        ...current,
                        discoveryUrl: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <label>
                Zugelassene E-Mail-Domains
                <textarea
                  value={ssoForm.allowedEmailDomains}
                  rows={3}
                  placeholder="beispiel.ch&#10;beispiel.org"
                  disabled={saving !== null}
                  onChange={(event) =>
                    setSsoForm((current) => ({
                      ...current,
                      allowedEmailDomains: event.target.value,
                    }))
                  }
                />
                <span className="tenant-admin-settings__hint">
                  Eine Domain pro Zeile oder durch Kommas getrennt.
                </span>
              </label>
              <div className="tenant-admin-settings__checkboxes">
                <label>
                  <input
                    type="checkbox"
                    checked={ssoForm.enabled}
                    disabled={saving !== null}
                    onChange={(event) =>
                      setSsoForm((current) => ({
                        ...current,
                        enabled: event.target.checked,
                      }))
                    }
                  />
                  SSO aktivieren
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={ssoForm.enforceSso}
                    disabled={saving !== null || !ssoForm.enabled}
                    onChange={(event) =>
                      setSsoForm((current) => ({
                        ...current,
                        enforceSso: event.target.checked,
                      }))
                    }
                  />
                  SSO für die Anmeldung erzwingen
                </label>
              </div>
              <button type="submit" disabled={saving !== null}>
                {saving === "sso"
                  ? "Wird gespeichert …"
                  : "SSO-Konfiguration speichern"}
              </button>
            </form>
          </section>

          <section
            className="tenant-admin-settings__section"
            aria-labelledby="tenant-features-heading"
          >
            <h2 id="tenant-features-heading">Feature-Schalter</h2>
            {settings.tenant_feature_flags.length > 0 ? (
              <ul className="tenant-admin-settings__feature-list">
                {settings.tenant_feature_flags.map((feature) => {
                  const catalog = asFeatureCatalogEntry(
                    feature.feature_catalog,
                  );
                  const target: SaveTarget = `feature:${feature.feature_key}`;
                  return (
                    <li
                      key={feature.feature_key}
                      className="tenant-admin-settings__feature"
                    >
                      <div>
                        <strong>{catalog?.name || feature.feature_key}</strong>
                        {catalog?.description ? (
                          <p>{catalog.description}</p>
                        ) : null}
                        <span className="tenant-admin-settings__feature-key">
                          {feature.feature_key}
                        </span>
                      </div>
                      <label>
                        <span className="tenant-admin-settings__visually-hidden">
                          {feature.enabled ? "Deaktivieren" : "Aktivieren"}:{" "}
                          {catalog?.name || feature.feature_key}
                        </span>
                        <input
                          type="checkbox"
                          checked={feature.enabled}
                          disabled={saving !== null}
                          onChange={() => void toggleFeature(feature)}
                        />
                        <span aria-hidden="true">
                          {saving === target
                            ? "Wird gespeichert …"
                            : feature.enabled
                              ? "Aktiviert"
                              : "Deaktiviert"}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>
                Für diesen Mandanten wurden keine Feature-Schalter
                zurückgegeben.
              </p>
            )}
          </section>

          <section
            className="tenant-admin-settings__section"
            aria-labelledby="tenant-users-heading"
          >
            <h2 id="tenant-users-heading">Aktive Benutzer*innen</h2>
            {activeUsers.length > 0 ? (
              <ul className="tenant-admin-settings__person-list">
                {activeUsers.map((user) => (
                  <li key={user.id}>
                    <strong>{realValue(user.display_name)}</strong>
                    {user.email ? <span>{user.email}</span> : null}
                    <span>
                      Beigetreten:{" "}
                      {formatDate(user.joined_at) ?? "Nicht hinterlegt"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Es wurden keine aktiven Benutzer*innen zurückgegeben.</p>
            )}
            {usersTruncated ? (
              <p>Die Benutzer*innenliste wurde vom Backend begrenzt.</p>
            ) : null}
          </section>

          <section
            className="tenant-admin-settings__section"
            aria-labelledby="tenant-roles-heading"
          >
            <h2 id="tenant-roles-heading">Rollen</h2>
            {roles.length > 0 ? (
              <ul className="tenant-admin-settings__role-list">
                {roles.map((role) => (
                  <li key={role.id}>
                    <strong>{role.name}</strong>
                    <span>{role.scope}</span>
                    <span>{role.active ? "Aktiv" : "Inaktiv"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Für diesen Mandanten wurden keine Rollen zurückgegeben.</p>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
