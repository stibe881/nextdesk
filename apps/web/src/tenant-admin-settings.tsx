import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { supabase } from "./lib/supabase";
import { functionErrorMessage } from "./lib/function-error";

export type TenantAdminSettingsProps = {
  tenantId: string;
  onClose: () => void;
};

type SsoProvider = "oidc" | "saml" | "azure_ad";
type SsoProviderSelection = SsoProvider | "";
type SaveTarget =
  | "branding"
  | "sso"
  | "invite-user"
  | `feature:${string}`
  | `remove-user:${string}`
  | `revoke-invitation:${string}`
  | `role:${string}`
  | "assign-role"
  | `revoke-role:${string}`;

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
  isSystem: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  permissionCodes: string[];
};

type TenantPermission = {
  code: string;
  description: string;
  is_sensitive: boolean;
};

type RoleAssignment = {
  id: string;
  user_id: string;
  role_id: string;
  department_id: string | null;
  team_id: string | null;
  starts_at: string;
  expires_at: string | null;
};

type RoleAssignmentWithDetails = RoleAssignment & {
  roleName: string;
  user: {
    id: string;
    displayName: string | null;
    email: string | null;
  };
};

type TenantDirectoryMember = {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  joinedAt: string | null;
};

type TenantInvitation = {
  id: string;
  email: string;
  status: "sent" | "accepted";
  expires_at: string;
  created_at: string;
};

type SettingsData = {
  tenant_settings: TenantSettings | null;
  tenant_branding: TenantBranding | null;
  tenant_sso_configurations: SsoConfiguration[];
  tenant_feature_flags: TenantFeature[];
  roles: TenantRole[];
};

type TenantUserDirectory = {
  members: TenantDirectoryMember[];
  invitations: TenantInvitation[];
};

type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  severity: string;
  occurredAt: string;
  actorName: string;
};

type AuditListData = {
  entries: AuditEntry[];
  truncated: boolean;
};

type RoleListData = {
  roles: TenantRole[];
  roleAssignments: RoleAssignmentWithDetails[];
};

type PermissionListData = {
  permissions: TenantPermission[];
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

type TenantUsersRequest =
  | { type: "listUsers"; tenantId: string }
  | { type: "inviteUser"; tenantId: string; email: string }
  | { type: "removeUser"; tenantId: string; userId: string }
  | {
      type: "revokeInvitation";
      tenantId: string;
      invitationId: string;
    };

type TenantAuditRequest = { type: "list"; tenantId: string; limit: number };

type TenantRoleManagementRequest =
  | { type: "listRoles"; tenantId: string }
  | { type: "listPermissions"; tenantId: string }
  | {
      type: "createRole";
      tenantId: string;
      name: string;
      permissionCodes: string[];
    }
  | {
      type: "updateRole";
      tenantId: string;
      roleId: string;
      name?: string;
      permissionCodes?: string[];
      active?: boolean;
    }
  | {
      type: "assignRole";
      tenantId: string;
      userId: string;
      roleId: string;
      departmentId: null;
      teamId: null;
    }
  | { type: "revokeRole"; tenantId: string; assignmentId: string };

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

type RoleForm = {
  name: string;
  permissionCodes: string[];
};

type RoleAssignmentForm = {
  userId: string;
  roleId: string;
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

const emptyRoleForm: RoleForm = {
  name: "",
  permissionCodes: [],
};

const emptyRoleAssignmentForm: RoleAssignmentForm = {
  userId: "",
  roleId: "",
};

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRoleAssignments(value: unknown): RoleAssignmentWithDetails[] {
  if (!Array.isArray(value)) {
    throw new Error(
      "Die Rollenverwaltung hat keine Rollenzuweisungen geliefert.",
    );
  }

  return value.map((rawAssignment, index) => {
    if (!isRecord(rawAssignment) || !isRecord(rawAssignment.user)) {
      throw new Error(
        `Die Rollenzuweisung an Position ${index + 1} ist ungültig.`,
      );
    }

    const user = rawAssignment.user;
    const id = rawAssignment.id;
    const userId = rawAssignment.user_id;
    const roleId = rawAssignment.role_id;
    const departmentId = rawAssignment.department_id;
    const teamId = rawAssignment.team_id;
    const startsAt = rawAssignment.starts_at;
    const expiresAt = rawAssignment.expires_at;
    const roleName = rawAssignment.roleName;
    const displayName = user.displayName;
    const email = user.email;

    if (
      typeof id !== "string" ||
      typeof userId !== "string" ||
      typeof roleId !== "string" ||
      (typeof departmentId !== "string" && departmentId !== null) ||
      (typeof teamId !== "string" && teamId !== null) ||
      typeof startsAt !== "string" ||
      (typeof expiresAt !== "string" && expiresAt !== null) ||
      typeof roleName !== "string" ||
      typeof user.id !== "string" ||
      (typeof displayName !== "string" && displayName !== null) ||
      (typeof email !== "string" && email !== null)
    ) {
      throw new Error(
        `Die Rollenzuweisung an Position ${index + 1} ist ungültig.`,
      );
    }

    return {
      id,
      user_id: userId,
      role_id: roleId,
      department_id: departmentId,
      team_id: teamId,
      starts_at: startsAt,
      expires_at: expiresAt,
      roleName,
      user: {
        id: user.id,
        displayName,
        email,
      },
    };
  });
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
      await functionErrorMessage(
        error,
        "Die Einstellungsfunktion ist nicht erreichbar.",
      ),
    );
  }
  if (!isRecord(data) || !("data" in data)) {
    throw new Error(
      "Die Einstellungsfunktion hat keine verwertbaren Daten geliefert.",
    );
  }

  return data.data as T;
}

