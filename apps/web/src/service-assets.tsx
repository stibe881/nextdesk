import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { supabase } from "./lib/supabase";

export type ServiceAssetsProps = {
  tenantId: string;
  initialTab?: CatalogTab;
  allowAssets?: boolean;
  fixedTab?: CatalogTab;
  createProblemRequestId?: number | undefined;
  onCreateProblemRequestConsumed?: ((requestId: number) => void) | undefined;
  onCreateMaintenance?: (() => void) | undefined;
};

export type CatalogTab = "services" | "assets" | "problems";
type Criticality = "low" | "medium" | "high" | "critical";
type ServiceStatus =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "maintenance";
type ProblemStatus = "open" | "investigating" | "known_error" | "resolved";
type EditableProblemStatus = Exclude<ProblemStatus, "resolved">;
type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type Service = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  criticality: Criticality;
  status: ServiceStatus;
  status_public: boolean;
  primary_responsible_id: string | null;
  secondary_responsible_id: string | null;
  service_category_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type ServiceCategory = {
  id: string;
  tenant_id: string;
  name: string;
  parent_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type Asset = {
  id: string;
  tenant_id: string;
  service_id: string | null;
  name: string;
  asset_tag: string | null;
  inventory_number: string | null;
  serial_number: string | null;
  manufacturer: string | null;
  model: string | null;
  operating_system: string | null;
  kind: string;
  status: string;
  customer_organization_id: string | null;
  intune_primary_person_name: string | null;
  metadata: { [key: string]: JsonValue };
  active: boolean;
  created_at: string;
  updated_at: string;
};

type Problem = {
  id: string;
  tenant_id: string;
  title: string;
  description: string;
  status: ProblemStatus;
  workaround: string | null;
  root_cause: string | null;
  owner_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type TicketReference = {
  id: string;
  ticketNumber: string;
  subject: string;
  statusLabel: string;
};

type ProblemOwner = {
  id: string;
  displayName: string;
};

type ServiceResponsibleAgent = {
  id: string;
  displayName: string;
};

type ServiceForm = {
  id: string | null;
  name: string;
  description: string;
  criticality: Criticality;
  status: ServiceStatus;
  statusPublic: boolean;
  primaryResponsibleId: string;
  secondaryResponsibleId: string;
  categoryId: string;
};

type ServiceCategoryForm = {
  id: string | null;
  name: string;
  parentId: string;
};

type AssetForm = {
  id: string | null;
  name: string;
  serviceId: string;
  assetTag: string;
  inventoryNumber: string;
  serialNumber: string;
  manufacturer: string;
  model: string;
  operatingSystem: string;
  kind: string;
  status: string;
  customerOrganizationId: string;
  metadata: string;
};

type ProblemForm = {
  id: string | null;
  title: string;
  description: string;
  status: EditableProblemStatus;
  workaround: string;
  rootCause: string;
  ownerId: string;
};

type ProblemFormMode = "create" | "edit" | "resolve";

type CatalogRequest = {
  type: "listCatalog";
  tenantId: string;
  includeArchivedServices?: boolean;
};

export function catalogRequest(
  tenantId: string,
  supportsArchivedServices: boolean,
  includeArchivedServices: boolean,
): CatalogRequest {
  return {
    type: "listCatalog",
    tenantId,
    ...(supportsArchivedServices ? { includeArchivedServices } : {}),
  };
}

export function canArchiveServices(
  canManageServices: boolean,
  supportsArchivedServices: boolean,
): boolean {
  return canManageServices && supportsArchivedServices;
}
type ProblemOwnersRequest = { type: "listProblemOwners"; tenantId: string };
type ServiceResponsibleAgentsRequest = {
  type: "listServiceResponsibleAgents";
  tenantId: string;
};
type ServiceSaveRequest = {
  type: "manageService";
  tenantId: string;
  operation: "create" | "update";
  name: string;
  description: string | null;
  criticality: Criticality;
  status: ServiceStatus;
  statusPublic: boolean;
  primaryResponsibleId: string | null;
  secondaryResponsibleId: string | null;
  categoryId?: string | null;
  serviceId?: string;
};
type ServiceCategorySaveRequest = {
  type: "manageServiceCategory";
  tenantId: string;
  operation: "create" | "update";
  name: string;
  parentId: string | null;
  categoryId?: string;
};
type ServiceArchiveRequest = {
  type: "manageService";
  tenantId: string;
  operation: "archive";
  serviceId: string;
};
type ServiceRestoreRequest = {
  type: "manageService";
  tenantId: string;
  operation: "restore";
  serviceId: string;
};
type AssetSaveRequest = {
  type: "manageAsset";
  tenantId: string;
  operation: "create" | "update";
  name: string;
  serviceId: string | null;
  assetTag: string | null;
  inventoryNumber: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  operatingSystem: string | null;
  kind: string;
  status: string;
  customerOrganizationId: string | null;
  metadata: { [key: string]: JsonValue };
  active: boolean;
  assetId?: string;
};
type AssetArchiveRequest = {
  type: "manageAsset";
  tenantId: string;
  operation: "archive";
  assetId: string;
};
type ProblemSaveRequest = {
  type: "manageProblem";
  tenantId: string;
  operation: "create" | "update";
  title: string;
  description: string;
  status: EditableProblemStatus;
  workaround: string | null;
  rootCause: string | null;
  ownerId: string | null;
  problemId?: string;
};
type ProblemResolveRequest = {
  type: "manageProblem";
  tenantId: string;
  operation: "resolve";
  problemId: string;
  workaround: string | null;
  rootCause: string | null;
};
type ProblemTicketsRequest = {
  type: "listProblemTickets";
  tenantId: string;
  problemId: string;
};
type TicketSearchRequest = {
  type: "searchTickets";
  tenantId: string;
  query: string;
};
type ProblemTicketLinkRequest = {
  type: "linkTicket" | "unlinkTicket";
  tenantId: string;
  ticketId: string;
  kind: "problem";
  targetId: string;
};
type ServiceAssetsRequest =
  | CatalogRequest
  | ProblemOwnersRequest
  | ServiceResponsibleAgentsRequest
  | ServiceSaveRequest
  | ServiceArchiveRequest
  | ServiceRestoreRequest
  | ServiceCategorySaveRequest
  | AssetSaveRequest
  | AssetArchiveRequest
  | ProblemSaveRequest
  | ProblemResolveRequest
  | ProblemTicketsRequest
  | TicketSearchRequest
  | ProblemTicketLinkRequest;

const EMPTY_SERVICE_FORM: ServiceForm = {
  id: null,
  name: "",
  description: "",
  criticality: "medium",
  status: "operational",
  statusPublic: false,
  primaryResponsibleId: "",
  secondaryResponsibleId: "",
  categoryId: "",
};

const EMPTY_SERVICE_CATEGORY_FORM: ServiceCategoryForm = {
  id: null,
  name: "",
  parentId: "",
};

const EMPTY_ASSET_FORM: AssetForm = {
  id: null,
  name: "",
  serviceId: "",
  assetTag: "",
  inventoryNumber: "",
  serialNumber: "",
  manufacturer: "",
  model: "",
  operatingSystem: "",
  kind: "other",
  status: "active",
  customerOrganizationId: "",
  metadata: "{}",
};

const EMPTY_PROBLEM_FORM: ProblemForm = {
  id: null,
  title: "",
  description: "",
  status: "open",
  workaround: "",
  rootCause: "",
  ownerId: "",
};

const CRITICALITY_LABELS: Record<Criticality, string> = {
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
  critical: "Kritisch",
};

const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  operational: "Betriebsbereit",
  degraded: "Beeinträchtigte Leistung",
  partial_outage: "Teilweiser Ausfall",
  major_outage: "Schwerwiegender Ausfall",
  maintenance: "Wird gewartet",
};

const PROBLEM_STATUS_LABELS: Record<ProblemStatus, string> = {
  open: "Offen",
  investigating: "In Untersuchung",
  known_error: "Bekannter Fehler",
  resolved: "Gelöst",
};

const EDITABLE_PROBLEM_STATUSES: EditableProblemStatus[] = [
  "open",
  "investigating",
  "known_error",
];

function serviceCategoryPath(
  categories: readonly ServiceCategory[],
  categoryId: string | null | undefined,
): ServiceCategory[] {
  if (!categoryId) return [];
  const categoriesById = new Map(
    categories.map((category) => [category.id, category]),
  );
  const path: ServiceCategory[] = [];
  const seen = new Set<string>();
  let current = categoriesById.get(categoryId) ?? null;
  while (current && !seen.has(current.id) && path.length < 3) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parent_id
      ? (categoriesById.get(current.parent_id) ?? null)
      : null;
  }
  return path;
}

function serviceCategoryLabel(
  categories: readonly ServiceCategory[],
  categoryId: string | null | undefined,
): string | null {
  const path = serviceCategoryPath(categories, categoryId);
  return path.length > 0
    ? path.map((category) => category.name).join(" · ")
    : null;
}

function serviceCategoryDepth(
  categories: readonly ServiceCategory[],
  category: ServiceCategory,
): number {
  return serviceCategoryPath(categories, category.id).length;
}

type ServiceEditorFieldsProps = {
  controlsDisabled: boolean;
  nameInputRef: RefObject<HTMLInputElement | null>;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  pendingAction: string | null;
  serviceForm: ServiceForm;
  serviceResponsibleAgentNames: ReadonlyMap<string, string>;
  serviceResponsibleAgents: ServiceResponsibleAgent[];
  serviceResponsibleAgentsLoading: boolean;
  serviceCategories: ServiceCategory[];
  supportsServiceCategories: boolean;
  onCreateCategory?:
    | ((
        name: string,
        parentId: string | null,
      ) => Promise<ServiceCategory | null>)
    | undefined;
  setServiceForm: Dispatch<SetStateAction<ServiceForm>>;
};

function ServiceEditorFields({
  controlsDisabled,
  nameInputRef,
  onCancel,
  onSubmit,
  pendingAction,
  serviceForm,
  serviceResponsibleAgentNames,
  serviceResponsibleAgents,
  serviceResponsibleAgentsLoading,
  serviceCategories,
  supportsServiceCategories,
  onCreateCategory,
  setServiceForm,
}: ServiceEditorFieldsProps) {
  const [addingLevel, setAddingLevel] = useState<0 | 1 | 2 | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const selectedCategoryPath = serviceCategoryPath(
    serviceCategories,
    serviceForm.categoryId,
  );
  const rootCategoryId = selectedCategoryPath[0]?.id ?? "";
  const subcategoryId = selectedCategoryPath[1]?.id ?? "";
  const rootCategories = serviceCategories.filter(
    (category) => category.parent_id === null,
  );
  const subcategories = serviceCategories.filter(
    (category) => category.parent_id === rootCategoryId,
  );
  const detailCategories = serviceCategories.filter(
    (category) => category.parent_id === subcategoryId,
  );
  const levelNames = ["Ort", "Kategorie", "Unterkategorie"] as const;
  const levelParents = [null, rootCategoryId, subcategoryId] as const;
  async function createCategory(level: 0 | 1 | 2) {
    const name = newCategoryName.trim();
    if (!name || !onCreateCategory) return;
    const created = await onCreateCategory(name, levelParents[level] || null);
    if (!created) return;
    setServiceForm((current) => ({ ...current, categoryId: created.id }));
    setNewCategoryName("");
    setAddingLevel(null);
  }
  function addControl(level: 0 | 1 | 2) {
    if (!onCreateCategory || (level > 0 && !levelParents[level])) return null;
    if (addingLevel !== level) {
      return (
        <button
          className="text-button"
          disabled={controlsDisabled}
          onClick={() => {
            setAddingLevel(level);
            setNewCategoryName("");
          }}
          type="button"
        >
          + {levelNames[level]} neu anlegen
        </button>
      );
    }
    return (
      <span className="service-assets__category-inline-add">
        <input
          aria-label={`Name für ${levelNames[level]}`}
          disabled={controlsDisabled}
          maxLength={120}
          onChange={(event) => setNewCategoryName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void createCategory(level);
            }
          }}
          placeholder={`Neue/r ${levelNames[level]}`}
          value={newCategoryName}
        />
        <button
          className="primary-button"
          disabled={controlsDisabled || !newCategoryName.trim()}
          onClick={() => void createCategory(level)}
          type="button"
        >
          Anlegen
        </button>
        <button
          disabled={controlsDisabled}
          onClick={() => setAddingLevel(null)}
          type="button"
        >
          Abbrechen
        </button>
      </span>
    );
  }
  return (
    <form onSubmit={(event) => void onSubmit(event)}>
      <label>
        Name
        <input
          disabled={controlsDisabled}
          maxLength={240}
          onChange={(event) =>
            setServiceForm((current) => ({
              ...current,
              name: event.target.value,
            }))
          }
          required
          ref={nameInputRef}
          value={serviceForm.name}
        />
      </label>
      <label>
        Kritikalität
        <select
          disabled={controlsDisabled}
          onChange={(event) =>
            setServiceForm((current) => ({
              ...current,
              criticality: event.target.value as Criticality,
            }))
          }
          value={serviceForm.criticality}
        >
          {(Object.keys(CRITICALITY_LABELS) as Criticality[]).map(
            (criticality) => (
              <option key={criticality} value={criticality}>
                {CRITICALITY_LABELS[criticality]}
              </option>
            ),
          )}
        </select>
      </label>
      <label>
        Betriebszustand
        <select
          disabled={controlsDisabled}
          onChange={(event) =>
            setServiceForm((current) => ({
              ...current,
              status: event.target.value as ServiceStatus,
            }))
          }
          value={serviceForm.status}
        >
          {(Object.keys(SERVICE_STATUS_LABELS) as ServiceStatus[]).map(
            (status) => (
              <option key={status} value={status}>
                {SERVICE_STATUS_LABELS[status]}
              </option>
            ),
          )}
        </select>
      </label>
      <label>
        Beschreibung (optional)
        <textarea
          disabled={controlsDisabled}
          maxLength={50000}
          onChange={(event) =>
            setServiceForm((current) => ({
              ...current,
              description: event.target.value,
            }))
          }
          rows={3}
          value={serviceForm.description}
        />
      </label>
      {supportsServiceCategories ? (
        <div
          aria-label="Serviceeinordnung"
          className="service-assets__service-category-fields"
          role="group"
        >
          <div>
            <strong>Serviceeinordnung</strong>
            <small>
              Wählen Sie den Ort (z. B. Betriebsweit, Baar, Menzingen) und bei
              Bedarf eine Kategorie und Unterkategorie.
            </small>
          </div>
          <label>
            Ort
            <select
              disabled={controlsDisabled}
              onChange={(event) =>
                setServiceForm((current) => ({
                  ...current,
                  categoryId: event.target.value,
                }))
              }
              value={rootCategoryId}
            >
              <option value="">Nicht zugeordnet</option>
              {rootCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {addControl(0)}
          </label>
          <label>
            Kategorie
            <select
              disabled={controlsDisabled || !rootCategoryId}
              onChange={(event) =>
                setServiceForm((current) => ({
                  ...current,
                  categoryId: event.target.value || rootCategoryId,
                }))
              }
              value={subcategoryId}
            >
              <option value="">
                {rootCategoryId
                  ? "Keine Kategorie"
                  : "Zuerst Ort wählen"}
              </option>
              {subcategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {addControl(1)}
          </label>
          <label>
            Unterkategorie
            <select
              disabled={controlsDisabled || !subcategoryId}
              onChange={(event) =>
                setServiceForm((current) => ({
                  ...current,
                  categoryId:
                    event.target.value || subcategoryId || rootCategoryId,
                }))
              }
              value={
                selectedCategoryPath[2]?.id && subcategoryId
                  ? selectedCategoryPath[2].id
                  : ""
              }
            >
              <option value="">
                {subcategoryId
                  ? "Keine Unterkategorie"
                  : "Zuerst Kategorie wählen"}
              </option>
              {detailCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {addControl(2)}
          </label>
          {rootCategories.length === 0 ? (
            <p>
              Es sind noch keine Orte und Kategorien angelegt. Sie können die
              Einordnung später ergänzen.
            </p>
          ) : null}
        </div>
      ) : null}
      <label>
        Primär verantwortliche Agent:in (optional)
        <select
          disabled={controlsDisabled || serviceResponsibleAgentsLoading}
          onChange={(event) =>
            setServiceForm((current) => ({
              ...current,
              primaryResponsibleId: event.target.value,
              secondaryResponsibleId:
                event.target.value === current.secondaryResponsibleId
                  ? ""
                  : current.secondaryResponsibleId,
            }))
          }
          value={serviceForm.primaryResponsibleId}
        >
          <option value="">Nicht zugeordnet</option>
          {serviceForm.primaryResponsibleId &&
          !serviceResponsibleAgentNames.has(
            serviceForm.primaryResponsibleId,
          ) ? (
            <option value={serviceForm.primaryResponsibleId}>
              Nicht mehr verfügbar
            </option>
          ) : null}
          {serviceResponsibleAgents
            .filter((agent) => agent.id !== serviceForm.secondaryResponsibleId)
            .map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.displayName}
              </option>
            ))}
        </select>
      </label>
      <label>
        Sekundär verantwortliche Agent:in (optional)
        <select
          disabled={
            controlsDisabled ||
            serviceResponsibleAgentsLoading ||
            !serviceForm.primaryResponsibleId
          }
          onChange={(event) =>
            setServiceForm((current) => ({
              ...current,
              secondaryResponsibleId: event.target.value,
            }))
          }
          value={serviceForm.secondaryResponsibleId}
        >
          <option value="">Nicht zugeordnet</option>
          {serviceForm.secondaryResponsibleId &&
          !serviceResponsibleAgentNames.has(
            serviceForm.secondaryResponsibleId,
          ) ? (
            <option value={serviceForm.secondaryResponsibleId}>
              Nicht mehr verfügbar
            </option>
          ) : null}
          {serviceResponsibleAgents
            .filter((agent) => agent.id !== serviceForm.primaryResponsibleId)
            .map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.displayName}
              </option>
            ))}
        </select>
        <small>
          Nur aktuell berechtigte interne Agent:innen stehen zur Auswahl.
        </small>
      </label>
      <label className="service-assets__status-public-toggle">
        <input
          checked={serviceForm.statusPublic}
          disabled={controlsDisabled}
          onChange={(event) =>
            setServiceForm((current) => ({
              ...current,
              statusPublic: event.target.checked,
            }))
          }
          type="checkbox"
        />
        <span>
          <strong>Auf öffentlicher Statusseite anzeigen</strong>
          <small>
            Der Service erscheint erst nach bewusster Freigabe der Statusseite
            unter Systemstatus.
          </small>
        </span>
      </label>
      <p>
        <button
          className="primary-button"
          disabled={controlsDisabled}
          type="submit"
        >
          {pendingAction?.startsWith("service:save:")
            ? "Wird gespeichert …"
            : serviceForm.id
              ? "Änderungen speichern"
              : "Service anlegen"}
        </button>{" "}
        <button disabled={controlsDisabled} onClick={onCancel} type="button">
          Abbrechen
        </button>
      </p>
    </form>
  );
}

