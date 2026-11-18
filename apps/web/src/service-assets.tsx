import { tn } from "./lib/formality";
import { recordRecentItem } from "./lib/recent-items";
import { ServiceInsightsPanel } from "./service-insights";
import { CsvImportDialog } from "./csv-import-dialog";
import { ASSET_IMPORT_FIELDS } from "./lib/import-fields";
import { ProblemAnalysis } from "./problem-insights";
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
import {
  FormCard,
  FormDialog,
  FormField,
  FormGrid,
  FormLayout,
  FormNote,
  FormSummary,
  FormSwitch,
} from "./form-kit";
import { supabase } from "./lib/supabase";
import { IntuneActionsMenu, useIntuneAssetDevices } from "./intune-actions";
import {
  AssetLabelDialog,
  LabelSelectionBar,
  type LabelBranding,
} from "./asset-label-dialog";
import { assetLabelItem } from "./lib/asset-labels";

import { confirmDialog } from "./app-dialog";
export type ServiceAssetsProps = {
  tenantId: string;
  initialTab?: CatalogTab;
  allowAssets?: boolean;
  fixedTab?: CatalogTab;
  createProblemRequestId?: number | undefined;
  onCreateProblemRequestConsumed?: ((requestId: number) => void) | undefined;
  onCreateMaintenance?: (() => void) | undefined;
  /** Prefills the asset filter, e.g. for a device opened from a ticket. */
  assetQueryRequest?: { query: string; id: number } | undefined;
  /** Tenant name and logo for printed asset labels. */
  labelBranding?: LabelBranding | undefined;
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
  department_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type DepartmentOption = {
  id: string;
  name: string;
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
  department_id: string | null;
  intune_primary_person_name: string | null;
  intune_primary_person_photo_url?: string | null;
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
  department_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** Affected services (older functions send none). */
  service_ids: string[];
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
  departmentId: string;
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
  departmentId: string;
};

type ProblemForm = {
  id: string | null;
  title: string;
  description: string;
  status: EditableProblemStatus;
  workaround: string;
  rootCause: string;
  ownerId: string;
  departmentId: string;
  serviceIds: string[];
  /** "" keeps the current state of the affected services. */
  serviceStatus: "" | ServiceStatus;
};

type ProblemFormMode = "create" | "edit" | "resolve";

type CatalogRequest = {
  type: "listCatalog";
  tenantId: string;
  includeArchivedServices?: boolean;
  sections?: Array<"services" | "assets" | "problems">;
  assetOffset?: number;
  assetLimit?: number;
  assetQuery?: string;
  assetServiceId?: string;
  assetStatus?: string;
};

/** Seitengrösse der Asset-Liste (Filter und Seiten in SQL). */
export const ASSET_PAGE_SIZE = 100;

/** Filter der Asset-Seite; «all» bzw. leere Suche werden nicht gesendet. */
export type AssetPageFilter = {
  offset: number;
  query: string;
  serviceFilter: string;
  statusFilter: string;
};

export function catalogRequest(
  tenantId: string,
  supportsArchivedServices: boolean,
  includeArchivedServices: boolean,
  assetPage?: AssetPageFilter,
  sections?: CatalogRequest["sections"],
): CatalogRequest {
  return {
    type: "listCatalog",
    tenantId,
    ...(supportsArchivedServices ? { includeArchivedServices } : {}),
    ...(sections ? { sections } : {}),
    ...(assetPage
      ? {
          assetOffset: assetPage.offset,
          assetLimit: ASSET_PAGE_SIZE,
          ...(assetPage.query.trim()
            ? { assetQuery: assetPage.query.trim().slice(0, 120) }
            : {}),
          ...(assetPage.serviceFilter !== "all"
            ? { assetServiceId: assetPage.serviceFilter }
            : {}),
          ...(assetPage.statusFilter !== "all"
            ? { assetStatus: assetPage.statusFilter }
            : {}),
        }
      : {}),
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
  departmentId?: string;
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
  departmentId?: string;
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
  departmentId?: string;
  problemId?: string;
  serviceIds: string[];
  serviceStatus: ServiceStatus | null;
};
type ProblemResolveRequest = {
  type: "manageProblem";
  tenantId: string;
  operation: "resolve";
  problemId: string;
  workaround: string | null;
  rootCause: string | null;
  serviceStatus?: ServiceStatus | null;
};
type ProblemDeleteRequest = {
  type: "manageProblem";
  tenantId: string;
  operation: "delete";
  problemId: string;
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
  | ProblemDeleteRequest
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
  departmentId: "",
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
  departmentId: "",
};

const EMPTY_PROBLEM_FORM: ProblemForm = {
  id: null,
  title: "",
  description: "",
  status: "open",
  workaround: "",
  rootCause: "",
  ownerId: "",
  departmentId: "",
  serviceIds: [],
  serviceStatus: "",
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
  departments: readonly DepartmentOption[];
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
  departments,
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
  const departmentName =
    departments.find((entry) => entry.id === serviceForm.departmentId)?.name ??
    "";
  return (
    <form onSubmit={(event) => void onSubmit(event)}>
      <FormLayout
        side={
          <>
            <FormSummary
              eyebrow="Statusseite"
              rows={[
                ["Zustand", SERVICE_STATUS_LABELS[serviceForm.status]],
                ["Kritikalität", CRITICALITY_LABELS[serviceForm.criticality]],
                ["Ort", selectedCategoryPath[0]?.name ?? ""],
                ["Abteilung", departmentName],
              ]}
              title={serviceForm.name.trim()}
            />
            <FormSwitch
              checked={serviceForm.statusPublic}
              disabled={controlsDisabled}
              hint="Der Dienst erscheint erst nach bewusster Freigabe der Statusseite unter Systemstatus."
              label="Auf öffentlicher Statusseite anzeigen"
              onChange={(checked) =>
                setServiceForm((current) => ({
                  ...current,
                  statusPublic: checked,
                }))
              }
            />
          </>
        }
      >
        <FormCard title="Dienst">
          <FormGrid cols={1}>
            <FormField label="Name" required>
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
            </FormField>
            <FormField label="Beschreibung">
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
            </FormField>
          </FormGrid>
        </FormCard>
        <FormCard title="Betrieb">
          <FormGrid cols={3}>
            <FormField label="Kritikalität">
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
            </FormField>
            <FormField label="Betriebszustand">
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
            </FormField>
            <DepartmentField
              departments={departments}
              disabled={controlsDisabled}
              onChange={(departmentId) =>
                setServiceForm((current) => ({ ...current, departmentId }))
              }
              required={serviceForm.id === null}
              value={serviceForm.departmentId}
            />
          </FormGrid>
        </FormCard>
        {supportsServiceCategories ? (
          <FormCard
            sub="Ort, Kategorie, Unterkategorie"
            title="Serviceeinordnung"
          >
            <FormNote>
              {tn(
                "Wähle den Ort (z. B. Betriebsweit, Baar, Menzingen) und bei Bedarf eine Kategorie und Unterkategorie.",
                "Wählen Sie den Ort (z. B. Betriebsweit, Baar, Menzingen) und bei Bedarf eine Kategorie und Unterkategorie.",
              )}
            </FormNote>
            <FormGrid cols={3}>
              <FormField label="Ort">
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
              </FormField>
              <FormField label="Kategorie">
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
                    {rootCategoryId ? "Keine Kategorie" : "Zuerst Ort wählen"}
                  </option>
                  {subcategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                {addControl(1)}
              </FormField>
              <FormField label="Unterkategorie">
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
              </FormField>
            </FormGrid>
            {rootCategories.length === 0 ? (
              <FormNote>
                {tn(
                  "Es sind noch keine Orte und Kategorien angelegt. Du kannst die Einordnung später ergänzen.",
                  "Es sind noch keine Orte und Kategorien angelegt. Sie können die Einordnung später ergänzen.",
                )}
              </FormNote>
            ) : null}
          </FormCard>
        ) : null}
        <FormCard title="Verantwortung">
          <FormGrid cols={2}>
            <FormField label="Primär verantwortliche Agent:in">
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
                  .filter(
                    (agent) => agent.id !== serviceForm.secondaryResponsibleId,
                  )
                  .map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.displayName}
                    </option>
                  ))}
              </select>
            </FormField>
            <FormField
              label="Sekundär verantwortliche Agent:in"
              hint="Nur aktuell berechtigte interne Agent:innen stehen zur Auswahl."
            >
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
                  .filter(
                    (agent) => agent.id !== serviceForm.primaryResponsibleId,
                  )
                  .map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.displayName}
                    </option>
                  ))}
              </select>
            </FormField>
          </FormGrid>
        </FormCard>
      </FormLayout>
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
              : "Dienst anlegen"}
        </button>{" "}
        <button disabled={controlsDisabled} onClick={onCancel} type="button">
          Abbrechen
        </button>
      </p>
    </form>
  );
}