async function tenantUsersRequest<T>(body: TenantUsersRequest): Promise<T> {
  if (!supabase) {
    throw new Error("Die Verbindung zu Supabase ist nicht konfiguriert.");
  }

  const { data, error } = await supabase.functions.invoke<FunctionEnvelope<T>>(
    "tenant-users",
    { body },
  );
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Die Benutzeraktion ist nicht erreichbar.",
      ),
    );
  }
  if (!isRecord(data) || !("data" in data)) {
    throw new Error(
      "Die Benutzeraktion hat keine verwertbaren Daten geliefert.",
    );
  }

  return data.data as T;
}

async function tenantAuditRequest<T>(body: TenantAuditRequest): Promise<T> {
  if (!supabase) {
    throw new Error("Die Verbindung zu Supabase ist nicht konfiguriert.");
  }

  const { data, error } = await supabase.functions.invoke<FunctionEnvelope<T>>(
    "tenant-audit-log",
    { body },
  );
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Das Änderungsprotokoll ist nicht erreichbar.",
      ),
    );
  }
  if (!isRecord(data) || !("data" in data)) {
    throw new Error(
      "Das Änderungsprotokoll hat keine verwertbaren Daten geliefert.",
    );
  }

  return data.data as T;
}

async function tenantRoleManagementRequest<T>(
  body: TenantRoleManagementRequest,
): Promise<T> {
  if (!supabase) {
    throw new Error("Die Verbindung zu Supabase ist nicht konfiguriert.");
  }

  const { data, error } = await supabase.functions.invoke<FunctionEnvelope<T>>(
    "tenant-role-management",
    { body },
  );
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Die Rollenverwaltung ist nicht erreichbar.",
      ),
    );
  }
  if (!isRecord(data) || !("data" in data)) {
    throw new Error(
      "Die Rollenverwaltung hat keine verwertbaren Daten geliefert.",
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
  const [userDirectory, setUserDirectory] = useState<TenantUserDirectory>({
    members: [],
    invitations: [],
  });
  const [roles, setRoles] = useState<TenantRole[]>([]);
  const [permissions, setPermissions] = useState<TenantPermission[]>([]);
  const [roleForm, setRoleForm] = useState<RoleForm>(emptyRoleForm);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [roleEditForm, setRoleEditForm] = useState<RoleForm>(emptyRoleForm);
  const [roleAssignmentForm, setRoleAssignmentForm] =
    useState<RoleAssignmentForm>(emptyRoleAssignmentForm);
  const [roleAssignments, setRoleAssignments] = useState<
    RoleAssignmentWithDetails[]
  >([]);
  const [assignmentPendingRevocation, setAssignmentPendingRevocation] =
    useState<RoleAssignmentWithDetails | null>(null);
  const [invitationEmail, setInvitationEmail] = useState("");
  const [brandingForm, setBrandingForm] =
    useState<BrandingForm>(emptyBrandingForm);
  const [ssoForm, setSsoForm] = useState<SsoForm>(emptySsoForm);
  const [loading, setLoading] = useState(true);
  const [audit, setAudit] = useState<AuditListData>({
    entries: [],
    truncated: false,
  });
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState("");
  const [saving, setSaving] = useState<SaveTarget | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextSettings, nextUserDirectory, roleList, permissionList] =
        await Promise.all([
          tenantAdminRequest<SettingsData>({ type: "getSettings", tenantId }),
          tenantUsersRequest<TenantUserDirectory>({
            type: "listUsers",
            tenantId,
          }),
          tenantRoleManagementRequest<RoleListData>({
            type: "listRoles",
            tenantId,
          }),
          tenantRoleManagementRequest<PermissionListData>({
            type: "listPermissions",
            tenantId,
          }),
        ]);
      setSettings(nextSettings);
      setUserDirectory(nextUserDirectory);
      setRoles(roleList.roles);
      setRoleAssignments(parseRoleAssignments(roleList.roleAssignments));
      setPermissions(permissionList.permissions);

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
      setUserDirectory({ members: [], invitations: [] });
      setRoles([]);
      setRoleAssignments([]);
      setPermissions([]);
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

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    setAuditError("");
    try {
      const nextAudit = await tenantAuditRequest<AuditListData>({
        type: "list",
        tenantId,
        limit: 50,
      });
      setAudit(nextAudit);
    } catch (nextError) {
      setAudit({ entries: [], truncated: false });
      setAuditError(
        messageFromError(
          nextError,
          "Das Änderungsprotokoll konnte nicht geladen werden.",
        ),
      );
    } finally {
      setAuditLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  useEffect(() => {
    setRoleForm(emptyRoleForm);
    setEditingRoleId(null);
    setRoleEditForm(emptyRoleForm);
    setRoleAssignmentForm(emptyRoleAssignmentForm);
    setRoleAssignments([]);
    setAssignmentPendingRevocation(null);
  }, [tenantId]);

  const activeUsers = useMemo(
    () => userDirectory.members.filter((member) => member.status === "active"),
    [userDirectory.members],
  );
  const openInvitations = useMemo(
    () =>
      userDirectory.invitations.filter(
        (invitation) => invitation.status === "sent",
      ),
    [userDirectory.invitations],
  );
  const branding = settings?.tenant_branding ?? null;
  const brandingLogoUrl = branding?.logo_url ?? branding?.logo_path ?? null;
  const ssoConfiguration = settings?.tenant_sso_configurations[0] ?? null;
  const permissionsByCode = useMemo(
    () =>
      new Map(permissions.map((permission) => [permission.code, permission])),
    [permissions],
  );
  const assignableRoles = useMemo(
    () => roles.filter((role) => role.active && role.scope === "tenant"),
    [roles],
  );

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

  async function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = invitationEmail.trim().toLowerCase();
    if (!email) {
      setError("Geben Sie eine E-Mail-Adresse für die Einladung ein.");
      return;
    }

    beginSave("invite-user");
    try {
      await tenantUsersRequest<{ sent: boolean; expiresAt: string }>({
        type: "inviteUser",
        tenantId,
        email,
      });
      setInvitationEmail("");
      await loadData();
      setSuccess(`Einladungslink wurde an ${email} versendet.`);
    } catch (nextError) {
      setError(
        messageFromError(
          nextError,
          "Die Einladung konnte nicht versendet werden.",
        ),
      );
    } finally {
      setSaving(null);
    }
  }

  async function removeUser(member: TenantDirectoryMember) {
    const target: SaveTarget = `remove-user:${member.id}`;
    beginSave(target);
    try {
      await tenantUsersRequest<{ removed: boolean }>({
        type: "removeUser",
        tenantId,
        userId: member.id,
      });
      await loadData();
      setSuccess(`${member.email} wurde aus diesem Mandanten entfernt.`);
    } catch (nextError) {
      setError(
        messageFromError(
          nextError,
          "Die Benutzer*in konnte nicht entfernt werden.",
        ),
      );
    } finally {
      setSaving(null);
    }
  }

  async function revokeInvitation(invitation: TenantInvitation) {
    const target: SaveTarget = `revoke-invitation:${invitation.id}`;
    beginSave(target);
    try {
      await tenantUsersRequest<{ revoked: boolean }>({
        type: "revokeInvitation",
        tenantId,
        invitationId: invitation.id,
      });
      await loadData();
      setSuccess(`Die Einladung an ${invitation.email} wurde widerrufen.`);
    } catch (nextError) {
      setError(
        messageFromError(
          nextError,
          "Die Einladung konnte nicht widerrufen werden.",
        ),
      );
    } finally {
      setSaving(null);
    }
  }

  function toggleRolePermission(
    permissionCode: string,
    setForm: (updater: (current: RoleForm) => RoleForm) => void,
  ) {
    setForm((current) => ({
      ...current,
      permissionCodes: current.permissionCodes.includes(permissionCode)
        ? current.permissionCodes.filter((code) => code !== permissionCode)
        : [...current.permissionCodes, permissionCode],
    }));
  }

  function roleNameIsValid(name: string): boolean {
    const length = Array.from(name.trim()).length;
    return length >= 3 && length <= 120;
  }

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = roleForm.name.trim();
    if (!roleNameIsValid(name)) {
      setError("Der Rollenname muss zwischen 3 und 120 Zeichen lang sein.");
      return;
    }

    beginSave("role:create");
    try {
      await tenantRoleManagementRequest<{ role: TenantRole }>({
        type: "createRole",
        tenantId,
        name,
        permissionCodes: roleForm.permissionCodes,
      });
      setRoleForm(emptyRoleForm);
      await loadData();
      setSuccess(`Die Rolle „${name}“ wurde erstellt.`);
    } catch (nextError) {
      setError(
        messageFromError(nextError, "Die Rolle konnte nicht erstellt werden."),
      );
    } finally {
      setSaving(null);
    }
  }

  function startRoleEdit(role: TenantRole) {
    if (role.isSystem) return;
    setEditingRoleId(role.id);
    setRoleEditForm({
      name: role.name,
      permissionCodes: role.permissionCodes,
    });
    setError("");
    setSuccess("");
  }

  async function updateRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const role = roles.find((item) => item.id === editingRoleId);
    const name = roleEditForm.name.trim();
    if (!role || role.isSystem) {
      setError("Diese Systemrolle kann nicht bearbeitet werden.");
      return;
    }
    if (!roleNameIsValid(name)) {
      setError("Der Rollenname muss zwischen 3 und 120 Zeichen lang sein.");
      return;
    }

    const target: SaveTarget = `role:${role.id}`;
    beginSave(target);
    try {
      await tenantRoleManagementRequest<{ role: TenantRole }>({
        type: "updateRole",
        tenantId,
        roleId: role.id,
        name,
        permissionCodes: roleEditForm.permissionCodes,
      });
      setEditingRoleId(null);
      setRoleEditForm(emptyRoleForm);
      await loadData();
      setSuccess(`Die Rolle „${name}“ wurde aktualisiert.`);
    } catch (nextError) {
      setError(
        messageFromError(
          nextError,
          "Die Rolle konnte nicht aktualisiert werden.",
        ),
      );
    } finally {
      setSaving(null);
    }
  }

  async function setRoleActivity(role: TenantRole) {
    if (role.isSystem) return;
    const target: SaveTarget = `role:${role.id}`;
    beginSave(target);
    try {
      await tenantRoleManagementRequest<{ role: TenantRole }>({
        type: "updateRole",
        tenantId,
        roleId: role.id,
        active: !role.active,
      });
      await loadData();
      setSuccess(
        `Die Rolle „${role.name}“ wurde ${role.active ? "deaktiviert" : "aktiviert"}.`,
      );
    } catch (nextError) {
      setError(
        messageFromError(
          nextError,
          "Der Rollenstatus konnte nicht geändert werden.",
        ),
      );
    } finally {
      setSaving(null);
    }
  }

  async function assignRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const person = activeUsers.find(
      (member) => member.id === roleAssignmentForm.userId,
    );
    const role = assignableRoles.find(
      (item) => item.id === roleAssignmentForm.roleId,
    );
    if (!person || !role) {
      setError(
        "Wählen Sie eine aktive Person und eine aktive Mandantenrolle aus.",
      );
      return;
    }

    beginSave("assign-role");
    try {
      const result = await tenantRoleManagementRequest<{
        assignment: RoleAssignment;
      }>({
        type: "assignRole",
        tenantId,
        userId: person.id,
        roleId: role.id,
        departmentId: null,
        teamId: null,
      });
      const assignment: RoleAssignmentWithDetails = {
        ...result.assignment,
        roleName: role.name,
        user: {
          id: person.id,
          displayName: person.displayName,
          email: person.email,
        },
      };
      setRoleAssignments((current) => [
        ...current.filter(
          (currentAssignment) => currentAssignment.id !== assignment.id,
        ),
        assignment,
      ]);
      setRoleAssignmentForm((current) => ({ ...current, roleId: "" }));
      setSuccess(`Die Rolle „${role.name}“ wurde ${person.email} zugewiesen.`);
    } catch (nextError) {
      setError(
        messageFromError(
          nextError,
          "Die Rolle konnte nicht zugewiesen werden.",
        ),
      );
    } finally {
      setSaving(null);
    }
  }

  async function revokeRoleAssignment(assignment: RoleAssignmentWithDetails) {
    const target: SaveTarget = `revoke-role:${assignment.id}`;
    beginSave(target);
    try {
      await tenantRoleManagementRequest<{ revoked: boolean }>({
        type: "revokeRole",
        tenantId,
        assignmentId: assignment.id,
      });
      setRoleAssignments((current) =>
        current.filter((item) => item.id !== assignment.id),
      );
      setAssignmentPendingRevocation(null);
      setSuccess("Die Rollenzuweisung wurde entzogen.");
    } catch (nextError) {
      setError(
        messageFromError(
          nextError,
          "Die Rollenzuweisung konnte nicht entzogen werden.",
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
            aria-labelledby="tenant-audit-heading"
          >
            <div className="tenant-admin-settings__section-heading">
              <div>
                <h2 id="tenant-audit-heading">Änderungsprotokoll</h2>
                <p>
                  Die letzten sicherheitsrelevanten Änderungen dieses Mandanten.
                </p>
              </div>
              <button
                type="button"
                disabled={auditLoading}
                onClick={() => void loadAudit()}
              >
                {auditLoading ? "Wird geladen …" : "Aktualisieren"}
              </button>
            </div>
            {auditError ? (
              <p
                className="tenant-admin-settings__notice tenant-admin-settings__notice--error"
                role="status"
              >
                {auditError}
              </p>
            ) : auditLoading ? (
              <p className="tenant-admin-settings__loading" aria-live="polite">
                Änderungsprotokoll wird geladen …
              </p>
            ) : audit.entries.length > 0 ? (
              <ol className="tenant-admin-settings__audit-list">
                {audit.entries.map((entry) => (
                  <li key={entry.id}>
                    <span
                      className={`tenant-admin-settings__audit-severity tenant-admin-settings__audit-severity--${entry.severity}`}
                    >
                      {entry.severity}
                    </span>
                    <div>
                      <strong>{entry.action.replaceAll(".", " · ")}</strong>
                      <span>
                        {entry.entityType.replaceAll("_", " ")} ·{" "}
                        {entry.actorName}
                      </span>
                    </div>
                    <time dateTime={entry.occurredAt}>
                      {formatDate(entry.occurredAt) ?? "Unbekannter Zeitpunkt"}
                    </time>
                  </li>
                ))}
              </ol>
            ) : (
              <p>Für diesen Mandanten liegen noch keine Änderungen vor.</p>
            )}
            {audit.truncated ? (
              <p className="tenant-admin-settings__hint">
                Es werden die 50 aktuellsten Einträge angezeigt.
              </p>
            ) : null}
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
            <h2 id="tenant-users-heading">Benutzer*innen</h2>
            <form className="tenant-admin-settings__form" onSubmit={inviteUser}>
              <h3>Benutzer*in einladen</h3>
              <label>
                E-Mail-Adresse
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={invitationEmail}
                  required
                  disabled={saving !== null}
                  onChange={(event) => setInvitationEmail(event.target.value)}
                />
              </label>
              <button type="submit" disabled={saving !== null}>
                {saving === "invite-user"
                  ? "Einladung wird versendet …"
                  : "Einladung versenden"}
              </button>
            </form>

            <h3>Aktive Benutzer*innen</h3>
            {activeUsers.length > 0 ? (
              <ul className="tenant-admin-settings__person-list">
                {activeUsers.map((member) => {
                  const target: SaveTarget = `remove-user:${member.id}`;
                  return (
                    <li key={member.id}>
                      <strong>
                        {member.displayName?.trim() || member.email}
                      </strong>
                      <span>{member.email}</span>
                      <span>
                        Beigetreten:{" "}
                        {formatDate(member.joinedAt) ?? "Nicht hinterlegt"}
                      </span>
                      <button
                        type="button"
                        disabled={saving !== null}
                        onClick={() => void removeUser(member)}
                      >
                        {saving === target ? "Wird entfernt …" : "Entfernen"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>Es sind keine aktiven Benutzer*innen vorhanden.</p>
            )}

            <h3>Offene Einladungen</h3>
            {openInvitations.length > 0 ? (
              <ul className="tenant-admin-settings__person-list">
                {openInvitations.map((invitation) => {
                  const target: SaveTarget = `revoke-invitation:${invitation.id}`;
                  return (
                    <li key={invitation.id}>
                      <strong>{invitation.email}</strong>
                      <span>
                        Eingeladen:{" "}
                        {formatDate(invitation.created_at) ??
                          "Nicht hinterlegt"}
                      </span>
                      <span>
                        Gültig bis:{" "}
                        {formatDate(invitation.expires_at) ??
                          "Nicht hinterlegt"}
                      </span>
                      <button
                        type="button"
                        disabled={saving !== null}
                        onClick={() => void revokeInvitation(invitation)}
                      >
                        {saving === target ? "Wird widerrufen …" : "Widerrufen"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>

          <section
            className="tenant-admin-settings__section"
            aria-labelledby="tenant-roles-heading"
          >
            <h2 id="tenant-roles-heading">Rollen</h2>
            <p>
              Verwalten Sie mandantenweite Rollen und deren Berechtigungen.
              Systemrollen sind geschützt und können nicht verändert werden.
            </p>
            <h3>Rollenübersicht</h3>
            {roles.length > 0 ? (
              <ul className="tenant-admin-settings__role-list">
                {roles.map((role) => {
                  const target: SaveTarget = `role:${role.id}`;
                  const scopeLabel =
                    role.scope === "tenant"
                      ? "Mandantenweit"
                      : role.scope === "department"
                        ? "Abteilungsweit"
                        : role.scope === "team"
                          ? "Teamweit"
                          : role.scope;
                  return (
                    <li key={role.id}>
                      <strong>{role.name}</strong>
                      <span>{scopeLabel}</span>
                      <span>{role.active ? "Aktiv" : "Inaktiv"}</span>
                      {role.isSystem ? <span>Systemrolle</span> : null}
                      <div>
                        <strong>Berechtigungen</strong>
                        {role.permissionCodes.length > 0 ? (
                          <ul>
                            {role.permissionCodes.map((permissionCode) => {
                              const permission =
                                permissionsByCode.get(permissionCode);
                              return (
                                <li key={permissionCode}>
                                  <code>{permissionCode}</code>
                                  {permission?.description
                                    ? `: ${permission.description}`
                                    : null}
                                  {permission?.is_sensitive
                                    ? " (sensibel)"
                                    : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p>
                            Dieser Rolle sind keine Berechtigungen zugeordnet.
                          </p>
                        )}
                      </div>
                      {!role.isSystem ? (
                        <div>
                          <button
                            type="button"
                            disabled={saving !== null}
                            onClick={() => startRoleEdit(role)}
                          >
                            Bearbeiten
                          </button>
                          <button
                            type="button"
                            disabled={saving !== null}
                            onClick={() => void setRoleActivity(role)}
                          >
                            {saving === target
                              ? "Wird gespeichert …"
                              : role.active
                                ? "Deaktivieren"
                                : "Aktivieren"}
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>Für diesen Mandanten wurden keine Rollen zurückgegeben.</p>
            )}

            <form className="tenant-admin-settings__form" onSubmit={createRole}>
              <h3>Neue Rolle erstellen</h3>
              <label>
                Rollenname
                <input
                  type="text"
                  value={roleForm.name}
                  minLength={3}
                  maxLength={120}
                  required
                  disabled={saving !== null}
                  onChange={(event) =>
                    setRoleForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <fieldset disabled={saving !== null}>
                <legend>Berechtigungen auswählen</legend>
                {permissions.length > 0 ? (
                  <ul className="tenant-admin-settings__role-list">
                    {permissions.map((permission) => (
                      <li key={permission.code}>
                        <label>
                          <input
                            type="checkbox"
                            checked={roleForm.permissionCodes.includes(
                              permission.code,
                            )}
                            onChange={() =>
                              toggleRolePermission(permission.code, setRoleForm)
                            }
                          />
                          <span>
                            <code>{permission.code}</code>:{" "}
                            {permission.description}
                            {permission.is_sensitive ? " (sensibel)" : ""}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Es wurden keine Berechtigungen zurückgegeben.</p>
                )}
              </fieldset>
              <button type="submit" disabled={saving !== null}>
                {saving === "role:create"
                  ? "Rolle wird erstellt …"
                  : "Rolle erstellen"}
              </button>
            </form>

            {editingRoleId &&
            roles.some(
              (role) => role.id === editingRoleId && !role.isSystem,
            ) ? (
              <form
                className="tenant-admin-settings__form"
                onSubmit={updateRole}
              >
                <h3>Rolle bearbeiten</h3>
                <label>
                  Rollenname
                  <input
                    type="text"
                    value={roleEditForm.name}
                    minLength={3}
                    maxLength={120}
                    required
                    disabled={saving !== null}
                    onChange={(event) =>
                      setRoleEditForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <fieldset disabled={saving !== null}>
                  <legend>Berechtigungen auswählen</legend>
                  {permissions.length > 0 ? (
                    <ul className="tenant-admin-settings__role-list">
                      {permissions.map((permission) => (
                        <li key={permission.code}>
                          <label>
                            <input
                              type="checkbox"
                              checked={roleEditForm.permissionCodes.includes(
                                permission.code,
                              )}
                              onChange={() =>
                                toggleRolePermission(
                                  permission.code,
                                  setRoleEditForm,
                                )
                              }
                            />
                            <span>
                              <code>{permission.code}</code>:{" "}
                              {permission.description}
                              {permission.is_sensitive ? " (sensibel)" : ""}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>Es wurden keine Berechtigungen zurückgegeben.</p>
                  )}
                </fieldset>
                <button type="submit" disabled={saving !== null}>
                  {saving === `role:${editingRoleId}`
                    ? "Rolle wird gespeichert …"
                    : "Änderungen speichern"}
                </button>
                <button
                  type="button"
                  disabled={saving !== null}
                  onClick={() => {
                    setEditingRoleId(null);
                    setRoleEditForm(emptyRoleForm);
                  }}
                >
                  Abbrechen
                </button>
              </form>
            ) : null}

            <form className="tenant-admin-settings__form" onSubmit={assignRole}>
              <h3>Rolle zuweisen</h3>
              <p>
                Es können nur aktive, mandantenweite Rollen an aktive Personen
                zugewiesen werden.
              </p>
              <div className="tenant-admin-settings__form-grid">
                <label>
                  Aktive Person
                  <select
                    value={roleAssignmentForm.userId}
                    required
                    disabled={saving !== null || activeUsers.length === 0}
                    onChange={(event) =>
                      setRoleAssignmentForm((current) => ({
                        ...current,
                        userId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Bitte auswählen</option>
                    {activeUsers.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.displayName?.trim()
                          ? `${person.displayName} (${person.email})`
                          : person.email}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Aktive Rolle
                  <select
                    value={roleAssignmentForm.roleId}
                    required
                    disabled={saving !== null || assignableRoles.length === 0}
                    onChange={(event) =>
                      setRoleAssignmentForm((current) => ({
                        ...current,
                        roleId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Bitte auswählen</option>
                    {assignableRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                type="submit"
                disabled={
                  saving !== null ||
                  activeUsers.length === 0 ||
                  assignableRoles.length === 0
                }
              >
                {saving === "assign-role"
                  ? "Rolle wird zugewiesen …"
                  : "Rolle zuweisen"}
              </button>
            </form>

            <h3>Aktive Rollenzuweisungen</h3>
            {roleAssignments.length > 0 ? (
              <ul className="tenant-admin-settings__person-list">
                {roleAssignments.map((assignment) => {
                  const target: SaveTarget = `revoke-role:${assignment.id}`;
                  return (
                    <li key={assignment.id}>
                      <strong>
                        {assignment.user.displayName?.trim() ||
                          assignment.user.email ||
                          "Unbekannte Person"}
                      </strong>
                      <span>
                        {assignment.user.email ?? "E-Mail nicht hinterlegt"}
                      </span>
                      <span>Rolle: {assignment.roleName}</span>
                      {assignment.department_id ? (
                        <span>Bereich: {assignment.department_id}</span>
                      ) : null}
                      {assignment.team_id ? (
                        <span>Team: {assignment.team_id}</span>
                      ) : null}
                      <span>
                        Zugewiesen:{" "}
                        {formatDate(assignment.starts_at) ?? "Nicht hinterlegt"}
                      </span>
                      <button
                        type="button"
                        disabled={saving !== null}
                        onClick={() =>
                          setAssignmentPendingRevocation(assignment)
                        }
                      >
                        {saving === target ? "Wird entzogen …" : "Entziehen"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>In dieser Ansicht wurde noch keine Rolle zugewiesen.</p>
            )}
          </section>
        </div>
      ) : null}
      {assignmentPendingRevocation ? (
        <div
          className="tenant-admin-settings__confirmation-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="revoke-role-dialog-title"
        >
          <h2 id="revoke-role-dialog-title">Rollenzuweisung entziehen?</h2>
          <p>
            Die Zuweisung der Rolle „{assignmentPendingRevocation.roleName}“ an{" "}
            {assignmentPendingRevocation.user.displayName?.trim() ||
              assignmentPendingRevocation.user.email ||
              "diese Person"}{" "}
            wird entzogen. Dieser Vorgang kann nicht rückgängig gemacht werden.
          </p>
          <button
            type="button"
            disabled={saving !== null}
            onClick={() =>
              void revokeRoleAssignment(assignmentPendingRevocation)
            }
          >
            {saving === `revoke-role:${assignmentPendingRevocation.id}`
              ? "Wird entzogen …"
              : "Rolle endgültig entziehen"}
          </button>
          <button
            type="button"
            disabled={saving !== null}
            onClick={() => setAssignmentPendingRevocation(null)}
          >
            Abbrechen
          </button>
        </div>
      ) : null}
    </section>
  );
}