const CATALOG_PAGE_COPY: Readonly<
  Record<CatalogTab, { eyebrow: string; title: string; description: string }>
> = {
  services: {
    eyebrow: "Servicekatalog",
    title: "Services",
    description:
      "Verwalten Sie die aktiven Services dieses Mandanten und ihre Kritikalität.",
  },
  assets: {
    eyebrow: "Asset Management",
    title: "Assets",
    description:
      "Verwalten Sie die aktiven Assets dieses Mandanten und ihre Zuordnung zu Services.",
  },
  problems: {
    eyebrow: "Fallmanagement",
    title: "Fälle",
    description:
      "Verfolgen Sie offene Fälle, dokumentieren Sie Ursachen und verknüpfen Sie betroffene Tickets.",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function personInitials(value: string): string {
  const initials = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("de-CH");
  return initials || "?";
}

function isCriticality(value: unknown): value is Criticality {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "critical"
  );
}

function isServiceStatus(value: unknown): value is ServiceStatus {
  return (
    value === "operational" ||
    value === "degraded" ||
    value === "partial_outage" ||
    value === "major_outage" ||
    value === "maintenance"
  );
}

function isProblemStatus(value: unknown): value is ProblemStatus {
  return (
    value === "open" ||
    value === "investigating" ||
    value === "known_error" ||
    value === "resolved"
  );
}

function parseService(value: unknown): Service | null {
  if (!isRecord(value)) return null;
  const primaryResponsibleId = Object.hasOwn(value, "primary_responsible_id")
    ? value.primary_responsible_id
    : null;
  const secondaryResponsibleId = Object.hasOwn(
    value,
    "secondary_responsible_id",
  )
    ? value.secondary_responsible_id
    : null;
  const serviceCategoryId = Object.hasOwn(value, "service_category_id")
    ? value.service_category_id
    : null;
  if (
    typeof value.id !== "string" ||
    typeof value.tenant_id !== "string" ||
    typeof value.name !== "string" ||
    !isNullableString(value.description) ||
    !isCriticality(value.criticality) ||
    !isServiceStatus(value.status) ||
    typeof value.status_public !== "boolean" ||
    !isNullableString(primaryResponsibleId) ||
    !isNullableString(secondaryResponsibleId) ||
    !isNullableString(serviceCategoryId) ||
    typeof value.active !== "boolean" ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    tenant_id: value.tenant_id,
    name: value.name,
    description: value.description,
    criticality: value.criticality,
    status: value.status,
    status_public: value.status_public,
    primary_responsible_id: primaryResponsibleId,
    secondary_responsible_id: secondaryResponsibleId,
    service_category_id: serviceCategoryId,
    active: value.active,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function parseServiceCategory(value: unknown): ServiceCategory | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.tenant_id !== "string" ||
    typeof value.name !== "string" ||
    !isNullableString(value.parent_id) ||
    typeof value.active !== "boolean" ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    tenant_id: value.tenant_id,
    name: value.name,
    parent_id: value.parent_id,
    active: value.active,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function parseAsset(value: unknown): Asset | null {
  if (!isRecord(value) || !isRecord(value.metadata)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.tenant_id !== "string" ||
    !isNullableString(value.service_id) ||
    typeof value.name !== "string" ||
    !isNullableString(value.asset_tag) ||
    !isNullableString(value.inventory_number) ||
    !isNullableString(value.serial_number) ||
    !isNullableString(value.manufacturer) ||
    !isNullableString(value.model) ||
    !isNullableString(value.operating_system) ||
    typeof value.kind !== "string" ||
    typeof value.status !== "string" ||
    !isNullableString(value.customer_organization_id) ||
    (Object.hasOwn(value, "intune_primary_person_name") &&
      !isNullableString(value.intune_primary_person_name)) ||
    typeof value.active !== "boolean" ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    tenant_id: value.tenant_id,
    service_id: value.service_id,
    name: value.name,
    asset_tag: value.asset_tag,
    inventory_number: value.inventory_number,
    serial_number: value.serial_number,
    manufacturer: value.manufacturer,
    model: value.model,
    operating_system: value.operating_system,
    kind: value.kind,
    status: value.status,
    customer_organization_id: value.customer_organization_id,
    intune_primary_person_name: isNullableString(
      value.intune_primary_person_name,
    )
      ? value.intune_primary_person_name
      : null,
    metadata: value.metadata as { [key: string]: JsonValue },
    active: value.active,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function parseProblem(value: unknown): Problem | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.tenant_id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.description !== "string" ||
    !isProblemStatus(value.status) ||
    !isNullableString(value.workaround) ||
    !isNullableString(value.root_cause) ||
    !isNullableString(value.owner_id) ||
    typeof value.created_by !== "string" ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    tenant_id: value.tenant_id,
    title: value.title,
    description: value.description,
    status: value.status,
    workaround: value.workaround,
    root_cause: value.root_cause,
    owner_id: value.owner_id,
    created_by: value.created_by,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function parseTicketReference(value: unknown): TicketReference | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id.trim() ||
    typeof value.ticketNumber !== "string" ||
    !value.ticketNumber.trim() ||
    typeof value.subject !== "string" ||
    !value.subject.trim() ||
    typeof value.statusLabel !== "string" ||
    !value.statusLabel.trim()
  ) {
    return null;
  }
  return {
    id: value.id,
    ticketNumber: value.ticketNumber,
    subject: value.subject,
    statusLabel: value.statusLabel,
  };
}

function parseProblemOwner(value: unknown): ProblemOwner | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id.trim() ||
    typeof value.displayName !== "string" ||
    !value.displayName.trim()
  ) {
    return null;
  }
  return { id: value.id, displayName: value.displayName };
}

function parseServiceResponsibleAgent(
  value: unknown,
): ServiceResponsibleAgent | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id.trim() ||
    typeof value.displayName !== "string" ||
    !value.displayName.trim()
  ) {
    return null;
  }
  return { id: value.id, displayName: value.displayName };
}

function responseData(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("Die Serverantwort hat ein unerwartetes Format.");
  }
  return value.data;
}

function parseTicketReferences(
  value: unknown,
  fallback: string,
): TicketReference[] {
  const tickets = responseData(value).tickets;
  if (!Array.isArray(tickets)) throw new Error(fallback);

  const parsed = tickets.map(parseTicketReference);
  if (parsed.some((ticket) => ticket === null)) throw new Error(fallback);
  const references = parsed as TicketReference[];
  if (
    new Set(references.map((ticket) => ticket.id)).size !== references.length
  ) {
    throw new Error(fallback);
  }
  return references;
}

function parseProblemOwners(value: unknown): ProblemOwner[] {
  const owners = responseData(value).owners;
  if (!Array.isArray(owners)) {
    throw new Error(
      "Die Liste der verantwortlichen Personen ist unvollständig.",
    );
  }
  const parsed = owners.map(parseProblemOwner);
  if (parsed.some((owner) => owner === null)) {
    throw new Error(
      "Die Liste der verantwortlichen Personen ist unvollständig.",
    );
  }
  const options = parsed as ProblemOwner[];
  if (new Set(options.map((owner) => owner.id)).size !== options.length) {
    throw new Error("Die Liste der verantwortlichen Personen ist ungültig.");
  }
  return options;
}

function parseServiceResponsibleAgents(
  value: unknown,
): ServiceResponsibleAgent[] {
  const agents = responseData(value).agents;
  if (!Array.isArray(agents)) {
    throw new Error("Die Liste der Service-Agent:innen ist unvollständig.");
  }
  const parsed = agents.map(parseServiceResponsibleAgent);
  if (parsed.some((agent) => agent === null)) {
    throw new Error("Die Liste der Service-Agent:innen ist unvollständig.");
  }
  const options = parsed as ServiceResponsibleAgent[];
  if (new Set(options.map((agent) => agent.id)).size !== options.length) {
    throw new Error("Die Liste der Service-Agent:innen ist ungültig.");
  }
  return options;
}

function parseProblemTicketLink(
  value: unknown,
  expected: {
    tenantId: string;
    problemId: string;
    ticketId: string;
    linked: boolean;
  },
): void {
  const link = responseData(value).link;
  if (
    !isRecord(link) ||
    link.tenantId !== expected.tenantId ||
    link.ticketId !== expected.ticketId ||
    link.targetId !== expected.problemId ||
    link.kind !== "problem" ||
    link.linked !== expected.linked
  ) {
    throw new Error("Die Ticketverknüpfung hat ein unerwartetes Format.");
  }
}

export function parseCatalog(value: unknown): {
  services: Service[];
  archivedServices: Service[];
  canManageServices: boolean;
  supportsArchivedServices: boolean;
  serviceCategories: ServiceCategory[];
  supportsServiceCategories: boolean;
  assets: Asset[];
  problems: Problem[];
} {
  const data = responseData(value);
  const supportsArchivedServices = Object.hasOwn(data, "archivedServices");
  const archivedServices = supportsArchivedServices
    ? data.archivedServices
    : [];
  const supportsServiceCategories = Object.hasOwn(data, "serviceCategories");
  const serviceCategories = supportsServiceCategories
    ? data.serviceCategories
    : [];
  const canManageServices = data.canManageServices ?? false;
  if (
    !Array.isArray(data.services) ||
    !Array.isArray(archivedServices) ||
    !Array.isArray(serviceCategories) ||
    typeof canManageServices !== "boolean" ||
    !Array.isArray(data.assets) ||
    !Array.isArray(data.problems)
  ) {
    throw new Error("Der Katalog ist unvollständig.");
  }

  const services = data.services.map(parseService);
  const archived = archivedServices.map(parseService);
  const categories = serviceCategories.map(parseServiceCategory);
  const assets = data.assets.map(parseAsset);
  const problems = data.problems.map(parseProblem);
  if (
    services.some((item) => item === null) ||
    archived.some((item) => item === null) ||
    categories.some((item) => item === null) ||
    assets.some((item) => item === null) ||
    problems.some((item) => item === null)
  ) {
    throw new Error("Der Katalog enthält ungültige Einträge.");
  }

  return {
    services: services as Service[],
    archivedServices: archived as Service[],
    canManageServices,
    supportsArchivedServices,
    serviceCategories: categories as ServiceCategory[],
    supportsServiceCategories,
    assets: assets as Asset[],
    problems: problems as Problem[],
  };
}