const catalogPageCopy = (): Readonly<
  Record<CatalogTab, { eyebrow: string; title: string; description: string }>
> => ({
  services: {
    eyebrow: "Dienstkatalog",
    title: "Dienste",
    description: tn(
      "Verwalte die aktiven Dienste dieses Mandanten und ihre Kritikalität.",
      "Verwalten Sie die aktiven Dienste dieses Mandanten und ihre Kritikalität.",
    ),
  },
  assets: {
    eyebrow: "Asset Management",
    title: "Assets",
    description: tn(
      "Verwalte die aktiven Assets dieses Mandanten und ihre Zuordnung zu Diensten.",
      "Verwalten Sie die aktiven Assets dieses Mandanten und ihre Zuordnung zu Diensten.",
    ),
  },
  problems: {
    eyebrow: "Fallmanagement",
    title: "Fälle",
    description: tn(
      "Verfolge offene Fälle, dokumentiere Ursachen und verknüpfe betroffene Tickets.",
      "Verfolgen Sie offene Fälle, dokumentieren Sie Ursachen und verknüpfen Sie betroffene Tickets.",
    ),
  },
});

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

// Older functions do not send department_id yet; a missing field means "no
// department".
function optionalDepartmentId(value: Record<string, unknown>): unknown {
  return Object.hasOwn(value, "department_id") ? value.department_id : null;
}

function parseDepartmentOption(value: unknown): DepartmentOption | null {
  if (
    !isRecord(value) ||
    !Object.keys(value).every((key) => key === "id" || key === "name") ||
    typeof value.id !== "string" ||
    !value.id.trim() ||
    typeof value.name !== "string" ||
    !value.name.trim()
  ) {
    return null;
  }
  return { id: value.id, name: value.name };
}

