import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  Bell,
  BookOpen,
  Bot,
  Box,
  BriefcaseBusiness,
  CalendarClock,
  LayoutDashboard,
  LayoutPanelTop,
  Mail,
  MessageSquareText,
  Settings,
  Ticket,
  UserRound,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "./lib/supabase";
import { functionErrorMessage } from "./lib/function-error";
import {
  getTenantSettings,
  type PushContentLevel,
  type PushTenantSettings,
  updateTenantSettings,
} from "./lib/push-notifications";
import { TicketCustomFieldsAdmin } from "./ticket-custom-fields-admin";
import { AssetIntuneSettings } from "./asset-intune-settings";
import { DepartmentManagement } from "./department-management";
import { TicketTemplates } from "./ticket-templates";
import { TenantAutomation } from "./tenant-automation";
import { TenantDataRetention } from "./tenant-data-retention";
import { TenantOnboarding, type OnboardingTarget } from "./tenant-onboarding";
import { AiGovernancePanel } from "./ai-governance-panel";
import { ExchangeMailSettings } from "./exchange-mail-settings";
import { SlaManagement } from "./sla-management";

export type TenantAdminSettingsProps = {
  tenantId: string;
  onClose: () => void;
  onBrandingUpdated?: () => void;
  onFeaturesUpdated?: () => void;
};

type SsoProvider = "oidc" | "saml" | "azure_ad";
type SsoProviderSelection = SsoProvider | "";
type SaveTarget =
  | "branding"
  | "sso"
  | "entra-directory-configuration"
  | "entra-directory-test"
  | "entra-sync"
  | "invite-user"
  | `person:${string}`
  | `entra-agent:${string}`
  | `feature:${string}`
  | `remove-user:${string}`
  | `revoke-invitation:${string}`
  | `role:${string}`
  | "assign-role"
  | `revoke-role:${string}`
  | "push-settings";

type SettingsArea =
  | "overview"
  | "branding"
  | "features"
  | "sla"
  | "ticket-fields"
  | "departments"
  | "privacy"
  | "users"
  | "roles"
  | "audit";

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

type EntraDirectoryConfiguration = {
  trusted_entra_tenant_id: string | null;
  configured_entra_tenant_id: string | null;
  enabled: boolean;
  last_connection_tested_at: string | null;
  last_connection_test_status: "success" | "failed" | null;
  last_sync_started_at: string | null;
  last_sync_completed_at: string | null;
  last_sync_status: "success" | "failed" | "running" | null;
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
  pilot_ends_at: string | null;
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
  departmentId: string | null;
  departmentName: string | null;
  jobTitle: string | null;
  jobTitleSource: "entra" | "manual";
  offer: string | null;
  offerSource: "entra" | "manual";
  isAgent: boolean;
  isTenantAdmin: boolean;
};

type TenantInvitation = {
  id: string;
  email: string;
  status: "sent" | "accepted";
  expires_at: string;
  created_at: string;
  displayName: string | null;
  jobTitle: string | null;
  offer: string | null;
  departmentId: string | null;
  departmentName: string | null;
  isAgent: boolean;
};

type TenantEntraDirectoryPerson = {
  id: string;
  email: string;
  displayName: string;
  jobTitle: string | null;
  sourceDepartmentName: string | null;
  accountEnabled: boolean;
  linkedToNextDesk: boolean;
  activeNextDeskMember: boolean;
  agentRequested: boolean;
  entraAgentAccessEffective: boolean;
  hasIndependentAgentAccess: boolean;
  agentDepartmentId: string | null;
  agentDepartmentName: string | null;
  isAgent: boolean;
  lastSyncedAt: string;
};

type TenantDepartment = {
  id: string;
  name: string;
  active: boolean;
};

type SettingsData = {
  tenant_settings: TenantSettings | null;
  tenant_branding: TenantBranding | null;
  tenant_sso_configurations: SsoConfiguration[];
  tenant_feature_flags: TenantFeature[];
  roles: TenantRole[];
  entra_directory: EntraDirectoryConfiguration;
};

type TenantUserDirectory = {
  members: TenantDirectoryMember[];
  invitations: TenantInvitation[];
  departments: TenantDepartment[];
  directoryPeople: TenantEntraDirectoryPerson[];
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
  portalName: string | null;
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
      type: "uploadBrandingLogo";
      tenantId: string;
      fileName: string;
      contentType: "image/png" | "image/jpeg" | "image/webp";
      base64: string;
    }
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
      type: "updateEntraDirectoryConfiguration";
      tenantId: string;
      enabled: boolean;
    }
  | {
      type: "toggleFeature";
      tenantId: string;
      featureKey: string;
      enabled: boolean;
    };

type TenantUsersRequest =
  | { type: "listUsers"; tenantId: string }
  | ({ type: "inviteUser"; tenantId: string; email: string } & PersonForm)
  | {
      type: "setEntraAgentAccess";
      tenantId: string;
      entraObjectId: string;
      departmentId: string | null;
      enabled: boolean;
    }
  | ({ type: "updatePerson"; tenantId: string; userId: string } & PersonForm)
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

type PersonForm = {
  displayName: string;
  jobTitle: string;
  offer: string;
  departmentId: string;
  isAgent: boolean;
};

type EntraAgentForm = {
  enabled: boolean;
  departmentId: string;
};

