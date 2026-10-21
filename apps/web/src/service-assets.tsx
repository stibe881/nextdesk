import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
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
};

export type CatalogTab = "services" | "assets" | "problems";
type Criticality = "low" | "medium" | "high" | "critical";
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

type ServiceForm = {
  id: string | null;
  name: string;
  description: string;
  criticality: Criticality;
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

type CatalogRequest = { type: "listCatalog"; tenantId: string };
type ProblemOwnersRequest = { type: "listProblemOwners"; tenantId: string };
type ServiceSaveRequest = {
  type: "manageService";
  tenantId: string;
  operation: "create" | "update";
  name: string;
  description: string | null;
  criticality: Criticality;
  active: boolean;
  serviceId?: string;
};
type ServiceArchiveRequest = {
  type: "manageService";
  tenantId: string;
  operation: "archive";
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
  | ServiceSaveRequest
  | ServiceArchiveRequest
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

function isCriticality(value: unknown): value is Criticality {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "critical"
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
  if (
    typeof value.id !== "string" ||
    typeof value.tenant_id !== "string" ||
    typeof value.name !== "string" ||
    !isNullableString(value.description) ||
    !isCriticality(value.criticality) ||
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

function parseCatalog(value: unknown): {
  services: Service[];
  assets: Asset[];
  problems: Problem[];
} {
  const data = responseData(value);
  if (
    !Array.isArray(data.services) ||
    !Array.isArray(data.assets) ||
    !Array.isArray(data.problems)
  ) {
    throw new Error("Der Katalog ist unvollständig.");
  }

  const services = data.services.map(parseService);
  const assets = data.assets.map(parseAsset);
  const problems = data.problems.map(parseProblem);
  if (
    services.some((item) => item === null) ||
    assets.some((item) => item === null) ||
    problems.some((item) => item === null)
  ) {
    throw new Error("Der Katalog enthält ungültige Einträge.");
  }

  return {
    services: services as Service[],
    assets: assets as Asset[],
    problems: problems as Problem[],
  };
}

function parseSavedService(value: unknown): Service {
  const service = parseService(responseData(value).service);
  if (!service) throw new Error("Der gespeicherte Service ist unvollständig.");
  return service;
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
}: ServiceAssetsProps) {
  const [activeTab, setActiveTab] = useState<CatalogTab>(
    fixedTab ??
      (allowAssets || initialTab !== "assets" ? initialTab : "services"),
  );
  const [services, setServices] = useState<Service[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [serviceForm, setServiceForm] =
    useState<ServiceForm>(EMPTY_SERVICE_FORM);
  const [assetForm, setAssetForm] = useState<AssetForm>(EMPTY_ASSET_FORM);
  const [problemForm, setProblemForm] =
    useState<ProblemForm>(EMPTY_PROBLEM_FORM);
  const [problemMode, setProblemMode] = useState<ProblemFormMode>("create");
  const [assetEditorOpen, setAssetEditorOpen] = useState(false);
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
  const problemOwnersRequestVersion = useRef(0);
  const problemTicketsRequestVersion = useRef(0);
  const ticketSearchRequestVersion = useRef(0);
  const lastProblemCreateRequestId = useRef<number | undefined>(undefined);
  const assetEditorRef = useRef<HTMLElement | null>(null);
  const assetNameInputRef = useRef<HTMLInputElement | null>(null);
  const assetEditorTriggerRef = useRef<HTMLElement | null>(null);
  const assetCreateButtonRef = useRef<HTMLButtonElement | null>(null);

  const serviceNames = useMemo(
    () => new Map(services.map((service) => [service.id, service.name])),
    [services],
  );
  const problemOwnerNames = useMemo(
    () => new Map(problemOwners.map((owner) => [owner.id, owner.displayName])),
    [problemOwners],
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
          contains([service.name, service.description], serviceQuery) &&
          (serviceCriticality === "all" ||
            service.criticality === serviceCriticality),
      ),
    [serviceCriticality, serviceQuery, services],
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
        await requestServiceAssets({ type: "listCatalog", tenantId }),
      );
      if (requestVersion.current !== version) return;
      setServices(sortByName(catalog.services));
      setAssets(sortByName(catalog.assets));
      setProblems(sortProblems(catalog.problems));
    } catch (nextError) {
      if (requestVersion.current !== version) return;
      setServices([]);
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
  }, [tenantId]);

  useEffect(() => {
    void loadCatalog();
    return () => {
      requestVersion.current += 1;
    };
  }, [loadCatalog]);

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
    setAssetForm(EMPTY_ASSET_FORM);
    setAssetEditorOpen(false);
    assetEditorTriggerRef.current = null;
    setProblemForm(EMPTY_PROBLEM_FORM);
    setProblemMode("create");
    clearProblemTicketState();
    setProblemOwners([]);
    setSuccess("");
  }, [tenantId]);

  useEffect(() => {
    if (!assetEditorOpen) return;
    const focusTimer = window.setTimeout(() => {
      assetNameInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [assetEditorOpen]);

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
    setError("");
    setSuccess("");
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
        active: true,
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

  async function archiveService(service: Service) {
    if (!window.confirm(`Service „${service.name}“ archivieren?`)) return;
    beginAction(`service:archive:${service.id}`);
    try {
      parseSavedService(
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
      if (assetForm.serviceId === service.id) {
        setAssetForm((current) => ({ ...current, serviceId: "" }));
      }
      if (serviceForm.id === service.id) resetServiceForm();
      setSuccess(`Der Service „${service.name}“ wurde archiviert.`);
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
        <button
          className="secondary-button"
          disabled={controlsDisabled}
          onClick={() => void loadCatalog()}
          type="button"
        >
          {loading ? "Wird geladen …" : "Aktualisieren"}
        </button>
      </div>

      {error ? (
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
          </div>
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

          {services.length === 0 ? (
            <p className="empty-state">
              Für diesen Mandanten sind noch keine aktiven Services vorhanden.
              Legen Sie unten den ersten Service an.
            </p>
          ) : filteredServices.length === 0 ? (
            <p className="empty-state">
              Keine Services entsprechen dem Filter.
            </p>
          ) : (
            <ul aria-label="Aktive Services">
              {filteredServices.map((service) => (
                <li key={service.id}>
                  <article>
                    <h4>{service.name}</h4>
                    <p>
                      <strong>{CRITICALITY_LABELS[service.criticality]}</strong>
                      {service.description ? ` · ${service.description}` : ""}
                    </p>
                    <p>Zuletzt geändert: {formatDate(service.updated_at)}</p>
                    <button
                      disabled={controlsDisabled}
                      onClick={() => {
                        setServiceForm(serviceDraft(service));
                        setError("");
                        setSuccess("");
                      }}
                      type="button"
                    >
                      Bearbeiten
                    </button>{" "}
                    <button
                      disabled={controlsDisabled}
                      onClick={() => void archiveService(service)}
                      type="button"
                    >
                      {pendingAction === `service:archive:${service.id}`
                        ? "Wird archiviert …"
                        : "Archivieren"}
                    </button>
                  </article>
                </li>
              ))}
            </ul>
          )}

          <section
            aria-labelledby="service-assets-service-form-title"
            className="panel"
          >
            <div className="panel-heading">
              <div>
                <p className="eyebrow">
                  {serviceForm.id ? "Service bearbeiten" : "Neuer Service"}
                </p>
                <h3 id="service-assets-service-form-title">
                  {serviceForm.id ? "Service aktualisieren" : "Service anlegen"}
                </h3>
              </div>
            </div>
            <form onSubmit={(event) => void saveService(event)}>
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
                {serviceForm.id ? (
                  <button
                    disabled={controlsDisabled}
                    onClick={resetServiceForm}
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

      {!loading && !forbidden && allowAssets && activeTab === "assets" ? (
        <section
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
                    <p>
                      Service:{" "}
                      {asset.service_id
                        ? (serviceNames.get(asset.service_id) ??
                          "Nicht im aktiven Katalog")
                        : "Nicht zugeordnet"}
                    </p>
                    <p>
                      Primäre Person (Intune):{" "}
                      {asset.intune_primary_person_name ?? "Nicht zugeordnet"}
                    </p>
                    <p>
                      <code>{metadataPreview(asset.metadata)}</code>
                    </p>
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
                      <p>
                        <strong>Primäre Person (Intune):</strong>{" "}
                        {editedAssetPrimaryPerson ?? "Nicht zugeordnet"}
                        <br />
                        <small>
                          Diese Angabe wird beim bewussten Intune-Abgleich aus
                          dem lokal verifizierten Entra-Verzeichnis übernommen
                          und kann hier nicht manuell geändert werden.
                        </small>
                      </p>
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
                      <label>
                        Kundenorganisation-ID (optional)
                        <input
                          disabled={controlsDisabled}
                          onChange={(event) =>
                            setAssetForm((current) => ({
                              ...current,
                              customerOrganizationId: event.target.value,
                            }))
                          }
                          placeholder="UUID"
                          value={assetForm.customerOrganizationId}
                        />
                      </label>
                      <label>
                        Metadaten (JSON-Objekt)
                        <textarea
                          aria-describedby="service-assets-metadata-help"
                          disabled={controlsDisabled}
                          onChange={(event) =>
                            setAssetForm((current) => ({
                              ...current,
                              metadata: event.target.value,
                            }))
                          }
                          rows={5}
                          spellCheck={false}
                          value={assetForm.metadata}
                        />
                      </label>
                      <p id="service-assets-metadata-help">
                        Erlaubt ist ein JSON-Objekt, zum Beispiel {"{"}
                        "standort":"Zürich"{"}"}.
                      </p>
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