function parseSavedService(value: unknown): Service {
  const service = parseService(responseData(value).service);
  if (!service) throw new Error("Der gespeicherte Service ist unvollständig.");
  return service;
}

function parseSavedServiceCategory(value: unknown): ServiceCategory {
  const category = parseServiceCategory(responseData(value).serviceCategory);
  if (!category) {
    throw new Error("Die gespeicherte Servicekategorie ist unvollständig.");
  }
  return category;
}

function parseSavedAsset(value: unknown): Asset {
  const asset = parseAsset(responseData(value).asset);
  if (!asset) throw new Error("Das gespeicherte Asset ist unvollständig.");
  return asset;
}

function parseSavedProblem(value: unknown): Problem {
  const problem = parseProblem(responseData(value).problem);
  if (!problem) {
    throw new Error("Der gespeicherte Fall ist unvollständig.");
  }
  return problem;
}

async function requestServiceAssets(
  body: ServiceAssetsRequest,
): Promise<unknown> {
  if (!supabase) {
    throw new Error("Die Verbindung zu Supabase ist nicht konfiguriert.");
  }
  const { data, error } = await supabase.functions.invoke<unknown>(
    "service-assets",
    { body },
  );
  if (error) throw error;
  return data;
}

function errorStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  const context = error.context;
  if (context instanceof Response) return context.status;
  if (
    isRecord(context) &&
    typeof context.status === "number" &&
    Number.isFinite(context.status)
  ) {
    return context.status;
  }
  return typeof error.status === "number" && Number.isFinite(error.status)
    ? error.status
    : null;
}

function publicMessage(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.message === "string" && value.message.trim()) {
    return value.message.trim();
  }
  return isRecord(value.error) ? publicMessage(value.error) : null;
}

async function apiErrorMessage(
  error: unknown,
  fallback: string,
): Promise<string> {
  const status = errorStatus(error);
  const context = isRecord(error) ? error.context : null;
  if (context instanceof Response) {
    try {
      const message = publicMessage(await context.clone().json());
      if (message) return message;
    } catch {
      // An error envelope is optional; fall through to the safe status message.
    }
  }
  if (status === 401) {
    return "Ihre Anmeldung ist nicht mehr gültig. Bitte melden Sie sich erneut an.";
  }
  if (status === 403) {
    return "Der Zugriff wurde von der API verweigert. Für diese Aktion fehlt Ihnen die erforderliche Berechtigung.";
  }
  if (status === 503) {
    return "Der Dienst oder die Berechtigungsprüfung ist derzeit nicht verfügbar. Bitte versuchen Sie es später erneut.";
  }
  return fallback;
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    left.name.localeCompare(right.name, "de"),
  );
}

export function sortServiceCategories(
  categories: ServiceCategory[],
): ServiceCategory[] {
  const categoriesByParent = new Map<string | null, ServiceCategory[]>();
  const categoriesById = new Map(
    categories.map((category) => [category.id, category]),
  );
  for (const category of categories) {
    const parentId =
      category.parent_id && categoriesById.has(category.parent_id)
        ? category.parent_id
        : null;
    const siblings = categoriesByParent.get(parentId) ?? [];
    siblings.push(category);
    categoriesByParent.set(parentId, siblings);
  }
  for (const siblings of categoriesByParent.values()) {
    siblings.sort((left, right) => left.name.localeCompare(right.name, "de"));
  }

  const ordered: ServiceCategory[] = [];
  const seen = new Set<string>();
  const visit = (category: ServiceCategory) => {
    if (seen.has(category.id)) return;
    seen.add(category.id);
    ordered.push(category);
    for (const child of categoriesByParent.get(category.id) ?? []) {
      visit(child);
    }
  };
  for (const root of categoriesByParent.get(null) ?? []) visit(root);
  for (const category of sortByName(categories)) visit(category);
  return ordered;
}

function sortProblems(items: Problem[]): Problem[] {
  return [...items].sort((left, right) =>
    right.updated_at.localeCompare(left.updated_at),
  );
}

function contains(haystack: Array<string | null>, query: string): boolean {
  if (!query.trim()) return true;
  const needle = query.trim().toLocaleLowerCase("de");
  return haystack.some((value) =>
    value?.toLocaleLowerCase("de").includes(needle),
  );
}

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unbekannt";
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function metadataPreview(metadata: { [key: string]: JsonValue }): string {
  const preview = JSON.stringify(metadata);
  return preview.length > 160 ? `${preview.slice(0, 157)}…` : preview;
}

function serviceDraft(service: Service): ServiceForm {
  return {
    id: service.id,
    name: service.name,
    description: service.description ?? "",
    criticality: service.criticality,
    status: service.status,
    statusPublic: service.status_public,
    primaryResponsibleId: service.primary_responsible_id ?? "",
    secondaryResponsibleId: service.secondary_responsible_id ?? "",
    categoryId: service.service_category_id ?? "",
  };
}

function assetDraft(asset: Asset): AssetForm {
  return {
    id: asset.id,
    name: asset.name,
    serviceId: asset.service_id ?? "",
    assetTag: asset.asset_tag ?? "",
    inventoryNumber: asset.inventory_number ?? "",
    serialNumber: asset.serial_number ?? "",
    manufacturer: asset.manufacturer ?? "",
    model: asset.model ?? "",
    operatingSystem: asset.operating_system ?? "",
    kind: asset.kind,
    status: asset.status,
    customerOrganizationId: asset.customer_organization_id ?? "",
    metadata: JSON.stringify(asset.metadata, null, 2),
  };
}

function problemDraft(problem: Problem): ProblemForm {
  return {
    id: problem.id,
    title: problem.title,
    description: problem.description,
    status: problem.status === "resolved" ? "open" : problem.status,
    workaround: problem.workaround ?? "",
    rootCause: problem.root_cause ?? "",
    ownerId: problem.owner_id ?? "",
  };
}