const emptyBrandingForm: BrandingForm = {
  portalName: "",
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

const emptyPersonForm: PersonForm = {
  displayName: "",
  jobTitle: "",
  offer: "",
  departmentId: "",
  isAgent: false,
};

const WORK_START_HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const WORK_END_HOURS = Array.from({ length: 24 }, (_, index) => index + 1);

function workHourLabel(hour: number): string {
  return `${hour.toString().padStart(2, "0")}:00 Uhr`;
}

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

type PreparedLogoUpload = {
  fileName: string;
  contentType: "image/png" | "image/jpeg" | "image/webp";
  base64: string;
  previewUrl: string;
};

const LOGO_MIME_TYPES = new Set<PreparedLogoUpload["contentType"]>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const MAX_LOGO_FILE_BYTES = 2 * 1024 * 1024;

async function prepareLogoUpload(file: File): Promise<PreparedLogoUpload> {
  if (!LOGO_MIME_TYPES.has(file.type as PreparedLogoUpload["contentType"])) {
    throw new Error("Bitte wählen Sie ein PNG-, JPEG- oder WebP-Bild aus.");
  }
  if (file.size === 0 || file.size > MAX_LOGO_FILE_BYTES) {
    throw new Error("Das Logo darf höchstens 2 MB gross sein.");
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("Die Bilddatei konnte nicht gelesen werden."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Die Bilddatei konnte nicht gelesen werden."));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
  const separator = dataUrl.indexOf(",");
  const base64 = separator >= 0 ? dataUrl.slice(separator + 1) : "";
  if (!base64) throw new Error("Die Bilddatei enthält keine Bilddaten.");
  return {
    fileName: file.name.slice(0, 120),
    contentType: file.type as PreparedLogoUpload["contentType"],
    base64,
    previewUrl: dataUrl,
  };
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function hasSufficientWhiteTextContrast(value: string): boolean {
  if (!isHexColor(value)) return false;
  const linearChannel = (offset: number) => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const red = linearChannel(1);
  const green = linearChannel(3);
  const blue = linearChannel(5);
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return 1.05 / (luminance + 0.05) >= 4.5;
}

function contrastRatio(foreground: string, background: string): number | null {
  if (!isHexColor(foreground) || !isHexColor(background)) return null;
  const luminance = (color: string) => {
    const linearChannel = (offset: number) => {
      const channel =
        Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    };
    return (
      0.2126 * linearChannel(1) +
      0.7152 * linearChannel(3) +
      0.0722 * linearChannel(5)
    );
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function CorporateDesignPreview({
  form,
  logoUrl,
}: {
  form: BrandingForm;
  logoUrl: string | null;
}) {
  const primaryColor = isHexColor(form.primaryColor)
    ? form.primaryColor.toUpperCase()
    : "#4338CA";
  const secondaryColor = isHexColor(form.secondaryColor)
    ? form.secondaryColor.toUpperCase()
    : "#3730A3";
  const accentColor = isHexColor(form.accentColor)
    ? form.accentColor.toUpperCase()
    : "#075985";
  const whiteTextContrast = contrastRatio("#FFFFFF", primaryColor);
  const contrastPasses = whiteTextContrast !== null && whiteTextContrast >= 4.5;
  const previewStyle = {
    "--design-preview-accent": accentColor,
    "--design-preview-primary": primaryColor,
    "--design-preview-secondary": secondaryColor,
  } as CSSProperties;
  const portalName = form.portalName.trim() || null;
  const previewNavigation = [
    { Icon: LayoutDashboard, label: "Übersicht" },
    { Icon: Ticket, label: "Tickets" },
    { Icon: CalendarClock, label: "Wiedervorlagen" },
    { Icon: BriefcaseBusiness, label: "Arbeitsplatz" },
    { Icon: Box, label: "Services" },
    { Icon: Box, label: "Assets" },
    { Icon: BookOpen, label: "Wissensdatenbank" },
    { Icon: UserRound, label: "Mein Portal" },
    { Icon: Settings, label: "Einstellungen" },
  ];

  return (
    <section
      aria-labelledby="tenant-branding-preview-heading"
      className="tenant-branding-preview"
      style={previewStyle}
    >
      <div className="tenant-branding-preview__heading">
        <div>
          <p className="tenant-admin-settings__eyebrow">LIVE-VORSCHAU</p>
          <h3 id="tenant-branding-preview-heading">Portalansicht</h3>
        </div>
        <span>Änderungen sind noch nicht gespeichert.</span>
      </div>
      <div
        aria-label="Vorschau von Navigation, Kopfbereich und Übersicht des Portals"
        className="tenant-branding-preview__frame"
      >
        <aside className="tenant-branding-preview__rail">
          <div className="tenant-branding-preview__brand">
            {logoUrl ? (
              <img alt={`${portalName ?? "Portal"} Logo`} src={logoUrl} />
            ) : (
              <span
                aria-label="Noch kein Portal-Logo ausgewählt"
                className="tenant-branding-preview__logo-fallback"
              >
                ND
              </span>
            )}
            {portalName ? <strong>{portalName}</strong> : null}
          </div>
          <p>ARBEITSBEREICH</p>
          <nav aria-label="Vorschau der Portalnavigation">
            {previewNavigation.map(({ Icon, label }, index) => (
              <span
                className={index === 0 ? "is-active" : undefined}
                key={label}
              >
                <Icon aria-hidden="true" size={14} strokeWidth={1.8} />
                {label}
              </span>
            ))}
          </nav>
        </aside>
        <main className="tenant-branding-preview__workspace">
          <header className="tenant-branding-preview__topbar">
            <div>
              <p>Operations / Übersicht</p>
              <strong>Guten Morgen</strong>
            </div>
            <span className="tenant-branding-preview__button">
              + Ticket erfassen
            </span>
          </header>
          <div className="tenant-branding-preview__content">
            <div className="tenant-branding-preview__intro">
              <div>
                <p>HEUTE IM BLICK</p>
                <strong>Ihr Arbeitstag</strong>
                <span>Tickets, Prioritäten und nächste Schritte.</span>
              </div>
              <span className="tenant-branding-preview__status">
                Alles im Blick
              </span>
            </div>
            <div className="tenant-branding-preview__metrics">
              <span>
                <b>3</b>
                Meine Tickets
              </span>
              <span>
                <b>2</b>
                Offen
              </span>
              <span>
                <b>1</b>
                Nicht zugewiesen
              </span>
            </div>
            <div className="tenant-branding-preview__ticket-row">
              <span className="tenant-branding-preview__ticket-mark" />
              <div>
                <small>ICT-2026-000001</small>
                <strong>Priorisiertes Ticket</strong>
              </div>
              <span>Neu</span>
            </div>
          </div>
        </main>
      </div>
      <p
        className={
          contrastPasses
            ? "tenant-branding-preview__contrast"
            : "tenant-branding-preview__contrast tenant-branding-preview__contrast--warning"
        }
      >
        {contrastPasses
          ? `Textfarbe Weiss auf Primärfarbe: Kontrast ${whiteTextContrast.toFixed(1)}:1 · WCAG AA erfüllt.`
          : `Warnung: Textfarbe Weiss auf Primärfarbe: Kontrast ${whiteTextContrast?.toFixed(1) ?? "nicht prüfbar"}:1 · WCAG AA (4,5:1) nicht erfüllt.`}
      </p>
    </section>
  );
}

const BRAND_COLOR_PALETTE = [
  "#4338CA",
  "#2563EB",
  "#0F766E",
  "#006E9C",
  "#166534",
  "#A16207",
  "#C2410C",
  "#B91C1C",
  "#BE185D",
  "#6D28D9",
  "#17233F",
] as const;

function BrandColorPicker({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (nextValue: string) => void;
  value: string;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const displayedColor = isHexColor(value) ? value.toUpperCase() : "#4338CA";

  return (
    <div className="brand-color-picker">
      <span className="brand-color-picker__label">{label}</span>
      <div className="brand-color-picker__controls">
        <button
          aria-controls={`palette-${label}`}
          aria-expanded={paletteOpen}
          aria-label={`${label}-Palette öffnen`}
          className="brand-color-picker__trigger"
          disabled={disabled}
          onClick={() => setPaletteOpen((current) => !current)}
          style={{ backgroundColor: displayedColor }}
          type="button"
        >
          <span aria-hidden="true" />
        </button>
        <input
          aria-label={`${label} mit Systemfarbauswahl ändern`}
          className="brand-color-picker__native"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          type="color"
          value={displayedColor}
        />
        <input
          aria-label={`${label} als Hex-Code`}
          disabled={disabled}
          inputMode="text"
          maxLength={7}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          placeholder="#RRGGBB"
          spellCheck={false}
          type="text"
          value={value}
        />
      </div>
      {paletteOpen ? (
        <div
          aria-label={`${label}-Palette`}
          className="brand-color-picker__palette"
          id={`palette-${label}`}
          role="listbox"
        >
          {BRAND_COLOR_PALETTE.map((color) => (
            <button
              aria-label={`${label} auf ${color} setzen`}
              aria-selected={displayedColor === color}
              className={
                displayedColor === color
                  ? "brand-color-picker__swatch is-selected"
                  : "brand-color-picker__swatch"
              }
              disabled={disabled}
              key={color}
              onClick={() => {
                onChange(color);
                setPaletteOpen(false);
              }}
              role="option"
              style={{ backgroundColor: color }}
              type="button"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
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

function isTenantFeatureActive(feature: TenantFeature): boolean {
  if (!feature.enabled) return false;
  if (!feature.pilot_ends_at) return true;
  const endsAt = Date.parse(feature.pilot_ends_at);
  return Number.isFinite(endsAt) && endsAt > Date.now();
}

type FeatureFilter = "all" | "active" | "inactive";
type FeatureGroupKey =
  "workflow" | "portals" | "communication" | "integrations" | "ai";

type FeatureGroup = {
  key: FeatureGroupKey;
  title: string;
  description: string;
};

type OperationalFunctionKey = "sso";
type OperationalFunction = {
  key: OperationalFunctionKey;
  name: string;
  description: string;
  statusLabel: string;
  tone: "active" | "inactive";
  Icon: typeof CalendarClock;
};

const FEATURE_GROUPS: readonly FeatureGroup[] = [
  {
    key: "workflow",
    title: "Arbeitsablauf & Ticketing",
    description: "Werkzeuge für den täglichen Support und Ticketprozesse.",
  },
  {
    key: "portals",
    title: "Portale & Self-Service",
    description: "Funktionen für anfragende Personen und ihre Abteilungen.",
  },
  {
    key: "communication",
    title: "Kommunikation & Benachrichtigungen",
    description: "E-Mail-Kanäle und Hinweise für die nextDesk-App.",
  },
  {
    key: "integrations",
    title: "Integrationen & Geräte",
    description:
      "Externe Systeme, Gerätebestand und kontrollierte Auslieferungen.",
  },
  {
    key: "ai",
    title: "KI & Governance",
    description: "KI-Assistenz und die dazugehörige Mandantenfreigabe.",
  },
];

function featureGroupFor(
  feature: TenantFeature,
  catalog: FeatureCatalogEntry | null,
): FeatureGroupKey {
  if (feature.feature_key === "ai.assist") return "ai";
  if (
    ["integrations.email", "notifications.push"].includes(feature.feature_key)
  ) {
    return "communication";
  }
  if (
    feature.feature_key === "assets.management" ||
    feature.feature_key.startsWith("integrations.") ||
    catalog?.category === "assets" ||
    catalog?.category === "integrations"
  ) {
    return "integrations";
  }
  if (
    feature.feature_key.startsWith("requester.") ||
    feature.feature_key === "portal.self-service" ||
    catalog?.category === "portal"
  ) {
    return "portals";
  }
  return "workflow";
}

function featureStatus(feature: TenantFeature): {
  label: string;
  tone: "active" | "inactive";
} {
  if (isTenantFeatureActive(feature)) {
    return { label: "Aktiv", tone: "active" };
  }
  return { label: "Deaktiviert", tone: "inactive" };
}

const FEATURE_PRESENTATION: Readonly<
  Record<string, { name: string; description: string; Icon: LucideIcon }>
> = {
  "experience.workspace": {
    name: "Arbeitsbereich",
    description:
      "Persönliche Arbeitsbereichseinstellungen, Wiedervorlagen und Mein Tag.",
    Icon: LayoutPanelTop,
  },
  "agent.workbench": {
    name: "Agentenwerkbank",
    description:
      "Makros, Erwähnungen, Stellvertretungen und erklärbare Arbeitsvorschläge für Agenten.",
    Icon: LayoutPanelTop,
  },
  "requester.department-view": {
    name: "Abteilungsansicht für Anfragende",
    description:
      "Anfragende sehen Titel, Status und Nummer der Tickets ihrer eigenen Abteilung, keine Inhalte.",
    Icon: MessageSquareText,
  },
  "portal.self-service": {
    name: "Self-Service",
    description:
      "Servicekatalog bei der Erfassung und Lösungsbestätigung durch Anfragende.",
    Icon: MessageSquareText,
  },
  "requester.portal": {
    name: "Anfragendenportal",
    description:
      "Eigene Tickets, Geräte, Freigaben, Störungsmeldungen und Datenauszug für Anfragende.",
    Icon: MessageSquareText,
  },
  "ai.assist": {
    name: "KI-Assistenz",
    description:
      "Vorbereitete KI-Entwürfe unter expliziter Mandantenfreigabe ohne Provideraufruf.",
    Icon: Bot,
  },
  "webhooks.outbound": {
    name: "Ausgehende Webhooks",
    description:
      "Kontrollierte Auslieferung mandantenbezogener Ereignisse an externe Endpunkte.",
    Icon: Webhook,
  },
  "notifications.push": {
    name: "Push-Benachrichtigungen",
    description:
      "Direkte Hinweise zu Tickets in der nextDesk-iOS-App über Apple Push Notification service.",
    Icon: Bell,
  },
  "integrations.email": {
    name: "E-Mail-Kanal (Exchange Online)",
    description:
      "Eingehende E-Mails werden zu Tickets, Agentenantworten gehen per E-Mail an Anfragende.",
    Icon: Mail,
  },
};

function featurePresentation(
  feature: TenantFeature,
  catalog: FeatureCatalogEntry | null,
): { name: string; description: string | null; Icon: LucideIcon | null } {
  const knownFeature = FEATURE_PRESENTATION[feature.feature_key];
  return {
    name: knownFeature?.name ?? catalog?.name ?? feature.feature_key,
    description: knownFeature?.description ?? catalog?.description ?? null,
    Icon: knownFeature?.Icon ?? null,
  };
}

function realValue(value: string | null | undefined): string {
  return value?.trim() || "Nicht hinterlegt";
}

export function TenantAdminSettings({
  tenantId,
  onClose,
  onBrandingUpdated,
  onFeaturesUpdated,
}: TenantAdminSettingsProps) {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [userDirectory, setUserDirectory] = useState<TenantUserDirectory>({
    members: [],
    invitations: [],
    departments: [],
    directoryPeople: [],
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
  const [invitationPersonForm, setInvitationPersonForm] =
    useState<PersonForm>(emptyPersonForm);
  const [editingPerson, setEditingPerson] =
    useState<TenantDirectoryMember | null>(null);
  const [personEditForm, setPersonEditForm] =
    useState<PersonForm>(emptyPersonForm);
  const [editingEntraAgent, setEditingEntraAgent] = useState<string | null>(
    null,
  );
  const [entraAgentForm, setEntraAgentForm] = useState<EntraAgentForm>({
    enabled: false,
    departmentId: "",
  });
  const [personSearch, setPersonSearch] = useState("");
  const [brandingForm, setBrandingForm] =
    useState<BrandingForm>(emptyBrandingForm);
  const [pendingLogo, setPendingLogo] = useState<PreparedLogoUpload | null>(
    null,
  );
  const [removeLogo, setRemoveLogo] = useState(false);
  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const [ssoForm, setSsoForm] = useState<SsoForm>(emptySsoForm);
  const [entraDirectoryEnabled, setEntraDirectoryEnabled] = useState(false);
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
  const [activeArea, setActiveArea] = useState<SettingsArea>("overview");
  const [onboardingTarget, setOnboardingTarget] =
    useState<OnboardingTarget | null>(null);
  const [pushTenantSettings, setPushTenantSettings] =
    useState<PushTenantSettings | null>(null);
  const [pushSettingsLoading, setPushSettingsLoading] = useState(false);
  const [pushSettingsError, setPushSettingsError] = useState("");
  const [pushSettingsSuccess, setPushSettingsSuccess] = useState("");
  const [featureQuery, setFeatureQuery] = useState("");
  const [featureFilter, setFeatureFilter] = useState<FeatureFilter>("all");
  const [selectedFeatureKey, setSelectedFeatureKey] = useState<string | null>(
    null,
  );

  const navigateFromOnboarding = useCallback((target: OnboardingTarget) => {
    setOnboardingTarget(target);
    if (target === "sso") {
      setSelectedFeatureKey("sso");
      setActiveArea("features");
      return;
    }
    setActiveArea(target);
  }, []);

  useEffect(() => {
    if (!onboardingTarget) return;
    const targetId = {
      branding: "tenant-branding-heading",
      departments: "tenant-departments-heading",
      features: "tenant-features-heading",
      sso: "tenant-sso-heading",
      users: "tenant-users-heading",
    }[onboardingTarget];
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      target?.focus({ preventScroll: true });
      setOnboardingTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeArea, onboardingTarget]);

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
        primaryColor: branding?.primary_color ?? "",
        secondaryColor: branding?.secondary_color ?? "",
        accentColor: branding?.accent_color ?? "",
      });
      setPendingLogo(null);
      setRemoveLogo(false);

      const sso = nextSettings.tenant_sso_configurations[0];
      setSsoForm(
        sso
          ? {
              provider: sso.provider,
              enabled: sso.enabled,
              issuerUrl: sso.issuer_url ?? "",
              discoveryUrl: sso.discovery_url ?? "",
              clientId:
                sso.provider === "azure_ad" ? "" : (sso.client_id ?? ""),
              allowedEmailDomains: sso.allowed_email_domains.join("\n"),
              enforceSso: sso.enforce_sso,
            }
          : emptySsoForm,
      );
      setEntraDirectoryEnabled(nextSettings.entra_directory.enabled);
    } catch (nextError) {
      setSettings(null);
      setUserDirectory({
        members: [],
        invitations: [],
        departments: [],
        directoryPeople: [],
      });
      setRoles([]);
      setRoleAssignments([]);
      setPermissions([]);
      setEntraDirectoryEnabled(false);
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

  useEffect(() => {
    const pushFeature = settings?.tenant_feature_flags.find(
      (feature) => feature.feature_key === "notifications.push",
    );
    const hasPushFeature = Boolean(
      pushFeature && isTenantFeatureActive(pushFeature),
    );
    if (!hasPushFeature) {
      setPushTenantSettings(null);
      setPushSettingsError("");
      setPushSettingsSuccess("");
      setPushSettingsLoading(false);
      return;
    }

    let mounted = true;
    setPushSettingsLoading(true);
    setPushSettingsError("");
    void getTenantSettings(tenantId)
      .then((nextSettings) => {
        if (mounted) setPushTenantSettings(nextSettings);
      })
      .catch((nextError: unknown) => {
        if (!mounted) return;
        setPushTenantSettings(null);
        setPushSettingsError(
          messageFromError(
            nextError,
            "Die Push-Einstellungen konnten nicht geladen werden. Bitte versuche es später erneut.",
          ),
        );
      })
      .finally(() => {
        if (mounted) setPushSettingsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [settings?.tenant_feature_flags, tenantId]);

  const saveEntraDirectoryConfiguration = async () => {
    if (!entraDirectory?.trusted_entra_tenant_id) {
      setError(
        "Für den Verzeichnisabgleich ist zuerst eine aktive, mandantenspezifische Microsoft-Entra-SSO-Konfiguration erforderlich.",
      );
      return;
    }
    beginSave("entra-directory-configuration");
    try {
      await tenantAdminRequest<{ updated: boolean }>({
        type: "updateEntraDirectoryConfiguration",
        tenantId,
        enabled: entraDirectoryEnabled,
      });
      await loadData();
      setSuccess(
        entraDirectoryEnabled
          ? "Der Entra-Verzeichnisconnector wurde aktiviert. Prüfen Sie die Verbindung, bevor Sie einen manuellen Abgleich starten."
          : "Der Entra-Verzeichnisconnector wurde gespeichert und deaktiviert.",
      );
    } catch (nextError) {
      setError(
        await functionErrorMessage(
          nextError,
          "Die Entra-Verzeichniskonfiguration konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setSaving(null);
    }
  };

  const testEntraDirectoryConnection = async () => {
    if (!supabase || !canTestEntraDirectory) {
      setError(
        "Speichern Sie zuerst eine gültige, an das mandantenspezifische Entra-SSO gebundene Konfiguration.",
      );
      return;
    }
    beginSave("entra-directory-test");
    try {
      const { error: invokeError } = await supabase.functions.invoke(
        "entra-directory-sync",
        { body: { type: "testTenant", tenantId } },
      );
      if (invokeError) throw invokeError;
      await loadData();
      setSuccess(
        "Die Entra-Verbindung wurde erfolgreich geprüft. Es wurden keine Personen- oder Profildaten angezeigt.",
      );
    } catch (nextError) {
      setError(
        await functionErrorMessage(
          nextError,
          "Die Entra-Verbindung konnte nicht geprüft werden.",
        ),
      );
    } finally {
      setSaving(null);
    }
  };

  const syncEntraDirectory = async () => {
    if (!supabase) {
      setError("Die Entra-Verzeichnissynchronisation ist nicht verfügbar.");
      return;
    }
    if (!canSyncEntraDirectory) {
      setError(
        "Aktivieren und testen Sie den an das mandantenspezifische Entra-SSO gebundenen Connector, bevor Sie den Abgleich starten.",
      );
      return;
    }
    beginSave("entra-sync");
    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        "entra-directory-sync",
        { body: { type: "syncTenant", tenantId } },
      );
      if (invokeError) throw invokeError;
      await loadData();
      const result = isRecord(data) && isRecord(data.data) ? data.data : null;
      const imported =
        result && typeof result.imported === "number" ? result.imported : 0;
      const active =
        result && typeof result.active === "number" ? result.active : 0;
      setSuccess(
        `Der Entra-Abgleich ist abgeschlossen: ${imported} Personen verarbeitet, ${active} aktiv. Die synchronisierten Personen erscheinen unten im Verzeichnis.`,
      );
    } catch (nextError) {
      setError(
        await functionErrorMessage(
          nextError,
          "Das Entra-Verzeichnis konnte nicht abgeglichen werden.",
        ),
      );
    } finally {
      setSaving(null);
    }
  };

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

  useEffect(() => {
    setFeatureQuery("");
    setFeatureFilter("all");
    setSelectedFeatureKey(null);
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
  const filteredActiveUsers = useMemo(() => {
    const term = personSearch.trim().toLocaleLowerCase("de-CH");
    if (!term) return activeUsers;
    return activeUsers.filter((person) =>
      [
        person.displayName,
        person.email,
        person.departmentName,
        person.jobTitle,
        person.offer,
      ].some((value) => value?.toLocaleLowerCase("de-CH").includes(term)),
    );
  }, [activeUsers, personSearch]);
  const filteredDirectoryPeople = useMemo(() => {
    const term = personSearch.trim().toLocaleLowerCase("de-CH");
    if (!term) return userDirectory.directoryPeople;
    return userDirectory.directoryPeople.filter((person) =>
      [
        person.displayName,
        person.email,
        person.sourceDepartmentName,
        person.jobTitle,
      ].some((value) => value?.toLocaleLowerCase("de-CH").includes(term)),
    );
  }, [personSearch, userDirectory.directoryPeople]);
  const branding = settings?.tenant_branding ?? null;
  const brandingLogoUrl = branding?.logo_url ?? branding?.logo_path ?? null;
  const ssoConfiguration = settings?.tenant_sso_configurations[0] ?? null;
  const entraDirectory = settings?.entra_directory ?? null;
  const isEntraSsoBindingReady = Boolean(
    entraDirectory?.trusted_entra_tenant_id &&
    entraDirectory?.configured_entra_tenant_id ===
      entraDirectory.trusted_entra_tenant_id,
  );
  const canTestEntraDirectory = Boolean(
    entraDirectory?.configured_entra_tenant_id && isEntraSsoBindingReady,
  );
  const canSyncEntraDirectory = Boolean(
    canTestEntraDirectory &&
    entraDirectory?.enabled &&
    entraDirectory.last_connection_test_status === "success",
  );
  const permissionsByCode = useMemo(
    () =>
      new Map(permissions.map((permission) => [permission.code, permission])),
    [permissions],
  );
  const assignableRoles = useMemo(
    () => roles.filter((role) => role.active && role.scope === "tenant"),
    [roles],
  );
  const effectiveAccess = useMemo(() => {
    const rolesById = new Map(roles.map((role) => [role.id, role]));
    const people = new Map<
      string,
      {
        id: string;
        displayName: string | null;
        email: string | null;
        roleNames: string[];
        permissionCodes: Set<string>;
      }
    >();

    for (const assignment of roleAssignments) {
      const role = rolesById.get(assignment.role_id);
      if (!role?.active) continue;

      const current = people.get(assignment.user_id) ?? {
        id: assignment.user_id,
        displayName: assignment.user.displayName,
        email: assignment.user.email,
        roleNames: [],
        permissionCodes: new Set<string>(),
      };
      if (!current.roleNames.includes(role.name)) {
        current.roleNames.push(role.name);
      }
      for (const permissionCode of role.permissionCodes) {
        current.permissionCodes.add(permissionCode);
      }
      people.set(assignment.user_id, current);
    }

    return [...people.values()]
      .map((person) => ({
        ...person,
        roleNames: person.roleNames.sort((left, right) =>
          left.localeCompare(right, "de-CH"),
        ),
        permissionCodes: [...person.permissionCodes].sort((left, right) =>
          left.localeCompare(right, "de-CH"),
        ),
      }))
      .sort((left, right) =>
        (left.displayName ?? left.email ?? left.id).localeCompare(
          right.displayName ?? right.email ?? right.id,
          "de-CH",
        ),
      );
  }, [roleAssignments, roles]);

  function beginSave(target: SaveTarget) {
    setSaving(target);
    setError("");
    setSuccess("");
  }

  function personFormFromMember(member: TenantDirectoryMember): PersonForm {
    return {
      displayName: member.displayName ?? "",
      jobTitle: member.jobTitle ?? "",
      offer: member.offer ?? "",
      departmentId: member.departmentId ?? "",
      isAgent: member.isAgent,
    };
  }

  async function chooseBrandingLogo(file: File | null | undefined) {
    if (!file) return;
    setError("");
    setSuccess("");
    try {
      setPendingLogo(await prepareLogoUpload(file));
      setRemoveLogo(false);
    } catch (nextError) {
      setPendingLogo(null);
      setError(
        messageFromError(
          nextError,
          "Das Logo konnte nicht vorbereitet werden.",
        ),
      );
    }
  }

  async function saveBranding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const portalName = brandingForm.portalName.trim();
    if (portalName && (portalName.length < 2 || portalName.length > 160)) {
      setError("Der Portalname muss zwischen 2 und 160 Zeichen lang sein.");
      return;
    }

    const nextBranding: BrandingUpdate = { portalName: portalName || null };

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
      if (formKey !== "accentColor" && !hasSufficientWhiteTextContrast(color)) {
        const label =
          formKey === "primaryColor" ? "Primärfarbe" : "Sekundärfarbe";
        setError(
          `${label} muss genügend Kontrast für helle Schaltflächentexte bieten.`,
        );
        return;
      }
      nextBranding[payloadKey] = color.toUpperCase();
    }

    beginSave("branding");
    try {
      if (pendingLogo) {
        const upload = await tenantAdminRequest<{ logoUrl: string }>({
          type: "uploadBrandingLogo",
          tenantId,
          fileName: pendingLogo.fileName,
          contentType: pendingLogo.contentType,
          base64: pendingLogo.base64,
        });
        nextBranding.logoUrl = upload.logoUrl;
      } else if (removeLogo && brandingLogoUrl) {
        nextBranding.logoUrl = null;
      }
      await tenantAdminRequest<{ updated: boolean }>({
        type: "updateBranding",
        tenantId,
        branding: nextBranding,
      });
      await loadData();
      onBrandingUpdated?.();
      setSuccess("Corporate Design wurde gespeichert.");
    } catch (nextError) {
      setError(
        messageFromError(
          nextError,
          "Corporate Design konnte nicht gespeichert werden.",
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
    if (
      ssoForm.enabled &&
      ssoForm.provider === "azure_ad" &&
      domains.length === 0
    ) {
      setError(
        "Für aktiviertes Microsoft-Entra-SSO ist mindestens eine Unternehmensdomain erforderlich.",
      );
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
        clientId: ssoForm.provider === "azure_ad" ? null : clientId || null,
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
        enabled: !isTenantFeatureActive(feature),
      });
      await loadData();
      onFeaturesUpdated?.();
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

  async function savePushSettings(nextValues: {
    checkInRequired?: boolean;
    contentLevel?: PushContentLevel;
    workEndHour?: number;
    workStartHour?: number;
  }) {
    if (!pushTenantSettings || saving !== null) return;

    const previousSettings = pushTenantSettings;
    const nextWorkHours = {
      ...previousSettings.workHours,
      checkInRequired:
        nextValues.checkInRequired ??
        previousSettings.workHours.checkInRequired,
      workEndHour:
        nextValues.workEndHour ?? previousSettings.workHours.workEndHour,
      workStartHour:
        nextValues.workStartHour ?? previousSettings.workHours.workStartHour,
    };
    const nextSettings = {
      ...previousSettings,
      contentLevel: nextValues.contentLevel ?? previousSettings.contentLevel,
      workHours: nextWorkHours,
    };

    setPushSettingsError("");
    setPushSettingsSuccess("");
    setPushTenantSettings(nextSettings);
    if (nextWorkHours.workEndHour <= nextWorkHours.workStartHour) {
      return;
    }

    beginSave("push-settings");
    try {
      const updated = await updateTenantSettings(tenantId, {
        contentLevel: nextSettings.contentLevel,
        checkInRequired: nextSettings.workHours.checkInRequired,
        workEndHour: nextSettings.workHours.workEndHour,
        workStartHour: nextSettings.workHours.workStartHour,
      });
      setPushTenantSettings((current) =>
        current
          ? {
              ...current,
              contentLevel: updated.contentLevel,
              workHours: updated.workHours,
            }
          : current,
      );
      setPushSettingsSuccess("Die Push-Einstellungen wurden gespeichert.");
    } catch (nextError) {
      setPushTenantSettings(previousSettings);
      setPushSettingsError(
        messageFromError(
          nextError,
          "Die Push-Einstellungen konnten nicht gespeichert werden. Bitte versuche es später erneut.",
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
    if (invitationPersonForm.isAgent && !invitationPersonForm.departmentId) {
      setError("Wählen Sie für einen Agenten einen Ticketzugriffsbereich aus.");
      return;
    }

    beginSave("invite-user");
    try {
      await tenantUsersRequest<{ sent: boolean; expiresAt: string }>({
        type: "inviteUser",
        tenantId,
        email,
        ...invitationPersonForm,
      });
      setInvitationEmail("");
      setInvitationPersonForm(emptyPersonForm);
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

  async function savePerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingPerson) return;
    if (personEditForm.isAgent && !personEditForm.departmentId) {
      setError("Wählen Sie für einen Agenten einen Ticketzugriffsbereich aus.");
      return;
    }
    const target: SaveTarget = `person:${editingPerson.id}`;
    beginSave(target);
    try {
      await tenantUsersRequest<{ updated: boolean }>({
        type: "updatePerson",
        tenantId,
        userId: editingPerson.id,
        ...personEditForm,
      });
      setEditingPerson(null);
      setPersonEditForm(emptyPersonForm);
      await loadData();
      setSuccess("Person, Ticketzugriff und Agentenzugang wurden gespeichert.");
    } catch (nextError) {
      setError(
        messageFromError(
          nextError,
          "Die Person konnte nicht aktualisiert werden.",
        ),
      );
    } finally {
      setSaving(null);
    }
  }

  function beginEntraAgentEdit(person: TenantEntraDirectoryPerson) {
    setError("");
    setSuccess("");
    setEditingEntraAgent(person.id);
    setEntraAgentForm({
      enabled: person.agentRequested,
      departmentId: person.agentDepartmentId ?? "",
    });
  }

  async function saveEntraAgentAccess(person: TenantEntraDirectoryPerson) {
    if (entraAgentForm.enabled && !entraAgentForm.departmentId) {
      setError("Wählen Sie für einen Support-Agenten eine Abteilung aus.");
      return;
    }

    const target: SaveTarget = `entra-agent:${person.id}`;
    beginSave(target);
    try {
      const result = await tenantUsersRequest<{
        updated: boolean;
        effectiveImmediately: boolean;
        agentRequested: boolean;
      }>({
        type: "setEntraAgentAccess",
        tenantId,
        entraObjectId: person.id,
        departmentId: entraAgentForm.enabled
          ? entraAgentForm.departmentId
          : null,
        enabled: entraAgentForm.enabled,
      });
      const departmentName = userDirectory.departments.find(
        (department) => department.id === entraAgentForm.departmentId,
      )?.name;
      setEditingEntraAgent(null);
      setEntraAgentForm({ enabled: false, departmentId: "" });
      await loadData();
      if (!result.agentRequested) {
        setSuccess(
          `Die Entra-Agentenvormerkung für ${person.displayName} wurde aufgehoben.`,
        );
      } else if (result.effectiveImmediately) {
        setSuccess(
          `${person.displayName} arbeitet jetzt als Support-Agent${departmentName ? ` in ${departmentName}` : ""}.`,
        );
      } else {
        setSuccess(
          `${person.displayName} ist als Support-Agent${departmentName ? ` für ${departmentName}` : ""} vorgemerkt. Der Zugang wird nach der ersten verifizierten Entra-Anmeldung wirksam.`,
        );
      }
    } catch (nextError) {
      setError(
        messageFromError(
          nextError,
          "Die Agentenzuordnung konnte nicht gespeichert werden.",
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

  const featureGroups = useMemo(() => {
    const query = featureQuery.trim().toLocaleLowerCase("de-CH");
    const visibleFeatures = (settings?.tenant_feature_flags ?? []).filter(
      (feature) => {
        if (feature.feature_key === "webhooks.outbound") return false;
        const catalog = asFeatureCatalogEntry(feature.feature_catalog);
        const presentation = featurePresentation(feature, catalog);
        const matchesQuery =
          !query ||
          [
            presentation.name,
            presentation.description ?? "",
            catalog?.category ?? "",
            feature.feature_key,
          ].some((value) => value.toLocaleLowerCase("de-CH").includes(query));
        const matchesFilter =
          featureFilter === "all" ||
          (featureFilter === "active" && isTenantFeatureActive(feature)) ||
          (featureFilter === "inactive" && !isTenantFeatureActive(feature));
        return matchesQuery && matchesFilter;
      },
    );

    return FEATURE_GROUPS.map((group) => ({
      ...group,
      features: visibleFeatures.filter(
        (feature) =>
          featureGroupFor(
            feature,
            asFeatureCatalogEntry(feature.feature_catalog),
          ) === group.key,
      ),
    })).filter((group) => group.features.length > 0);
  }, [featureFilter, featureQuery, settings?.tenant_feature_flags]);

  const operationalFunctions = useMemo(() => {
    const query = featureQuery.trim().toLocaleLowerCase("de-CH");
    const functions: OperationalFunction[] = [
      {
        key: "sso",
        name: "Single Sign-On",
        description: ssoForm.enforceSso
          ? "SSO ist für die Anmeldung dieses Mandanten erzwungen."
          : "Microsoft Entra ID und die zugelassenen Unternehmensdomains konfigurieren.",
        statusLabel: ssoForm.enabled ? "Aktiv" : "Deaktiviert",
        tone: ssoForm.enabled ? "active" : "inactive",
        Icon: UserRound,
      },
    ];
    return functions.filter((item) => {
      const matchesQuery =
        !query ||
        [item.name, item.description, item.key].some((value) =>
          value.toLocaleLowerCase("de-CH").includes(query),
        );
      const matchesFilter =
        featureFilter === "all" ||
        (featureFilter === "active" && item.tone === "active") ||
        (featureFilter === "inactive" && item.tone === "inactive");
      return matchesQuery && matchesFilter;
    });
  }, [featureFilter, featureQuery, ssoForm.enabled, ssoForm.enforceSso]);

  const featureStatusCounts = useMemo(() => {
    const features = settings?.tenant_feature_flags ?? [];
    return {
      all:
        features.filter(
          (feature) => feature.feature_key !== "webhooks.outbound",
        ).length + 1,
      active:
        features.filter(
          (feature) =>
            feature.feature_key !== "webhooks.outbound" &&
            isTenantFeatureActive(feature),
        ).length + (ssoForm.enabled ? 1 : 0),
      inactive:
        features.filter(
          (feature) =>
            feature.feature_key !== "webhooks.outbound" &&
            !isTenantFeatureActive(feature),
        ).length + (ssoForm.enabled ? 0 : 1),
    };
  }, [settings?.tenant_feature_flags, ssoForm.enabled]);

  const visibleFeatureCount = featureGroups.reduce(
    (count, group) => count + group.features.length,
    operationalFunctions.length,
  );
  const slaManagementEnabled =
    settings?.tenant_feature_flags.some(
      (feature) =>
        feature.feature_key === "automation.sla" &&
        isTenantFeatureActive(feature),
    ) ?? false;
  const settingsAreas: ReadonlyArray<readonly [SettingsArea, string]> = [
    ["overview", "Übersicht"],
    ["branding", "Design"],
    ["features", "Funktionen"],
    ...(slaManagementEnabled ? ([["sla", "SLA"]] as const) : []),
    ["ticket-fields", "Ticketfelder"],
    ["departments", "Abteilungen"],
    ["privacy", "Datenschutz"],
    ["users", "Personen"],
    ["roles", "Rollen"],
    ["audit", "Protokoll"],
  ];

  useEffect(() => {
    if (activeArea === "sla" && !slaManagementEnabled) {
      setActiveArea("features");
    }
  }, [activeArea, slaManagementEnabled]);

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
            Verwalten Sie Zugänge, Erscheinungsbild und Berechtigungen dieses
            Mandanten.
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
        <>
          <nav
            className="tenant-admin-settings__tabs"
            aria-label="Einstellungsbereiche"
            role="tablist"
          >
            {settingsAreas.map(([area, label]) => (
              <button
                key={area}
                type="button"
                className={
                  activeArea === area
                    ? "tenant-admin-settings__tab tenant-admin-settings__tab--active"
                    : "tenant-admin-settings__tab"
                }
                aria-selected={activeArea === area}
                role="tab"
                onClick={() => setActiveArea(area)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="tenant-admin-settings__content" role="tabpanel">
            {activeArea === "overview" && (
              <>
                <section
                  className="tenant-admin-settings__section"
                  aria-labelledby="tenant-general-heading"
                >
                  <h2 id="tenant-general-heading">Mandantenüberblick</h2>
                  <dl className="tenant-admin-settings__details">
                    <div>
                      <dt>Portalname</dt>
                      <dd>
                        {realValue(settings.tenant_settings?.portal_name)}
                      </dd>
                    </div>
                    <div>
                      <dt>Support-E-Mail</dt>
                      <dd>
                        {realValue(settings.tenant_settings?.support_email)}
                      </dd>
                    </div>
                    <div>
                      <dt>Ticketzugang</dt>
                      <dd>
                        {settings.tenant_settings?.ticket_access_enabled ===
                          null ||
                        settings.tenant_settings?.ticket_access_enabled ===
                          undefined
                          ? "Nicht hinterlegt"
                          : settings.tenant_settings.ticket_access_enabled
                            ? "Aktiviert"
                            : "Deaktiviert"}
                      </dd>
                    </div>
                    <div>
                      <dt>Externer Ticketzugang</dt>
                      <dd>
                        {settings.tenant_settings
                          ?.allow_external_ticket_access === null ||
                        settings.tenant_settings
                          ?.allow_external_ticket_access === undefined
                          ? "Nicht hinterlegt"
                          : settings.tenant_settings
                                .allow_external_ticket_access
                            ? "Aktiviert"
                            : "Deaktiviert"}
                      </dd>
                    </div>
                  </dl>
                </section>
                <TenantOnboarding
                  tenantId={tenantId}
                  onNavigate={navigateFromOnboarding}
                />
              </>
            )}

            {activeArea === "audit" && (
              <section
                className="tenant-admin-settings__section"
                aria-labelledby="tenant-audit-heading"
              >
                <div className="tenant-admin-settings__section-heading">
                  <div>
                    <h2 id="tenant-audit-heading">Änderungsprotokoll</h2>
                    <p>
                      Die letzten sicherheitsrelevanten Änderungen dieses
                      Mandanten.
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
                  <p
                    className="tenant-admin-settings__loading"
                    aria-live="polite"
                  >
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
                          {formatDate(entry.occurredAt) ??
                            "Unbekannter Zeitpunkt"}
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
            )}

            {activeArea === "branding" && (
              <section
                className="tenant-admin-settings__section"
                aria-labelledby="tenant-branding-heading"
              >
                <div className="tenant-admin-settings__section-heading">
                  <div>
                    <h2 id="tenant-branding-heading" tabIndex={-1}>
                      Corporate Design
                    </h2>
                    <p>
                      Die folgenden Werte stammen aus der aktuellen
                      Mandantenkonfiguration.
                    </p>
                  </div>
                </div>
                {branding ? (
                  <dl className="tenant-admin-settings__details tenant-admin-settings__details--branding">
                    {(
                      [
                        "primary_color",
                        "secondary_color",
                        "accent_color",
                      ] as const
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
                      <div className="tenant-admin-settings__logo-preview">
                        <dt>Aktuelles Logo</dt>
                        <dd>
                          <img
                            alt="Aktuelles Mandantenlogo"
                            src={brandingLogoUrl}
                          />
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
                    Portalname <span className="form-optional">(optional)</span>
                    <input
                      type="text"
                      value={brandingForm.portalName}
                      maxLength={160}
                      placeholder="Leer lassen: keine Portalbezeichnung"
                      disabled={saving !== null}
                      onChange={(event) =>
                        setBrandingForm((current) => ({
                          ...current,
                          portalName: event.target.value,
                        }))
                      }
                    />
                    <span className="tenant-admin-settings__hint">
                      Wird das Feld leer gespeichert, bleibt im Arbeitsbereich
                      nur das Logo sichtbar.
                    </span>
                  </label>
                  <div className="tenant-logo-upload">
                    <div>
                      <span className="tenant-logo-upload__label">
                        Portal-Logo
                      </span>
                      <p>
                        PNG, JPEG oder WebP bis 2 MB. Das Logo wird erst beim
                        Speichern übernommen.
                      </p>
                    </div>
                    <input
                      accept="image/png,image/jpeg,image/webp"
                      className="tenant-logo-upload__input"
                      disabled={saving !== null}
                      onChange={(event) =>
                        void chooseBrandingLogo(event.target.files?.[0])
                      }
                      ref={logoFileInputRef}
                      type="file"
                    />
                    <div
                      className="tenant-logo-upload__dropzone"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        void chooseBrandingLogo(event.dataTransfer.files[0]);
                      }}
                    >
                      {pendingLogo ? (
                        <img
                          alt="Vorschau des ausgewählten Logos"
                          src={pendingLogo.previewUrl}
                        />
                      ) : brandingLogoUrl && !removeLogo ? (
                        <img
                          alt="Aktuelles Mandantenlogo"
                          src={brandingLogoUrl}
                        />
                      ) : (
                        <span>Logo hier ablegen</span>
                      )}
                      <button
                        disabled={saving !== null}
                        onClick={() => logoFileInputRef.current?.click()}
                        type="button"
                      >
                        Datei auswählen
                      </button>
                    </div>
                    {(pendingLogo || brandingLogoUrl) && !removeLogo ? (
                      <button
                        className="tenant-logo-upload__remove"
                        disabled={saving !== null}
                        onClick={() => {
                          setPendingLogo(null);
                          setRemoveLogo(true);
                          if (logoFileInputRef.current)
                            logoFileInputRef.current.value = "";
                        }}
                        type="button"
                      >
                        Logo entfernen
                      </button>
                    ) : null}
                  </div>
                  <div className="tenant-admin-settings__form-grid">
                    <BrandColorPicker
                      disabled={saving !== null}
                      label="Primärfarbe"
                      onChange={(primaryColor) =>
                        setBrandingForm((current) => ({
                          ...current,
                          primaryColor,
                        }))
                      }
                      value={brandingForm.primaryColor}
                    />
                    <BrandColorPicker
                      disabled={saving !== null}
                      label="Sekundärfarbe"
                      onChange={(secondaryColor) =>
                        setBrandingForm((current) => ({
                          ...current,
                          secondaryColor,
                        }))
                      }
                      value={brandingForm.secondaryColor}
                    />
                    <BrandColorPicker
                      disabled={saving !== null}
                      label="Akzentfarbe"
                      onChange={(accentColor) =>
                        setBrandingForm((current) => ({
                          ...current,
                          accentColor,
                        }))
                      }
                      value={brandingForm.accentColor}
                    />
                  </div>
                  <CorporateDesignPreview
                    form={brandingForm}
                    logoUrl={
                      pendingLogo?.previewUrl ??
                      (removeLogo ? null : brandingLogoUrl)
                    }
                  />
                  <button type="submit" disabled={saving !== null}>
                    {saving === "branding"
                      ? "Wird gespeichert …"
                      : "Corporate Design speichern"}
                  </button>
                </form>
              </section>
            )}

            {activeArea === "sla" && slaManagementEnabled ? (
              <SlaManagement headingLevel="h2" tenantId={tenantId} />
            ) : null}

            {activeArea === "features" && (
              <section
                className="tenant-admin-settings__section tenant-admin-settings__functions"
                aria-labelledby="tenant-features-heading"
              >
                <div className="tenant-admin-settings__section-heading tenant-admin-settings__functions-heading">
                  <div>
                    <h2 id="tenant-features-heading" tabIndex={-1}>
                      Funktionen & Integrationen
                    </h2>
                    <p>
                      Aktivieren Sie nur die Funktionen, die dieser Mandant
                      wirklich nutzt. Die jeweilige Konfiguration öffnen Sie
                      gezielt direkt bei der passenden Funktion.
                    </p>
                  </div>
                  <p className="tenant-admin-settings__functions-summary">
                    <strong>{featureStatusCounts.active}</strong> aktiv ·{" "}
                    {featureStatusCounts.inactive} deaktiviert
                  </p>
                </div>

                {settings.tenant_feature_flags.length > 0 ? (
                  <>
                    <div className="tenant-admin-settings__feature-toolbar">
                      <label className="tenant-admin-settings__feature-search">
                        <span>Funktionen durchsuchen</span>
                        <input
                          type="search"
                          value={featureQuery}
                          onChange={(event) =>
                            setFeatureQuery(event.target.value)
                          }
                          placeholder="Name, Bereich oder Kennung"
                        />
                      </label>
                      <div
                        aria-label="Funktionsstatus filtern"
                        className="tenant-admin-settings__feature-filters"
                        role="toolbar"
                      >
                        {(
                          [
                            ["all", "Alle", featureStatusCounts.all],
                            ["active", "Aktiv", featureStatusCounts.active],
                            [
                              "inactive",
                              "Deaktiviert",
                              featureStatusCounts.inactive,
                            ],
                          ] as const
                        ).map(([filter, label, count]) => (
                          <button
                            key={filter}
                            type="button"
                            aria-pressed={featureFilter === filter}
                            className={
                              featureFilter === filter
                                ? "tenant-admin-settings__feature-filter is-active"
                                : "tenant-admin-settings__feature-filter"
                            }
                            onClick={() => setFeatureFilter(filter)}
                          >
                            {label} <span>{count}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <p
                      className="tenant-admin-settings__feature-results"
                      aria-live="polite"
                    >
                      {visibleFeatureCount} von {featureStatusCounts.all}{" "}
                      Funktionen angezeigt
                    </p>

                    {featureGroups.length > 0 ? (
                      <div className="tenant-admin-settings__feature-groups">
                        {featureGroups.map((group) => (
                          <section
                            key={group.key}
                            className="tenant-admin-settings__feature-group"
                            aria-labelledby={`feature-group-${group.key}`}
                          >
                            <header>
                              <div>
                                <h3 id={`feature-group-${group.key}`}>
                                  {group.title}
                                </h3>
                                <p>{group.description}</p>
                              </div>
                              <span>{group.features.length}</span>
                            </header>
                            <ul className="tenant-admin-settings__feature-list tenant-admin-settings__feature-grid">
                              {group.features.map((feature) => {
                                const catalog = asFeatureCatalogEntry(
                                  feature.feature_catalog,
                                );
                                const presentation = featurePresentation(
                                  feature,
                                  catalog,
                                );
                                const target: SaveTarget = `feature:${feature.feature_key}`;
                                const status = featureStatus(feature);
                                const detailsId = `feature-details-${feature.feature_key}`;
                                const isDetailsOpen =
                                  selectedFeatureKey === feature.feature_key;
                                const hasDedicatedConfiguration = [
                                  "notifications.push",
                                  "integrations.email",
                                  "ai.assist",
                                  "ticketing.templates",
                                  "assets.management",
                                  "automation.sla",
                                ].includes(feature.feature_key);
                                return (
                                  <li
                                    key={feature.feature_key}
                                    className={
                                      isDetailsOpen
                                        ? "tenant-admin-settings__feature is-open"
                                        : "tenant-admin-settings__feature"
                                    }
                                  >
                                    <div className="tenant-admin-settings__feature-card">
                                      <div className="tenant-admin-settings__feature-card-head">
                                        <div className="tenant-admin-settings__feature-title">
                                          {presentation.Icon ? (
                                            <presentation.Icon
                                              aria-hidden="true"
                                              size={18}
                                              strokeWidth={1.8}
                                            />
                                          ) : null}
                                          <div>
                                            <strong>{presentation.name}</strong>
                                            <span
                                              className={`tenant-admin-settings__feature-status tenant-admin-settings__feature-status--${status.tone}`}
                                            >
                                              {saving === target
                                                ? "Wird gespeichert …"
                                                : status.label}
                                            </span>
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          className="tenant-admin-settings__feature-toggle"
                                          disabled={saving !== null}
                                          onClick={() =>
                                            void toggleFeature(feature)
                                          }
                                        >
                                          {isTenantFeatureActive(feature)
                                            ? "Deaktivieren"
                                            : "Aktivieren"}
                                        </button>
                                      </div>
                                      {presentation.description ? (
                                        <p>{presentation.description}</p>
                                      ) : null}
                                      <div className="tenant-admin-settings__feature-actions">
                                        <button
                                          type="button"
                                          aria-controls={detailsId}
                                          aria-expanded={isDetailsOpen}
                                          onClick={() =>
                                            setSelectedFeatureKey((current) =>
                                              current === feature.feature_key
                                                ? null
                                                : feature.feature_key,
                                            )
                                          }
                                        >
                                          {isDetailsOpen
                                            ? "Details schliessen"
                                            : hasDedicatedConfiguration
                                              ? "Konfigurieren"
                                              : "Details"}
                                        </button>
                                      </div>
                                    </div>

                                    {isDetailsOpen ? (
                                      <div
                                        className="tenant-admin-settings__feature-details"
                                        id={detailsId}
                                      >
                                        <div className="tenant-admin-settings__feature-details-heading">
                                          <div>
                                            <h4>
                                              {presentation.name} konfigurieren
                                            </h4>
                                            <p>
                                              Die Konfiguration ändert den
                                              Funktionsstatus nicht automatisch.
                                            </p>
                                          </div>
                                        </div>

                                        {isDetailsOpen &&
                                        feature.feature_key ===
                                          "notifications.push" ? (
                                          <section
                                            aria-labelledby="push-settings-heading"
                                            className="tenant-admin-settings__push-settings"
                                          >
                                            <h3 id="push-settings-heading">
                                              Push-Einstellungen
                                            </h3>
                                            {pushSettingsLoading ? (
                                              <p className="tenant-admin-settings__push-state">
                                                Push-Status wird geladen …
                                              </p>
                                            ) : null}
                                            {pushSettingsError ? (
                                              <p
                                                aria-live="polite"
                                                className="tenant-admin-settings__push-feedback tenant-admin-settings__push-feedback--error"
                                                role="status"
                                              >
                                                {pushSettingsError}
                                              </p>
                                            ) : null}
                                            {pushTenantSettings ? (
                                              <>
                                                <dl className="tenant-admin-settings__push-status">
                                                  <div>
                                                    <dt>Apple-Zugang (APNs)</dt>
                                                    <dd>
                                                      <span
                                                        className={
                                                          pushTenantSettings.apnsConfigured
                                                            ? "tenant-admin-settings__push-badge tenant-admin-settings__push-badge--ready"
                                                            : "tenant-admin-settings__push-badge"
                                                        }
                                                      >
                                                        {pushTenantSettings.apnsConfigured
                                                          ? "eingerichtet"
                                                          : "noch nicht eingerichtet"}
                                                      </span>
                                                    </dd>
                                                  </div>
                                                  <div>
                                                    <dt>Registrierte Geräte</dt>
                                                    <dd>
                                                      {
                                                        pushTenantSettings.registeredDevices
                                                      }
                                                    </dd>
                                                  </div>
                                                </dl>
                                                <fieldset
                                                  className="tenant-admin-settings__push-content-level"
                                                  disabled={saving !== null}
                                                >
                                                  <legend>Inhaltsstufe</legend>
                                                  <div>
                                                    <label
                                                      className={
                                                        pushTenantSettings.contentLevel ===
                                                        "minimal"
                                                          ? "tenant-admin-settings__push-option is-selected"
                                                          : "tenant-admin-settings__push-option"
                                                      }
                                                    >
                                                      <input
                                                        checked={
                                                          pushTenantSettings.contentLevel ===
                                                          "minimal"
                                                        }
                                                        name="push-content-level"
                                                        onChange={() =>
                                                          void savePushSettings(
                                                            {
                                                              contentLevel:
                                                                "minimal",
                                                            },
                                                          )
                                                        }
                                                        type="radio"
                                                        value="minimal"
                                                      />
                                                      <span>
                                                        <strong>
                                                          Nur Ticketnummer
                                                          (empfohlen)
                                                        </strong>
                                                        <small>
                                                          Der Push enthält nur
                                                          Ereignisart und
                                                          Ticketnummer.
                                                        </small>
                                                      </span>
                                                    </label>
                                                    <label
                                                      className={
                                                        pushTenantSettings.contentLevel ===
                                                        "subject"
                                                          ? "tenant-admin-settings__push-option is-selected"
                                                          : "tenant-admin-settings__push-option"
                                                      }
                                                    >
                                                      <input
                                                        checked={
                                                          pushTenantSettings.contentLevel ===
                                                          "subject"
                                                        }
                                                        name="push-content-level"
                                                        onChange={() =>
                                                          void savePushSettings(
                                                            {
                                                              contentLevel:
                                                                "subject",
                                                            },
                                                          )
                                                        }
                                                        type="radio"
                                                        value="subject"
                                                      />
                                                      <span>
                                                        <strong>
                                                          Ticketnummer und
                                                          Betreff
                                                        </strong>
                                                        <small>
                                                          Der Betreff erscheint
                                                          zusätzlich im Push.
                                                        </small>
                                                      </span>
                                                    </label>
                                                  </div>
                                                </fieldset>
                                                <fieldset
                                                  className="tenant-admin-settings__push-work-hours"
                                                  disabled={saving !== null}
                                                >
                                                  <legend>
                                                    Arbeitszeit-Check-in
                                                  </legend>
                                                  <label className="tenant-admin-settings__push-checkin-toggle">
                                                    <input
                                                      checked={
                                                        pushTenantSettings
                                                          .workHours
                                                          .checkInRequired
                                                      }
                                                      onChange={(event) =>
                                                        void savePushSettings({
                                                          checkInRequired:
                                                            event.target
                                                              .checked,
                                                        })
                                                      }
                                                      type="checkbox"
                                                    />
                                                    <span>
                                                      <strong>
                                                        Check-in für Push
                                                        erforderlich
                                                      </strong>
                                                      <small>
                                                        Ausserhalb dieser Zeit
                                                        und ohne Check-in werden
                                                        keine
                                                        Push-Benachrichtigungen
                                                        versendet. Standard:
                                                        06:00–17:00 Uhr.
                                                      </small>
                                                    </span>
                                                  </label>
                                                  <div className="tenant-admin-settings__push-work-hours-grid">
                                                    <label>
                                                      Beginn
                                                      <select
                                                        disabled={
                                                          saving !== null ||
                                                          !pushTenantSettings
                                                            .workHours
                                                            .checkInRequired
                                                        }
                                                        onChange={(event) =>
                                                          void savePushSettings(
                                                            {
                                                              workStartHour:
                                                                Number(
                                                                  event.target
                                                                    .value,
                                                                ),
                                                            },
                                                          )
                                                        }
                                                        value={
                                                          pushTenantSettings
                                                            .workHours
                                                            .workStartHour
                                                        }
                                                      >
                                                        {WORK_START_HOURS.map(
                                                          (hour) => (
                                                            <option
                                                              key={hour}
                                                              value={hour}
                                                            >
                                                              {workHourLabel(
                                                                hour,
                                                              )}
                                                            </option>
                                                          ),
                                                        )}
                                                      </select>
                                                    </label>
                                                    <label>
                                                      Ende
                                                      <select
                                                        aria-describedby={
                                                          pushTenantSettings
                                                            .workHours
                                                            .workEndHour <=
                                                          pushTenantSettings
                                                            .workHours
                                                            .workStartHour
                                                            ? "push-work-hours-error"
                                                            : undefined
                                                        }
                                                        aria-invalid={
                                                          pushTenantSettings
                                                            .workHours
                                                            .workEndHour <=
                                                          pushTenantSettings
                                                            .workHours
                                                            .workStartHour
                                                            ? true
                                                            : undefined
                                                        }
                                                        disabled={
                                                          saving !== null ||
                                                          !pushTenantSettings
                                                            .workHours
                                                            .checkInRequired
                                                        }
                                                        onChange={(event) =>
                                                          void savePushSettings(
                                                            {
                                                              workEndHour:
                                                                Number(
                                                                  event.target
                                                                    .value,
                                                                ),
                                                            },
                                                          )
                                                        }
                                                        value={
                                                          pushTenantSettings
                                                            .workHours
                                                            .workEndHour
                                                        }
                                                      >
                                                        {WORK_END_HOURS.map(
                                                          (hour) => (
                                                            <option
                                                              key={hour}
                                                              value={hour}
                                                            >
                                                              {workHourLabel(
                                                                hour,
                                                              )}
                                                            </option>
                                                          ),
                                                        )}
                                                      </select>
                                                    </label>
                                                  </div>
                                                  {pushTenantSettings.workHours
                                                    .workEndHour <=
                                                  pushTenantSettings.workHours
                                                    .workStartHour ? (
                                                    <p
                                                      className="tenant-admin-settings__push-work-hours-error"
                                                      id="push-work-hours-error"
                                                      role="alert"
                                                    >
                                                      Das Ende muss nach dem
                                                      Beginn liegen.
                                                    </p>
                                                  ) : null}
                                                </fieldset>
                                                <p className="tenant-admin-settings__push-note">
                                                  Mitteilungen werden direkt
                                                  über Apple (APNs) an die
                                                  nextDesk-iOS-App zugestellt.
                                                  Nachrichtentexte,
                                                  Beschreibungen und Namen
                                                  werden nie übertragen.
                                                </p>
                                              </>
                                            ) : null}
                                            {pushSettingsSuccess ? (
                                              <p
                                                aria-live="polite"
                                                className="tenant-admin-settings__push-feedback tenant-admin-settings__push-feedback--success"
                                                role="status"
                                              >
                                                {pushSettingsSuccess}
                                              </p>
                                            ) : null}
                                          </section>
                                        ) : null}

                                        {!isTenantFeatureActive(feature) ? (
                                          <p className="tenant-admin-settings__feature-detail-note">
                                            Aktivieren Sie diese Funktion
                                            zuerst. Ihre bestehende
                                            Konfiguration wird nicht verändert,
                                            aber bis zur Aktivierung nicht
                                            verwendet.
                                          </p>
                                        ) : (
                                          <>
                                            {feature.feature_key ===
                                            "integrations.email" ? (
                                              <ExchangeMailSettings
                                                tenantId={tenantId}
                                              />
                                            ) : null}
                                            {feature.feature_key ===
                                            "ai.assist" ? (
                                              <AiGovernancePanel
                                                tenantId={tenantId}
                                              />
                                            ) : null}
                                            {feature.feature_key ===
                                            "ticketing.templates" ? (
                                              <TicketTemplates
                                                tenantId={tenantId}
                                              />
                                            ) : null}
                                            {feature.feature_key ===
                                            "assets.management" ? (
                                              <AssetIntuneSettings
                                                tenantId={tenantId}
                                              />
                                            ) : null}
                                            {feature.feature_key ===
                                            "automation.sla" ? (
                                              <TenantAutomation
                                                tenantId={tenantId}
                                              />
                                            ) : null}
                                            {!hasDedicatedConfiguration ? (
                                              <p className="tenant-admin-settings__feature-detail-note">
                                                Diese Funktion benötigt keine
                                                weitere Mandantenkonfiguration.
                                              </p>
                                            ) : null}
                                          </>
                                        )}
                                        <details className="tenant-admin-settings__feature-technical">
                                          <summary>Technische Details</summary>
                                          <code>{feature.feature_key}</code>
                                        </details>
                                      </div>
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          </section>
                        ))}
                      </div>
                    ) : (
                      <p className="tenant-admin-settings__feature-empty">
                        Keine Funktion entspricht der aktuellen Suche oder dem
                        gewählten Statusfilter.
                      </p>
                    )}
                  </>
                ) : (
                  <p>
                    Für diesen Mandanten wurden keine Feature-Schalter
                    zurückgegeben.
                  </p>
                )}

                {operationalFunctions.length > 0 ? (
                  <section
                    className="tenant-admin-settings__feature-group tenant-admin-settings__feature-group--operational"
                    aria-labelledby="feature-group-operational"
                  >
                    <header>
                      <div>
                        <h3 id="feature-group-operational">
                          Identität & Betriebsablauf
                        </h3>
                        <p>
                          Weitere Mandantenkonfigurationen, die mit der Suche
                          und dem Statusfilter mitgefiltert werden.
                        </p>
                      </div>
                      <span>{operationalFunctions.length}</span>
                    </header>
                    <ul className="tenant-admin-settings__feature-list">
                      {operationalFunctions.map((item) => {
                        const detailsId = `feature-details-${item.key}`;
                        const isDetailsOpen = selectedFeatureKey === item.key;
                        return (
                          <li
                            className={
                              isDetailsOpen
                                ? "tenant-admin-settings__feature tenant-admin-settings__feature--operational is-open"
                                : "tenant-admin-settings__feature tenant-admin-settings__feature--operational"
                            }
                            key={item.key}
                          >
                            <div className="tenant-admin-settings__feature-card">
                              <div className="tenant-admin-settings__feature-card-head">
                                <div className="tenant-admin-settings__feature-title">
                                  <item.Icon
                                    aria-hidden="true"
                                    size={18}
                                    strokeWidth={1.8}
                                  />
                                  <div>
                                    <strong>{item.name}</strong>
                                    <span
                                      className={`tenant-admin-settings__feature-status tenant-admin-settings__feature-status--${item.tone}`}
                                    >
                                      {item.statusLabel}
                                    </span>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  aria-controls={detailsId}
                                  aria-expanded={isDetailsOpen}
                                  onClick={() =>
                                    setSelectedFeatureKey((current) =>
                                      current === item.key ? null : item.key,
                                    )
                                  }
                                >
                                  {isDetailsOpen
                                    ? "Details schliessen"
                                    : "Konfigurieren"}
                                </button>
                              </div>
                              <p>{item.description}</p>
                            </div>
                            {isDetailsOpen ? (
                              <div
                                className="tenant-admin-settings__feature-details"
                                id={detailsId}
                              >
                                {item.key === "sso" ? (
                                  <>
                                    <div className="tenant-admin-settings__feature-details-heading">
                                      <div>
                                        <h4
                                          id="tenant-sso-heading"
                                          tabIndex={-1}
                                        >
                                          SSO-Konfiguration
                                        </h4>
                                        <p>
                                          Die zentrale Entra-App bleibt bei
                                          Gross ICT; hier verwalten Sie nur die
                                          mandantenspezifische Freigabe.
                                        </p>
                                      </div>
                                    </div>
                                    {ssoConfiguration ? (
                                      <dl className="tenant-admin-settings__details">
                                        <div>
                                          <dt>Anbieter</dt>
                                          <dd>{ssoConfiguration.provider}</dd>
                                        </div>
                                        <div>
                                          <dt>Status</dt>
                                          <dd>
                                            {ssoConfiguration.enabled
                                              ? "Aktiviert"
                                              : "Deaktiviert"}
                                          </dd>
                                        </div>
                                        {ssoConfiguration.issuer_url ? (
                                          <div>
                                            <dt>Issuer-URL</dt>
                                            <dd>
                                              {ssoConfiguration.issuer_url}
                                            </dd>
                                          </div>
                                        ) : null}
                                        {ssoConfiguration.discovery_url ? (
                                          <div>
                                            <dt>Discovery-URL</dt>
                                            <dd>
                                              {ssoConfiguration.discovery_url}
                                            </dd>
                                          </div>
                                        ) : null}
                                        {ssoConfiguration.provider ===
                                        "azure_ad" ? (
                                          <div>
                                            <dt>Client-App</dt>
                                            <dd>
                                              Zentrale mehrmandantenfähige
                                              nextDesk-Entra-App
                                            </dd>
                                          </div>
                                        ) : ssoConfiguration.client_id ? (
                                          <div>
                                            <dt>Client-ID</dt>
                                            <dd>
                                              {ssoConfiguration.client_id}
                                            </dd>
                                          </div>
                                        ) : null}
                                        <div>
                                          <dt>SSO erzwingen</dt>
                                          <dd>
                                            {ssoConfiguration.enforce_sso
                                              ? "Ja"
                                              : "Nein"}
                                          </dd>
                                        </div>
                                      </dl>
                                    ) : (
                                      <p>
                                        Für diesen Mandanten wurde noch keine
                                        SSO-Konfiguration zurückgegeben.
                                      </p>
                                    )}
                                    <p className="tenant-admin-settings__security-note">
                                      Microsoft Entra ID verwendet die zentral
                                      verwaltete, mehrmandantenfähige
                                      nextDesk-App. Pro Kundenmandant werden nur
                                      der eigene Entra-Tenant und die
                                      Unternehmensdomains hinterlegt. Geheime
                                      Client-Schlüssel werden hier nie angezeigt
                                      oder gespeichert.
                                    </p>

                                    <form
                                      className="tenant-admin-settings__form"
                                      onSubmit={saveSsoConfiguration}
                                    >
                                      <h5>SSO-Konfiguration bearbeiten</h5>
                                      <p className="tenant-admin-settings__hint">
                                        nextDesk unterstützt hier den zentral
                                        verwalteten
                                        Microsoft-Entra-ID-Anmeldeweg. Andere
                                        Anbieter lassen sich erst auswählen,
                                        wenn ihr Anmeldeweg serverseitig
                                        vollständig bereitsteht. Eine Person mit
                                        passender Entra-Mandantenkennung und
                                        zugelassener Unternehmensdomain wird
                                        beim ersten Login ausschliesslich als
                                        anfragende Person angelegt;
                                        Agentenrechte werden nur über die
                                        Rollenverwaltung oder eine Einladung
                                        vergeben.
                                      </p>
                                      <div className="tenant-admin-settings__form-grid">
                                        <label>
                                          Anbieter
                                          <select
                                            value={ssoForm.provider}
                                            disabled={saving !== null}
                                            onChange={(event) =>
                                              setSsoForm((current) => ({
                                                ...current,
                                                provider: event.target
                                                  .value as SsoProviderSelection,
                                              }))
                                            }
                                          >
                                            <option value="">
                                              Bitte auswählen
                                            </option>
                                            <option value="azure_ad">
                                              Microsoft Entra ID
                                            </option>
                                          </select>
                                        </label>
                                        {ssoForm.provider !== "azure_ad" && (
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
                                        )}
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
                                                discoveryUrl:
                                                  event.target.value,
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
                                              allowedEmailDomains:
                                                event.target.value,
                                            }))
                                          }
                                        />
                                        <span className="tenant-admin-settings__hint">
                                          Eine Domain pro Zeile oder durch
                                          Kommas getrennt.
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
                                            disabled={
                                              saving !== null ||
                                              !ssoForm.enabled
                                            }
                                            onChange={(event) =>
                                              setSsoForm((current) => ({
                                                ...current,
                                                enforceSso:
                                                  event.target.checked,
                                              }))
                                            }
                                          />
                                          SSO für die Anmeldung erzwingen
                                        </label>
                                      </div>
                                      <button
                                        type="submit"
                                        disabled={saving !== null}
                                      >
                                        {saving === "sso"
                                          ? "Wird gespeichert …"
                                          : "SSO-Konfiguration speichern"}
                                      </button>
                                    </form>
                                  </>
                                ) : null}
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ) : null}
              </section>
            )}

            {activeArea === "ticket-fields" && (
              <TicketCustomFieldsAdmin tenantId={tenantId} />
            )}

            {activeArea === "departments" && (
              <section
                aria-label="Abteilungen"
                id="tenant-departments-heading"
                tabIndex={-1}
              >
                <DepartmentManagement tenantId={tenantId} />
              </section>
            )}

            {activeArea === "privacy" && (
              <TenantDataRetention tenantId={tenantId} />
            )}

            {activeArea === "users" && (
              <section
                className="tenant-admin-settings__section"
                aria-labelledby="tenant-users-heading"
              >
                <h2 id="tenant-users-heading" tabIndex={-1}>
                  Personen & Agenten
                </h2>
                <p>
                  Ordnen Sie Mitarbeitende einer Abteilung zu, hinterlegen Sie
                  Angebot und Funktion und bestimmen Sie, wer als Support-Agent
                  in der Ticketbearbeitung arbeitet.
                </p>
                <section
                  className="tenant-admin-settings__directory-config"
                  aria-labelledby="tenant-entra-directory-heading"
                >
                  <div className="tenant-admin-settings__directory-config-heading">
                    <div>
                      <h3 id="tenant-entra-directory-heading">
                        Microsoft Entra-Verzeichnis
                      </h3>
                      <p>
                        Die Verbindung ist ausschliesslich an die aktive,
                        mandantenspezifische Microsoft-Entra-SSO-Konfiguration
                        gebunden. Personen werden erst bei einem bewusst
                        gestarteten Abgleich verarbeitet.
                      </p>
                    </div>
                    <span
                      className={`tenant-admin-settings__directory-status ${
                        !entraDirectory?.trusted_entra_tenant_id
                          ? "tenant-admin-settings__directory-status--blocked"
                          : !entraDirectory?.configured_entra_tenant_id
                            ? "tenant-admin-settings__directory-status--idle"
                            : !isEntraSsoBindingReady
                              ? "tenant-admin-settings__directory-status--blocked"
                              : entraDirectory.last_sync_status === "running"
                                ? "tenant-admin-settings__directory-status--running"
                                : entraDirectory.last_connection_test_status ===
                                    "failed"
                                  ? "tenant-admin-settings__directory-status--failed"
                                  : entraDirectory.enabled
                                    ? "tenant-admin-settings__directory-status--ready"
                                    : "tenant-admin-settings__directory-status--idle"
                      }`}
                      role="status"
                    >
                      {!entraDirectory?.trusted_entra_tenant_id
                        ? "SSO-Bindung erforderlich"
                        : !entraDirectory?.configured_entra_tenant_id
                          ? "Noch nicht gespeichert"
                          : !isEntraSsoBindingReady
                            ? "Neue Speicherung erforderlich"
                            : entraDirectory.last_sync_status === "running"
                              ? "Abgleich läuft"
                              : entraDirectory.last_connection_test_status ===
                                  "failed"
                                ? "Verbindung fehlgeschlagen"
                                : entraDirectory.enabled
                                  ? "Bereit für manuellen Abgleich"
                                  : "Deaktiviert"}
                    </span>
                  </div>

                  <dl className="tenant-admin-settings__directory-facts">
                    <div>
                      <dt>Verknüpfter Entra-Mandant</dt>
                      <dd>
                        {entraDirectory?.trusted_entra_tenant_id ??
                          "Keine aktive mandantenspezifische Entra-SSO-Konfiguration"}
                      </dd>
                    </div>
                    <div>
                      <dt>Letzter Verbindungstest</dt>
                      <dd>
                        {entraDirectory?.last_connection_tested_at
                          ? `${entraDirectory.last_connection_test_status === "success" ? "Erfolgreich" : "Fehlgeschlagen"} · ${formatDate(entraDirectory.last_connection_tested_at)}`
                          : "Noch nicht durchgeführt"}
                      </dd>
                    </div>
                    <div>
                      <dt>Letzter Abgleich</dt>
                      <dd>
                        {entraDirectory?.last_sync_completed_at
                          ? `${entraDirectory.last_sync_status === "success" ? "Erfolgreich" : "Fehlgeschlagen"} · ${formatDate(entraDirectory.last_sync_completed_at)}`
                          : "Noch nicht durchgeführt"}
                      </dd>
                    </div>
                  </dl>

                  <div className="tenant-admin-settings__directory-actions">
                    <label className="tenant-admin-settings__directory-toggle">
                      <input
                        type="checkbox"
                        checked={entraDirectoryEnabled}
                        disabled={
                          saving !== null ||
                          !entraDirectory?.trusted_entra_tenant_id
                        }
                        onChange={(event) =>
                          setEntraDirectoryEnabled(event.target.checked)
                        }
                      />
                      <span>Connector für manuelle Abgleiche aktivieren</span>
                    </label>
                    <div>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={
                          saving !== null ||
                          !entraDirectory?.trusted_entra_tenant_id
                        }
                        onClick={() => void saveEntraDirectoryConfiguration()}
                      >
                        {saving === "entra-directory-configuration"
                          ? "Wird gespeichert …"
                          : "Konfiguration speichern"}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={saving !== null || !canTestEntraDirectory}
                        onClick={() => void testEntraDirectoryConnection()}
                      >
                        {saving === "entra-directory-test"
                          ? "Verbindung wird geprüft …"
                          : "Verbindung testen"}
                      </button>
                      <button
                        type="button"
                        disabled={saving !== null || !canSyncEntraDirectory}
                        onClick={() => void syncEntraDirectory()}
                      >
                        {saving === "entra-sync"
                          ? "Entra wird abgeglichen …"
                          : "Manuellen Abgleich starten"}
                      </button>
                    </div>
                  </div>
                  <p className="tenant-admin-settings__directory-note">
                    Der Verbindungstest überträgt keine Personenliste in den
                    Browser. Ein deaktivierter Connector kann nach dem Speichern
                    getestet, aber erst nach einem erfolgreichen Test und einer
                    bewussten Aktivierung abgeglichen werden. Agentenzugänge
                    werden weiterhin nur über eine bewusste Vormerkung vergeben.
                  </p>
                </section>
                <form
                  className="tenant-admin-settings__form"
                  onSubmit={inviteUser}
                >
                  <h3>Person einladen</h3>
                  <div className="tenant-admin-settings__person-form-grid">
                    <label>
                      Vor- und Nachname
                      <input
                        value={invitationPersonForm.displayName}
                        required
                        minLength={2}
                        disabled={saving !== null}
                        onChange={(event) =>
                          setInvitationPersonForm((current) => ({
                            ...current,
                            displayName: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      E-Mail-Adresse
                      <input
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        value={invitationEmail}
                        required
                        disabled={saving !== null}
                        onChange={(event) =>
                          setInvitationEmail(event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Ticketzugriffsbereich
                      <select
                        value={invitationPersonForm.departmentId}
                        disabled={saving !== null}
                        onChange={(event) =>
                          setInvitationPersonForm((current) => ({
                            ...current,
                            departmentId: event.target.value,
                          }))
                        }
                      >
                        <option value="">Noch nicht zugeordnet</option>
                        {userDirectory.departments
                          .filter((department) => department.active)
                          .map((department) => (
                            <option key={department.id} value={department.id}>
                              {department.name}
                            </option>
                          ))}
                      </select>
                      <small className="tenant-admin-settings__field-hint">
                        Steuert ausschliesslich, auf welche Ticketbereiche diese
                        Person als Agent zugreifen darf.
                      </small>
                    </label>
                    <label>
                      Angebot
                      <input
                        value={invitationPersonForm.offer}
                        disabled={saving !== null}
                        onChange={(event) =>
                          setInvitationPersonForm((current) => ({
                            ...current,
                            offer: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Funktion
                      <input
                        value={invitationPersonForm.jobTitle}
                        disabled={saving !== null}
                        onChange={(event) =>
                          setInvitationPersonForm((current) => ({
                            ...current,
                            jobTitle: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="tenant-admin-settings__agent-toggle">
                      <input
                        type="checkbox"
                        checked={invitationPersonForm.isAgent}
                        disabled={saving !== null}
                        onChange={(event) =>
                          setInvitationPersonForm((current) => ({
                            ...current,
                            isAgent: event.target.checked,
                          }))
                        }
                      />
                      <span>Arbeitet als Support-Agent</span>
                    </label>
                  </div>
                  <button type="submit" disabled={saving !== null}>
                    {saving === "invite-user"
                      ? "Einladung wird versendet …"
                      : "Einladung versenden"}
                  </button>
                </form>

                <div className="tenant-admin-settings__people-heading">
                  <div>
                    <h3>Aktive Personen</h3>
                    <p>{activeUsers.length} aktive Person(en) im Mandanten</p>
                  </div>
                  <label>
                    <span className="tenant-admin-settings__visually-hidden">
                      Personen suchen
                    </span>
                    <input
                      type="search"
                      placeholder="Name, E-Mail, Ticketzugriff …"
                      value={personSearch}
                      onChange={(event) => setPersonSearch(event.target.value)}
                    />
                  </label>
                </div>
                {filteredActiveUsers.length > 0 ? (
                  <ul className="tenant-admin-settings__person-list">
                    {filteredActiveUsers.map((member) => {
                      const target: SaveTarget = `remove-user:${member.id}`;
                      const editTarget: SaveTarget = `person:${member.id}`;
                      const isEditing = editingPerson?.id === member.id;
                      const offerFromEntra = member.offerSource === "entra";
                      const jobTitleFromEntra =
                        member.jobTitleSource === "entra";
                      return (
                        <li key={member.id}>
                          <div className="tenant-admin-settings__person-summary">
                            <div>
                              <strong>
                                {member.displayName?.trim() || member.email}
                              </strong>
                              <span>{member.email}</span>
                            </div>
                            <div className="tenant-admin-settings__person-badges">
                              {member.departmentName ? (
                                <span>
                                  Ticketzugriff: {member.departmentName}
                                </span>
                              ) : null}
                              {member.offer ? (
                                <span>Organisation: {member.offer}</span>
                              ) : null}
                              {member.jobTitle ? (
                                <span>Funktion: {member.jobTitle}</span>
                              ) : null}
                              {member.isTenantAdmin ? (
                                <span>Mandantenadmin</span>
                              ) : member.isAgent ? (
                                <span>Support-Agent</span>
                              ) : (
                                <span>Anfragende Person</span>
                              )}
                            </div>
                          </div>
                          <div className="tenant-admin-settings__person-actions">
                            <button
                              type="button"
                              disabled={saving !== null}
                              onClick={() => {
                                setEditingPerson(isEditing ? null : member);
                                setPersonEditForm(personFormFromMember(member));
                              }}
                            >
                              {isEditing
                                ? "Bearbeitung schliessen"
                                : "Bearbeiten"}
                            </button>
                            <button
                              type="button"
                              disabled={saving !== null}
                              onClick={() => void removeUser(member)}
                            >
                              {saving === target
                                ? "Wird entfernt …"
                                : "Entfernen"}
                            </button>
                          </div>
                          {isEditing ? (
                            <form
                              className="tenant-admin-settings__person-editor"
                              onSubmit={savePerson}
                            >
                              <label>
                                Vor- und Nachname
                                <input
                                  value={personEditForm.displayName}
                                  minLength={2}
                                  disabled={saving !== null}
                                  onChange={(event) =>
                                    setPersonEditForm((current) => ({
                                      ...current,
                                      displayName: event.target.value,
                                    }))
                                  }
                                />
                              </label>
                              <label>
                                Ticketzugriffsbereich
                                <select
                                  value={personEditForm.departmentId}
                                  disabled={saving !== null}
                                  onChange={(event) =>
                                    setPersonEditForm((current) => ({
                                      ...current,
                                      departmentId: event.target.value,
                                    }))
                                  }
                                >
                                  <option value="">
                                    Noch nicht zugeordnet
                                  </option>
                                  {userDirectory.departments
                                    .filter((department) => department.active)
                                    .map((department) => (
                                      <option
                                        key={department.id}
                                        value={department.id}
                                      >
                                        {department.name}
                                      </option>
                                    ))}
                                </select>
                                <small className="tenant-admin-settings__field-hint">
                                  Steuert ausschliesslich, auf welche
                                  Ticketbereiche diese Person als Agent
                                  zugreifen darf. Entra-Organisationsdaten
                                  ändern diesen Zugriff nie.
                                </small>
                              </label>
                              <label>
                                {offerFromEntra
                                  ? "Organisation / Angebot (Entra)"
                                  : "Angebot"}
                                <input
                                  value={personEditForm.offer}
                                  disabled={saving !== null}
                                  readOnly={offerFromEntra}
                                  onChange={
                                    offerFromEntra
                                      ? undefined
                                      : (event) =>
                                          setPersonEditForm((current) => ({
                                            ...current,
                                            offer: event.target.value,
                                          }))
                                  }
                                />
                                {offerFromEntra ? (
                                  <small className="tenant-admin-settings__field-hint">
                                    Wird aus der Entra-Organisationsabteilung
                                    übernommen und beim nächsten Abgleich
                                    aktualisiert.
                                  </small>
                                ) : null}
                              </label>
                              <label>
                                {jobTitleFromEntra
                                  ? "Funktion (Entra)"
                                  : "Funktion"}
                                <input
                                  value={personEditForm.jobTitle}
                                  disabled={saving !== null}
                                  readOnly={jobTitleFromEntra}
                                  onChange={
                                    jobTitleFromEntra
                                      ? undefined
                                      : (event) =>
                                          setPersonEditForm((current) => ({
                                            ...current,
                                            jobTitle: event.target.value,
                                          }))
                                  }
                                />
                                {jobTitleFromEntra ? (
                                  <small className="tenant-admin-settings__field-hint">
                                    Wird aus der Entra-Funktion übernommen und
                                    beim nächsten Abgleich aktualisiert.
                                  </small>
                                ) : null}
                              </label>
                              <label className="tenant-admin-settings__agent-toggle">
                                <input
                                  type="checkbox"
                                  checked={personEditForm.isAgent}
                                  disabled={
                                    saving !== null || member.isTenantAdmin
                                  }
                                  onChange={(event) =>
                                    setPersonEditForm((current) => ({
                                      ...current,
                                      isAgent: event.target.checked,
                                    }))
                                  }
                                />
                                <span>
                                  {member.isTenantAdmin
                                    ? "Mandantenadministration hat automatisch Agentenzugang"
                                    : "Arbeitet als Support-Agent"}
                                </span>
                              </label>
                              <div className="tenant-admin-settings__form-actions">
                                <button
                                  type="submit"
                                  disabled={saving !== null}
                                >
                                  {saving === editTarget
                                    ? "Wird gespeichert …"
                                    : "Person speichern"}
                                </button>
                              </div>
                            </form>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : personSearch.trim() ? (
                  <p>
                    Für diese Suche wurden keine aktiven nextDesk-Personen
                    gefunden.
                  </p>
                ) : (
                  <p>
                    Für diesen Mandanten sind noch keine aktiven Personen
                    vorhanden.
                  </p>
                )}

                <h3>
                  Synchronisierte Entra-Personen
                  {personSearch.trim()
                    ? ` (${filteredDirectoryPeople.length} Treffer)`
                    : ""}
                </h3>
                {filteredDirectoryPeople.length > 0 ? (
                  <ul className="tenant-admin-settings__person-list">
                    {filteredDirectoryPeople.map((person) => {
                      const target: SaveTarget = `entra-agent:${person.id}`;
                      const isEditing = editingEntraAgent === person.id;
                      return (
                        <li key={person.id}>
                          <div className="tenant-admin-settings__person-summary">
                            <div>
                              <strong>{person.displayName}</strong>
                              <span>{person.email}</span>
                            </div>
                            <div className="tenant-admin-settings__person-badges">
                              {person.sourceDepartmentName ? (
                                <span>{person.sourceDepartmentName}</span>
                              ) : null}
                              {person.jobTitle ? (
                                <span>{person.jobTitle}</span>
                              ) : null}
                              <span>
                                {person.accountEnabled
                                  ? "Entra aktiv"
                                  : "In Entra deaktiviert"}
                              </span>
                              <span>
                                {person.linkedToNextDesk
                                  ? "nextDesk verknüpft"
                                  : "Noch nicht angemeldet"}
                              </span>
                              {person.entraAgentAccessEffective ? (
                                <span>
                                  Support-Agent · Entra-Zuordnung
                                  {person.agentDepartmentName
                                    ? ` · ${person.agentDepartmentName}`
                                    : ""}
                                </span>
                              ) : person.isAgent ? (
                                <span>Support-Agent · andere Zuweisung</span>
                              ) : person.agentRequested ? (
                                <span>
                                  Agent vorgemerkt
                                  {person.agentDepartmentName
                                    ? ` · ${person.agentDepartmentName}`
                                    : ""}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="tenant-admin-settings__person-actions">
                            <button
                              type="button"
                              disabled={
                                saving !== null ||
                                !person.accountEnabled ||
                                (person.isAgent && !person.agentRequested)
                              }
                              onClick={() =>
                                isEditing
                                  ? setEditingEntraAgent(null)
                                  : beginEntraAgentEdit(person)
                              }
                            >
                              {isEditing
                                ? "Agentenzuordnung schliessen"
                                : person.isAgent && !person.agentRequested
                                  ? "Bereits Support-Agent"
                                  : person.agentRequested
                                    ? "Agentenzuordnung bearbeiten"
                                    : "Als Agent zuordnen"}
                            </button>
                          </div>
                          {isEditing ? (
                            <form
                              className="tenant-admin-settings__entra-agent-editor"
                              onSubmit={(event) => {
                                event.preventDefault();
                                void saveEntraAgentAccess(person);
                              }}
                            >
                              <div>
                                <strong>Support-Agent zuordnen</strong>
                                <p>
                                  {person.hasIndependentAgentAccess
                                    ? "Eine getrennte Agentenzuordnung bleibt unverändert. Sie bearbeiten hier nur die Entra-Vormerkung."
                                    : person.activeNextDeskMember
                                      ? "Die Zuordnung wird nach dem Speichern sofort wirksam."
                                      : "Die Person wird vorgemerkt. Der Agentenzugang wird erst nach ihrer ersten verifizierten Entra-Anmeldung wirksam."}
                                </p>
                              </div>
                              <label className="tenant-admin-settings__agent-toggle">
                                <input
                                  type="checkbox"
                                  checked={entraAgentForm.enabled}
                                  disabled={saving !== null}
                                  onChange={(event) =>
                                    setEntraAgentForm((current) => ({
                                      ...current,
                                      enabled: event.target.checked,
                                    }))
                                  }
                                />
                                <span>Arbeitet als Support-Agent</span>
                              </label>
                              <label>
                                Ziel-Abteilung
                                <select
                                  value={entraAgentForm.departmentId}
                                  disabled={
                                    saving !== null || !entraAgentForm.enabled
                                  }
                                  onChange={(event) =>
                                    setEntraAgentForm((current) => ({
                                      ...current,
                                      departmentId: event.target.value,
                                    }))
                                  }
                                >
                                  <option value="">Bitte auswählen</option>
                                  {userDirectory.departments
                                    .filter((department) => department.active)
                                    .map((department) => (
                                      <option
                                        key={department.id}
                                        value={department.id}
                                      >
                                        {department.name}
                                      </option>
                                    ))}
                                </select>
                              </label>
                              <div className="tenant-admin-settings__form-actions">
                                <button
                                  type="submit"
                                  disabled={saving !== null}
                                >
                                  {saving === target
                                    ? "Wird gespeichert …"
                                    : entraAgentForm.enabled
                                      ? "Agentenzuordnung speichern"
                                      : "Agentenzuordnung aufheben"}
                                </button>
                                <button
                                  type="button"
                                  disabled={saving !== null}
                                  onClick={() => setEditingEntraAgent(null)}
                                >
                                  Abbrechen
                                </button>
                              </div>
                            </form>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : personSearch.trim() ? (
                  <p>
                    Für diese Suche wurden keine synchronisierten Entra-Personen
                    gefunden.
                  </p>
                ) : (
                  <p>
                    Nach dem Abgleich erscheinen hier die Personen aus Microsoft
                    Entra.
                  </p>
                )}

                <h3>Offene Einladungen</h3>
                {openInvitations.length > 0 ? (
                  <ul className="tenant-admin-settings__person-list">
                    {openInvitations.map((invitation) => {
                      const target: SaveTarget = `revoke-invitation:${invitation.id}`;
                      return (
                        <li key={invitation.id}>
                          <strong>
                            {invitation.displayName?.trim() || invitation.email}
                          </strong>
                          <span>{invitation.email}</span>
                          <span className="tenant-admin-settings__person-badges">
                            {invitation.departmentName ? (
                              <span>{invitation.departmentName}</span>
                            ) : null}
                            {invitation.offer ? (
                              <span>{invitation.offer}</span>
                            ) : null}
                            {invitation.jobTitle ? (
                              <span>{invitation.jobTitle}</span>
                            ) : null}
                            {invitation.isAgent ? (
                              <span>Support-Agent</span>
                            ) : null}
                          </span>
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
                            {saving === target
                              ? "Wird widerrufen …"
                              : "Widerrufen"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </section>
            )}

            {activeArea === "roles" && (
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
                                Dieser Rolle sind keine Berechtigungen
                                zugeordnet.
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

                <form
                  className="tenant-admin-settings__form"
                  onSubmit={createRole}
                >
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
                                  toggleRolePermission(
                                    permission.code,
                                    setRoleForm,
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

                <form
                  className="tenant-admin-settings__form"
                  onSubmit={assignRole}
                >
                  <h3>Rolle zuweisen</h3>
                  <p>
                    Es können nur aktive, mandantenweite Rollen an aktive
                    Personen zugewiesen werden.
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
                        disabled={
                          saving !== null || assignableRoles.length === 0
                        }
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

                <section
                  className="tenant-admin-settings__access-overview"
                  aria-labelledby="effective-access-heading"
                >
                  <div className="tenant-admin-settings__section-heading">
                    <div>
                      <h3 id="effective-access-heading">Effektiver Zugriff</h3>
                      <p>
                        Zusammenfassung aller aktiven Rollen und daraus
                        resultierenden Berechtigungen je Person.
                      </p>
                    </div>
                    <span className="tenant-admin-settings__access-count">
                      {effectiveAccess.length} Personen
                    </span>
                  </div>
                  {effectiveAccess.length > 0 ? (
                    <ul className="tenant-admin-settings__access-list">
                      {effectiveAccess.map((person) => (
                        <li key={person.id}>
                          <div>
                            <strong>
                              {person.displayName?.trim() ||
                                person.email ||
                                "Unbekannte Person"}
                            </strong>
                            <span>
                              {person.email ?? "E-Mail nicht hinterlegt"}
                            </span>
                          </div>
                          <div>
                            <span className="tenant-admin-settings__access-label">
                              Rollen
                            </span>
                            <p>{person.roleNames.join(" · ")}</p>
                          </div>
                          <div>
                            <span className="tenant-admin-settings__access-label">
                              Berechtigungen ({person.permissionCodes.length})
                            </span>
                            <p>{person.permissionCodes.join(" · ")}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="tenant-admin-settings__hint">
                      Sobald einer aktiven Person eine Rolle zugewiesen ist,
                      erscheint ihre effektive Zugriffsübersicht hier.
                    </p>
                  )}
                </section>

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
                            {formatDate(assignment.starts_at) ??
                              "Nicht hinterlegt"}
                          </span>
                          <button
                            type="button"
                            disabled={saving !== null}
                            onClick={() =>
                              setAssignmentPendingRevocation(assignment)
                            }
                          >
                            {saving === target
                              ? "Wird entzogen …"
                              : "Entziehen"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p>In dieser Ansicht wurde noch keine Rolle zugewiesen.</p>
                )}
              </section>
            )}
          </div>
        </>
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