function parseService(value: unknown): Service | null {
  if (!isRecord(value)) return null;
  const departmentId = optionalDepartmentId(value);
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
    !isNullableString(departmentId) ||
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
    department_id: departmentId,
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
  const departmentId = optionalDepartmentId(value);
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
    !isNullableString(departmentId) ||
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
    department_id: departmentId,
    intune_primary_person_name: isNullableString(
      value.intune_primary_person_name,
    )
      ? value.intune_primary_person_name
      : null,
    intune_primary_person_photo_url:
      typeof value.intune_primary_person_photo_url === "string" &&
      value.intune_primary_person_photo_url.startsWith("https://")
        ? value.intune_primary_person_photo_url
        : null,
    metadata: value.metadata as { [key: string]: JsonValue },
    active: value.active,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function parseProblem(value: unknown): Problem | null {
  if (!isRecord(value)) return null;
  const departmentId = optionalDepartmentId(value);
  if (
    typeof value.id !== "string" ||
    typeof value.tenant_id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.description !== "string" ||
    !isProblemStatus(value.status) ||
    !isNullableString(value.workaround) ||
    !isNullableString(value.root_cause) ||
    !isNullableString(value.owner_id) ||
    !isNullableString(departmentId) ||
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
    department_id: departmentId,
    created_by: value.created_by,
    created_at: value.created_at,
    updated_at: value.updated_at,
    service_ids: Array.isArray(value.service_ids)
      ? value.service_ids.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
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
  /** Anzahl passender Assets insgesamt (bei seitenweiser Abfrage). */
  assetTotal: number;
  problems: Problem[];
  departments: DepartmentOption[];
} {
  const data = responseData(value);
  const departmentValues = Object.hasOwn(data, "departments")
    ? data.departments
    : [];
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
    !Array.isArray(data.problems) ||
    !Array.isArray(departmentValues)
  ) {
    throw new Error("Der Katalog ist unvollständig.");
  }

  const services = data.services.map(parseService);
  const archived = archivedServices.map(parseService);
  const categories = serviceCategories.map(parseServiceCategory);
  const assets = data.assets.map(parseAsset);
  const problems = data.problems.map(parseProblem);
  const departments = departmentValues.map(parseDepartmentOption);
  if (
    services.some((item) => item === null) ||
    archived.some((item) => item === null) ||
    categories.some((item) => item === null) ||
    assets.some((item) => item === null) ||
    problems.some((item) => item === null) ||
    departments.some((item) => item === null) ||
    new Set(departments.map((item) => item?.id)).size !== departments.length
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
    assetTotal:
      typeof data.assetTotal === "number" &&
      Number.isInteger(data.assetTotal) &&
      data.assetTotal >= assets.length
        ? data.assetTotal
        : assets.length,
    problems: problems as Problem[],
    departments: departments as DepartmentOption[],
  };
}

/**
 * Department for a save request: only sent when the person can choose (more
 * than one department) and a department is selected; otherwise the server
 * uses the person's only department or keeps the existing one.
 */
export function departmentRequestValue(
  departments: readonly DepartmentOption[],
  departmentId: string,
): { departmentId?: string } {
  return departments.length > 1 && departmentId ? { departmentId } : {};
}

/** Department name for lists, only when more than one department exists. */
export function departmentLabel(
  departments: readonly DepartmentOption[],
  departmentId: string | null,
): string | null {
  if (departments.length <= 1 || !departmentId) return null;
  return (
    departments.find((department) => department.id === departmentId)?.name ??
    null
  );
}

type DepartmentFieldProps = {
  departments: readonly DepartmentOption[];
  disabled: boolean;
  onChange: (departmentId: string) => void;
  required: boolean;
  value: string;
};

function DepartmentField({
  departments,
  disabled,
  onChange,
  required,
  value,
}: DepartmentFieldProps) {
  if (departments.length <= 1) return null;
  return (
    <FormField label="Abteilung" required={required}>
      <select
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        value={value}
      >
        <option disabled value="">
          Abteilung wählen
        </option>
        {value && !departments.some((department) => department.id === value) ? (
          <option value={value}>Nicht mehr verfügbar</option>
        ) : null}
        {departments.map((department) => (
          <option key={department.id} value={department.id}>
            {department.name}
          </option>
        ))}
      </select>
    </FormField>
  );
}

function parseSavedService(value: unknown): Service {
  const service = parseService(responseData(value).service);
  if (!service) throw new Error("Der gespeicherte Dienst ist unvollständig.");
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

function defaultTicketFollowUpMessage(
  title: string,
  workaround: string,
): string {
  const lines = [
    "Guten Tag",
    "",
    tn(
      `Die Ursache deiner Meldung wurde behoben (${title.trim()}).`,
      `Die Ursache Ihrer Meldung wurde behoben (${title.trim()}).`,
    ),
  ];
  if (workaround.trim()) lines.push("", workaround.trim());
  lines.push(
    "",
    tn(
      "Bitte melde dich, falls das Problem weiterhin besteht.",
      "Bitte melden Sie sich, falls das Problem weiterhin besteht.",
    ),
  );
  return lines.join("\n");
}

/** Markdown of a knowledge draft from a resolved case. */
function caseArticleMarkdown(form: {
  description: string;
  workaround: string;
  rootCause: string;
}): string {
  const sections = [
    ["Problem", form.description],
    ["Lösung / Workaround", form.workaround],
    ["Ursache", form.rootCause],
  ]
    .filter(([, text]) => text?.trim())
    .map(([heading, text]) => `## ${heading}\n\n${text!.trim()}`);
  return sections.length > 0
    ? sections.join("\n\n")
    : tn(
        "## Lösung\n\nBeschreibe hier die Lösung.",
        "## Lösung\n\nBeschreiben Sie hier die Lösung.",
      );
}

/** Creates a knowledge draft and returns its id. */
async function createCaseArticle(
  tenantId: string,
  input: {
    title: string;
    bodyMarkdown: string;
    visibility: "internal" | "external";
    departmentId: string | null;
  },
): Promise<string> {
  if (!supabase) {
    throw new Error("Die Verbindung zu Supabase ist nicht konfiguriert.");
  }
  const { data, error } = await supabase.functions.invoke("knowledge-base", {
    body: {
      type: "saveArticle",
      tenantId,
      title: input.title,
      bodyMarkdown: input.bodyMarkdown,
      visibility: input.visibility,
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
    },
  });
  if (error) throw error;
  const article =
    isRecord(data) && isRecord(data.data) ? data.data.article : null;
  if (!isRecord(article) || typeof article.id !== "string") {
    throw new Error("Der Wissensartikel konnte nicht angelegt werden.");
  }
  return article.id;
}

function knowledgeArticleLink(articleId: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("wissen", articleId);
  return url.toString();
}

/** Sends a reply to and/or resolves one ticket linked to a resolved case. */
async function followUpLinkedTicket(
  tenantId: string,
  ticketId: string,
  options: { message: string | null; resolve: boolean },
): Promise<void> {
  if (!supabase) {
    throw new Error("Die Verbindung zu Supabase ist nicht konfiguriert.");
  }
  if (options.message) {
    const { error } = await supabase.functions.invoke("ticket-operations", {
      body: {
        type: "addComment",
        tenantId,
        ticketId,
        body: options.message,
        visibility: "external",
      },
    });
    if (error) throw error;
  }
  if (options.resolve) {
    const { error } = await supabase.functions.invoke("ticket-operations", {
      body: {
        type: "updateTicket",
        tenantId,
        ticketId,
        statusKey: "resolved",
      },
    });
    if (error) throw error;
  }
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
    return tn(
      "Deine Anmeldung ist nicht mehr gültig. Bitte melde dich erneut an.",
      "Ihre Anmeldung ist nicht mehr gültig. Bitte melden Sie sich erneut an.",
    );
  }
  if (status === 403) {
    return tn(
      "Der Zugriff wurde von der API verweigert. Für diese Aktion fehlt dir die erforderliche Berechtigung.",
      "Der Zugriff wurde von der API verweigert. Für diese Aktion fehlt Ihnen die erforderliche Berechtigung.",
    );
  }
  if (status === 503) {
    return tn(
      "Der Dienst oder die Berechtigungsprüfung ist derzeit nicht verfügbar. Bitte versuche es später erneut.",
      "Der Dienst oder die Berechtigungsprüfung ist derzeit nicht verfügbar. Bitte versuchen Sie es später erneut.",
    );
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
    departmentId: service.department_id ?? "",
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
    departmentId: asset.department_id ?? "",
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
    departmentId: problem.department_id ?? "",
    serviceIds: problem.service_ids,
    // Resolving suggests to set the affected services back to operational.
    serviceStatus: "",
  };
}

/** Affected services of a case and the state to set on them. */
function ProblemServicesField({
  disabled,
  onChange,
  onStatusChange,
  selectedIds,
  services,
  status,
  statusLabel,
}: {
  disabled: boolean;
  onChange: (serviceIds: string[]) => void;
  onStatusChange: (status: "" | ServiceStatus) => void;
  selectedIds: readonly string[];
  services: readonly Service[];
  status: "" | ServiceStatus;
  statusLabel: string;
}) {
  const [query, setQuery] = useState("");
  const selected = new Set(selectedIds);
  const term = query.trim().toLocaleLowerCase("de-CH");
  const visible = services.filter(
    (service) =>
      service.active &&
      (!term || service.name.toLocaleLowerCase("de-CH").includes(term)),
  );
  return (
    <fieldset className="service-assets__problem-services">
      <legend>Betroffene Dienste (optional)</legend>
      {services.length > 8 ? (
        <input
          aria-label="Dienste filtern"
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Dienst suchen"
          type="search"
          value={query}
        />
      ) : null}
      {visible.length === 0 ? (
        <p className="data-caption">Keine Dienste gefunden.</p>
      ) : (
        <ul>
          {visible.map((service) => (
            <li key={service.id}>
              <label className="service-assets__checkbox">
                <input
                  checked={selected.has(service.id)}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selectedIds, service.id]
                        : selectedIds.filter((id) => id !== service.id),
                    )
                  }
                  type="checkbox"
                />
                <span>
                  {service.name}
                  <small> · {SERVICE_STATUS_LABELS[service.status]}</small>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <label>
        {statusLabel}
        <select
          disabled={disabled || selectedIds.length === 0}
          onChange={(event) =>
            onStatusChange(event.target.value as "" | ServiceStatus)
          }
          value={status}
        >
          <option value="">Nicht ändern</option>
          {(Object.keys(SERVICE_STATUS_LABELS) as ServiceStatus[]).map(
            (entry) => (
              <option key={entry} value={entry}>
                {SERVICE_STATUS_LABELS[entry]}
              </option>
            ),
          )}
        </select>
      </label>
      <p className="data-caption">
        Der gewählte Zustand wird bei den Diensten gespeichert und im
        Systemstatus angezeigt (bei öffentlichen Diensten auch auf der
        Statusseite).
      </p>
    </fieldset>
  );
}

export function ServiceAssets({
  tenantId,
  initialTab = "services",
  allowAssets = true,
  fixedTab,
  createProblemRequestId,
  onCreateProblemRequestConsumed,
  onCreateMaintenance,
  assetQueryRequest,
  labelBranding,
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
  const [assetImportOpen, setAssetImportOpen] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [serviceForm, setServiceForm] =
    useState<ServiceForm>(EMPTY_SERVICE_FORM);
  const [assetForm, setAssetForm] = useState<AssetForm>(EMPTY_ASSET_FORM);
  const [problemForm, setProblemForm] =
    useState<ProblemForm>(EMPTY_PROBLEM_FORM);
  const [problemMode, setProblemMode] = useState<ProblemFormMode>("create");
  const [assetEditorOpen, setAssetEditorOpen] = useState(false);
  const [problemEditorOpen, setProblemEditorOpen] = useState(false);
  const [serviceEditorOpen, setServiceEditorOpen] = useState(false);
  const [inlineServiceEditorId, setInlineServiceEditorId] = useState<
    string | null
  >(null);
  const [serviceQuery, setServiceQuery] = useState("");
  const [serviceCriticality, setServiceCriticality] = useState<
    "all" | Criticality
  >("all");
  const [assetQuery, setAssetQuery] = useState(assetQueryRequest?.query ?? "");
  useEffect(() => {
    if (assetQueryRequest) setAssetQuery(assetQueryRequest.query);
  }, [assetQueryRequest]);
  const [assetServiceFilter, setAssetServiceFilter] = useState("all");
  // Assets selected for printing labels.
  const [labelSelection, setLabelSelection] = useState<Set<string>>(
    () => new Set(),
  );
  const [labelDialogOpen, setLabelDialogOpen] = useState(false);
  const [assetStatusFilter, setAssetStatusFilter] = useState("all");
  const [assetTotal, setAssetTotal] = useState(0);
  const [assetPageLoading, setAssetPageLoading] = useState(false);
  const assetPageVersion = useRef(0);
  const assetFilterRef = useRef({
    query: assetQuery,
    serviceFilter: "all",
    statusFilter: "all",
  });
  assetFilterRef.current = {
    query: assetQuery,
    serviceFilter: assetServiceFilter,
    statusFilter: assetStatusFilter,
  };
  const [insightsServiceId, setInsightsServiceId] = useState<string | null>(
    null,
  );
  const [problemQuery, setProblemQuery] = useState("");
  const [problemStatusFilter, setProblemStatusFilter] = useState<
    "open" | "all" | ProblemStatus
  >("open");
  // Follow-up for the tickets of a case that is being resolved.
  const [ticketFollowUp, setTicketFollowUp] = useState({
    notify: false,
    message: "",
    resolve: false,
  });
  // Optional knowledge draft from the case being resolved.
  const [caseArticle, setCaseArticle] = useState({
    create: false,
    title: "",
    visibility: "internal" as "internal" | "external",
  });
  const [createdArticleId, setCreatedArticleId] = useState<string | null>(null);
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
  // Read through a ref so learning that archiving is supported does not
  // recreate loadCatalog and trigger a second, identical catalog request.
  const supportsArchivedServicesRef = useRef(false);
  supportsArchivedServicesRef.current = supportsArchivedServices;
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
  const editedAssetPrimaryPhoto = useMemo(() => {
    if (!assetForm.id) return null;
    return (
      assets.find((asset) => asset.id === assetForm.id)
        ?.intune_primary_person_photo_url ?? null
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
  // Intune actions only for assets with a known operating system (devices).
  const intuneCandidateIds = useMemo(
    () =>
      allowAssets && activeTab === "assets"
        ? assets
            .filter((asset) => asset.operating_system)
            .slice(0, 100)
            .map((asset) => asset.id)
        : [],
    [activeTab, allowAssets, assets],
  );
  const intuneAssets = useIntuneAssetDevices(tenantId, intuneCandidateIds);
  const filteredAssets = useMemo(
    () =>
      assets.filter(
        (asset) =>
          contains(
            [
              asset.id,
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
            (problemStatusFilter === "open"
              ? problem.status !== "resolved"
              : problem.status === problemStatusFilter)),
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
  const pageCopy = fixedTab ? catalogPageCopy()[fixedTab] : null;

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
            supportsArchivedServicesRef.current,
            showArchivedServices,
            { offset: 0, ...assetFilterRef.current },
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
      setAssets(catalog.assets);
      setAssetTotal(catalog.assetTotal);
      setProblems(sortProblems(catalog.problems));
      setDepartments(catalog.departments);
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
      setDepartments([]);
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
  }, [showArchivedServices, tenantId]);

  useEffect(() => {
    void loadCatalog();
    return () => {
      requestVersion.current += 1;
    };
  }, [loadCatalog]);

  // Asset-Seiten: Filter und Seiten werden in SQL ausgewertet.
  const loadAssetPage = useCallback(
    async (offset: number) => {
      const version = assetPageVersion.current + 1;
      assetPageVersion.current = version;
      setAssetPageLoading(true);
      try {
        const catalog = parseCatalog(
          await requestServiceAssets(
            catalogRequest(
              tenantId,
              false,
              false,
              { offset, ...assetFilterRef.current },
              ["assets"],
            ),
          ),
        );
        if (assetPageVersion.current !== version) return;
        setAssets((current) =>
          offset === 0 ? catalog.assets : [...current, ...catalog.assets],
        );
        setAssetTotal(catalog.assetTotal);
      } catch (nextError) {
        if (assetPageVersion.current !== version) return;
        setError(
          await apiErrorMessage(
            nextError,
            "Die Assets konnten nicht geladen werden.",
          ),
        );
      } finally {
        if (assetPageVersion.current === version) setAssetPageLoading(false);
      }
    },
    [tenantId],
  );
  const assetFilterKey = `${assetQuery.trim()}|${assetServiceFilter}|${assetStatusFilter}`;
  const appliedAssetFilterKey = useRef(assetFilterKey);
  useEffect(() => {
    if (!allowAssets || appliedAssetFilterKey.current === assetFilterKey) {
      return;
    }
    const timer = window.setTimeout(() => {
      appliedAssetFilterKey.current = assetFilterKey;
      void loadAssetPage(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [allowAssets, assetFilterKey, loadAssetPage]);

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
    setCreatedArticleId(null);
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
    // New cases search as well; their tickets are linked after creating.
    if (query.length < 2) {
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
    setCreatedArticleId(null);
  }

  function resetServiceForm() {
    setServiceForm(EMPTY_SERVICE_FORM);
    setServiceEditorOpen(false);
    setInlineServiceEditorId(null);
    setError("");
    setSuccess("");
    setCreatedArticleId(null);
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
    setCreatedArticleId(null);
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
    setCreatedArticleId(null);
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
    setCreatedArticleId(null);
    restoreAssetEditorFocus();
  }

  function openAssetEditor(asset?: Asset, trigger?: HTMLElement) {
    assetEditorTriggerRef.current =
      trigger ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    setAssetForm(asset ? assetDraft(asset) : EMPTY_ASSET_FORM);
    if (asset) recordRecentItem(tenantId, "asset", asset.id);
    setError("");
    setSuccess("");
    setCreatedArticleId(null);
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

  function openNewProblem() {
    resetProblemForm();
    setProblemEditorOpen(true);
  }

  function resetProblemForm() {
    setProblemEditorOpen(false);
    setTicketFollowUp({ notify: false, message: "", resolve: false });
    setCaseArticle({ create: false, title: "", visibility: "internal" });
    setProblemForm(EMPTY_PROBLEM_FORM);
    setProblemMode("create");
    clearProblemTicketState();
    setError("");
    setSuccess("");
    setCreatedArticleId(null);
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
    openNewProblem();
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
    setCreatedArticleId(null);
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
      setError(
        tn(
          "Bitte gib einen Servicenamen ein.",
          "Bitte geben Sie einen Servicenamen ein.",
        ),
      );
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
        ...departmentRequestValue(departments, serviceForm.departmentId),
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
          ? `Der Dienst „${saved.name}“ wurde gespeichert.`
          : `Der Dienst „${saved.name}“ wurde angelegt.`,
      );
    } catch (nextError) {
      setForbidden(errorStatus(nextError) === 403);
      setError(
        await apiErrorMessage(
          nextError,
          "Der Dienst konnte nicht gespeichert werden.",
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
    setCreatedArticleId(null);
  }

  async function saveServiceCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = serviceCategoryForm.name.trim();
    if (!name) {
      setError(
        tn(
          "Bitte gib einen Namen für die Servicekategorie ein.",
          "Bitte geben Sie einen Namen für die Servicekategorie ein.",
        ),
      );
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
        sortByName([...current.filter((item) => item.id !== saved.id), saved]),
      );
      setQuickEdit(null);
      setSuccess(`Der Dienst „${saved.name}“ wurde gespeichert.`);
    } catch (nextError) {
      setForbidden(errorStatus(nextError) === 403);
      setError(
        await apiErrorMessage(
          nextError,
          "Der Dienst konnte nicht gespeichert werden.",
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
    if (!(await confirmDialog(`Dienst „${service.name}“ archivieren?`))) return;
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
        `Der Dienst „${service.name}“ wurde archiviert und von der öffentlichen Statusseite entfernt.`,
      );
    } catch (nextError) {
      setForbidden(errorStatus(nextError) === 403);
      setError(
        await apiErrorMessage(
          nextError,
          "Der Dienst konnte nicht archiviert werden.",
        ),
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function restoreService(service: Service) {
    if (!(await confirmDialog(`Dienst „${service.name}“ wiederherstellen?`)))
      return;
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
        throw new Error("Der Dienst wurde nicht wiederhergestellt.");
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
      setSuccess(`Der Dienst „${restored.name}“ wurde wiederhergestellt.`);
    } catch (nextError) {
      setForbidden(errorStatus(nextError) === 403);
      setError(
        await apiErrorMessage(
          nextError,
          "Der Dienst konnte nicht wiederhergestellt werden.",
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
        ...departmentRequestValue(departments, assetForm.departmentId),
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
            intune_primary_person_photo_url:
              current.find((asset) => asset.id === saved.id)
                ?.intune_primary_person_photo_url ?? null,
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
    if (!(await confirmDialog(`Asset „${asset.name}“ archivieren?`))) return;
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

  /** Mirrors a state change of affected services in the local list. */
  function applyLocalServiceStatus(
    serviceIds: readonly string[],
    status: "" | ServiceStatus,
  ) {
    if (!status || serviceIds.length === 0) return;
    const ids = new Set(serviceIds);
    setServices((current) =>
      current.map((service) =>
        ids.has(service.id) ? { ...service, status } : service,
      ),
    );
  }

  async function deleteProblem(problem: Problem) {
    if (
      !(await confirmDialog(
        `Den Fall „${problem.title}“ endgültig löschen? Die Verknüpfungen zu Tickets werden entfernt; die Tickets selbst bleiben bestehen.`,
      ))
    ) {
      return;
    }
    beginAction(`problem:delete:${problem.id}`);
    try {
      await requestServiceAssets({
        type: "manageProblem",
        tenantId,
        operation: "delete",
        problemId: problem.id,
      });
      setProblems((current) =>
        current.filter((item) => item.id !== problem.id),
      );
      if (problemForm.id === problem.id) resetProblemForm();
      setSuccess(`Der Fall „${problem.title}“ wurde gelöscht.`);
    } catch (nextError) {
      setForbidden(errorStatus(nextError) === 403);
      setError(
        await apiErrorMessage(
          nextError,
          "Der Fall konnte nicht gelöscht werden.",
        ),
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function linkTicketToProblem(ticket: TicketReference) {
    const problemId = problemForm.id;
    if (!problemId) {
      // New case: remember the ticket and link it after creating.
      setProblemTickets((current) =>
        current.some((item) => item.id === ticket.id)
          ? current
          : [...current, ticket],
      );
      setTicketSearchResults((current) =>
        current.filter((item) => item.id !== ticket.id),
      );
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
      setProblemTickets((current) =>
        current.filter((item) => item.id !== ticket.id),
      );
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
            serviceStatus: problemForm.serviceStatus || null,
          }),
        );
        applyLocalServiceStatus(
          resolved.service_ids,
          problemForm.serviceStatus,
        );
        setProblems((current) =>
          sortProblems([
            ...current.filter((problem) => problem.id !== resolved.id),
            resolved,
          ]),
        );
        const linkedTickets = [...problemTickets];
        const articleRequest = caseArticle.create
          ? {
              title: caseArticle.title.trim() || resolved.title,
              bodyMarkdown: caseArticleMarkdown(problemForm),
              visibility: caseArticle.visibility,
              departmentId: problemForm.departmentId || null,
            }
          : null;
        let articleId: string | null = null;
        let articleFailure = "";
        if (articleRequest) {
          try {
            articleId = await createCaseArticle(tenantId, articleRequest);
          } catch (articleError) {
            articleFailure = await apiErrorMessage(
              articleError,
              "Der Wissensartikel konnte nicht angelegt werden.",
            );
          }
        }
        const message = ticketFollowUp.notify
          ? ticketFollowUp.message.trim()
          : "";
        const followUpWanted =
          linkedTickets.length > 0 &&
          (Boolean(message) || ticketFollowUp.resolve);
        const failed: string[] = [];
        if (followUpWanted) {
          for (const ticket of linkedTickets) {
            try {
              await followUpLinkedTicket(tenantId, ticket.id, {
                message: message || null,
                resolve: ticketFollowUp.resolve,
              });
            } catch (ticketError) {
              failed.push(
                `${ticket.ticketNumber}: ${await apiErrorMessage(
                  ticketError,
                  "Aktion fehlgeschlagen",
                )}`,
              );
            }
          }
        }
        resetProblemForm();
        setCreatedArticleId(articleId);
        const done = linkedTickets.length - failed.length;
        const actionText = [
          message ? "benachrichtigt" : null,
          ticketFollowUp.resolve ? "gelöst" : null,
        ]
          .filter(Boolean)
          .join(" und ");
        setSuccess(
          [
            `Der Fall „${resolved.title}“ wurde gelöst.`,
            followUpWanted
              ? `${done} von ${linkedTickets.length} angehängten Tickets wurden ${actionText}.`
              : null,
            articleId ? "Der Wissensartikel wurde als Entwurf angelegt." : null,
          ]
            .filter(Boolean)
            .join(" "),
        );
        const problemsText = [
          failed.length > 0
            ? `Nicht alle Tickets konnten bearbeitet werden: ${failed.join(" · ")}`
            : null,
          articleFailure || null,
        ].filter(Boolean);
        if (problemsText.length > 0) setError(problemsText.join(" "));
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
        ...departmentRequestValue(departments, problemForm.departmentId),
        serviceIds: problemForm.serviceIds,
        serviceStatus: problemForm.serviceStatus || null,
      };
      const saved = parseSavedProblem(await requestServiceAssets(request));
      applyLocalServiceStatus(saved.service_ids, problemForm.serviceStatus);
      const pendingTickets = editing ? [] : [...problemTickets];
      const linkFailures: string[] = [];
      for (const ticket of pendingTickets) {
        try {
          await requestServiceAssets({
            type: "linkTicket",
            tenantId,
            ticketId: ticket.id,
            kind: "problem",
            targetId: saved.id,
          });
        } catch (linkError) {
          linkFailures.push(
            `${ticket.ticketNumber}: ${await apiErrorMessage(
              linkError,
              "konnte nicht angehängt werden",
            )}`,
          );
        }
      }
      setProblems((current) =>
        sortProblems([
          ...current.filter((problem) => problem.id !== saved.id),
          saved,
        ]),
      );
      resetProblemForm();
      const linked = pendingTickets.length - linkFailures.length;
      setSuccess(
        editing
          ? `Der Fall „${saved.title}“ wurde gespeichert.`
          : pendingTickets.length > 0
            ? `Der Fall „${saved.title}“ wurde angelegt. ${linked} von ${pendingTickets.length} Tickets wurden angehängt.`
            : `Der Fall „${saved.title}“ wurde angelegt.`,
      );
      if (linkFailures.length > 0) {
        setError(
          `Nicht alle Tickets konnten angehängt werden: ${linkFailures.join(" · ")}`,
        );
      }
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
        ? assetTotal
        : filteredProblems.length;

  return (
    <section
      aria-busy={loading || pendingAction !== null}
      aria-labelledby="service-assets-title"
      className="service-assets"
    >
      <div className="panel-heading">
        <div>
          {pageCopy ? (
            // Der Seitentitel steht bereits in der Kopfzeile der App.
            <h2 className="sr-only" id="service-assets-title">
              {pageCopy.title}
            </h2>
          ) : (
            <>
              <p className="eyebrow">Servicekatalog</p>
              <h2 id="service-assets-title">Dienste, Assets und Fälle</h2>
            </>
          )}
          <p>
            {pageCopy?.description ??
              tn(
                "Verwalte den aktuellen Katalog dieses Mandanten. Archivierte und gelöste Einträge werden von der API nicht mehr im Katalog angezeigt.",
                "Verwalten Sie den aktuellen Katalog dieses Mandanten. Archivierte und gelöste Einträge werden von der API nicht mehr im Katalog angezeigt.",
              )}
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
                  Dienst erstellen
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
        ) : null}
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
          {createdArticleId ? (
            <>
              {" "}
              <a
                href={knowledgeArticleLink(createdArticleId)}
                rel="noreferrer"
                target="_blank"
              >
                Artikel öffnen
              </a>
            </>
          ) : null}
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
              Assets ({assetTotal})
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
              {!fixedTab ? <h3>Dienste</h3> : null}
              <p>{activeCount} passende Dienste</p>
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
                  {tn(
                    "Lege den ersten Ort an, um Services strukturiert einzuordnen.",
                    "Legen Sie den ersten Ort an, um Services strukturiert einzuordnen.",
                  )}
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
            <legend>Dienste filtern</legend>
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
              <span>Archivierte Dienste anzeigen</span>
            </label>
          ) : null}

          {services.length === 0 ? (
            <p className="empty-state">
              {tn(
                "Für diesen Mandanten sind noch keine aktiven Services vorhanden. Erstelle den ersten Dienst über die Kopfaktion.",
                "Für diesen Mandanten sind noch keine aktiven Services vorhanden. Erstellen Sie den ersten Dienst über die Kopfaktion.",
              )}
            </p>
          ) : filteredServices.length === 0 ? (
            <p className="empty-state">
              Keine Services entsprechen dem Filter.
            </p>
          ) : (
            <ul aria-label="Aktive Dienste">
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
                          {departmentLabel(
                            departments,
                            service.department_id,
                          ) ? (
                            <p className="service-assets__service-category">
                              Abteilung:{" "}
                              {departmentLabel(
                                departments,
                                service.department_id,
                              )}
                            </p>
                          ) : null}
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
                                .filter(
                                  (agent) => agent.id !== quickEdit.primary,
                                )
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
                    <div className="service-assets__service-card-actions">
                      <button
                        aria-expanded={insightsServiceId === service.id}
                        onClick={() =>
                          setInsightsServiceId((current) =>
                            current === service.id ? null : service.id,
                          )
                        }
                        type="button"
                      >
                        {insightsServiceId === service.id
                          ? "Details schliessen"
                          : "Details"}
                      </button>
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
                    {insightsServiceId === service.id ? (
                      <ServiceInsightsPanel
                        serviceId={service.id}
                        tenantId={tenantId}
                      />
                    ) : null}
                    {inlineServiceEditorId === service.id ? (
                      <section
                        aria-labelledby={`service-assets-inline-editor-${service.id}`}
                        className="service-assets__service-inline-editor"
                      >
                        <div className="service-assets__service-inline-editor-heading">
                          <div>
                            <p className="eyebrow">Dienst bearbeiten</p>
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
                          departments={departments}
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
                    {tn(
                      "Archivierte Services werden nicht als aktiv angeboten. Diese können bewusst wiederhergestellt werden.",
                      "Archivierte Services werden nicht als aktiv angeboten. Sie können bewusst wiederhergestellt werden.",
                    )}
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
                <ul aria-label="Archivierte Dienste">
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
                            ? "Dienst bearbeiten"
                            : "Neuer Dienst"}
                        </p>
                        <h3 id="service-assets-service-form-title">
                          {serviceForm.id
                            ? "Dienst aktualisieren"
                            : "Dienst anlegen"}
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
                      departments={departments}
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
              {!fixedTab ? <h3>Assets</h3> : null}
              <p>{activeCount} passende Assets</p>
            </div>
            <span className="service-assets__heading-actions">
              <button
                className="text-button"
                disabled={controlsDisabled}
                onClick={() => setAssetImportOpen(true)}
                type="button"
              >
                CSV importieren
              </button>
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
            </span>
          </div>
          {assetImportOpen ? (
            <CsvImportDialog
              fields={ASSET_IMPORT_FIELDS}
              onClose={() => setAssetImportOpen(false)}
              onFinished={(imported) => {
                if (imported) {
                  setSuccess(`${imported} Assets importiert.`);
                  void loadCatalog();
                }
              }}
              onImportRow={async (values) => {
                const text = (key: string) =>
                  typeof values[key] === "string"
                    ? (values[key] as string)
                    : null;
                await requestServiceAssets({
                  type: "manageAsset",
                  tenantId,
                  operation: "create",
                  name: text("name") ?? "",
                  serviceId: null,
                  assetTag: text("assetTag"),
                  inventoryNumber: text("inventoryNumber"),
                  serialNumber: text("serialNumber"),
                  manufacturer: text("manufacturer"),
                  model: text("model"),
                  operatingSystem: text("operatingSystem"),
                  kind: text("kind") ?? "other",
                  status: "active",
                  customerOrganizationId: null,
                  metadata: { source: "csv-import" },
                  active: true,
                });
              }}
              templateName="assets-vorlage.csv"
              title="Assets aus CSV importieren"
            />
          ) : null}
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
              Dienst
              <select
                onChange={(event) => setAssetServiceFilter(event.target.value)}
                value={assetServiceFilter}
              >
                <option value="all">Alle Dienste</option>
                <option value="unassigned">Ohne Dienst</option>
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
              {tn(
                "Für diesen Mandanten sind noch keine aktiven Assets vorhanden. Lege unten das erste Asset an.",
                "Für diesen Mandanten sind noch keine aktiven Assets vorhanden. Legen Sie unten das erste Asset an.",
              )}
            </p>
          ) : filteredAssets.length === 0 ? (
            <p className="empty-state">Keine Assets entsprechen dem Filter.</p>
          ) : (
            <>
              <LabelSelectionBar
                onClear={() => setLabelSelection(new Set())}
                onPrint={() => setLabelDialogOpen(true)}
                onSelectVisible={() =>
                  setLabelSelection(
                    (current) =>
                      new Set([
                        ...current,
                        ...filteredAssets.map((asset) => asset.id),
                      ]),
                  )
                }
                selectedCount={
                  assets.filter((asset) => labelSelection.has(asset.id)).length
                }
                visibleCount={filteredAssets.length}
              />
              <ul aria-label="Aktive Assets">
                {filteredAssets.map((asset) => (
                  <li key={asset.id}>
                    <article>
                      <label className="asset-label-check">
                        <input
                          checked={labelSelection.has(asset.id)}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setLabelSelection((current) => {
                              const next = new Set(current);
                              if (checked) next.add(asset.id);
                              else next.delete(asset.id);
                              return next;
                            });
                          }}
                          type="checkbox"
                        />
                        Für Etikett auswählen
                      </label>
                      <h4>{asset.name}</h4>
                      <p>
                        {asset.kind} · {asset.status}
                        {asset.asset_tag
                          ? ` · Kennung: ${asset.asset_tag}`
                          : ""}
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
                        Dienst:{" "}
                        {asset.service_id
                          ? (serviceNames.get(asset.service_id) ??
                            "Nicht im aktiven Katalog")
                          : "Nicht zugeordnet"}
                      </p>
                      {departmentLabel(departments, asset.department_id) ? (
                        <p>
                          Abteilung:{" "}
                          {departmentLabel(departments, asset.department_id)}
                        </p>
                      ) : null}
                      {asset.intune_primary_person_name ? (
                        <div className="service-assets__primary-person">
                          <span
                            aria-hidden="true"
                            className="service-assets__primary-person-avatar"
                          >
                            {asset.intune_primary_person_photo_url ? (
                              <img
                                alt=""
                                className="service-assets__primary-person-photo"
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                src={asset.intune_primary_person_photo_url}
                              />
                            ) : (
                              personInitials(asset.intune_primary_person_name)
                            )}
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
                      {intuneAssets.devices.has(asset.id) ? " " : null}
                      <IntuneActionsMenu
                        device={intuneAssets.devices.get(asset.id)}
                        disabled={!intuneAssets.connectionReady}
                        tenantId={tenantId}
                        ticketId={null}
                      />
                    </article>
                  </li>
                ))}
              </ul>
              {assets.length < assetTotal ? (
                <p className="service-assets__load-more">
                  <button
                    disabled={controlsDisabled || assetPageLoading}
                    onClick={() => void loadAssetPage(assets.length)}
                    type="button"
                  >
                    {assetPageLoading
                      ? "Wird geladen …"
                      : `Weitere Assets laden (${assets.length} von ${assetTotal})`}
                  </button>
                </p>
              ) : null}
            </>
          )}

          {labelDialogOpen ? (
            <AssetLabelDialog
              branding={labelBranding}
              buildItems={(mode, baseUrl) =>
                assets
                  .filter((asset) => labelSelection.has(asset.id))
                  .map((asset) =>
                    assetLabelItem(
                      {
                        id: asset.id,
                        name: asset.name,
                        assetTag: asset.asset_tag,
                        inventoryNumber: asset.inventory_number,
                        serialNumber: asset.serial_number,
                      },
                      mode,
                      baseUrl,
                    ),
                  )
              }
              count={
                assets.filter((asset) => labelSelection.has(asset.id)).length
              }
              onClose={() => setLabelDialogOpen(false)}
            />
          ) : null}

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
                          {editedAssetPrimaryPhoto ? (
                            <img
                              alt=""
                              className="service-assets__primary-person-photo"
                              referrerPolicy="no-referrer"
                              src={editedAssetPrimaryPhoto}
                            />
                          ) : editedAssetPrimaryPerson ? (
                            personInitials(editedAssetPrimaryPerson)
                          ) : (
                            "—"
                          )}
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
                      <FormLayout
                        side={
                          <FormSummary
                            eyebrow={assetForm.kind.trim() || "Asset"}
                            rows={[
                              ["Status", assetForm.status.trim()],
                              [
                                "Dienst",
                                services.find(
                                  (service) =>
                                    service.id === assetForm.serviceId,
                                )?.name ?? "",
                              ],
                              ["Inventarnr.", assetForm.inventoryNumber.trim()],
                            ]}
                            title={assetForm.name.trim()}
                          />
                        }
                      >
                        <FormCard title="Gerät">
                          <FormGrid cols={2}>
                            <FormField label="Name" required>
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
                            </FormField>
                            <FormField label="Art" required>
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
                            </FormField>
                            <FormField label="Status" required>
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
                            </FormField>
                            <FormField label="Zugehöriger Dienst">
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
                            </FormField>
                            <DepartmentField
                              departments={departments}
                              disabled={controlsDisabled}
                              onChange={(departmentId) =>
                                setAssetForm((current) => ({
                                  ...current,
                                  departmentId,
                                }))
                              }
                              required={assetForm.id === null}
                              value={assetForm.departmentId}
                            />
                          </FormGrid>
                        </FormCard>
                        <FormCard title="Hersteller und Modell">
                          <FormGrid cols={3}>
                            <FormField label="Hersteller">
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
                            </FormField>
                            <FormField label="Modell">
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
                            </FormField>
                            <FormField label="Betriebssystem">
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
                            </FormField>
                          </FormGrid>
                        </FormCard>
                        <FormCard title="Kennungen">
                          <FormGrid cols={3}>
                            <FormField label="Asset-Kennung">
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
                            </FormField>
                            <FormField label="Inventarnummer">
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
                            </FormField>
                            <FormField label="Seriennummer">
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
                            </FormField>
                          </FormGrid>
                        </FormCard>
                      </FormLayout>
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
          className="service-assets__problems-panel"
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
              {!fixedTab ? <h3>Fälle</h3> : null}
              <p>{activeCount} passende Fälle</p>
            </div>
            <button
              className="primary-button"
              disabled={controlsDisabled}
              onClick={openNewProblem}
              type="button"
            >
              Neuer Fall
            </button>
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
                    event.target.value as "open" | "all" | ProblemStatus,
                  )
                }
                value={problemStatusFilter}
              >
                <option value="open">Alle offenen Status</option>
                {EDITABLE_PROBLEM_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {PROBLEM_STATUS_LABELS[status]}
                  </option>
                ))}
                <option value="resolved">
                  {PROBLEM_STATUS_LABELS.resolved}
                </option>
                <option value="all">Alle Fälle</option>
              </select>
            </label>
          </fieldset>

          {problems.length === 0 ? (
            <p className="empty-state">
              {tn(
                "Es sind keine Fälle vorhanden. Lege bei Bedarf mit «Neuer Fall» einen an.",
                "Es sind keine Fälle vorhanden. Legen Sie bei Bedarf mit «Neuer Fall» einen an.",
              )}
            </p>
          ) : filteredProblems.length === 0 ? (
            <p className="empty-state">Keine Fälle entsprechen dem Filter.</p>
          ) : (
            <ul aria-label="Fälle">
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
                    {problem.service_ids.length > 0 ? (
                      <p>
                        Dienste:{" "}
                        {services
                          .filter((service) =>
                            problem.service_ids.includes(service.id),
                          )
                          .map(
                            (service) =>
                              `${service.name} (${SERVICE_STATUS_LABELS[service.status]})`,
                          )
                          .join(", ") || "Nicht mehr verfügbar"}
                      </p>
                    ) : null}
                    {problem.owner_id ? (
                      <p>
                        Verantwortlich:{" "}
                        {problemOwnerNames.get(problem.owner_id) ??
                          "Nicht mehr aktiv"}
                      </p>
                    ) : null}
                    {departmentLabel(departments, problem.department_id) ? (
                      <p>
                        Abteilung:{" "}
                        {departmentLabel(departments, problem.department_id)}
                      </p>
                    ) : null}
                    <p>Zuletzt geändert: {formatDate(problem.updated_at)}</p>
                    <button
                      disabled={controlsDisabled}
                      onClick={() => {
                        clearProblemTicketState();
                        setProblemForm(problemDraft(problem));
                        setProblemMode("edit");
                        setProblemEditorOpen(true);
                        setError("");
                        setSuccess("");
                        setCreatedArticleId(null);
                      }}
                      type="button"
                    >
                      {problem.status === "resolved"
                        ? "Wieder öffnen"
                        : "Bearbeiten"}
                    </button>{" "}
                    <button
                      disabled={controlsDisabled}
                      onClick={() => {
                        clearProblemTicketState();
                        setProblemForm(problemDraft(problem));
                        setProblemMode("resolve");
                        setProblemEditorOpen(true);
                        setError("");
                        setSuccess("");
                        setCreatedArticleId(null);
                      }}
                      type="button"
                    >
                      {problem.status === "resolved"
                        ? "Lösung und Tickets"
                        : "Lösen"}
                    </button>{" "}
                    <button
                      className="danger-action"
                      disabled={controlsDisabled}
                      onClick={() => void deleteProblem(problem)}
                      type="button"
                    >
                      {pendingAction === `problem:delete:${problem.id}`
                        ? "Wird gelöscht …"
                        : "Löschen"}
                    </button>
                  </article>
                </li>
              ))}
            </ul>
          )}

          {problemEditorOpen
            ? createPortal(
                <div
                  aria-label={
                    problemMode === "resolve"
                      ? "Fall lösen"
                      : problemMode === "edit"
                        ? "Fall bearbeiten"
                        : "Fall anlegen"
                  }
                  aria-modal="true"
                  className="service-assets__dialog-backdrop"
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && !controlsDisabled) {
                      event.preventDefault();
                      resetProblemForm();
                    }
                  }}
                  onMouseDown={(event) => {
                    if (
                      event.currentTarget === event.target &&
                      !controlsDisabled
                    ) {
                      resetProblemForm();
                    }
                  }}
                  role="dialog"
                >
                  <section
                    aria-busy={controlsDisabled}
                    aria-labelledby="service-assets-problem-form-title"
                    className="service-assets__asset-editor-dialog service-assets__problem-dialog"
                    tabIndex={-1}
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
                      <button
                        aria-label="Fallbearbeitung schliessen"
                        disabled={controlsDisabled}
                        onClick={resetProblemForm}
                        type="button"
                      >
                        Schliessen
                      </button>
                    </div>
                    {error ? (
                      <p
                        className="form-message form-message--error"
                        role="alert"
                      >
                        {error}
                      </p>
                    ) : null}
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
                          <DepartmentField
                            departments={departments}
                            disabled={controlsDisabled}
                            onChange={(departmentId) =>
                              setProblemForm((current) => ({
                                ...current,
                                departmentId,
                              }))
                            }
                            required={problemMode === "create"}
                            value={problemForm.departmentId}
                          />
                          <ProblemServicesField
                            disabled={controlsDisabled}
                            onChange={(serviceIds) =>
                              setProblemForm((current) => ({
                                ...current,
                                serviceIds,
                              }))
                            }
                            onStatusChange={(serviceStatus) =>
                              setProblemForm((current) => ({
                                ...current,
                                serviceStatus,
                              }))
                            }
                            selectedIds={problemForm.serviceIds}
                            services={services}
                            status={problemForm.serviceStatus}
                            statusLabel="Betriebszustand der betroffenen Dienste"
                          />
                          <label>
                            Status
                            <select
                              disabled={controlsDisabled}
                              onChange={(event) =>
                                setProblemForm((current) => ({
                                  ...current,
                                  status: event.target
                                    .value as EditableProblemStatus,
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
                              disabled={
                                controlsDisabled || problemOwnersLoading
                              }
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
                                  ? "Agent:innen werden geladen …"
                                  : "Nicht zugewiesen"}
                              </option>
                              {problemForm.ownerId &&
                              !problemOwnerNames.has(problemForm.ownerId) ? (
                                <option value={problemForm.ownerId}>
                                  Keine aktive Agent:in
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
                            Fälle können nur aktiven Agent:innen zugewiesen
                            werden. Eine bisherige verantwortliche Person ohne
                            Agentenzugriff kann entfernt oder durch eine
                            Agent:in ersetzt werden.
                          </p>
                        </>
                      ) : (
                        <p>
                          {tn(
                            "Beim Speichern wird dieser Fall als gelöst markiert. Gelöste Fälle findest du über den Statusfilter «Gelöst».",
                            "Beim Speichern wird dieser Fall als gelöst markiert. Gelöste Fälle finden Sie über den Statusfilter «Gelöst».",
                          )}
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
                        <ProblemAnalysis
                          disabled={controlsDisabled}
                          problemId={problemForm.id}
                          tenantId={tenantId}
                        />
                      ) : null}
                      {problemMode !== "resolve" || problemForm.id ? (
                        <section aria-labelledby="service-assets-problem-tickets-title">
                          <h4 id="service-assets-problem-tickets-title">
                            Ticketanhänge
                          </h4>
                          {problemTicketsLoading ? (
                            <p aria-live="polite">
                              Verknüpfte Tickets werden geladen …
                            </p>
                          ) : problemTickets.length === 0 ? (
                            <p>
                              {problemForm.id
                                ? "Noch keine Tickets angehängt."
                                : tn(
                                    "Suche Tickets, die zu diesem Fall gehören. Diese werden beim Anlegen angehängt.",
                                    "Suchen Sie Tickets, die zu diesem Fall gehören. Sie werden beim Anlegen angehängt.",
                                  )}
                            </p>
                          ) : (
                            <ul aria-label="Verknüpfte Tickets">
                              {problemTickets.map((ticket) => (
                                <li key={ticket.id}>
                                  <strong>{ticket.ticketNumber}</strong> ·{" "}
                                  {ticket.subject} · {ticket.statusLabel}{" "}
                                  <button
                                    disabled={controlsDisabled}
                                    onClick={() =>
                                      void unlinkTicketFromProblem(ticket)
                                    }
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
                                if (event.key === "Enter")
                                  event.preventDefault();
                              }}
                              placeholder="Ticketnummer oder Betreff"
                              type="search"
                              value={ticketSearchQuery}
                            />
                          </label>
                          <p id="service-assets-ticket-search-help">
                            {tn(
                              "Gib mindestens zwei Zeichen ein.",
                              "Geben Sie mindestens zwei Zeichen ein.",
                            )}
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
                                    onClick={() =>
                                      void linkTicketToProblem(ticket)
                                    }
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
                      {problemMode === "resolve" &&
                      problemForm.serviceIds.length > 0 ? (
                        <fieldset className="service-assets__ticket-follow-up">
                          <legend>Betroffene Dienste</legend>
                          <p className="data-caption">
                            {services
                              .filter((service) =>
                                problemForm.serviceIds.includes(service.id),
                              )
                              .map(
                                (service) =>
                                  `${service.name} (${SERVICE_STATUS_LABELS[service.status]})`,
                              )
                              .join(" · ")}
                          </p>
                          <label className="service-assets__checkbox">
                            <input
                              checked={
                                problemForm.serviceStatus === "operational"
                              }
                              disabled={controlsDisabled}
                              onChange={(event) =>
                                setProblemForm((current) => ({
                                  ...current,
                                  serviceStatus: event.target.checked
                                    ? "operational"
                                    : "",
                                }))
                              }
                              type="checkbox"
                            />
                            Betroffene Dienste auf «Betriebsbereit» setzen
                            (Systemstatus)
                          </label>
                        </fieldset>
                      ) : null}
                      {problemMode === "resolve" ? (
                        <fieldset className="service-assets__ticket-follow-up">
                          <legend>Wissensartikel</legend>
                          <label className="service-assets__checkbox">
                            <input
                              checked={caseArticle.create}
                              disabled={controlsDisabled}
                              onChange={(event) => {
                                const create = event.target.checked;
                                setCaseArticle((current) => ({
                                  ...current,
                                  create,
                                  title:
                                    create && !current.title.trim()
                                      ? problemForm.title
                                      : current.title,
                                }));
                              }}
                              type="checkbox"
                            />
                            Aus diesem Fall einen Wissensartikel erstellen
                          </label>
                          {caseArticle.create ? (
                            <>
                              <label>
                                Titel des Artikels
                                <input
                                  disabled={controlsDisabled}
                                  maxLength={240}
                                  minLength={3}
                                  onChange={(event) =>
                                    setCaseArticle((current) => ({
                                      ...current,
                                      title: event.target.value,
                                    }))
                                  }
                                  required
                                  value={caseArticle.title}
                                />
                              </label>
                              <label>
                                Sichtbarkeit
                                <select
                                  disabled={controlsDisabled}
                                  onChange={(event) =>
                                    setCaseArticle((current) => ({
                                      ...current,
                                      visibility: event.target.value as
                                        "internal" | "external",
                                    }))
                                  }
                                  value={caseArticle.visibility}
                                >
                                  <option value="internal">Intern</option>
                                  <option value="external">Extern</option>
                                </select>
                              </label>
                              <p className="data-caption">
                                {tn(
                                  "Der Artikel wird aus Beschreibung, Workaround und Ursache als Entwurf angelegt. Du kannst ihn danach in der Wissensdatenbank überarbeiten und freigeben.",
                                  "Der Artikel wird aus Beschreibung, Workaround und Ursache als Entwurf angelegt. Sie können ihn danach in der Wissensdatenbank überarbeiten und freigeben.",
                                )}
                              </p>
                            </>
                          ) : null}
                        </fieldset>
                      ) : null}
                      {problemMode === "resolve" &&
                      problemTickets.length > 0 ? (
                        <fieldset className="service-assets__ticket-follow-up">
                          <legend>
                            Angehängte Tickets ({problemTickets.length}) nach
                            dem Lösen
                          </legend>
                          <label className="service-assets__checkbox">
                            <input
                              checked={ticketFollowUp.notify}
                              disabled={controlsDisabled}
                              onChange={(event) => {
                                const notify = event.target.checked;
                                setTicketFollowUp((current) => ({
                                  ...current,
                                  notify,
                                  message:
                                    notify && !current.message.trim()
                                      ? defaultTicketFollowUpMessage(
                                          problemForm.title,
                                          problemForm.workaround,
                                        )
                                      : current.message,
                                }));
                              }}
                              type="checkbox"
                            />
                            Antwort an alle angehängten Tickets senden
                          </label>
                          {ticketFollowUp.notify ? (
                            <label>
                              Antwort an die anfragenden Personen
                              <textarea
                                disabled={controlsDisabled}
                                maxLength={50000}
                                onChange={(event) =>
                                  setTicketFollowUp((current) => ({
                                    ...current,
                                    message: event.target.value,
                                  }))
                                }
                                rows={5}
                                value={ticketFollowUp.message}
                              />
                            </label>
                          ) : null}
                          <label className="service-assets__checkbox">
                            <input
                              checked={ticketFollowUp.resolve}
                              disabled={controlsDisabled}
                              onChange={(event) =>
                                setTicketFollowUp((current) => ({
                                  ...current,
                                  resolve: event.target.checked,
                                }))
                              }
                              type="checkbox"
                            />
                            Alle angehängten Tickets auf «Gelöst» setzen
                          </label>
                          <p className="data-caption">
                            Beides lässt sich kombinieren. Tickets ohne
                            zugewiesene Agent:in oder mit fehlenden
                            Pflichtangaben können nicht gelöst werden; sie
                            werden nach dem Speichern aufgelistet.
                          </p>
                        </fieldset>
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
                                ? ticketFollowUp.notify ||
                                  ticketFollowUp.resolve
                                  ? "Fall lösen und Tickets bearbeiten"
                                  : "Fall lösen"
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
                </div>,
                document.body,
              )
            : null}
        </section>
      ) : null}
    </section>
  );
}