export function ServiceAssets({
  tenantId,
  initialTab = "services",
  allowAssets = true,
  fixedTab,
  createProblemRequestId,
  onCreateProblemRequestConsumed,
  onCreateMaintenance,
}: ServiceAssetsProps) {
  const [activeTab, setActiveTab] = useState<CatalogTab>(
    fixedTab ??
      (allowAssets || initialTab !== "assets" ? initialTab : "services"),
  );
  const [services, setServices] = useState<Service[]>([]);
  const [archivedServices, setArchivedServices] = useState<Service[]>([]);
  const [canManageServices, setCanManageServices] = useState(false);
  const [supportsArchivedServices, setSupportsArchivedServices] =
    useState(false);
  const [serviceCategories, setServiceCategories] = useState<ServiceCategory[]>(
    [],
  );
  const [supportsServiceCategories, setSupportsServiceCategories] =
    useState(false);
  const [serviceCategoryManagerOpen, setServiceCategoryManagerOpen] =
    useState(false);
  const [serviceCategoryForm, setServiceCategoryForm] =
    useState<ServiceCategoryForm>(EMPTY_SERVICE_CATEGORY_FORM);
  const [showArchivedServices, setShowArchivedServices] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [serviceForm, setServiceForm] =
    useState<ServiceForm>(EMPTY_SERVICE_FORM);
  const [assetForm, setAssetForm] = useState<AssetForm>(EMPTY_ASSET_FORM);
  const [problemForm, setProblemForm] =
    useState<ProblemForm>(EMPTY_PROBLEM_FORM);
  const [problemMode, setProblemMode] = useState<ProblemFormMode>("create");
  const [assetEditorOpen, setAssetEditorOpen] = useState(false);
  const [serviceEditorOpen, setServiceEditorOpen] = useState(false);
  const [inlineServiceEditorId, setInlineServiceEditorId] = useState<
    string | null
  >(null);
  const [serviceQuery, setServiceQuery] = useState("");
  const [serviceCriticality, setServiceCriticality] = useState<
    "all" | Criticality
  >("all");
  const [assetQuery, setAssetQuery] = useState("");
  const [assetServiceFilter, setAssetServiceFilter] = useState("all");
  const [assetStatusFilter, setAssetStatusFilter] = useState("all");
  const [problemQuery, setProblemQuery] = useState("");
  const [problemStatusFilter, setProblemStatusFilter] = useState<
    "all" | EditableProblemStatus
  >("all");
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [success, setSuccess] = useState("");
  const [quickEdit, setQuickEdit] = useState<{
    field: "criticality" | "responsibility";
    primary: string;
    secondary: string;
    serviceId: string;
  } | null>(null);
  const [serviceResponsibleAgents, setServiceResponsibleAgents] = useState<
    ServiceResponsibleAgent[]
  >([]);
  const [serviceResponsibleAgentsLoading, setServiceResponsibleAgentsLoading] =
    useState(false);
  const [problemOwners, setProblemOwners] = useState<ProblemOwner[]>([]);
  const [problemOwnersLoading, setProblemOwnersLoading] = useState(false);
  const [problemTickets, setProblemTickets] = useState<TicketReference[]>([]);
  const [ticketSearchQuery, setTicketSearchQuery] = useState("");
  const [ticketSearchResults, setTicketSearchResults] = useState<
    TicketReference[]
  >([]);
  const [problemTicketsLoading, setProblemTicketsLoading] = useState(false);
  const [ticketSearchLoading, setTicketSearchLoading] = useState(false);
  const requestVersion = useRef(0);
  const serviceResponsibleAgentsRequestVersion = useRef(0);
  const problemOwnersRequestVersion = useRef(0);
  const problemTicketsRequestVersion = useRef(0);
  const ticketSearchRequestVersion = useRef(0);
  const lastProblemCreateRequestId = useRef<number | undefined>(undefined);
  const assetEditorRef = useRef<HTMLElement | null>(null);
  const assetNameInputRef = useRef<HTMLInputElement | null>(null);
  const assetEditorTriggerRef = useRef<HTMLElement | null>(null);
  const assetCreateButtonRef = useRef<HTMLButtonElement | null>(null);
  const serviceEditorRef = useRef<HTMLDivElement | null>(null);
  const serviceNameInputRef = useRef<HTMLInputElement | null>(null);
  const serviceEditorTriggerRef = useRef<HTMLElement | null>(null);
  const serviceCreateButtonRef = useRef<HTMLButtonElement | null>(null);
  const archivedServiceRestoreButtonRefs = useRef(
    new Map<string, HTMLButtonElement>(),
  );

  const serviceNames = useMemo(
    () => new Map(services.map((service) => [service.id, service.name])),
    [services],
  );
  const serviceCategoryLabels = useMemo(
    () =>
      new Map(
        serviceCategories.map((category) => [
          category.id,
          serviceCategoryLabel(serviceCategories, category.id) ?? category.name,
        ]),
      ),
    [serviceCategories],
  );
  const selectableServiceCategoryParents = useMemo(
    () =>
      serviceCategories.filter(
        (category) => serviceCategoryDepth(serviceCategories, category) < 3,
      ),
    [serviceCategories],
  );
  const serviceCategoryParentOptions = useMemo(
    () =>
      selectableServiceCategoryParents.filter((category) => {
        if (!serviceCategoryForm.id || category.id === serviceCategoryForm.id) {
          return category.id !== serviceCategoryForm.id;
        }
        return !serviceCategoryPath(serviceCategories, category.id).some(
          (ancestor) => ancestor.id === serviceCategoryForm.id,
        );
      }),
    [
      selectableServiceCategoryParents,
      serviceCategories,
      serviceCategoryForm.id,
    ],
  );
  const problemOwnerNames = useMemo(
    () => new Map(problemOwners.map((owner) => [owner.id, owner.displayName])),
    [problemOwners],
  );
  const serviceResponsibleAgentNames = useMemo(
    () =>
      new Map(
        serviceResponsibleAgents.map((agent) => [agent.id, agent.displayName]),
      ),
    [serviceResponsibleAgents],
  );
  const assetStatuses = useMemo(
    () =>
      [...new Set(assets.map((asset) => asset.status))].sort((left, right) =>
        left.localeCompare(right, "de"),
      ),
    [assets],
  );
  const editedAssetPrimaryPerson = useMemo(() => {
    if (!assetForm.id) return null;
    return (
      assets.find((asset) => asset.id === assetForm.id)
        ?.intune_primary_person_name ?? null
    );
  }, [assetForm.id, assets]);
  const filteredServices = useMemo(
    () =>
      services.filter(
        (service) =>
          contains(
            [
              service.name,
              service.description,
              service.service_category_id
                ? (serviceCategoryLabels.get(service.service_category_id) ??
                  null)
                : null,
            ],
            serviceQuery,
          ) &&
          (serviceCriticality === "all" ||
            service.criticality === serviceCriticality),
      ),
    [serviceCategoryLabels, serviceCriticality, serviceQuery, services],
  );
  const filteredArchivedServices = useMemo(
    () =>
      archivedServices.filter(
        (service) =>
          contains(
            [
              service.name,
              service.description,
              service.service_category_id
                ? (serviceCategoryLabels.get(service.service_category_id) ??
                  null)
                : null,
            ],
            serviceQuery,
          ) &&
          (serviceCriticality === "all" ||
            service.criticality === serviceCriticality),
      ),
    [archivedServices, serviceCategoryLabels, serviceCriticality, serviceQuery],
  );
  const filteredAssets = useMemo(
    () =>
      assets.filter(
        (asset) =>
          contains(
            [
              asset.name,
              asset.asset_tag,
              asset.inventory_number,
              asset.serial_number,
              asset.manufacturer,
              asset.model,
              asset.operating_system,
              asset.kind,
              asset.status,
              asset.intune_primary_person_name,
              asset.service_id
                ? (serviceNames.get(asset.service_id) ?? null)
                : null,
            ],
            assetQuery,
          ) &&
          (assetStatusFilter === "all" || asset.status === assetStatusFilter) &&
          (assetServiceFilter === "all" ||
            (assetServiceFilter === "unassigned"
              ? asset.service_id === null
              : asset.service_id === assetServiceFilter)),
      ),
    [assetQuery, assetServiceFilter, assetStatusFilter, assets, serviceNames],
  );
  const filteredProblems = useMemo(
    () =>
      problems.filter(
        (problem) =>
          contains(
            [
              problem.title,
              problem.description,
              problem.workaround,
              problem.root_cause,
              problem.owner_id
                ? (problemOwnerNames.get(problem.owner_id) ?? null)
                : null,
            ],
            problemQuery,
          ) &&
          (problemStatusFilter === "all" ||
            problem.status === problemStatusFilter),
      ),
    [problemOwnerNames, problemQuery, problemStatusFilter, problems],
  );
  const attachedTicketIds = useMemo(
    () => new Set(problemTickets.map((ticket) => ticket.id)),
    [problemTickets],
  );
  const attachableTicketSearchResults = useMemo(
    () =>
      ticketSearchResults.filter((ticket) => !attachedTicketIds.has(ticket.id)),
    [attachedTicketIds, ticketSearchResults],
  );
  const availableTabs: readonly CatalogTab[] = fixedTab
    ? [fixedTab]
    : allowAssets
      ? ["services", "assets", "problems"]
      : ["services", "problems"];
  const pageCopy = fixedTab ? CATALOG_PAGE_COPY[fixedTab] : null;

  useEffect(() => {
    setActiveTab(
      fixedTab ??
        (allowAssets || initialTab !== "assets" ? initialTab : "services"),
    );
  }, [allowAssets, fixedTab, initialTab]);

  const loadCatalog = useCallback(async () => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setLoading(true);
    setError("");
    setForbidden(false);

    try {
      const catalog = parseCatalog(
        await requestServiceAssets(
          catalogRequest(
            tenantId,
            supportsArchivedServices,
            showArchivedServices,
          ),
        ),
      );
      if (requestVersion.current !== version) return;
      setServices(sortByName(catalog.services));
      setArchivedServices(sortByName(catalog.archivedServices));
      setCanManageServices(catalog.canManageServices);
      setSupportsArchivedServices(catalog.supportsArchivedServices);
      if (!catalog.supportsArchivedServices) setShowArchivedServices(false);
      setServiceCategories(sortServiceCategories(catalog.serviceCategories));
      setSupportsServiceCategories(catalog.supportsServiceCategories);
      if (!catalog.supportsServiceCategories) {
        setServiceCategoryManagerOpen(false);
        setServiceCategoryForm(EMPTY_SERVICE_CATEGORY_FORM);
      }
      setAssets(sortByName(catalog.assets));
      setProblems(sortProblems(catalog.problems));
    } catch (nextError) {
      if (requestVersion.current !== version) return;
      setServices([]);
      setArchivedServices([]);
      setCanManageServices(false);
      setSupportsArchivedServices(false);
      setServiceCategories([]);
      setSupportsServiceCategories(false);
      setServiceCategoryManagerOpen(false);
      setServiceCategoryForm(EMPTY_SERVICE_CATEGORY_FORM);
      setAssets([]);
      setProblems([]);
      setForbidden(errorStatus(nextError) === 403);
      setError(
        await apiErrorMessage(
          nextError,
          "Die Katalogdaten konnten nicht geladen werden.",
        ),
      );
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, [showArchivedServices, supportsArchivedServices, tenantId]);

  useEffect(() => {
    void loadCatalog();
    return () => {
      requestVersion.current += 1;
    };
  }, [loadCatalog]);

  useEffect(() => {
    const version = serviceResponsibleAgentsRequestVersion.current + 1;
    serviceResponsibleAgentsRequestVersion.current = version;
    if (!canManageServices) {
      setServiceResponsibleAgents([]);
      setServiceResponsibleAgentsLoading(false);
      return;
    }
    setServiceResponsibleAgents([]);
    setServiceResponsibleAgentsLoading(true);
    void (async () => {
      try {
        const agents = parseServiceResponsibleAgents(
          await requestServiceAssets({
            type: "listServiceResponsibleAgents",
            tenantId,
          }),
        );
        if (serviceResponsibleAgentsRequestVersion.current !== version) return;
        setServiceResponsibleAgents(agents);
      } catch {
        if (serviceResponsibleAgentsRequestVersion.current !== version) return;
        // The server remains authoritative. An unavailable directory leaves
        // the optional selection empty and any write is revalidated server-side.
        setServiceResponsibleAgents([]);
      } finally {
        if (serviceResponsibleAgentsRequestVersion.current === version) {
          setServiceResponsibleAgentsLoading(false);
        }
      }
    })();
    return () => {
      serviceResponsibleAgentsRequestVersion.current += 1;
    };
  }, [canManageServices, tenantId]);

  useEffect(() => {
    const version = problemOwnersRequestVersion.current + 1;
    problemOwnersRequestVersion.current = version;
    setProblemOwners([]);
    setProblemOwnersLoading(true);
    void (async () => {
      try {
        const owners = parseProblemOwners(
          await requestServiceAssets({ type: "listProblemOwners", tenantId }),
        );
        if (problemOwnersRequestVersion.current !== version) return;
        setProblemOwners(owners);
      } catch {
        if (problemOwnersRequestVersion.current !== version) return;
        // The server remains authoritative. A user without asset.manage sees
        // an empty, disabled picker and receives the normal action denial.
        setProblemOwners([]);
      } finally {
        if (problemOwnersRequestVersion.current === version) {
          setProblemOwnersLoading(false);
        }
      }
    })();
    return () => {
      problemOwnersRequestVersion.current += 1;
    };
  }, [tenantId]);

  useEffect(() => {
    setServiceForm(EMPTY_SERVICE_FORM);
    setServiceEditorOpen(false);
    setInlineServiceEditorId(null);
    serviceEditorTriggerRef.current = null;
    setAssetForm(EMPTY_ASSET_FORM);
    setAssetEditorOpen(false);
    assetEditorTriggerRef.current = null;
    setProblemForm(EMPTY_PROBLEM_FORM);
    setProblemMode("create");
    clearProblemTicketState();
    setServiceResponsibleAgents([]);
    setServiceResponsibleAgentsLoading(false);
    setProblemOwners([]);
    setArchivedServices([]);
    setCanManageServices(false);
    setSupportsArchivedServices(false);
    setServiceCategories([]);
    setSupportsServiceCategories(false);
    setServiceCategoryManagerOpen(false);
    setServiceCategoryForm(EMPTY_SERVICE_CATEGORY_FORM);
    setShowArchivedServices(false);
    setSuccess("");
  }, [tenantId]);

  useEffect(() => {
    if (
      !inlineServiceEditorId ||
      filteredServices.some((service) => service.id === inlineServiceEditorId)
    ) {
      return;
    }
    setServiceForm(EMPTY_SERVICE_FORM);
    setInlineServiceEditorId(null);
    serviceEditorTriggerRef.current = null;
    setError("");
    setForbidden(false);
  }, [filteredServices, inlineServiceEditorId]);

  useEffect(() => {
    if (!assetEditorOpen) return;
    const focusTimer = window.setTimeout(() => {
      assetNameInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [assetEditorOpen]);

  useEffect(() => {
    if (!serviceEditorOpen) return;
    const focusTimer = window.setTimeout(() => {
      serviceNameInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [serviceEditorOpen]);

  useEffect(() => {
    if (!inlineServiceEditorId) return;
    const focusTimer = window.setTimeout(() => {
      serviceNameInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [inlineServiceEditorId]);

  useEffect(() => {
    const problemId = problemForm.id;
    const version = problemTicketsRequestVersion.current + 1;
    problemTicketsRequestVersion.current = version;
    if (!problemId) {
      setProblemTickets([]);
      setProblemTicketsLoading(false);
      return;
    }

    setProblemTickets([]);
    setProblemTicketsLoading(true);
    setError("");
    setForbidden(false);
    void (async () => {
      try {
        const tickets = parseTicketReferences(
          await requestServiceAssets({
            type: "listProblemTickets",
            tenantId,
            problemId,
          }),
          "Die verknüpften Tickets haben ein unerwartetes Format.",
        );
        if (problemTicketsRequestVersion.current !== version) return;
        setProblemTickets(tickets);
      } catch (nextError) {
        const message = await apiErrorMessage(
          nextError,
          "Die verknüpften Tickets konnten nicht geladen werden.",
        );
        if (problemTicketsRequestVersion.current !== version) return;
        setForbidden(errorStatus(nextError) === 403);
        setError(message);
      } finally {
        if (problemTicketsRequestVersion.current === version) {
          setProblemTicketsLoading(false);
        }
      }
    })();
  }, [problemForm.id, tenantId]);

  useEffect(() => {
    const problemId = problemForm.id;
    const query = ticketSearchQuery.trim();
    const version = ticketSearchRequestVersion.current + 1;
    ticketSearchRequestVersion.current = version;
    if (!problemId || query.length < 2) {
      setTicketSearchResults([]);
      setTicketSearchLoading(false);
      return;
    }

    setTicketSearchResults([]);
    setTicketSearchLoading(true);
    setError("");
    setForbidden(false);
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const tickets = parseTicketReferences(
            await requestServiceAssets({
              type: "searchTickets",
              tenantId,
              query,
            }),
            "Die Ticketsuche hat ein unerwartetes Format.",
          );
          if (ticketSearchRequestVersion.current !== version) return;
          setTicketSearchResults(tickets);
        } catch (nextError) {
          const message = await apiErrorMessage(
            nextError,
            "Tickets konnten nicht gesucht werden.",
          );
          if (ticketSearchRequestVersion.current !== version) return;
          setForbidden(errorStatus(nextError) === 403);
          setError(message);
        } finally {
          if (ticketSearchRequestVersion.current === version) {
            setTicketSearchLoading(false);
          }
        }
      })();
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [problemForm.id, tenantId, ticketSearchQuery]);

  function beginAction(action: string) {
    setPendingAction(action);
    setError("");
    setForbidden(false);
    setSuccess("");
  }

  function resetServiceForm() {
    setServiceForm(EMPTY_SERVICE_FORM);
    setServiceEditorOpen(false);
    setInlineServiceEditorId(null);
    setError("");
    setSuccess("");
    restoreServiceEditorFocus();
  }

  function restoreServiceEditorFocus(archivedServiceId?: string) {
    const trigger = serviceEditorTriggerRef.current;
    serviceEditorTriggerRef.current = null;
    window.setTimeout(() => {
      const archiveTrigger = archivedServiceId
        ? archivedServiceRestoreButtonRefs.current.get(archivedServiceId)
        : null;
      const archiveTriggerIsUsable =
        archiveTrigger?.isConnected && !archiveTrigger.disabled;
      const triggerIsUsable =
        trigger?.isConnected &&
        !(trigger instanceof HTMLButtonElement && trigger.disabled);
      const fallback = serviceCreateButtonRef.current;
      const fallbackIsUsable = fallback?.isConnected && !fallback.disabled;
      if (archiveTriggerIsUsable) {
        archiveTrigger.focus();
      } else if (triggerIsUsable) {
        trigger.focus();
      } else if (fallbackIsUsable) {
        fallback.focus();
      }
    }, 0);
  }

  function openServiceEditor(trigger?: HTMLElement) {
    serviceEditorTriggerRef.current =
      trigger ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    setInlineServiceEditorId(null);
    setServiceForm(EMPTY_SERVICE_FORM);
    setError("");
    setSuccess("");
    setServiceEditorOpen(true);
  }

  function openInlineServiceEditor(service: Service, trigger: HTMLElement) {
    if (inlineServiceEditorId === service.id) {
      resetServiceForm();
      return;
    }
    serviceEditorTriggerRef.current = trigger;
    setServiceEditorOpen(false);
    setInlineServiceEditorId(service.id);
    setServiceForm(serviceDraft(service));
    setError("");
    setSuccess("");
  }

  function handleServiceEditorKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !controlsDisabled) {
      event.preventDefault();
      resetServiceForm();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = serviceEditorRef.current;
    if (!dialog) return;
    const focusable = [
      ...dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]",
      ),
    ];
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function restoreAssetEditorFocus() {
    const trigger = assetEditorTriggerRef.current;
    assetEditorTriggerRef.current = null;
    window.setTimeout(() => {
      const triggerIsUsable =
        trigger?.isConnected &&
        !(trigger instanceof HTMLButtonElement && trigger.disabled);
      const fallback = assetCreateButtonRef.current;
      const fallbackIsUsable = fallback?.isConnected && !fallback.disabled;
      if (triggerIsUsable) {
        trigger.focus();
      } else if (fallbackIsUsable) {
        fallback.focus();
      }
    }, 0);
  }

  function resetAssetForm() {
    setAssetForm(EMPTY_ASSET_FORM);
    setAssetEditorOpen(false);
    setError("");
    setSuccess("");
    restoreAssetEditorFocus();
  }

  function openAssetEditor(asset?: Asset, trigger?: HTMLElement) {
    assetEditorTriggerRef.current =
      trigger ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    setAssetForm(asset ? assetDraft(asset) : EMPTY_ASSET_FORM);
    setError("");
    setSuccess("");
    setAssetEditorOpen(true);
  }

  function handleAssetEditorKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !controlsDisabled) {
      event.preventDefault();
      resetAssetForm();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = assetEditorRef.current;
    if (!dialog) return;
    const focusable = [
      ...dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]",
      ),
    ];
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function resetProblemForm() {
    setProblemForm(EMPTY_PROBLEM_FORM);
    setProblemMode("create");
    clearProblemTicketState();
    setError("");
    setSuccess("");
  }

  useEffect(() => {
    if (
      createProblemRequestId === undefined ||
      lastProblemCreateRequestId.current === createProblemRequestId
    ) {
      return;
    }
    lastProblemCreateRequestId.current = createProblemRequestId;
    setActiveTab("problems");
    resetProblemForm();
    onCreateProblemRequestConsumed?.(createProblemRequestId);
  }, [createProblemRequestId, onCreateProblemRequestConsumed]);

  function clearProblemTicketState() {
    problemTicketsRequestVersion.current += 1;
    ticketSearchRequestVersion.current += 1;
    setProblemTickets([]);
    setTicketSearchQuery("");
    setTicketSearchResults([]);
    setProblemTicketsLoading(false);
    setTicketSearchLoading(false);
  }

  function selectTab(tab: CatalogTab) {
    setActiveTab(tab);
    setError("");
    setSuccess("");
  }

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, tab: CatalogTab) {
    const currentIndex = availableTabs.indexOf(tab);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight")
      nextIndex = (currentIndex + 1) % availableTabs.length;
    if (event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + availableTabs.length) % availableTabs.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = availableTabs.length - 1;
    if (nextIndex === currentIndex) return;

    event.preventDefault();
    const nextTab = availableTabs[nextIndex];
    if (!nextTab) return;
    selectTab(nextTab);
    window.requestAnimationFrame(() => {
      document.getElementById(`service-assets-${nextTab}-tab`)?.focus();
    });
  }

  async function saveService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = serviceForm.name.trim();
    if (!name) {
      setError("Bitte geben Sie einen Servicenamen ein.");
      return;
    }

    const editing = serviceForm.id !== null;
    beginAction(`service:save:${serviceForm.id ?? "new"}`);
    try {
      const request: ServiceSaveRequest = {
        type: "manageService",
        tenantId,
        operation: editing ? "update" : "create",
        ...(editing ? { serviceId: serviceForm.id! } : {}),
        name,
        description: optionalText(serviceForm.description),
        criticality: serviceForm.criticality,
        status: serviceForm.status,
        statusPublic: serviceForm.statusPublic,
        primaryResponsibleId: serviceForm.primaryResponsibleId || null,
        secondaryResponsibleId: serviceForm.secondaryResponsibleId || null,
        ...(supportsServiceCategories
          ? { categoryId: serviceForm.categoryId || null }
          : {}),
      };
      const saved = parseSavedService(await requestServiceAssets(request));
      setServices((current) =>
        sortByName([
          ...current.filter((service) => service.id !== saved.id),
          saved,
        ]),
      );
      resetServiceForm();
      setSuccess(
        editing
          ? `Der Service „${saved.name}“ wurde gespeichert.`
          : `Der Service „${saved.name}“ wurde angelegt.`,
      );
    } catch (nextError) {
      setForbidden(errorStatus(nextError) === 403);
      setError(
        await apiErrorMessage(
          nextError,
          "Der Service konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setPendingAction(null);
    }
  }

  function openServiceCategoryManager(category?: ServiceCategory) {
    setServiceCategoryManagerOpen(true);
    setServiceCategoryForm(
      category
        ? {
            id: category.id,
            name: category.name,
            parentId: category.parent_id ?? "",
          }
        : EMPTY_SERVICE_CATEGORY_FORM,
    );
    setError("");
    setSuccess("");
  }

  async function saveServiceCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = serviceCategoryForm.name.trim();
    if (!name) {
      setError("Bitte geben Sie einen Namen für die Servicekategorie ein.");
      return;
    }
    if (!supportsServiceCategories || !canManageServices) return;
    const editing = serviceCategoryForm.id !== null;
    beginAction(`service-category:save:${serviceCategoryForm.id ?? "new"}`);
    try {
      const request: ServiceCategorySaveRequest = {
        type: "manageServiceCategory",
        tenantId,
        operation: editing ? "update" : "create",
        ...(editing ? { categoryId: serviceCategoryForm.id! } : {}),
        name,
        parentId: serviceCategoryForm.parentId || null,
      };
      const saved = parseSavedServiceCategory(
        await requestServiceAssets(request),
      );
      setServiceCategories((current) =>
        sortServiceCategories([
          ...current.filter((category) => category.id !== saved.id),
          saved,
        ]),
      );
      setServiceCategoryForm(EMPTY_SERVICE_CATEGORY_FORM);
      setSuccess(
        editing
          ? `Die Servicekategorie „${saved.name}“ wurde gespeichert.`
          : `Die Servicekategorie „${saved.name}“ wurde angelegt.`,
      );
    } catch (nextError) {
      setForbidden(errorStatus(nextError) === 403);
      setError(
        await apiErrorMessage(
          nextError,
          "Die Servicekategorie konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function quickSaveService(
    service: Service,
    patch: Partial<
      Pick<
        ServiceForm,
        "criticality" | "primaryResponsibleId" | "secondaryResponsibleId"
      >
    >,
  ) {
    if (!canManageServices) return;
    const primaryResponsibleId =
      patch.primaryResponsibleId ?? service.primary_responsible_id ?? "";
    const secondaryResponsibleId = primaryResponsibleId
      ? (patch.secondaryResponsibleId ?? service.secondary_responsible_id ?? "")
      : "";
    beginAction(`service:save:${service.id}`);
    try {
      const request: ServiceSaveRequest = {
        type: "manageService",
        tenantId,
        operation: "update",
        serviceId: service.id,
        name: service.name,
        description: service.description,
        criticality: patch.criticality ?? service.criticality,
        status: service.status,
        statusPublic: service.status_public,
        primaryResponsibleId: primaryResponsibleId || null,
        secondaryResponsibleId: secondaryResponsibleId || null,
        ...(supportsServiceCategories
          ? { categoryId: service.service_category_id }
          : {}),
      };
      const saved = parseSavedService(await requestServiceAssets(request));
      setServices((current) =>
        sortByName([
          ...current.filter((item) => item.id !== saved.id),
          saved,
        ]),
      );
      setQuickEdit(null);
      setSuccess(`Der Service „${saved.name}“ wurde gespeichert.`);
    } catch (nextError) {
      setForbidden(errorStatus(nextError) === 403);
      setError(
        await apiErrorMessage(
          nextError,
          "Der Service konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function createServiceCategoryInline(
    name: string,
    parentId: string | null,
  ): Promise<ServiceCategory | null> {
    if (!supportsServiceCategories || !canManageServices) return null;
    beginAction("service-category:save:new");
    try {
      const saved = parseSavedServiceCategory(
        await requestServiceAssets({
          type: "manageServiceCategory",
          tenantId,
          operation: "create",
          name,
          parentId,
        }),
      );
      setServiceCategories((current) =>
        sortServiceCategories([
          ...current.filter((category) => category.id !== saved.id),
          saved,
        ]),
      );
      setSuccess(`„${saved.name}“ wurde angelegt.`);
      return saved;
    } catch (nextError) {
      setForbidden(errorStatus(nextError) === 403);
      setError(
        await apiErrorMessage(
          nextError,
          "Die Servicekategorie konnte nicht gespeichert werden.",
        ),
      );
      return null;
    } finally {
      setPendingAction(null);
    }
  }

  async function archiveService(service: Service) {
    if (!canArchiveServices(canManageServices, supportsArchivedServices)) {
      return;
    }
    if (!window.confirm(`Service „${service.name}“ archivieren?`)) return;
    const closesCurrentServiceEditor =
      serviceForm.id === service.id || inlineServiceEditorId === service.id;
    beginAction(`service:archive:${service.id}`);
    try {
      const archived = parseSavedService(
        await requestServiceAssets({
          type: "manageService",
          tenantId,
          operation: "archive",
          serviceId: service.id,
        }),
      );
      setServices((current) =>
        current.filter((item) => item.id !== service.id),
      );
      if (showArchivedServices) {
        setArchivedServices((current) =>
          sortByName([
            ...current.filter((item) => item.id !== archived.id),
            archived,
          ]),
        );
      }
      if (assetForm.serviceId === service.id) {
        setAssetForm((current) => ({ ...current, serviceId: "" }));
      }
      if (closesCurrentServiceEditor) {
        setServiceForm(EMPTY_SERVICE_FORM);
        setServiceEditorOpen(false);
        setInlineServiceEditorId(null);
        restoreServiceEditorFocus(
          showArchivedServices ? archived.id : undefined,
        );
      }
      setSuccess(
        `Der Service „${service.name}“ wurde archiviert und von der öffentlichen Statusseite entfernt.`,
      );
    } catch (nextError) {
      setForbidden(errorStatus(nextError) === 403);
      setError(
        await apiErrorMessage(
          nextError,
          "Der Service konnte nicht archiviert werden.",
        ),
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function restoreService(service: Service) {
    if (!window.confirm(`Service „${service.name}“ wiederherstellen?`)) return;
    beginAction(`service:restore:${service.id}`);
    try {
      const restored = parseSavedService(
        await requestServiceAssets({
          type: "manageService",
          tenantId,
          operation: "restore",
          serviceId: service.id,
        } satisfies ServiceRestoreRequest),
      );
      if (!restored.active) {
        throw new Error("Der Service wurde nicht wiederhergestellt.");
      }
      setArchivedServices((current) =>
        current.filter((item) => item.id !== restored.id),
      );
      setServices((current) =>
        sortByName([
          ...current.filter((item) => item.id !== restored.id),
          restored,
        ]),
      );
      setSuccess(`Der Service „${restored.name}“ wurde wiederhergestellt.`);
    } catch (nextError) {
      setForbidden(errorStatus(nextError) === 403);
      setError(
        await apiErrorMessage(
          nextError,
          "Der Service konnte nicht wiederhergestellt werden.",
        ),
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function saveAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = assetForm.name.trim();
    const kind = assetForm.kind.trim();
    const status = assetForm.status.trim();
    if (!name || !kind || !status) {
      setError("Name, Art und Status des Assets sind erforderlich.");
      return;
    }

    let metadata: { [key: string]: JsonValue };
    try {
      const parsed: unknown = JSON.parse(assetForm.metadata);
      if (!isRecord(parsed)) {
        throw new Error("metadata-not-object");
      }
      metadata = parsed as { [key: string]: JsonValue };
    } catch {
      setError(
        "Metadaten müssen ein gültiges JSON-Objekt sein, zum Beispiel {}.",
      );
      return;
    }

    const editing = assetForm.id !== null;
    beginAction(`asset:save:${assetForm.id ?? "new"}`);
    try {
      const request: AssetSaveRequest = {
        type: "manageAsset",
        tenantId,
        operation: editing ? "update" : "create",
        ...(editing ? { assetId: assetForm.id! } : {}),
        name,
        serviceId: optionalText(assetForm.serviceId),
        assetTag: optionalText(assetForm.assetTag),
        inventoryNumber: optionalText(assetForm.inventoryNumber),
        serialNumber: optionalText(assetForm.serialNumber),
        manufacturer: optionalText(assetForm.manufacturer),
        model: optionalText(assetForm.model),
        operatingSystem: optionalText(assetForm.operatingSystem),
        kind,
        status,
        customerOrganizationId: optionalText(assetForm.customerOrganizationId),
        metadata,
        active: true,
      };
      const saved = parseSavedAsset(await requestServiceAssets(request));
      setAssets((current) =>
        sortByName([
          ...current.filter((asset) => asset.id !== saved.id),
          {
            ...saved,
            intune_primary_person_name:
              current.find((asset) => asset.id === saved.id)
                ?.intune_primary_person_name ??
              saved.intune_primary_person_name,
          },
        ]),
      );
      resetAssetForm();
      setSuccess(
        editing
          ? `Das Asset „${saved.name}“ wurde gespeichert.`
          : `Das Asset „${saved.name}“ wurde angelegt.`,
      );
    } catch (nextError) {
      setForbidden(errorStatus(nextError) === 403);
      setError(
        await apiErrorMessage(
          nextError,
          "Das Asset konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function archiveAsset(asset: Asset) {
    if (!window.confirm(`Asset „${asset.name}“ archivieren?`)) return;
    beginAction(`asset:archive:${asset.id}`);
    try {
      parseSavedAsset(
        await requestServiceAssets({
          type: "manageAsset",
          tenantId,
          operation: "archive",
          assetId: asset.id,
        }),
      );
      setAssets((current) => current.filter((item) => item.id !== asset.id));
      if (assetForm.id === asset.id) resetAssetForm();
      setSuccess(`Das Asset „${asset.name}“ wurde archiviert.`);
    } catch (nextError) {
      setForbidden(errorStatus(nextError) === 403);
      setError(
        await apiErrorMessage(
          nextError,
          "Das Asset konnte nicht archiviert werden.",
        ),
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function linkTicketToProblem(ticket: TicketReference) {
    const problemId = problemForm.id;
    if (!problemId) {
      setError("Der ausgewählte Fall ist nicht mehr verfügbar.");
      return;
    }

    beginAction(`problem:ticket:link:${problemId}:${ticket.id}`);
    try {
      parseProblemTicketLink(
        await requestServiceAssets({
          type: "linkTicket",
          tenantId,
          ticketId: ticket.id,
          kind: "problem",
          targetId: problemId,
        }),
        { tenantId, problemId, ticketId: ticket.id, linked: true },
      );
      setProblemTickets((current) =>
        current.some((item) => item.id === ticket.id)
          ? current
          : [...current, ticket],
      );
      setTicketSearchResults((current) =>
        current.filter((item) => item.id !== ticket.id),
      );
      setSuccess(`Ticket ${ticket.ticketNumber} wurde angehängt.`);
    } catch (nextError) {
      setForbidden(errorStatus(nextError) === 403);
      setError(
        await apiErrorMessage(
          nextError,
          "Das Ticket konnte nicht angehängt werden.",
        ),
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function unlinkTicketFromProblem(ticket: TicketReference) {
    const problemId = problemForm.id;
    if (!problemId) {
      setError("Der ausgewählte Fall ist nicht mehr verfügbar.");
      return;
    }

    beginAction(`problem:ticket:unlink:${problemId}:${ticket.id}`);
    try {
      parseProblemTicketLink(
        await requestServiceAssets({
          type: "unlinkTicket",
          tenantId,
          ticketId: ticket.id,
          kind: "problem",
          targetId: problemId,
        }),
        { tenantId, problemId, ticketId: ticket.id, linked: false },
      );
      setProblemTickets((current) =>
        current.filter((item) => item.id !== ticket.id),
      );
      setSuccess(`Ticket ${ticket.ticketNumber} wurde entfernt.`);
    } catch (nextError) {
      setForbidden(errorStatus(nextError) === 403);
      setError(
        await apiErrorMessage(
          nextError,
          "Das Ticket konnte nicht entfernt werden.",
        ),
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function saveProblem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = problemForm.title.trim();
    if (problemMode !== "resolve" && title.length < 3) {
      setError("Der Titel des Falls muss mindestens drei Zeichen lang sein.");
      return;
    }
    if (problemMode === "resolve" && !problemForm.id) {
      setError("Der zu lösende Fall ist nicht mehr verfügbar.");
      return;
    }

    const action =
      problemMode === "resolve"
        ? `problem:resolve:${problemForm.id}`
        : `problem:save:${problemForm.id ?? "new"}`;
    beginAction(action);
    try {
      if (problemMode === "resolve") {
        const resolved = parseSavedProblem(
          await requestServiceAssets({
            type: "manageProblem",
            tenantId,
            operation: "resolve",
            problemId: problemForm.id!,
            workaround: optionalText(problemForm.workaround),
            rootCause: optionalText(problemForm.rootCause),
          }),
        );
        setProblems((current) =>
          current.filter((problem) => problem.id !== resolved.id),
        );
        resetProblemForm();
        setSuccess(`Der Fall „${resolved.title}“ wurde gelöst.`);
        return;
      }

      const editing = problemMode === "edit" && problemForm.id !== null;
      const request: ProblemSaveRequest = {
        type: "manageProblem",
        tenantId,
        operation: editing ? "update" : "create",
        ...(editing ? { problemId: problemForm.id! } : {}),
        title,
        description: problemForm.description,
        status: problemForm.status,
        workaround: optionalText(problemForm.workaround),
        rootCause: optionalText(problemForm.rootCause),
        ownerId: optionalText(problemForm.ownerId),
      };
      const saved = parseSavedProblem(await requestServiceAssets(request));
      setProblems((current) =>
        sortProblems([
          ...current.filter((problem) => problem.id !== saved.id),
          saved,
        ]),
      );
      resetProblemForm();
      setSuccess(
        editing
          ? `Der Fall „${saved.title}“ wurde gespeichert.`
          : `Der Fall „${saved.title}“ wurde angelegt.`,
      );
    } catch (nextError) {
      setForbidden(errorStatus(nextError) === 403);
      setError(
        await apiErrorMessage(
          nextError,
          problemMode === "resolve"
            ? "Der Fall konnte nicht gelöst werden."
            : "Der Fall konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setPendingAction(null);
    }
  }

  const controlsDisabled = loading || pendingAction !== null;
  const activeCount =
    activeTab === "services"
      ? filteredServices.length
      : activeTab === "assets"
        ? filteredAssets.length
        : filteredProblems.length;

  return (
    <section
      aria-busy={loading || pendingAction !== null}
      aria-labelledby="service-assets-title"
      className="service-assets"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{pageCopy?.eyebrow ?? "Servicekatalog"}</p>
          <h2 id="service-assets-title">
            {pageCopy?.title ?? "Services, Assets und Fälle"}
          </h2>
          <p>
            {pageCopy?.description ??
              "Verwalten Sie den aktuellen Katalog dieses Mandanten. Archivierte und gelöste Einträge werden von der API nicht mehr im Katalog angezeigt."}
          </p>
        </div>
        {fixedTab === "services" ? (
          canManageServices || onCreateMaintenance ? (
            <div className="service-assets__catalog-actions">
              {canManageServices ? (
                <button
                  className="primary-button"
                  disabled={controlsDisabled}
                  onClick={(event) => openServiceEditor(event.currentTarget)}
                  ref={serviceCreateButtonRef}
                  type="button"
                >
                  Service erstellen
                </button>
              ) : null}
              {onCreateMaintenance ? (
                <button
                  className="secondary-button"
                  disabled={controlsDisabled}
                  onClick={onCreateMaintenance}
                  type="button"
                >
                  Wartung erfassen
                </button>
              ) : null}
            </div>
          ) : null
        ) : (
          <button
            className="secondary-button"
            disabled={controlsDisabled}
            onClick={() => void loadCatalog()}
            type="button"
          >
            {loading ? "Wird geladen …" : "Aktualisieren"}
          </button>
        )}
      </div>

      {error && !serviceEditorOpen && !inlineServiceEditorId ? (
        <p role="alert">
          <strong>{forbidden ? "Zugriff verweigert: " : "Hinweis: "}</strong>
          {error}
        </p>
      ) : null}
      {success ? (
        <p aria-live="polite" role="status">
          {success}
        </p>
      ) : null}

      {!fixedTab ? (
        <div aria-label="Katalogbereiche" role="tablist">
          <button
            aria-controls="service-assets-services-panel"
            aria-selected={activeTab === "services"}
            id="service-assets-services-tab"
            onClick={() => selectTab("services")}
            onKeyDown={(event) => moveTab(event, "services")}
            role="tab"
            tabIndex={activeTab === "services" ? 0 : -1}
            type="button"
          >
            Services ({services.length})
          </button>
          {allowAssets ? (
            <button
              aria-controls="service-assets-assets-panel"
              aria-selected={activeTab === "assets"}
              id="service-assets-assets-tab"
              onClick={() => selectTab("assets")}
              onKeyDown={(event) => moveTab(event, "assets")}
              role="tab"
              tabIndex={activeTab === "assets" ? 0 : -1}
              type="button"
            >
              Assets ({assets.length})
            </button>
          ) : null}
          <button
            aria-controls="service-assets-problems-panel"
            aria-selected={activeTab === "problems"}
            id="service-assets-problems-tab"
            onClick={() => selectTab("problems")}
            onKeyDown={(event) => moveTab(event, "problems")}
            role="tab"
            tabIndex={activeTab === "problems" ? 0 : -1}
            type="button"
          >
            Fälle ({problems.length})
          </button>
        </div>
      ) : null}

      {loading ? (
        <p aria-live="polite" className="empty-state">
          Katalog wird geladen …
        </p>
      ) : null}

      {!loading && !forbidden && activeTab === "services" ? (
        <section
          className="service-assets__services-panel"
          aria-labelledby={
            fixedTab ? "service-assets-title" : "service-assets-services-tab"
          }
          {...(!fixedTab
            ? {
                id: "service-assets-services-panel",
                role: "tabpanel" as const,
                tabIndex: 0,
              }
            : {})}
        >
          <div className="panel-heading">
            <div>
              <h3>Services</h3>
              <p>{activeCount} passende Services</p>
            </div>
            {canManageServices && supportsServiceCategories ? (
              <button
                className="secondary-button"
                disabled={controlsDisabled}
                onClick={() =>
                  serviceCategoryManagerOpen
                    ? setServiceCategoryManagerOpen(false)
                    : openServiceCategoryManager()
                }
                type="button"
              >
                {serviceCategoryManagerOpen
                  ? "Orte und Kategorien schliessen"
                  : "Orte und Kategorien verwalten"}
              </button>
            ) : null}
          </div>
          {canManageServices &&
          supportsServiceCategories &&
          serviceCategoryManagerOpen ? (
            <section
              aria-labelledby="service-assets-category-manager-title"
              className="service-assets__category-manager"
            >
              <div className="service-assets__category-manager-heading">
                <div>
                  <p className="eyebrow">Servicehierarchie</p>
                  <h4 id="service-assets-category-manager-title">
                    Orte und Kategorien strukturieren
                  </h4>
                  <p>
                    Drei Ebenen sind möglich: Ort (z. B. Betriebsweit, Baar),
                    Kategorie und Unterkategorie.
                  </p>
                </div>
                {serviceCategoryForm.id ? (
                  <button
                    disabled={controlsDisabled}
                    onClick={() =>
                      setServiceCategoryForm(EMPTY_SERVICE_CATEGORY_FORM)
                    }
                    type="button"
                  >
                    Neue Kategorie
                  </button>
                ) : null}
              </div>
              <form onSubmit={(event) => void saveServiceCategory(event)}>
                <label>
                  Name
                  <input
                    disabled={controlsDisabled}
                    maxLength={120}
                    onChange={(event) =>
                      setServiceCategoryForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    required
                    value={serviceCategoryForm.name}
                  />
                </label>
                <label>
                  Übergeordnet
                  <select
                    disabled={controlsDisabled}
                    onChange={(event) =>
                      setServiceCategoryForm((current) => ({
                        ...current,
                        parentId: event.target.value,
                      }))
                    }
                    value={serviceCategoryForm.parentId}
                  >
                    <option value="">Ort (oberste Ebene)</option>
                    {serviceCategoryParentOptions.map((category) => (
                      <option key={category.id} value={category.id}>
                        {`${"— ".repeat(
                          serviceCategoryDepth(serviceCategories, category) - 1,
                        )}${serviceCategoryLabel(serviceCategories, category.id) ?? category.name}`}
                      </option>
                    ))}
                  </select>
                  <small>
                    Die Datenbank begrenzt die Hierarchie verbindlich auf drei
                    Ebenen.
                  </small>
                </label>
                <p className="service-assets__category-manager-actions">
                  <button
                    className="primary-button"
                    disabled={controlsDisabled}
                    type="submit"
                  >
                    {pendingAction?.startsWith("service-category:save:")
                      ? "Wird gespeichert …"
                      : serviceCategoryForm.id
                        ? "Kategorie speichern"
                        : "Kategorie anlegen"}
                  </button>
                  <button
                    disabled={controlsDisabled}
                    onClick={() =>
                      setServiceCategoryForm(EMPTY_SERVICE_CATEGORY_FORM)
                    }
                    type="button"
                  >
                    Abbrechen
                  </button>
                </p>
              </form>
              {serviceCategories.length === 0 ? (
                <p className="service-assets__category-manager-empty">
                  Legen Sie den ersten Ort an, um Services strukturiert
                  einzuordnen.
                </p>
              ) : (
                <ul
                  aria-label="Servicekategorien"
                  className="service-assets__category-list"
                >
                  {serviceCategories.map((category) => (
                    <li
                      data-depth={serviceCategoryDepth(
                        serviceCategories,
                        category,
                      )}
                      key={category.id}
                    >
                      <span>
                        {serviceCategoryLabel(serviceCategories, category.id)}
                      </span>
                      <button
                        disabled={controlsDisabled}
                        onClick={() => openServiceCategoryManager(category)}
                        type="button"
                      >
                        Bearbeiten
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
          <fieldset disabled={controlsDisabled}>
            <legend>Services filtern</legend>
            <label>
              Suche
              <input
                onChange={(event) => setServiceQuery(event.target.value)}
                placeholder="Name oder Beschreibung"
                type="search"
                value={serviceQuery}
              />
            </label>
            <label>
              Kritikalität
              <select
                onChange={(event) =>
                  setServiceCriticality(
                    event.target.value as "all" | Criticality,
                  )
                }
                value={serviceCriticality}
              >
                <option value="all">Alle Kritikalitäten</option>
                {(Object.keys(CRITICALITY_LABELS) as Criticality[]).map(
                  (criticality) => (
                    <option key={criticality} value={criticality}>
                      {CRITICALITY_LABELS[criticality]}
                    </option>
                  ),
                )}
              </select>
            </label>
          </fieldset>
          {canArchiveServices(canManageServices, supportsArchivedServices) ? (
            <label className="service-assets__archive-toggle">
              <input
                checked={showArchivedServices}
                disabled={controlsDisabled}
                onChange={(event) =>
                  setShowArchivedServices(event.target.checked)
                }
                type="checkbox"
              />
              <span>Archivierte Services anzeigen</span>
            </label>
          ) : null}

          {services.length === 0 ? (
            <p className="empty-state">
              Für diesen Mandanten sind noch keine aktiven Services vorhanden.
              Erstellen Sie den ersten Service über die Kopfaktion.
            </p>
          ) : filteredServices.length === 0 ? (
            <p className="empty-state">
              Keine Services entsprechen dem Filter.
            </p>
          ) : (
            <ul aria-label="Aktive Services">
              {filteredServices.map((service) => (
                <li key={service.id}>
                  <article
                    className="service-assets__service-card"
                    data-editing={
                      inlineServiceEditorId === service.id || undefined
                    }
                  >
                    <div className="service-assets__service-card-header">
                      <div className="service-assets__service-identity">
                        <span
                          aria-hidden="true"
                          className="service-assets__service-mark"
                        >
                          {service.name.slice(0, 1).toLocaleUpperCase("de-CH")}
                        </span>
                        <div>
                          <h4>{service.name}</h4>
                          {service.service_category_id ? (
                            <p className="service-assets__service-category">
                              {serviceCategoryLabels.get(
                                service.service_category_id,
                              ) ?? "Serviceeinordnung nicht mehr verfügbar"}
                            </p>
                          ) : (
                            <p className="service-assets__service-category service-assets__service-category--empty">
                              Nicht eingeordnet
                            </p>
                          )}
                        </div>
                      </div>
                      <span
                        className={`service-assets__service-status service-assets__service-status--${service.status}`}
                      >
                        <span aria-hidden="true" />
                        {SERVICE_STATUS_LABELS[service.status]}
                      </span>
                    </div>
                    {service.description ? (
                      <p className="service-assets__service-description">
                        {service.description}
                      </p>
                    ) : null}
                    <dl className="service-assets__service-facts">
                      {canManageServices &&
                      quickEdit?.serviceId === service.id &&
                      quickEdit.field === "criticality" ? (
                        <div className="service-assets__service-fact-editor">
                          <dt>Kritikalität</dt>
                          <dd>
                            <select
                              aria-label="Kritikalität"
                              autoFocus
                              disabled={controlsDisabled}
                              onBlur={() => setQuickEdit(null)}
                              onChange={(event) =>
                                void quickSaveService(service, {
                                  criticality: event.target
                                    .value as Criticality,
                                })
                              }
                              value={service.criticality}
                            >
                              {(
                                Object.keys(CRITICALITY_LABELS) as Criticality[]
                              ).map((criticality) => (
                                <option key={criticality} value={criticality}>
                                  {CRITICALITY_LABELS[criticality]}
                                </option>
                              ))}
                            </select>
                          </dd>
                        </div>
                      ) : (
                        <div
                          aria-label={
                            canManageServices
                              ? "Kritikalität ändern"
                              : undefined
                          }
                          className={
                            canManageServices
                              ? "service-assets__service-fact--editable"
                              : undefined
                          }
                          onClick={
                            canManageServices
                              ? () =>
                                  setQuickEdit({
                                    field: "criticality",
                                    primary: "",
                                    secondary: "",
                                    serviceId: service.id,
                                  })
                              : undefined
                          }
                          onKeyDown={
                            canManageServices
                              ? (event) => {
                                  if (
                                    event.key === "Enter" ||
                                    event.key === " "
                                  ) {
                                    event.preventDefault();
                                    setQuickEdit({
                                      field: "criticality",
                                      primary: "",
                                      secondary: "",
                                      serviceId: service.id,
                                    });
                                  }
                                }
                              : undefined
                          }
                          role={canManageServices ? "button" : undefined}
                          tabIndex={canManageServices ? 0 : undefined}
                        >
                          <dt>Kritikalität</dt>
                          <dd>{CRITICALITY_LABELS[service.criticality]}</dd>
                        </div>
                      )}
                      {canManageServices &&
                      quickEdit?.serviceId === service.id &&
                      quickEdit.field === "responsibility" ? (
                        <div className="service-assets__service-fact-editor">
                          <dt>Verantwortung</dt>
                          <dd>
                            <select
                              aria-label="Primär verantwortlich"
                              autoFocus
                              disabled={
                                controlsDisabled ||
                                serviceResponsibleAgentsLoading
                              }
                              onChange={(event) =>
                                setQuickEdit({
                                  ...quickEdit,
                                  primary: event.target.value,
                                  secondary:
                                    event.target.value === quickEdit.secondary
                                      ? ""
                                      : quickEdit.secondary,
                                })
                              }
                              value={quickEdit.primary}
                            >
                              <option value="">Nicht zugeordnet</option>
                              {serviceResponsibleAgents.map((agent) => (
                                <option key={agent.id} value={agent.id}>
                                  {agent.displayName}
                                </option>
                              ))}
                            </select>
                            <select
                              aria-label="Sekundär verantwortlich"
                              disabled={
                                controlsDisabled ||
                                serviceResponsibleAgentsLoading ||
                                !quickEdit.primary
                              }
                              onChange={(event) =>
                                setQuickEdit({
                                  ...quickEdit,
                                  secondary: event.target.value,
                                })
                              }
                              value={quickEdit.secondary}
                            >
                              <option value="">Keine Stellvertretung</option>
                              {serviceResponsibleAgents
                                .filter((agent) => agent.id !== quickEdit.primary)
                                .map((agent) => (
                                  <option key={agent.id} value={agent.id}>
                                    {agent.displayName}
                                  </option>
                                ))}
                            </select>
                            <span className="service-assets__service-fact-actions">
                              <button
                                className="primary-button"
                                disabled={controlsDisabled}
                                onClick={() =>
                                  void quickSaveService(service, {
                                    primaryResponsibleId: quickEdit.primary,
                                    secondaryResponsibleId: quickEdit.secondary,
                                  })
                                }
                                type="button"
                              >
                                Speichern
                              </button>
                              <button
                                disabled={controlsDisabled}
                                onClick={() => setQuickEdit(null)}
                                type="button"
                              >
                                Abbrechen
                              </button>
                            </span>
                          </dd>
                        </div>
                      ) : canManageServices ? (
                        <div
                          aria-label="Verantwortung ändern"
                          className="service-assets__service-fact--editable"
                          onClick={() =>
                            setQuickEdit({
                              field: "responsibility",
                              primary: service.primary_responsible_id ?? "",
                              secondary: service.secondary_responsible_id ?? "",
                              serviceId: service.id,
                            })
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setQuickEdit({
                                field: "responsibility",
                                primary: service.primary_responsible_id ?? "",
                                secondary:
                                  service.secondary_responsible_id ?? "",
                                serviceId: service.id,
                              });
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <dt>Verantwortung</dt>
                          <dd>
                            {service.primary_responsible_id
                              ? (serviceResponsibleAgentNames.get(
                                  service.primary_responsible_id,
                                ) ?? "Nicht mehr verfügbar")
                              : "Nicht zugeordnet"}
                            {service.primary_responsible_id &&
                            service.secondary_responsible_id
                              ? ` · ${
                                  serviceResponsibleAgentNames.get(
                                    service.secondary_responsible_id,
                                  ) ?? "Nicht mehr verfügbar"
                                }`
                              : ""}
                          </dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>Letzte Änderung</dt>
                        <dd>{formatDate(service.updated_at)}</dd>
                      </div>
                    </dl>
                    {canManageServices ||
                    canArchiveServices(
                      canManageServices,
                      supportsArchivedServices,
                    ) ? (
                      <div className="service-assets__service-card-actions">
                        {canManageServices ? (
                          <button
                            aria-expanded={inlineServiceEditorId === service.id}
                            disabled={controlsDisabled}
                            onClick={(event) =>
                              openInlineServiceEditor(
                                service,
                                event.currentTarget,
                              )
                            }
                            type="button"
                          >
                            {inlineServiceEditorId === service.id
                              ? "Bearbeitung schliessen"
                              : "Bearbeiten"}
                          </button>
                        ) : null}
                        {canArchiveServices(
                          canManageServices,
                          supportsArchivedServices,
                        ) ? (
                          <button
                            disabled={controlsDisabled}
                            onClick={() => void archiveService(service)}
                            type="button"
                          >
                            {pendingAction === `service:archive:${service.id}`
                              ? "Wird archiviert …"
                              : "Archivieren"}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {inlineServiceEditorId === service.id ? (
                      <section
                        aria-labelledby={`service-assets-inline-editor-${service.id}`}
                        className="service-assets__service-inline-editor"
                      >
                        <div className="service-assets__service-inline-editor-heading">
                          <div>
                            <p className="eyebrow">Service bearbeiten</p>
                            <h5
                              id={`service-assets-inline-editor-${service.id}`}
                            >
                              {service.name}
                            </h5>
                          </div>
                          <button
                            disabled={controlsDisabled}
                            onClick={resetServiceForm}
                            type="button"
                          >
                            Schliessen
                          </button>
                        </div>
                        {error ? (
                          <p role="alert">
                            <strong>
                              {forbidden ? "Zugriff verweigert: " : "Hinweis: "}
                            </strong>
                            {error}
                          </p>
                        ) : null}
                        <ServiceEditorFields
                          controlsDisabled={controlsDisabled}
                          nameInputRef={serviceNameInputRef}
                          onCancel={resetServiceForm}
                          onSubmit={saveService}
                          pendingAction={pendingAction}
                          serviceForm={serviceForm}
                          serviceResponsibleAgentNames={
                            serviceResponsibleAgentNames
                          }
                          serviceResponsibleAgents={serviceResponsibleAgents}
                          serviceResponsibleAgentsLoading={
                            serviceResponsibleAgentsLoading
                          }
                          serviceCategories={serviceCategories}
                          supportsServiceCategories={supportsServiceCategories}
                          onCreateCategory={
                            canManageServices
                              ? createServiceCategoryInline
                              : undefined
                          }
                          setServiceForm={setServiceForm}
                        />
                      </section>
                    ) : null}
                  </article>
                </li>
              ))}
            </ul>
          )}

          {canArchiveServices(canManageServices, supportsArchivedServices) &&
          showArchivedServices ? (
            <section
              aria-labelledby="service-assets-archived-services-title"
              className="service-assets__archived panel"
              id="service-assets-archived-services"
            >
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Archiv</p>
                  <h4 id="service-assets-archived-services-title">
                    Archivierte Services
                  </h4>
                  <p>
                    Archivierte Services werden nicht als aktiv angeboten. Sie
                    können bewusst wiederhergestellt werden.
                  </p>
                </div>
              </div>
              {archivedServices.length === 0 ? (
                <p className="empty-state">
                  Für diesen Mandanten sind keine archivierten Services
                  vorhanden.
                </p>
              ) : filteredArchivedServices.length === 0 ? (
                <p className="empty-state">
                  Keine archivierten Services entsprechen dem Filter.
                </p>
              ) : (
                <ul aria-label="Archivierte Services">
                  {filteredArchivedServices.map((service) => (
                    <li key={service.id}>
                      <article>
                        <h5>{service.name}</h5>
                        <span className="service-assets__archive-state">
                          Archiviert
                        </span>
                        <p>
                          <strong>
                            {CRITICALITY_LABELS[service.criticality]}
                          </strong>
                          {service.description
                            ? ` · ${service.description}`
                            : ""}
                        </p>
                        <p>
                          Zuletzt geändert: {formatDate(service.updated_at)}
                        </p>
                        <button
                          disabled={controlsDisabled}
                          onClick={() => void restoreService(service)}
                          ref={(element) => {
                            if (element) {
                              archivedServiceRestoreButtonRefs.current.set(
                                service.id,
                                element,
                              );
                            } else {
                              archivedServiceRestoreButtonRefs.current.delete(
                                service.id,
                              );
                            }
                          }}
                          type="button"
                        >
                          {pendingAction === `service:restore:${service.id}`
                            ? "Wird wiederhergestellt …"
                            : "Wiederherstellen"}
                        </button>
                      </article>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {serviceEditorOpen
            ? createPortal(
                <div
                  aria-labelledby="service-assets-service-form-title"
                  aria-modal="true"
                  className="service-assets__dialog-backdrop"
                  onKeyDown={handleServiceEditorKeyDown}
                  onMouseDown={(event) => {
                    if (
                      event.target === event.currentTarget &&
                      !controlsDisabled
                    ) {
                      resetServiceForm();
                    }
                  }}
                  ref={serviceEditorRef}
                  role="dialog"
                  tabIndex={-1}
                >
                  <section className="service-assets__service-editor service-assets__service-editor-dialog panel">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">
                          {serviceForm.id
                            ? "Service bearbeiten"
                            : "Neuer Service"}
                        </p>
                        <h3 id="service-assets-service-form-title">
                          {serviceForm.id
                            ? "Service aktualisieren"
                            : "Service anlegen"}
                        </h3>
                      </div>
                      <button
                        aria-label="Serviceeditor schliessen"
                        disabled={controlsDisabled}
                        onClick={resetServiceForm}
                        type="button"
                      >
                        Schliessen
                      </button>
                    </div>
                    {error ? (
                      <p role="alert">
                        <strong>
                          {forbidden ? "Zugriff verweigert: " : "Hinweis: "}
                        </strong>
                        {error}
                      </p>
                    ) : null}
                    <ServiceEditorFields
                      controlsDisabled={controlsDisabled}
                      nameInputRef={serviceNameInputRef}
                      onCancel={resetServiceForm}
                      onSubmit={saveService}
                      pendingAction={pendingAction}
                      serviceForm={serviceForm}
                      serviceResponsibleAgentNames={
                        serviceResponsibleAgentNames
                      }
                      serviceResponsibleAgents={serviceResponsibleAgents}
                      serviceResponsibleAgentsLoading={
                        serviceResponsibleAgentsLoading
                      }
                      serviceCategories={serviceCategories}
                      supportsServiceCategories={supportsServiceCategories}
                      onCreateCategory={
                        canManageServices
                          ? createServiceCategoryInline
                          : undefined
                      }
                      setServiceForm={setServiceForm}
                    />
                  </section>
                </div>,
                document.body,
              )
            : null}
        </section>
      ) : null}

      {!loading && !forbidden && allowAssets && activeTab === "assets" ? (
        <section
          className="service-assets__asset-panel"
          aria-labelledby={
            fixedTab ? "service-assets-title" : "service-assets-assets-tab"
          }
          {...(!fixedTab
            ? {
                id: "service-assets-assets-panel",
                role: "tabpanel" as const,
                tabIndex: 0,
              }
            : {})}
        >
          <div className="panel-heading">
            <div>
              <h3>Assets</h3>
              <p>{activeCount} passende Assets</p>
            </div>
            <button
              className="secondary-button"
              disabled={controlsDisabled}
              onClick={(event) =>
                openAssetEditor(undefined, event.currentTarget)
              }
              ref={assetCreateButtonRef}
              type="button"
            >
              Asset erfassen
            </button>
          </div>
          <fieldset disabled={controlsDisabled}>
            <legend>Assets filtern</legend>
            <label>
              Suche
              <input
                onChange={(event) => setAssetQuery(event.target.value)}
                placeholder="Name, Kennung, Art oder Status"
                type="search"
                value={assetQuery}
              />
            </label>
            <label>
              Service
              <select
                onChange={(event) => setAssetServiceFilter(event.target.value)}
                value={assetServiceFilter}
              >
                <option value="all">Alle Services</option>
                <option value="unassigned">Ohne Service</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                onChange={(event) => setAssetStatusFilter(event.target.value)}
                value={assetStatusFilter}
              >
                <option value="all">Alle Status</option>
                {assetStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          {assets.length === 0 ? (
            <p className="empty-state">
              Für diesen Mandanten sind noch keine aktiven Assets vorhanden.
              Legen Sie unten das erste Asset an.
            </p>
          ) : filteredAssets.length === 0 ? (
            <p className="empty-state">Keine Assets entsprechen dem Filter.</p>
          ) : (
            <ul aria-label="Aktive Assets">
              {filteredAssets.map((asset) => (
                <li key={asset.id}>
                  <article>
                    <h4>{asset.name}</h4>
                    <p>
                      {asset.kind} · {asset.status}
                      {asset.asset_tag ? ` · Kennung: ${asset.asset_tag}` : ""}
                    </p>
                    <p>
                      {[asset.manufacturer, asset.model]
                        .filter(Boolean)
                        .join(" · ") || "Keine Gerätedaten hinterlegt"}
                      {asset.inventory_number
                        ? ` · Inventar: ${asset.inventory_number}`
                        : ""}
                    </p>
                    {asset.serial_number ? (
                      <p>Seriennummer: {asset.serial_number}</p>
                    ) : null}
                    <p>
                      Service:{" "}
                      {asset.service_id
                        ? (serviceNames.get(asset.service_id) ??
                          "Nicht im aktiven Katalog")
                        : "Nicht zugeordnet"}
                    </p>
                    {asset.intune_primary_person_name ? (
                      <div className="service-assets__primary-person">
                        <span
                          aria-hidden="true"
                          className="service-assets__primary-person-avatar"
                        >
                          {personInitials(asset.intune_primary_person_name)}
                        </span>
                        <span className="service-assets__primary-person-copy">
                          <small>Primäre Person</small>
                          <strong>{asset.intune_primary_person_name}</strong>
                        </span>
                        <span className="service-assets__primary-person-source">
                          Intune
                        </span>
                      </div>
                    ) : (
                      <p className="service-assets__primary-person-empty">
                        Keine primäre Person durch Intune erkannt
                      </p>
                    )}
                    {metadataPreview(asset.metadata) !== "{}" ? (
                      <p>
                        <code>{metadataPreview(asset.metadata)}</code>
                      </p>
                    ) : null}
                    <button
                      disabled={controlsDisabled}
                      onClick={(event) =>
                        openAssetEditor(asset, event.currentTarget)
                      }
                      type="button"
                    >
                      Bearbeiten
                    </button>{" "}
                    <button
                      disabled={controlsDisabled}
                      onClick={() => void archiveAsset(asset)}
                      type="button"
                    >
                      {pendingAction === `asset:archive:${asset.id}`
                        ? "Wird archiviert …"
                        : "Archivieren"}
                    </button>
                  </article>
                </li>
              ))}
            </ul>
          )}

          {assetEditorOpen
            ? createPortal(
                <div
                  aria-label={
                    assetForm.id ? "Asset bearbeiten" : "Asset erfassen"
                  }
                  aria-modal="true"
                  className="service-assets__dialog-backdrop"
                  onMouseDown={(event) => {
                    if (
                      event.currentTarget === event.target &&
                      !controlsDisabled
                    ) {
                      resetAssetForm();
                    }
                  }}
                  role="dialog"
                >
                  <section
                    aria-busy={controlsDisabled}
                    aria-labelledby="service-assets-asset-form-title"
                    className="service-assets__asset-editor-dialog"
                    onKeyDown={handleAssetEditorKeyDown}
                    ref={assetEditorRef}
                    tabIndex={-1}
                  >
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">
                          {assetForm.id ? "Asset bearbeiten" : "Neues Asset"}
                        </p>
                        <h3 id="service-assets-asset-form-title">
                          {assetForm.id
                            ? "Asset aktualisieren"
                            : "Asset anlegen"}
                        </h3>
                      </div>
                      <button
                        aria-label="Assetbearbeitung schliessen"
                        disabled={controlsDisabled}
                        onClick={resetAssetForm}
                        type="button"
                      >
                        Schliessen
                      </button>
                    </div>
                    {assetForm.id ? (
                      <aside className="service-assets__primary-person service-assets__primary-person--dialog">
                        <span
                          aria-hidden="true"
                          className="service-assets__primary-person-avatar"
                        >
                          {editedAssetPrimaryPerson
                            ? personInitials(editedAssetPrimaryPerson)
                            : "—"}
                        </span>
                        <span className="service-assets__primary-person-copy">
                          <small>Primäre Person</small>
                          <strong>
                            {editedAssetPrimaryPerson ??
                              "Keine primäre Person erkannt"}
                          </strong>
                        </span>
                        <span className="service-assets__primary-person-source">
                          Intune
                        </span>
                        <p>
                          Lokal aus dem verifizierten Entra-Verzeichnis
                          übernommen. Diese Angabe kann hier nicht manuell
                          geändert werden.
                        </p>
                      </aside>
                    ) : null}
                    <form onSubmit={(event) => void saveAsset(event)}>
                      <label>
                        Name
                        <input
                          disabled={controlsDisabled}
                          maxLength={240}
                          onChange={(event) =>
                            setAssetForm((current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                          ref={assetNameInputRef}
                          required
                          value={assetForm.name}
                        />
                      </label>
                      <label>
                        Zugehöriger Service (optional)
                        <select
                          disabled={controlsDisabled}
                          onChange={(event) =>
                            setAssetForm((current) => ({
                              ...current,
                              serviceId: event.target.value,
                            }))
                          }
                          value={assetForm.serviceId}
                        >
                          <option value="">Nicht zugeordnet</option>
                          {services.map((service) => (
                            <option key={service.id} value={service.id}>
                              {service.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Asset-Kennung (optional)
                        <input
                          disabled={controlsDisabled}
                          maxLength={160}
                          onChange={(event) =>
                            setAssetForm((current) => ({
                              ...current,
                              assetTag: event.target.value,
                            }))
                          }
                          value={assetForm.assetTag}
                        />
                      </label>
                      <label>
                        Inventarnummer (optional)
                        <input
                          disabled={controlsDisabled}
                          maxLength={160}
                          onChange={(event) =>
                            setAssetForm((current) => ({
                              ...current,
                              inventoryNumber: event.target.value,
                            }))
                          }
                          value={assetForm.inventoryNumber}
                        />
                      </label>
                      <label>
                        Seriennummer (optional)
                        <input
                          disabled={controlsDisabled}
                          maxLength={160}
                          onChange={(event) =>
                            setAssetForm((current) => ({
                              ...current,
                              serialNumber: event.target.value,
                            }))
                          }
                          value={assetForm.serialNumber}
                        />
                      </label>
                      <label>
                        Hersteller (optional)
                        <input
                          disabled={controlsDisabled}
                          maxLength={160}
                          onChange={(event) =>
                            setAssetForm((current) => ({
                              ...current,
                              manufacturer: event.target.value,
                            }))
                          }
                          value={assetForm.manufacturer}
                        />
                      </label>
                      <label>
                        Modell (optional)
                        <input
                          disabled={controlsDisabled}
                          maxLength={160}
                          onChange={(event) =>
                            setAssetForm((current) => ({
                              ...current,
                              model: event.target.value,
                            }))
                          }
                          value={assetForm.model}
                        />
                      </label>
                      <label>
                        Betriebssystem (optional)
                        <input
                          disabled={controlsDisabled}
                          maxLength={160}
                          onChange={(event) =>
                            setAssetForm((current) => ({
                              ...current,
                              operatingSystem: event.target.value,
                            }))
                          }
                          value={assetForm.operatingSystem}
                        />
                      </label>
                      <label>
                        Art
                        <input
                          disabled={controlsDisabled}
                          maxLength={64}
                          onChange={(event) =>
                            setAssetForm((current) => ({
                              ...current,
                              kind: event.target.value,
                            }))
                          }
                          required
                          value={assetForm.kind}
                        />
                      </label>
                      <label>
                        Status
                        <input
                          disabled={controlsDisabled}
                          maxLength={64}
                          onChange={(event) =>
                            setAssetForm((current) => ({
                              ...current,
                              status: event.target.value,
                            }))
                          }
                          required
                          value={assetForm.status}
                        />
                      </label>
                      <p>
                        <button
                          className="primary-button"
                          disabled={controlsDisabled}
                          type="submit"
                        >
                          {pendingAction?.startsWith("asset:save:")
                            ? "Wird gespeichert …"
                            : assetForm.id
                              ? "Änderungen speichern"
                              : "Asset anlegen"}
                        </button>{" "}
                        {assetForm.id ? (
                          <button
                            disabled={controlsDisabled}
                            onClick={resetAssetForm}
                            type="button"
                          >
                            Abbrechen
                          </button>
                        ) : null}
                      </p>
                    </form>
                  </section>
                </div>,
                document.body,
              )
            : null}
        </section>
      ) : null}

      {!loading && !forbidden && activeTab === "problems" ? (
        <section
          aria-labelledby={
            fixedTab ? "service-assets-title" : "service-assets-problems-tab"
          }
          {...(!fixedTab
            ? {
                id: "service-assets-problems-panel",
                role: "tabpanel" as const,
                tabIndex: 0,
              }
            : {})}
        >
          <div className="panel-heading">
            <div>
              <h3>Fälle</h3>
              <p>{activeCount} passende offene Fälle</p>
            </div>
          </div>
          <fieldset disabled={controlsDisabled}>
            <legend>Fälle filtern</legend>
            <label>
              Suche
              <input
                onChange={(event) => setProblemQuery(event.target.value)}
                placeholder="Titel, Beschreibung oder Lösung"
                type="search"
                value={problemQuery}
              />
            </label>
            <label>
              Status
              <select
                onChange={(event) =>
                  setProblemStatusFilter(
                    event.target.value as "all" | EditableProblemStatus,
                  )
                }
                value={problemStatusFilter}
              >
                <option value="all">Alle offenen Status</option>
                {EDITABLE_PROBLEM_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {PROBLEM_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          {problems.length === 0 ? (
            <p className="empty-state">
              Es sind keine offenen Fälle vorhanden. Legen Sie unten bei Bedarf
              einen neuen Fall an.
            </p>
          ) : filteredProblems.length === 0 ? (
            <p className="empty-state">Keine Fälle entsprechen dem Filter.</p>
          ) : (
            <ul aria-label="Offene Fälle">
              {filteredProblems.map((problem) => (
                <li key={problem.id}>
                  <article>
                    <h4>{problem.title}</h4>
                    <p>
                      <strong>{PROBLEM_STATUS_LABELS[problem.status]}</strong>
                      {problem.description ? ` · ${problem.description}` : ""}
                    </p>
                    {problem.workaround ? (
                      <p>Workaround: {problem.workaround}</p>
                    ) : null}
                    {problem.root_cause ? (
                      <p>Ursache: {problem.root_cause}</p>
                    ) : null}
                    {problem.owner_id ? (
                      <p>
                        Verantwortlich:{" "}
                        {problemOwnerNames.get(problem.owner_id) ??
                          "Nicht mehr aktiv"}
                      </p>
                    ) : null}
                    <p>Zuletzt geändert: {formatDate(problem.updated_at)}</p>
                    <button
                      disabled={controlsDisabled}
                      onClick={() => {
                        clearProblemTicketState();
                        setProblemForm(problemDraft(problem));
                        setProblemMode("edit");
                        setError("");
                        setSuccess("");
                      }}
                      type="button"
                    >
                      Bearbeiten
                    </button>{" "}
                    <button
                      disabled={controlsDisabled}
                      onClick={() => {
                        clearProblemTicketState();
                        setProblemForm(problemDraft(problem));
                        setProblemMode("resolve");
                        setError("");
                        setSuccess("");
                      }}
                      type="button"
                    >
                      Lösen
                    </button>
                  </article>
                </li>
              ))}
            </ul>
          )}

          <section
            aria-labelledby="service-assets-problem-form-title"
            className="panel"
          >
            <div className="panel-heading">
              <div>
                <p className="eyebrow">
                  {problemMode === "resolve"
                    ? "Fall lösen"
                    : problemMode === "edit"
                      ? "Fall bearbeiten"
                      : "Neuer Fall"}
                </p>
                <h3 id="service-assets-problem-form-title">
                  {problemMode === "resolve"
                    ? `Lösung dokumentieren: ${problemForm.title}`
                    : problemMode === "edit"
                      ? "Fall aktualisieren"
                      : "Fall anlegen"}
                </h3>
              </div>
            </div>
            <form onSubmit={(event) => void saveProblem(event)}>
              {problemMode !== "resolve" ? (
                <>
                  <label>
                    Titel
                    <input
                      disabled={controlsDisabled}
                      maxLength={240}
                      minLength={3}
                      onChange={(event) =>
                        setProblemForm((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                      required
                      value={problemForm.title}
                    />
                  </label>
                  <label>
                    Status
                    <select
                      disabled={controlsDisabled}
                      onChange={(event) =>
                        setProblemForm((current) => ({
                          ...current,
                          status: event.target.value as EditableProblemStatus,
                        }))
                      }
                      value={problemForm.status}
                    >
                      {EDITABLE_PROBLEM_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {PROBLEM_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Beschreibung
                    <textarea
                      disabled={controlsDisabled}
                      maxLength={50000}
                      onChange={(event) =>
                        setProblemForm((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      rows={4}
                      value={problemForm.description}
                    />
                  </label>
                  <label>
                    Verantwortliche Person (optional)
                    <select
                      disabled={controlsDisabled || problemOwnersLoading}
                      onChange={(event) =>
                        setProblemForm((current) => ({
                          ...current,
                          ownerId: event.target.value,
                        }))
                      }
                      value={problemForm.ownerId}
                    >
                      <option value="">
                        {problemOwnersLoading
                          ? "Aktive Personen werden geladen …"
                          : "Nicht zugewiesen"}
                      </option>
                      {problemForm.ownerId &&
                      !problemOwnerNames.has(problemForm.ownerId) ? (
                        <option value={problemForm.ownerId}>
                          Nicht mehr aktive Person
                        </option>
                      ) : null}
                      {problemOwners.map((owner) => (
                        <option key={owner.id} value={owner.id}>
                          {owner.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>
                    Es werden ausschliesslich aktive Mandantenmitglieder
                    angezeigt. Bereits nicht mehr aktive Verantwortliche können
                    entfernt oder durch eine aktive Person ersetzt werden.
                  </p>
                </>
              ) : (
                <p>
                  Beim Speichern wird dieser Fall als gelöst markiert und
                  anschließend nicht mehr im offenen Katalog angezeigt.
                </p>
              )}
              <label>
                Workaround (optional)
                <textarea
                  disabled={controlsDisabled}
                  maxLength={50000}
                  onChange={(event) =>
                    setProblemForm((current) => ({
                      ...current,
                      workaround: event.target.value,
                    }))
                  }
                  rows={3}
                  value={problemForm.workaround}
                />
              </label>
              <label>
                Ursache / Root Cause (optional)
                <textarea
                  disabled={controlsDisabled}
                  maxLength={50000}
                  onChange={(event) =>
                    setProblemForm((current) => ({
                      ...current,
                      rootCause: event.target.value,
                    }))
                  }
                  rows={3}
                  value={problemForm.rootCause}
                />
              </label>
              {problemForm.id ? (
                <section aria-labelledby="service-assets-problem-tickets-title">
                  <h4 id="service-assets-problem-tickets-title">
                    Ticketanhänge
                  </h4>
                  {problemTicketsLoading ? (
                    <p aria-live="polite">
                      Verknüpfte Tickets werden geladen …
                    </p>
                  ) : problemTickets.length === 0 ? (
                    <p>Noch keine Tickets angehängt.</p>
                  ) : (
                    <ul aria-label="Verknüpfte Tickets">
                      {problemTickets.map((ticket) => (
                        <li key={ticket.id}>
                          <strong>{ticket.ticketNumber}</strong> ·{" "}
                          {ticket.subject} · {ticket.statusLabel}{" "}
                          <button
                            disabled={controlsDisabled}
                            onClick={() => void unlinkTicketFromProblem(ticket)}
                            type="button"
                          >
                            {pendingAction ===
                            `problem:ticket:unlink:${problemForm.id}:${ticket.id}`
                              ? "Wird entfernt …"
                              : "Entfernen"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <label>
                    Ticket suchen
                    <input
                      aria-describedby="service-assets-ticket-search-help"
                      disabled={controlsDisabled}
                      maxLength={240}
                      onChange={(event) =>
                        setTicketSearchQuery(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.preventDefault();
                      }}
                      placeholder="Ticketnummer oder Betreff"
                      type="search"
                      value={ticketSearchQuery}
                    />
                  </label>
                  <p id="service-assets-ticket-search-help">
                    Geben Sie mindestens zwei Zeichen ein.
                  </p>
                  {ticketSearchQuery.trim().length >= 2 &&
                  ticketSearchLoading ? (
                    <p aria-live="polite">Tickets werden gesucht …</p>
                  ) : null}
                  {ticketSearchQuery.trim().length >= 2 &&
                  !ticketSearchLoading &&
                  attachableTicketSearchResults.length === 0 ? (
                    <p>
                      {ticketSearchResults.length > 0
                        ? "Alle passenden Tickets sind bereits angehängt."
                        : "Keine passenden Tickets gefunden."}
                    </p>
                  ) : null}
                  {ticketSearchQuery.trim().length >= 2 &&
                  !ticketSearchLoading &&
                  attachableTicketSearchResults.length > 0 ? (
                    <ul aria-label="Gefundene Tickets">
                      {attachableTicketSearchResults.map((ticket) => (
                        <li key={ticket.id}>
                          <strong>{ticket.ticketNumber}</strong> ·{" "}
                          {ticket.subject} · {ticket.statusLabel}{" "}
                          <button
                            disabled={controlsDisabled}
                            onClick={() => void linkTicketToProblem(ticket)}
                            type="button"
                          >
                            {pendingAction ===
                            `problem:ticket:link:${problemForm.id}:${ticket.id}`
                              ? "Wird angehängt …"
                              : "Anhängen"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ) : null}
              <p>
                <button
                  className="primary-button"
                  disabled={controlsDisabled}
                  type="submit"
                >
                  {pendingAction?.startsWith("problem:resolve:")
                    ? "Wird gelöst …"
                    : pendingAction?.startsWith("problem:save:")
                      ? "Wird gespeichert …"
                      : problemMode === "resolve"
                        ? "Fall lösen"
                        : problemMode === "edit"
                          ? "Änderungen speichern"
                          : "Fall anlegen"}
                </button>{" "}
                {problemMode === "edit" || problemMode === "resolve" ? (
                  <button
                    disabled={controlsDisabled}
                    onClick={resetProblemForm}
                    type="button"
                  >
                    Abbrechen
                  </button>
                ) : null}
              </p>
            </form>
          </section>
        </section>
      ) : null}
    </section>
  );
}
