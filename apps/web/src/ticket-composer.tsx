import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Plus,
  Users,
  X,
} from "lucide-react";
import { supabase } from "./lib/supabase";
import { TicketAssetPicker, type PickedAsset } from "./ticket-asset-picker";
import {
  appendAnswersToDescription,
  parseCondition,
  parseTemplateFormField,
  sanitizeAnswers,
  validateAnswers,
  type FormAnswers,
  type TemplateCondition,
  type TemplateFormField,
} from "./lib/ticket-template-form";
import { TicketTemplateFormFields } from "./ticket-template-form-fields";
import {
  clearTicketComposerDraft,
  readTicketComposerDraft,
  writeTicketComposerDraft,
  type TicketComposerDraft,
} from "./lib/ticket-composer-draft";
import {
  ClassificationSuggestion,
  TicketSuggestionPanel,
  useTicketSuggestions,
  type ArticleChoice,
} from "./ticket-suggestions";

type Department = { id: string; key: string; name: string; kind: string };
type Priority = { key: string; label: string; sort_order: number };
type RequesterContact = { id: string; displayName: string };
type RequesterDraft = { name: string; email: string };
type RequesterLookup = {
  tenantId: string;
  query: string;
  status: "loading" | "loaded" | "error";
  requesters: RequesterContact[];
  error: string;
};
type ActiveTenantPerson = { id: string; displayName: string };
type WatcherLookup = {
  status: "loading" | "ready";
  tenantId: string;
  ticketId: string;
};
type RequesterContext = {
  isInternal: boolean;
  departmentId?: string;
  departmentName?: string;
};
type AssignableAgent = { id: string; displayName: string | null };
type TicketCategory = { id: string; name: string; parentId: string | null };
type CategoryLookup = {
  tenantId: string;
  departmentId: string;
  status: "loading" | "loaded" | "error";
  categories: TicketCategory[];
  error: string;
};
type CategoryDraft = { name: string; parentId: string | null };
type AvailableTicketTemplate = {
  id: string;
  name: string;
  subjectTemplate: string;
  descriptionTemplate: string;
  priorityKey: string | null;
  checklistItems: Array<{
    description: string;
    position: number;
    condition: TemplateCondition | null;
  }>;
  formFields: TemplateFormField[];
};
type TemplateFormState = {
  templateId: string;
  answers: FormAnswers;
  errors: Record<string, string>;
};
type PortalIncidentNotice = {
  categoryId: string | null;
  departmentId: string | null;
  description: string;
  id: string;
  title: string;
};
type SlaExpectation = {
  message: string;
  resolutionDueAt: string | null;
  responseDueAt: string | null;
};
type FieldErrors = {
  description?: string;
  subject?: string;
};
type TemplateLookup = {
  tenantId: string;
  departmentId: string;
  status: "loading" | "loaded" | "error";
  templates: AvailableTicketTemplate[];
  error: string;
};

type OptionsResponse = {
  departments: Department[];
  priorities: Priority[];
  currentRequester: RequesterContact | null;
  requesterContext: RequesterContext;
};

const EMPTY_OPTIONS: OptionsResponse = {
  departments: [],
  priorities: [],
  currentRequester: null,
  requesterContext: { isInternal: false },
};
const SAFE_TEMPLATE_PLACEHOLDER =
  /\{\{(anfragende_person|abteilung|heute|ticket_nummer)\}\}/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Boolean(value.trim()) &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

function hasOnlySafeTemplatePlaceholders(value: string): boolean {
  return !/[{}]/.test(value.replace(SAFE_TEMPLATE_PLACEHOLDER, ""));
}

function parseRequester(value: unknown): RequesterContact {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isNonemptyString(value.displayName) ||
    Array.from(value.displayName.trim()).length < 2 ||
    Array.from(value.displayName.trim()).length > 160 ||
    value.displayName.includes("@") ||
    isUuid(value.displayName.trim())
  ) {
    throw new Error("Die Daten zur anfragenden Person sind ungültig.");
  }
  // Only retain the name and the opaque contact reference, never directory emails.
  return { id: value.id, displayName: value.displayName.trim() };
}

function parseRequesters(value: unknown): RequesterContact[] {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.requesters) ||
    value.data.requesters.length > 30
  ) {
    throw new Error("Die Antwort zur Personensuche ist ungültig.");
  }
  const requesters = value.data.requesters.map(parseRequester);
  if (
    new Set(requesters.map((requester) => requester.id)).size !==
    requesters.length
  ) {
    throw new Error("Die Personensuche enthält doppelte Einträge.");
  }
  return requesters;
}

function parseColleagues(value: unknown): ActiveTenantPerson[] {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.people) ||
    value.data.people.length > 20
  ) {
    throw new Error("Die Personenliste ist ungültig.");
  }
  return value.data.people.map((entry) => {
    if (
      !isRecord(entry) ||
      !isUuid(entry.userId) ||
      !isNonemptyString(entry.displayName) ||
      Array.from(entry.displayName.trim()).length > 160
    ) {
      throw new Error("Die Personenliste enthält ungültige Daten.");
    }
    return { id: entry.userId, displayName: entry.displayName.trim() };
  });
}

function parseAddedWatcher(value: unknown): { userId: string } {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !isRecord(value.data.watcher) ||
    !isUuid(value.data.watcher.userId) ||
    (value.data.watcher.createdAt !== null &&
      typeof value.data.watcher.createdAt !== "string")
  ) {
    throw new Error("Die Bestätigung zur Kopie fehlt.");
  }
  return { userId: value.data.watcher.userId };
}

function functionErrorStatus(value: unknown): number | null {
  if (!isRecord(value)) return null;
  if (typeof value.status === "number") return value.status;
  return value.context instanceof Response ? value.context.status : null;
}

function isQuietWatcherUnavailable(value: unknown): boolean {
  const status = functionErrorStatus(value);
  return status === null || [401, 403, 404].includes(status);
}

function parseCreatedRequester(value: unknown): RequesterContact {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("Die Bestätigung zur anfragenden Person fehlt.");
  }
  return parseRequester(
    "requester" in value.data ? value.data.requester : value.data,
  );
}

function isPermissionDenied(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.context instanceof Response &&
    value.context.status === 403
  );
}

async function requesterErrorMessage(
  value: unknown,
  fallback: string,
): Promise<string> {
  let response: unknown = value;
  if (isRecord(value) && value.context instanceof Response) {
    try {
      response = await value.context.clone().json();
    } catch {
      return fallback;
    }
  }
  if (
    !isRecord(response) ||
    !isRecord(response.error) ||
    typeof response.error.code !== "string"
  )
    return fallback;
  // Backend text is never rendered. Only known codes select our own messages.
  switch (response.error.code) {
    case "invalid_requester_query":
      return "Bitte geben Sie einen Suchbegriff mit 2 bis 120 gültigen Zeichen ein.";
    case "invalid_requester_name":
      return "Bitte geben Sie einen Namen mit 2 bis 160 gültigen Zeichen ein.";
    case "invalid_requester_email":
      return "Bitte geben Sie eine gültige E-Mail-Adresse ein oder lassen Sie das Feld leer.";
    case "invalid_requester_contact":
      return "Die ausgewählte anfragende Person ist nicht mehr gültig. Bitte wählen Sie eine Person erneut aus.";
    case "requester_selection_denied":
      return "Für die gewählte Abteilung dürfen Sie kein Ticket für eine andere Person erstellen. Wählen Sie Ihre eigene Person oder eine Abteilung, für die Sie berechtigt sind.";
    case "requester_permission_check_failed":
      return "Die Berechtigung für die anfragende Person konnte nicht geprüft werden. Bitte versuchen Sie es später erneut.";
    default:
      return fallback;
  }
}

function parseFormOptions(value: unknown): OptionsResponse {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("Ticketoptionen fehlen.");
  }
  const data = value.data;
  if (
    !Array.isArray(data.departments) ||
    !Array.isArray(data.priorities) ||
    !isRecord(data.requesterContext)
  ) {
    throw new Error("Ticketoptionen sind unvollständig.");
  }
  const currentRequester =
    data.currentRequester === undefined || data.currentRequester === null
      ? null
      : parseRequester(data.currentRequester);

  const { requesterContext } = data;
  if (
    typeof requesterContext.isInternal !== "boolean" ||
    (requesterContext.departmentId !== undefined &&
      !isUuid(requesterContext.departmentId)) ||
    (requesterContext.departmentName !== undefined &&
      !isNonemptyString(requesterContext.departmentName))
  ) {
    throw new Error("Der Anfragendenkontext ist ungültig.");
  }

  const departments: Department[] = [];
  for (const department of data.departments) {
    if (
      !isRecord(department) ||
      !isUuid(department.id) ||
      !isNonemptyString(department.key) ||
      !isNonemptyString(department.name) ||
      !isNonemptyString(department.kind) ||
      departments.some(
        (item) => item.id === department.id || item.key === department.key,
      )
    ) {
      throw new Error("Ticketoptionen enthalten ungültige Abteilungen.");
    }
    departments.push({
      id: department.id,
      key: department.key,
      name: department.name,
      kind: department.kind,
    });
  }

  const priorities: Priority[] = [];
  for (const priority of data.priorities) {
    if (
      !isRecord(priority) ||
      !isNonemptyString(priority.key) ||
      !isNonemptyString(priority.label) ||
      typeof priority.sort_order !== "number" ||
      !Number.isSafeInteger(priority.sort_order) ||
      priorities.some((item) => item.key === priority.key)
    ) {
      throw new Error("Ticketoptionen enthalten ungültige Prioritäten.");
    }
    priorities.push({
      key: priority.key,
      label: priority.label,
      sort_order: priority.sort_order,
    });
  }

  return {
    departments,
    priorities,
    currentRequester,
    requesterContext: {
      isInternal: requesterContext.isInternal,
      ...(typeof requesterContext.departmentId === "string"
        ? { departmentId: requesterContext.departmentId }
        : {}),
      ...(typeof requesterContext.departmentName === "string"
        ? { departmentName: requesterContext.departmentName }
        : {}),
    },
  };
}

function parseAssignableAgents(value: unknown): AssignableAgent[] {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.agents)
  ) {
    throw new Error("Zuweisbare Personen fehlen.");
  }

  const agents: AssignableAgent[] = [];
  for (const agent of value.data.agents) {
    if (
      !isRecord(agent) ||
      !isUuid(agent.id) ||
      (!isNonemptyString(agent.displayName) && agent.displayName !== null) ||
      agents.some((item) => item.id === agent.id)
    ) {
      throw new Error("Zuweisbare Personen enthalten ungültige Daten.");
    }
    agents.push({ id: agent.id, displayName: agent.displayName });
  }
  return agents;
}

function parseCategory(value: unknown): TicketCategory {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isNonemptyString(value.name) ||
    (value.parentId !== null && !isUuid(value.parentId)) ||
    value.parentId === value.id
  ) {
    throw new Error("Die Kategoriedaten sind ungültig.");
  }
  return {
    id: value.id,
    name: value.name.trim(),
    parentId: typeof value.parentId === "string" ? value.parentId : null,
  };
}

function parseCategories(value: unknown): TicketCategory[] {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.categories)
  ) {
    throw new Error("Die Kategorien fehlen in der Antwort.");
  }
  const categories = value.data.categories.map(parseCategory);
  const byId = new Map(categories.map((category) => [category.id, category]));
  if (
    byId.size !== categories.length ||
    categories.some(
      (category) =>
        category.parentId !== null &&
        byId.get(category.parentId)?.parentId !== null,
    )
  ) {
    throw new Error("Die Zuordnung der Kategorien ist ungültig.");
  }
  return categories;
}

function parseAvailableTicketTemplate(value: unknown): AvailableTicketTemplate {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isNonemptyString(value.name) ||
    !isNonemptyString(value.subjectTemplate) ||
    !isNonemptyString(value.descriptionTemplate) ||
    (value.priorityKey !== null && !isNonemptyString(value.priorityKey)) ||
    !Array.isArray(value.checklistItems) ||
    !hasOnlySafeTemplatePlaceholders(value.subjectTemplate) ||
    !hasOnlySafeTemplatePlaceholders(value.descriptionTemplate)
  ) {
    throw new Error("Die Ticketvorlage ist ungültig.");
  }
  const checklistItems = value.checklistItems.map((item) => {
    const condition = isRecord(item) ? parseCondition(item.condition) : null;
    if (
      !isRecord(item) ||
      !isNonemptyString(item.description) ||
      item.description.length > 1000 ||
      typeof item.position !== "number" ||
      !Number.isSafeInteger(item.position) ||
      condition === undefined
    ) {
      throw new Error("Die Checkliste der Ticketvorlage ist ungültig.");
    }
    return {
      description: item.description,
      position: item.position,
      condition,
    };
  });
  const formFields = (
    Array.isArray(value.formFields) ? value.formFields : []
  ).map((field, index) => {
    const parsed = parseTemplateFormField(field, index);
    if (!parsed)
      throw new Error("Die Formularfelder der Vorlage sind ungültig.");
    return parsed;
  });
  return {
    id: value.id,
    name: value.name.trim(),
    subjectTemplate: value.subjectTemplate,
    descriptionTemplate: value.descriptionTemplate,
    priorityKey:
      typeof value.priorityKey === "string" ? value.priorityKey : null,
    checklistItems,
    formFields,
  };
}

function parseAvailableTicketTemplates(
  value: unknown,
): AvailableTicketTemplate[] {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.templates) ||
    value.data.templates.length > 100
  ) {
    throw new Error("Die Ticketvorlagen fehlen in der Antwort.");
  }
  const templates = value.data.templates.map(parseAvailableTicketTemplate);
  if (
    new Set(templates.map((template) => template.id)).size !== templates.length
  ) {
    throw new Error("Die Ticketvorlagen enthalten doppelte Einträge.");
  }
  return templates;
}

function templatePreview(
  template: AvailableTicketTemplate,
  requesterName: string,
  departmentName: string,
): { subject: string; description: string } {
  const replacements: Record<string, string> = {
    anfragende_person: requesterName,
    abteilung: departmentName,
    heute: new Intl.DateTimeFormat("de-CH", {
      dateStyle: "short",
      timeZone: "Europe/Zurich",
    }).format(new Date()),
    ticket_nummer: "wird beim Erstellen vergeben",
  };
  const render = (value: string) =>
    value.replace(
      SAFE_TEMPLATE_PLACEHOLDER,
      (_match, key: string) => replacements[key] ?? "",
    );
  return {
    subject: render(template.subjectTemplate),
    description: render(template.descriptionTemplate),
  };
}

function parseCreatedCategory(
  value: unknown,
  parentId: string | null,
): TicketCategory {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("Die Bestätigung zur Kategorie fehlt.");
  }
  const category = parseCategory(
    "category" in value.data ? value.data.category : value.data,
  );
  if (category.parentId !== parentId) {
    throw new Error("Die erstellte Kategorie hat eine ungültige Zuordnung.");
  }
  return category;
}

function parseCreatedTicket(value: unknown): {
  ticketId: string;
  ticketNumber: string;
} {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !isUuid(value.data.ticketId) ||
    !isNonemptyString(value.data.ticketNumber)
  ) {
    throw new Error("Die Bestätigung zum Ticket fehlt.");
  }
  return {
    ticketId: value.data.ticketId,
    ticketNumber: value.data.ticketNumber,
  };
}

function parsePortalIncidentNotices(value: unknown): PortalIncidentNotice[] {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.notices)
  ) {
    throw new Error("Störungsmeldungen fehlen.");
  }
  const notices: PortalIncidentNotice[] = [];
  for (const notice of value.data.notices) {
    if (
      !isRecord(notice) ||
      !isUuid(notice.id) ||
      !isNonemptyString(notice.title) ||
      !isNonemptyString(notice.description) ||
      (notice.category_id !== null && !isUuid(notice.category_id)) ||
      (notice.department_id !== null && !isUuid(notice.department_id))
    ) {
      throw new Error("Störungsmeldungen enthalten ungültige Daten.");
    }
    notices.push({
      categoryId: notice.category_id,
      departmentId: notice.department_id,
      description: notice.description.trim(),
      id: notice.id,
      title: notice.title.trim(),
    });
  }
  return notices;
}

function parseSlaExpectation(value: unknown): SlaExpectation {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !isRecord(value.data.expectation) ||
    !isNonemptyString(value.data.expectation.message) ||
    (value.data.expectation.responseDueAt !== null &&
      typeof value.data.expectation.responseDueAt !== "string") ||
    (value.data.expectation.resolutionDueAt !== null &&
      typeof value.data.expectation.resolutionDueAt !== "string")
  ) {
    throw new Error("Die SLA-Erwartung ist ungültig.");
  }
  return {
    message: value.data.expectation.message.trim(),
    resolutionDueAt: value.data.expectation.resolutionDueAt,
    responseDueAt: value.data.expectation.responseDueAt,
  };
}

function localSlaDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

const NEW_CATEGORY_OPTION = "__new__";

function knowledgeArticleLink(articleId: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("wissen", articleId);
  return url.toString();
}

export function TicketComposer({
  currentUserId,
  tenantId,
  onCreated,
  onOpenKnowledgeArticle,
  onOpenTicket,
}: {
  currentUserId: string | null;
  tenantId: string;
  onCreated: (ticketId: string, ticketNumber: string) => void;
  /**
   * Opens an article in the knowledge base (closes the composer). The draft
   * is kept in sessionStorage first; `draftKept` says whether there was one.
   */
  onOpenKnowledgeArticle?:
    ((articleId: string, draftKept: boolean) => void) | undefined;
  /** Opens an existing ticket (closes the composer, keeps the draft). */
  onOpenTicket?:
    | ((ticketId: string, ticketNumber: string, draftKept: boolean) => void)
    | undefined;
}) {
  const [options, setOptions] = useState<OptionsResponse>(EMPTY_OPTIONS);
  const [optionsTenantId, setOptionsTenantId] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState("");
  const [pickedAssets, setPickedAssets] = useState<PickedAsset[]>([]);
  // Chosen suggested articles, kept even if the suggestions change.
  const [articleChoices, setArticleChoices] = useState<
    Record<string, { choice: ArticleChoice; title: string }>
  >({});
  const [selectedRequester, setSelectedRequester] =
    useState<RequesterContact | null>(null);
  const [requesterManagement, setRequesterManagement] = useState<{
    tenantId: string;
    allowed: boolean;
    error: string;
  } | null>(null);
  const [requesterPermissionRetry, setRequesterPermissionRetry] = useState(0);
  const [requesterQuery, setRequesterQuery] = useState("");
  const [requesterLookup, setRequesterLookup] =
    useState<RequesterLookup | null>(null);
  const [requesterDraft, setRequesterDraft] = useState<RequesterDraft | null>(
    null,
  );
  const [requesterSaving, setRequesterSaving] = useState(false);
  const [requesterError, setRequesterError] = useState("");
  const [assignableAgents, setAssignableAgents] = useState<AssignableAgent[]>(
    [],
  );
  const [assignedAgentId, setAssignedAgentId] = useState("");
  const [agentLookupAllowed, setAgentLookupAllowed] = useState(false);
  const [categoryLookup, setCategoryLookup] = useState<CategoryLookup | null>(
    null,
  );
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(
    null,
  );
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryError, setCategoryError] = useState("");
  const [templateLookup, setTemplateLookup] = useState<TemplateLookup | null>(
    null,
  );
  const [templateId, setTemplateId] = useState("");
  const [templateFormState, setTemplateFormState] = useState<TemplateFormState>(
    { templateId: "", answers: {}, errors: {} },
  );
  const [priorityKey, setPriorityKey] = useState("normal");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [deflectionNotice, setDeflectionNotice] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  // Stored draft fields that wait for their options (department-dependent
  // categories, templates, agents, the requester permission) to load.
  const draftRestoreRef = useRef<TicketComposerDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    expectation: SlaExpectation | null;
    ticketId: string;
    ticketNumber: string;
  } | null>(null);
  useEffect(() => {
    if (!confirmation) return;
    const timer = window.setTimeout(() => setConfirmation(null), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmation]);
  const [watcherLookup, setWatcherLookup] = useState<WatcherLookup | null>(
    null,
  );
  const [watcherQuery, setWatcherQuery] = useState("");
  const [selectedWatchers, setSelectedWatchers] = useState<
    ActiveTenantPerson[]
  >([]);
  const [watcherResults, setWatcherResults] = useState<ActiveTenantPerson[]>(
    [],
  );
  const [watcherSearching, setWatcherSearching] = useState(false);
  const [watcherSaving, setWatcherSaving] = useState(false);
  const [watcherNotice, setWatcherNotice] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [incidentNotices, setIncidentNotices] = useState<
    PortalIncidentNotice[] | null
  >(null);
  const departmentSelectRef = useRef<HTMLSelectElement>(null);
  const categoryRequestRef = useRef(0);
  const templateRequestRef = useRef(0);
  const incidentRequestRef = useRef(0);
  const requesterScopeRef = useRef(0);
  const requesterSearchRef = useRef(0);
  const requesterCreationRef = useRef<number | null>(null);
  const watcherRequestRef = useRef(0);
  const watcherSearchRef = useRef(0);
  const formReady = !loading && optionsTenantId === tenantId;
  const currentRequesterManagement =
    formReady && requesterManagement?.tenantId === tenantId
      ? requesterManagement
      : null;
  const canManageRequesters = currentRequesterManagement?.allowed === true;
  const requesterFormOpen = requesterDraft !== null;
  const [requesterPickerOpen, setRequesterPickerOpen] = useState(false);
  const currentSelectedRequester = formReady ? selectedRequester : null;
  const currentRequesterLookup =
    canManageRequesters &&
    requesterLookup?.tenantId === tenantId &&
    requesterLookup.query === requesterQuery.trim()
      ? requesterLookup
      : null;

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    const storedDraft = readTicketComposerDraft(currentUserId, tenantId);
    draftRestoreRef.current = storedDraft;
    setDraftRestored(storedDraft !== null);
    setSubject(storedDraft?.subject ?? "");
    setDescription(storedDraft?.description ?? "");
    setLoading(true);
    setError("");
    setFieldErrors({});
    setSaving(false);
    setConfirmation(null);
    setOptions(EMPTY_OPTIONS);
    setOptionsTenantId(null);
    setDepartmentId("");
    setCategoryDraft(null);
    setTemplateLookup(null);
    setTemplateId("");
    setDeflectionNotice(false);
    setAssignableAgents([]);
    setAssignedAgentId("");
    setAgentLookupAllowed(false);
    void Promise.all([
      supabase.functions.invoke("ticket-actions", {
        body: { type: "getFormOptions", tenantId },
      }),
      supabase.functions.invoke("ticket-requesters", {
        body: { type: "getOwn", tenantId },
      }),
    ])
      .then(([formResponse, requesterResponse]) => {
        if (formResponse.error) throw formResponse.error;
        if (requesterResponse.error) throw requesterResponse.error;
        const parsedOptions = parseFormOptions(formResponse.data);
        const currentRequester = parseCreatedRequester(requesterResponse.data);
        if (!mounted) return;
        setOptions({ ...parsedOptions, currentRequester });
        setSelectedRequester(currentRequester);
        const contextDepartmentId = parsedOptions.requesterContext.departmentId;
        const restoredDepartmentId = draftRestoreRef.current?.departmentId;
        const restoredPriorityKey = draftRestoreRef.current?.priorityKey;
        if (
          restoredPriorityKey &&
          parsedOptions.priorities.some(
            (item) => item.key === restoredPriorityKey,
          )
        ) {
          setPriorityKey(restoredPriorityKey);
        } else {
          setPriorityKey(
            parsedOptions.priorities.some((item) => item.key === "normal")
              ? "normal"
              : (parsedOptions.priorities[0]?.key ?? ""),
          );
        }
        if (
          restoredDepartmentId &&
          parsedOptions.departments.some(
            (department) => department.id === restoredDepartmentId,
          )
        ) {
          setDepartmentId(restoredDepartmentId);
          return;
        }
        setDepartmentId(
          parsedOptions.requesterContext.isInternal &&
            contextDepartmentId &&
            parsedOptions.departments.some(
              (department) => department.id === contextDepartmentId,
            )
            ? contextDepartmentId
            : (parsedOptions.departments[0]?.id ?? ""),
        );
      })
      .catch(() => {
        if (mounted)
          setError("Die Erfassungsoptionen konnten nicht geladen werden.");
      })
      .finally(() => {
        if (mounted) {
          setOptionsTenantId(tenantId);
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [tenantId, currentUserId]);

  useEffect(() => {
    const requestId = ++watcherRequestRef.current;
    setWatcherLookup(null);
    setWatcherQuery("");
    setSelectedWatchers([]);
    setWatcherResults([]);
    setWatcherSaving(false);
    setWatcherNotice("");
    if (!supabase || !confirmation) return;
    const ticketId = confirmation.ticketId;
    setWatcherLookup({ status: "loading", tenantId, ticketId });
    // listTicketWatchers verifies on the server that the portal is enabled and
    // that the caller is the requester of this ticket before copy is offered.
    void supabase.functions
      .invoke("requester-portal", {
        body: { tenantId, ticketId, type: "listTicketWatchers" },
      })
      .then(({ data, error: requestError }) => {
        if (requestError) throw requestError;
        if (
          !isRecord(data) ||
          !isRecord(data.data) ||
          !Array.isArray(data.data.watchers)
        ) {
          throw new Error("invalid_watchers");
        }
        if (watcherRequestRef.current !== requestId) return;
        setWatcherLookup({ status: "ready", tenantId, ticketId });
      })
      .then(undefined, () => {
        // Copy is optional. Hide it quietly when it is not available.
        if (watcherRequestRef.current !== requestId) return;
        setWatcherLookup(null);
      });

    return () => {
      ++watcherRequestRef.current;
    };
  }, [confirmation?.ticketId, tenantId]);

  useEffect(() => {
    const requestId = ++watcherSearchRef.current;
    const query = watcherQuery.trim();
    const ready =
      watcherLookup?.status === "ready" && watcherLookup.tenantId === tenantId;
    if (!supabase || !ready || Array.from(query).length < 2) {
      setWatcherResults([]);
      setWatcherSearching(false);
      return;
    }
    const client = supabase;
    setWatcherSearching(true);
    const timer = window.setTimeout(() => {
      void client.functions
        .invoke("requester-portal", {
          body: { tenantId, type: "searchColleagues", query },
        })
        .then(({ data, error: requestError }) => {
          if (requestError) throw requestError;
          const people = parseColleagues(data);
          if (watcherSearchRef.current !== requestId) return;
          setWatcherResults(people);
          setWatcherSearching(false);
        })
        .then(undefined, () => {
          if (watcherSearchRef.current !== requestId) return;
          setWatcherResults([]);
          setWatcherSearching(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      ++watcherSearchRef.current;
    };
  }, [watcherLookup, watcherQuery, tenantId]);

  useEffect(() => {
    const requestId = ++incidentRequestRef.current;
    setIncidentNotices(null);
    if (!supabase) return;

    void supabase.functions
      .invoke("requester-portal", {
        body: { tenantId, type: "activeIncidentNotices" },
      })
      .then(({ data, error: requestError }) => {
        if (requestError) throw requestError;
        const notices = parsePortalIncidentNotices(data);
        if (incidentRequestRef.current === requestId)
          setIncidentNotices(notices);
      })
      .catch(() => {
        // A disabled requester portal or a transient error must not block ticket creation.
        if (incidentRequestRef.current === requestId) setIncidentNotices(null);
      });

    return () => {
      ++incidentRequestRef.current;
    };
  }, [tenantId]);

  useEffect(() => {
    const requestId = ++requesterScopeRef.current;
    ++requesterSearchRef.current;
    requesterCreationRef.current = null;
    setRequesterManagement(null);
    setRequesterQuery("");
    setRequesterLookup(null);
    setRequesterDraft(null);
    setRequesterSaving(false);
    setRequesterError("");
    if (!supabase || !formReady || !options.currentRequester) return;
    setSelectedRequester(options.currentRequester);

    // The API has no capability flag. Probe its permission-protected search with
    // the current name before showing management controls; SSO is not a right.
    const query = Array.from(options.currentRequester.displayName)
      .slice(0, 120)
      .join("");
    void supabase.functions
      .invoke("ticket-requesters", {
        body: { type: "search", tenantId, query },
      })
      .then(({ data, error: requestError }) => {
        if (requestError) throw requestError;
        parseRequesters(data);
        if (requesterScopeRef.current !== requestId) return;
        setRequesterManagement({ tenantId, allowed: true, error: "" });
        const restoredRequester = consumeDraftField("requester");
        if (restoredRequester) setSelectedRequester(restoredRequester);
      })
      .catch((requestError: unknown) => {
        if (requesterScopeRef.current !== requestId) return;
        consumeDraftField("requester");
        setRequesterManagement({
          tenantId,
          allowed: false,
          error: isPermissionDenied(requestError)
            ? ""
            : "Die Berechtigung zur Personenauswahl konnte nicht geprüft werden. Ihre eigene Person bleibt ausgewählt.",
        });
      });
    return () => {
      ++requesterScopeRef.current;
      ++requesterSearchRef.current;
      requesterCreationRef.current = null;
    };
  }, [tenantId, formReady, options.currentRequester, requesterPermissionRetry]);

  useEffect(() => {
    const requestId = ++requesterSearchRef.current;
    setRequesterLookup(null);
    const query = requesterQuery.trim();
    const queryLength = Array.from(query).length;
    if (
      !supabase ||
      !canManageRequesters ||
      requesterFormOpen ||
      queryLength < 2
    )
      return;
    if (queryLength > 120 || /[\u0000-\u001f\u007f]/u.test(query)) {
      setRequesterLookup({
        tenantId,
        query,
        status: "error",
        requesters: [],
        error:
          "Bitte geben Sie eine Suchanfrage mit 2 bis 120 gültigen Zeichen ein.",
      });
      return;
    }
    setRequesterLookup({
      tenantId,
      query,
      status: "loading",
      requesters: [],
      error: "",
    });
    const client = supabase;
    const timer = window.setTimeout(() => {
      void client.functions
        .invoke("ticket-requesters", {
          body: { type: "search", tenantId, query },
        })
        .then(({ data, error: requestError }) => {
          if (requestError) throw requestError;
          const requesters = parseRequesters(data);
          if (requesterSearchRef.current !== requestId) return;
          setRequesterLookup({
            tenantId,
            query,
            status: "loaded",
            requesters,
            error: "",
          });
        })
        .catch(async (requestError: unknown) => {
          if (requesterSearchRef.current !== requestId) return;
          if (isPermissionDenied(requestError)) {
            setRequesterManagement({
              tenantId,
              allowed: false,
              error: "",
            });
            setSelectedRequester(options.currentRequester);
            setRequesterQuery("");
            setRequesterError(
              "Sie sind nicht berechtigt, eine andere anfragende Person auszuwählen. Ihre eigene Person ist ausgewählt.",
            );
            return;
          }
          const message = await requesterErrorMessage(
            requestError,
            "Die Personensuche konnte nicht ausgeführt werden. Bitte ändern Sie die Suche oder versuchen Sie es später erneut.",
          );
          if (requesterSearchRef.current !== requestId) return;
          setRequesterLookup({
            tenantId,
            query,
            status: "error",
            requesters: [],
            error: message,
          });
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      ++requesterSearchRef.current;
    };
  }, [
    tenantId,
    canManageRequesters,
    requesterQuery,
    requesterFormOpen,
    options.currentRequester,
  ]);

  useEffect(() => {
    if (!supabase || !departmentId) return;
    let mounted = true;
    setAssignableAgents([]);
    setAssignedAgentId("");
    setAgentLookupAllowed(false);

    void supabase.functions
      .invoke("ticket-agent-assignment", {
        body: { type: "listForDepartment", tenantId, departmentId },
      })
      .then(({ data, error: requestError }) => {
        if (requestError) throw requestError;
        const agents = parseAssignableAgents(data);
        if (!mounted) return;
        setAssignableAgents(agents);
        setAgentLookupAllowed(true);
        const restoredAgentId = consumeDraftField(
          "assignedAgentId",
          departmentId,
        );
        if (
          restoredAgentId &&
          agents.some((agent) => agent.id === restoredAgentId)
        )
          setAssignedAgentId(restoredAgentId);
      })
      .catch(() => {
        if (!mounted) return;
        consumeDraftField("assignedAgentId", departmentId);
        setAssignableAgents([]);
        setAgentLookupAllowed(false);
      });

    return () => {
      mounted = false;
    };
  }, [departmentId, tenantId]);

  useEffect(() => {
    const requestId = ++categoryRequestRef.current;
    setCategoryLookup(null);
    setCategoryId("");
    setSubcategoryId("");
    setCategoryDraft(null);
    setCategorySaving(false);
    setCategoryError("");
    if (!supabase || loading || optionsTenantId !== tenantId || !departmentId)
      return;

    setCategoryLookup({
      tenantId,
      departmentId,
      status: "loading",
      categories: [],
      error: "",
    });
    void supabase.functions
      .invoke("ticket-actions", {
        body: { type: "getCategories", tenantId, departmentId },
      })
      .then(({ data, error: requestError }) => {
        if (requestError) throw requestError;
        const categories = parseCategories(data);
        if (categoryRequestRef.current !== requestId) return;
        setCategoryLookup({
          tenantId,
          departmentId,
          status: "loaded",
          categories,
          error: "",
        });
        const restoredSubcategoryId = consumeDraftField(
          "subcategoryId",
          departmentId,
        );
        const restoredCategoryId = consumeDraftField(
          "categoryId",
          departmentId,
        );
        if (
          restoredCategoryId &&
          categories.some(
            (category) =>
              category.id === restoredCategoryId && category.parentId === null,
          )
        ) {
          setCategoryId(restoredCategoryId);
          if (
            restoredSubcategoryId &&
            categories.some(
              (category) =>
                category.id === restoredSubcategoryId &&
                category.parentId === restoredCategoryId,
            )
          )
            setSubcategoryId(restoredSubcategoryId);
        }
      })
      .catch(() => {
        if (categoryRequestRef.current !== requestId) return;
        setCategoryLookup({
          tenantId,
          departmentId,
          status: "error",
          categories: [],
          error:
            "Die Kategorien konnten nicht geladen werden. Bitte versuchen Sie es später erneut.",
        });
      });

    return () => {
      // Also invalidate an in-flight category creation on scope changes/unmount.
      ++categoryRequestRef.current;
    };
  }, [departmentId, tenantId, loading, optionsTenantId]);

  useEffect(() => {
    const requestId = ++templateRequestRef.current;
    setTemplateLookup(null);
    setTemplateId("");
    if (!supabase || loading || optionsTenantId !== tenantId || !departmentId)
      return;

    setTemplateLookup({
      tenantId,
      departmentId,
      status: "loading",
      templates: [],
      error: "",
    });
    void supabase.functions
      .invoke("ticket-actions", {
        body: { type: "listAvailableTemplates", tenantId, departmentId },
      })
      .then(({ data, error: requestError }) => {
        if (requestError) throw requestError;
        const templates = parseAvailableTicketTemplates(data);
        if (templateRequestRef.current !== requestId) return;
        setTemplateLookup({
          tenantId,
          departmentId,
          status: "loaded",
          templates,
          error: "",
        });
        const restoredTemplateId = consumeDraftField(
          "templateId",
          departmentId,
        );
        if (
          restoredTemplateId &&
          templates.some((template) => template.id === restoredTemplateId)
        )
          setTemplateId(restoredTemplateId);
      })
      .catch(() => {
        if (templateRequestRef.current !== requestId) return;
        setTemplateLookup({
          tenantId,
          departmentId,
          status: "error",
          templates: [],
          error:
            "Die Ticketvorlagen konnten nicht geladen werden. Sie können das Ticket weiterhin ohne Vorlage erfassen.",
        });
      });

    return () => {
      ++templateRequestRef.current;
    };
  }, [departmentId, tenantId, loading, optionsTenantId]);

  /**
   * Takes a stored draft field once its options are loaded. Department
   * dependent fields only apply to the department they were chosen in.
   */
  function consumeDraftField<
    Field extends
      | "assignedAgentId"
      | "categoryId"
      | "subcategoryId"
      | "templateId"
      | "requester",
  >(field: Field, forDepartmentId?: string): TicketComposerDraft[Field] | null {
    const pending = draftRestoreRef.current;
    if (!pending) return null;
    if (
      forDepartmentId !== undefined &&
      pending.departmentId !== forDepartmentId
    )
      return null;
    const value = pending[field];
    draftRestoreRef.current = {
      ...pending,
      [field]: field === "requester" ? null : "",
    };
    return value || null;
  }

  function changeDepartment(nextDepartmentId: string) {
    setDepartmentId(nextDepartmentId);
    setAssignableAgents([]);
    setAssignedAgentId("");
    setAgentLookupAllowed(false);
    // Invalidate immediately, before the next effect runs.
    ++categoryRequestRef.current;
    setCategoryLookup(null);
    setCategoryId("");
    setSubcategoryId("");
    setCategoryDraft(null);
    setCategorySaving(false);
    setCategoryError("");
  }

  function selectRequester(requester: RequesterContact) {
    if (!canManageRequesters || saving || requesterSaving) return;
    ++requesterSearchRef.current;
    setSelectedRequester(requester);
    setRequesterQuery("");
    setRequesterLookup(null);
    setRequesterDraft(null);
    setRequesterError("");
    setError("");
  }

  function openRequesterForm() {
    if (!canManageRequesters || saving || requesterSaving) return;
    ++requesterSearchRef.current;
    setRequesterLookup(null);
    setRequesterDraft({ name: requesterQuery.trim(), email: "" });
    setRequesterQuery("");
    setRequesterError("");
  }

  async function createRequester() {
    if (
      !supabase ||
      !canManageRequesters ||
      !requesterDraft ||
      saving ||
      requesterSaving ||
      requesterCreationRef.current !== null
    )
      return;
    const displayName = requesterDraft.name.trim();
    const email = requesterDraft.email.trim();
    const nameLength = Array.from(displayName).length;
    if (
      nameLength < 2 ||
      nameLength > 160 ||
      /[\u0000-\u001f\u007f@]/u.test(displayName) ||
      isUuid(displayName)
    ) {
      setRequesterError(
        "Bitte geben Sie einen Namen mit 2 bis 160 Zeichen ein, keine E-Mail-Adresse oder ID.",
      );
      return;
    }
    if (
      email &&
      (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
    ) {
      setRequesterError(
        "Bitte geben Sie eine gültige E-Mail-Adresse ein oder lassen Sie das Feld leer.",
      );
      return;
    }
    const requestId = requesterScopeRef.current;
    requesterCreationRef.current = requestId;
    setRequesterSaving(true);
    setRequesterError("");
    try {
      const { data, error: requestError } = await supabase.functions.invoke(
        "ticket-requesters",
        {
          body: {
            type: "create",
            tenantId,
            displayName,
            ...(email ? { email } : {}),
          },
        },
      );
      if (requestError) throw requestError;
      const requester = parseCreatedRequester(data);
      if (requesterScopeRef.current !== requestId) return;
      ++requesterSearchRef.current;
      setSelectedRequester(requester);
      setRequesterQuery("");
      setRequesterLookup(null);
      setRequesterDraft(null);
      setError("");
    } catch (requestError: unknown) {
      if (requesterScopeRef.current !== requestId) return;
      if (isPermissionDenied(requestError)) {
        setRequesterManagement({
          tenantId,
          allowed: false,
          error: "",
        });
        setSelectedRequester(options.currentRequester);
        setRequesterDraft(null);
        setRequesterError(
          "Sie sind nicht berechtigt, anfragende Personen anzulegen. Ihre eigene Person ist ausgewählt.",
        );
      } else {
        const message = await requesterErrorMessage(
          requestError,
          "Die anfragende Person konnte nicht gespeichert oder bestätigt werden. Bitte prüfen Sie Name und E-Mail-Adresse und versuchen Sie es erneut.",
        );
        if (requesterScopeRef.current === requestId) setRequesterError(message);
      }
    } finally {
      if (requesterScopeRef.current === requestId) {
        requesterCreationRef.current = null;
        setRequesterSaving(false);
      }
    }
  }

  function openCategoryForm(parentId: string | null) {
    if (!categoriesLoaded || saving || categorySaving) return;
    setCategoryError("");
    setCategoryDraft({ name: "", parentId });
  }

  async function createCategory() {
    if (
      !supabase ||
      !categoriesLoaded ||
      !categoryDraft ||
      categorySaving ||
      saving
    )
      return;
    const name = categoryDraft.name.trim();
    const parentId = categoryDraft.parentId;
    const nameLength = Array.from(name).length;
    if (nameLength < 2 || nameLength > 120 || name.includes("\0")) {
      setCategoryError(
        "Bitte geben Sie einen Namen mit 2 bis 120 Zeichen ein.",
      );
      return;
    }
    if (
      parentId !== null &&
      !rootCategories.some((category) => category.id === parentId)
    ) {
      setCategoryError(
        "Bitte wählen Sie eine gültige übergeordnete Kategorie.",
      );
      return;
    }
    const requestId = categoryRequestRef.current;
    setCategorySaving(true);
    setCategoryError("");
    try {
      const { data, error: requestError } = await supabase.functions.invoke(
        "ticket-actions",
        {
          body: {
            type: "createCategory",
            tenantId,
            departmentId,
            name,
            ...(parentId !== null ? { parentCategoryId: parentId } : {}),
          },
        },
      );
      if (requestError) throw requestError;
      const category = parseCreatedCategory(data, parentId);
      if (categoryRequestRef.current !== requestId) return;
      setCategoryLookup((current) =>
        current?.status === "loaded" &&
        current.tenantId === tenantId &&
        current.departmentId === departmentId
          ? {
              ...current,
              categories: [
                ...current.categories.filter((item) => item.id !== category.id),
                category,
              ],
            }
          : current,
      );
      setCategoryId(parentId ?? category.id);
      setSubcategoryId(parentId !== null ? category.id : "");
      setCategoryDraft(null);
    } catch {
      if (categoryRequestRef.current === requestId)
        setCategoryError(
          "Die Kategorie konnte nicht gespeichert werden. Bitte prüfen Sie den Namen und versuchen Sie es erneut.",
        );
    } finally {
      if (categoryRequestRef.current === requestId) setCategorySaving(false);
    }
  }

  function validateTicketDraft(): boolean {
    if (selectedTemplate && selectedTemplate.formFields.length > 0) {
      const formErrors = validateAnswers(
        selectedTemplate.formFields,
        templateFormAnswers,
      );
      setTemplateFormState({
        templateId: selectedTemplate.id,
        answers: templateFormAnswers,
        errors: formErrors,
      });
      const firstKey = Object.keys(formErrors)[0];
      if (firstKey) {
        document.getElementById(`ticket-template-field-${firstKey}`)?.focus();
        return false;
      }
    }
    const nextErrors: FieldErrors = {};
    const draftSubject = (selectedTemplatePreview?.subject ?? subject).trim();
    const draftDescription = (
      selectedTemplatePreview?.description ?? description
    ).trim();
    if (Array.from(draftSubject).length < 3) {
      nextErrors.subject =
        "Bitte beschreiben Sie Ihr Anliegen im Betreff mit mindestens 3 Zeichen.";
    }
    if (!draftDescription) {
      nextErrors.description =
        "Bitte schildern Sie kurz, was passiert ist oder was Sie benötigen.";
    }
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function loadSlaExpectation(
    ticketId: string,
  ): Promise<SlaExpectation | null> {
    if (!supabase) return null;
    try {
      const { data, error: requestError } = await supabase.functions.invoke(
        "requester-portal",
        {
          body: { tenantId, ticketId, type: "slaExpectation" },
        },
      );
      if (requestError) throw requestError;
      return parseSlaExpectation(data);
    } catch {
      return null;
    }
  }

  async function addSelectedWatchers() {
    const lookup =
      confirmation &&
      watcherLookup?.status === "ready" &&
      watcherLookup.tenantId === tenantId &&
      watcherLookup.ticketId === confirmation.ticketId
        ? watcherLookup
        : null;
    const watcherIds = selectedWatchers.map((person) => person.id);
    const client = supabase;
    if (!client || !lookup || watcherSaving) return;
    if (watcherIds.length === 0) {
      setWatcherNotice("Bitte wählen Sie mindestens eine Person aus.");
      return;
    }
    setWatcherSaving(true);
    setWatcherNotice("");
    const results = await Promise.allSettled(
      watcherIds.map(async (watcherId) => {
        const { data, error: requestError } = await client.functions.invoke(
          "requester-portal",
          {
            body: {
              tenantId,
              ticketId: lookup.ticketId,
              type: "addTicketWatcher",
              watcherId,
            },
          },
        );
        if (requestError) throw requestError;
        const watcher = parseAddedWatcher(data);
        if (watcher.userId !== watcherId) {
          throw new Error("invalid_added_watcher");
        }
        return watcher.userId;
      }),
    );
    const added = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.some(isQuietWatcherUnavailable)) {
      setWatcherLookup(null);
      setSelectedWatchers([]);
    } else {
      if (added.length > 0) {
        setSelectedWatchers((current) =>
          current.filter((person) => !added.includes(person.id)),
        );
      }
      if (failures.length > 0) {
        setWatcherNotice(
          "Nicht alle Personen konnten in Kopie gesetzt werden. Bitte versuchen Sie es erneut.",
        );
      } else {
        setWatcherNotice(
          `${added.length} ${added.length === 1 ? "Person wurde" : "Personen wurden"} in Kopie gesetzt.`,
        );
      }
    }
    setWatcherSaving(false);
  }

  async function createTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateTicketDraft()) return;
    if (!currentSelectedRequester) {
      setError(
        "Bitte wählen Sie eine anfragende Person aus. Ohne ausgewählte Person kann kein Ticket erstellt werden.",
      );
      return;
    }
    if (
      !supabase ||
      !departmentId ||
      loading ||
      optionsTenantId !== tenantId ||
      !effectivePriorityKey ||
      saving ||
      requesterSaving ||
      requesterDraft ||
      categorySaving ||
      categoryDraft
    )
      return;
    const requestId = requesterScopeRef.current;
    setSaving(true);
    setError("");
    setConfirmation(null);
    try {
      const { data, error: requestError } = await supabase.functions.invoke(
        "ticket-actions",
        {
          body: {
            type: "createTicket",
            tenantId,
            departmentId,
            priorityKey: effectivePriorityKey,
            requesterContactId: currentSelectedRequester.id,
            subject: selectedTemplatePreview?.subject ?? subject,
            description: selectedTemplatePreview?.description ?? description,
            ...(selectedTemplate ? { templateId: selectedTemplate.id } : {}),
            ...(selectedTemplate && selectedTemplate.formFields.length > 0
              ? {
                  formAnswers: sanitizeAnswers(
                    selectedTemplate.formFields,
                    templateFormAnswers,
                  ),
                }
              : {}),
            categoryId: selectedCategory?.id ?? null,
            subcategoryId: selectedSubcategory?.id ?? null,
          },
        },
      );
      if (requestError) throw requestError;
      const created = parseCreatedTicket(data);
      const expectationPromise = loadSlaExpectation(created.ticketId);
      if (assignedAgentId) {
        const { error: agentAssignmentError } = await supabase.functions.invoke(
          "ticket-agent-assignment",
          {
            body: {
              type: "assign",
              tenantId,
              ticketId: created.ticketId,
              assignedAgentId,
            },
          },
        );
        if (agentAssignmentError) {
          const expectation = await expectationPromise;
          clearTicketComposerDraft(currentUserId, tenantId);
          draftRestoreRef.current = null;
          setDraftRestored(false);
          setConfirmation({ ...created, expectation });
          setSubject("");
          setDescription("");
          setTemplateId("");
          setAssignedAgentId("");
          setError(
            "Das Ticket wurde erstellt, aber die Agentenzuweisung konnte nicht gespeichert werden. Öffnen Sie das Ticket und versuchen Sie die Zuweisung erneut.",
          );
          return;
        }
      }
      if (currentSelectedRequester.id !== options.currentRequester?.id) {
        const { error: requesterAssignmentError } =
          await supabase.functions.invoke("ticket-requesters", {
            body: {
              type: "assign",
              tenantId,
              ticketId: created.ticketId,
              requesterContactId: currentSelectedRequester.id,
            },
          });
        if (requesterAssignmentError) throw requesterAssignmentError;
      }
      // Chosen knowledge articles: link them and, if wanted, add a link to
      // the conversation as an internal note or a reply to the requester.
      for (const [articleId, { choice, title }] of Object.entries(
        articleChoices,
      )) {
        const article = { id: articleId, title };
        try {
          await supabase!.functions.invoke("ticket-knowledge", {
            body: {
              type: "attach",
              tenantId,
              ticketId: created.ticketId,
              articleId: article.id,
              visibility: choice === "external" ? "external" : "internal",
            },
          });
          if (choice === "internal" || choice === "external") {
            await supabase!.functions.invoke("ticket-operations", {
              body: {
                type: "addComment",
                tenantId,
                ticketId: created.ticketId,
                visibility: choice,
                body: `Wissensartikel: ${article.title}\n${knowledgeArticleLink(article.id)}`,
              },
            });
          }
        } catch {
          // Best effort: the ticket exists; the article can be added there.
        }
      }
      setArticleChoices({});
      // Picked assets are linked to the new ticket (best effort: the ticket
      // exists either way, missing links can be added in the ticket).
      await Promise.allSettled(
        pickedAssets.map((asset) =>
          supabase!.functions.invoke("service-assets", {
            body: {
              type: "linkTicket",
              tenantId,
              ticketId: created.ticketId,
              kind: "asset",
              targetId: asset.id,
            },
          }),
        ),
      );
      setPickedAssets([]);
      // The ticket exists: the stored draft is done, whatever happens next.
      clearTicketComposerDraft(currentUserId, tenantId);
      draftRestoreRef.current = null;
      if (requesterScopeRef.current !== requestId) return;
      setSubject("");
      setDescription("");
      setTemplateId("");
      // Close the composer and open the new ticket right away; the parent
      // shows a short-lived confirmation.
      onCreated(created.ticketId, created.ticketNumber);
    } catch (requestError: unknown) {
      const message = await requesterErrorMessage(
        requestError,
        "Das Ticket konnte nicht erstellt oder bestätigt werden. Bitte prüfen Sie Ihre Eingaben und versuchen Sie es erneut.",
      );
      if (requesterScopeRef.current === requestId) setError(message);
    } finally {
      if (requesterScopeRef.current === requestId) setSaving(false);
    }
  }

  const currentCategoryLookup =
    !loading &&
    optionsTenantId === tenantId &&
    categoryLookup?.tenantId === tenantId &&
    categoryLookup.departmentId === departmentId
      ? categoryLookup
      : null;
  const categoriesLoaded = currentCategoryLookup?.status === "loaded";
  const categories = categoriesLoaded ? currentCategoryLookup.categories : [];
  const rootCategories = categories.filter(
    (category) => category.parentId === null,
  );
  const selectedCategory = rootCategories.find(
    (category) => category.id === categoryId,
  );
  const subcategories = selectedCategory
    ? categories.filter((category) => category.parentId === selectedCategory.id)
    : [];
  const selectedSubcategory = subcategories.find(
    (category) => category.id === subcategoryId,
  );
  const currentTemplateLookup =
    !loading &&
    optionsTenantId === tenantId &&
    templateLookup?.tenantId === tenantId &&
    templateLookup.departmentId === departmentId
      ? templateLookup
      : null;
  const availableTemplates =
    currentTemplateLookup?.status === "loaded"
      ? currentTemplateLookup.templates
      : [];
  const selectedTemplate =
    availableTemplates.find((template) => template.id === templateId) ?? null;
  const selectedDepartmentName =
    options.departments.find((department) => department.id === departmentId)
      ?.name ?? "Abteilung";
  const templateFormAnswers: FormAnswers =
    selectedTemplate && templateFormState.templateId === selectedTemplate.id
      ? templateFormState.answers
      : {};
  const templateFormErrors =
    selectedTemplate && templateFormState.templateId === selectedTemplate.id
      ? templateFormState.errors
      : {};
  const basicTemplatePreview = selectedTemplate
    ? templatePreview(
        selectedTemplate,
        currentSelectedRequester?.displayName ?? "Anfragende Person",
        selectedDepartmentName,
      )
    : null;
  // The server appends the same section; the preview shows it up front.
  const selectedTemplatePreview =
    selectedTemplate && basicTemplatePreview
      ? {
          subject: basicTemplatePreview.subject,
          description: appendAnswersToDescription(
            basicTemplatePreview.description,
            selectedTemplate.formFields,
            sanitizeAnswers(selectedTemplate.formFields, templateFormAnswers),
          ),
        }
      : null;
  const effectivePriorityKey = selectedTemplate?.priorityKey ?? priorityKey;
  const draftParent = categoryDraft?.parentId
    ? rootCategories.find((category) => category.id === categoryDraft.parentId)
    : null;
  const requesterDepartmentIsValid =
    options.requesterContext.isInternal &&
    options.requesterContext.departmentId !== undefined &&
    options.departments.some(
      (department) => department.id === options.requesterContext.departmentId,
    );
  const contextDepartmentName = requesterDepartmentIsValid
    ? options.requesterContext.departmentName
    : undefined;
  const matchingIncidentNotices = (incidentNotices ?? []).filter(
    (notice) =>
      (notice.departmentId === null || notice.departmentId === departmentId) &&
      (notice.categoryId === null ||
        notice.categoryId === selectedCategory?.id),
  );
  const currentWatcherLookup =
    confirmation &&
    watcherLookup?.status === "ready" &&
    watcherLookup.tenantId === tenantId &&
    watcherLookup.ticketId === confirmation.ticketId
      ? watcherLookup
      : null;
  const matchingWatcherPeople = currentWatcherLookup
    ? watcherResults.filter(
        (person) =>
          person.id !== currentUserId &&
          !selectedWatchers.some((selected) => selected.id === person.id),
      )
    : [];
  const draftSubject = selectedTemplatePreview?.subject ?? subject;
  const draftDescription = selectedTemplatePreview?.description ?? description;
  const { suggestions, clear: clearSuggestions } = useTicketSuggestions({
    description: draftDescription,
    enabled: formReady && !saving,
    // The server falls back to the requester view without ticket work rights.
    mode: agentLookupAllowed ? "agent" : "requester",
    subject: draftSubject,
    tenantId,
  });
  // Keep the draft (without attachments) in sessionStorage while typing, so
  // opening a suggestion and coming back restores it.
  useEffect(() => {
    if (!formReady || saving) return;
    writeTicketComposerDraft(currentUserId, tenantId, currentDraft());
    // currentDraft reads exactly the values listed here.
  }, [
    formReady,
    saving,
    currentUserId,
    tenantId,
    subject,
    description,
    departmentId,
    priorityKey,
    categoryId,
    subcategoryId,
    templateId,
    assignedAgentId,
    currentSelectedRequester,
  ]);
  const classification =
    suggestions?.mode === "agent" ? suggestions.classification : null;
  const departmentSuggestion =
    classification?.department &&
    classification.department.id !== departmentId &&
    options.departments.some(
      (department) => department.id === classification.department?.id,
    )
      ? classification.department
      : null;
  const categorySuggestion =
    classification?.category &&
    classification.category.departmentId === departmentId &&
    classification.category.id !== selectedCategory?.id &&
    rootCategories.some(
      (category) => category.id === classification.category?.id,
    )
      ? classification.category
      : null;
  const priorityFixedByTemplate =
    selectedTemplate?.priorityKey !== null &&
    selectedTemplate?.priorityKey !== undefined;
  const prioritySuggestion =
    classification?.priority &&
    !priorityFixedByTemplate &&
    classification.priority.key !== effectivePriorityKey &&
    options.priorities.some(
      (priority) => priority.key === classification.priority?.key,
    )
      ? classification.priority
      : null;

  function currentDraft(): TicketComposerDraft {
    // Fields still waiting for their options keep their stored value.
    const pending = draftRestoreRef.current;
    const pendingHere =
      pending && pending.departmentId === departmentId ? pending : null;
    const ownRequesterId = options.currentRequester?.id;
    return {
      subject,
      description,
      departmentId,
      priorityKey,
      categoryId: categoryId || pendingHere?.categoryId || "",
      subcategoryId: categoryId
        ? subcategoryId
        : pendingHere?.subcategoryId || "",
      templateId: templateId || pendingHere?.templateId || "",
      assignedAgentId: assignedAgentId || pendingHere?.assignedAgentId || "",
      requester:
        currentSelectedRequester &&
        currentSelectedRequester.id !== ownRequesterId
          ? {
              id: currentSelectedRequester.id,
              displayName: currentSelectedRequester.displayName,
            }
          : (pending?.requester ?? null),
    };
  }

  /** Stores the draft before a suggestion closes the composer. */
  function keepDraft(): boolean {
    return formReady
      ? writeTicketComposerDraft(currentUserId, tenantId, currentDraft())
      : readTicketComposerDraft(currentUserId, tenantId) !== null;
  }

  function discardDraft() {
    clearTicketComposerDraft(currentUserId, tenantId);
    draftRestoreRef.current = null;
    setDraftRestored(false);
    clearSuggestions();
    setSubject("");
    setDescription("");
    setTemplateId("");
    setCategoryId("");
    setSubcategoryId("");
    setAssignedAgentId("");
    setFieldErrors({});
    setError("");
    if (canManageRequesters && options.currentRequester)
      setSelectedRequester(options.currentRequester);
  }

  const openSuggestedTicket = onOpenTicket
    ? (ticketId: string, ticketNumber: string) =>
        onOpenTicket(ticketId, ticketNumber, keepDraft())
    : undefined;
  const openSuggestedArticle = onOpenKnowledgeArticle
    ? (articleId: string) => onOpenKnowledgeArticle(articleId, keepDraft())
    : undefined;

  function finishWithArticle() {
    // "Hat mein Problem gelöst": no ticket is created, the draft is cleared.
    clearTicketComposerDraft(currentUserId, tenantId);
    draftRestoreRef.current = null;
    setDraftRestored(false);
    clearSuggestions();
    setSubject("");
    setDescription("");
    setTemplateId("");
    setFieldErrors({});
    setError("");
    setDeflectionNotice(true);
  }

  return (
    <section className="ticket-compose panel" aria-label="Ticket erfassen">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">NEUER VORGANG</p>
          <h2>Ticket erfassen</h2>
        </div>
      </div>
      {loading || optionsTenantId !== tenantId ? (
        <p className="empty-state">Erfassungsoptionen werden geladen …</p>
      ) : (
        <form
          className="ticket-compose-form"
          noValidate
          onSubmit={createTicket}
        >
          <section
            aria-label="Schritte für die Ticketerfassung"
            className="ticket-compose-description"
          >
            <p className="data-caption">
              <strong>In drei Schritten:</strong> Anliegen beschreiben,
              einordnen und anschliessend erstellen. Pflichtfelder sind mit
              einem Stern markiert.
            </p>
            {draftRestored && (
              <p className="data-caption" role="status">
                Ihr gespeicherter Entwurf wurde wiederhergestellt.{" "}
                <button
                  className="text-button"
                  disabled={saving}
                  onClick={discardDraft}
                  type="button"
                >
                  Entwurf verwerfen
                </button>
              </p>
            )}
          </section>
          <div className="ticket-compose-description ticket-compose-requester">
            {currentRequesterManagement?.error && (
              <div>
                <p className="error" role="alert">
                  {currentRequesterManagement.error}
                </p>
                <button
                  className="text-button"
                  disabled={saving}
                  onClick={() =>
                    setRequesterPermissionRetry((current) => current + 1)
                  }
                  type="button"
                >
                  Berechtigung erneut prüfen
                </button>
              </div>
            )}
            <div className="ticket-requester-combobox">
              <label>
                Anfragende Person <span aria-hidden="true">*</span>
                <input
                  aria-autocomplete="list"
                  aria-controls="ticket-requester-options"
                  aria-describedby="ticket-requester-help"
                  aria-expanded={requesterPickerOpen}
                  aria-invalid={!currentSelectedRequester}
                  autoComplete="off"
                  disabled={saving || requesterSaving || requesterFormOpen}
                  maxLength={120}
                  onBlur={() => {
                    // Let a click on an option finish first.
                    window.setTimeout(() => {
                      setRequesterPickerOpen(false);
                      setRequesterQuery("");
                      setRequesterLookup(null);
                    }, 150);
                  }}
                  onChange={(event) => {
                    if (!canManageRequesters) return;
                    // Invalidate before the effect: no old result may win a keystroke race.
                    ++requesterSearchRef.current;
                    setRequesterPickerOpen(true);
                    setRequesterQuery(event.target.value);
                    setRequesterLookup(null);
                    setRequesterError("");
                  }}
                  onFocus={() => {
                    if (canManageRequesters) setRequesterPickerOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.preventDefault();
                    if (event.key === "Escape") {
                      setRequesterPickerOpen(false);
                      setRequesterQuery("");
                    }
                  }}
                  placeholder={
                    canManageRequesters
                      ? "Name eingeben, um eine Person zu suchen"
                      : ""
                  }
                  readOnly={!canManageRequesters}
                  required
                  role="combobox"
                  value={
                    requesterPickerOpen
                      ? requesterQuery
                      : (currentSelectedRequester?.displayName ?? "")
                  }
                />
              </label>
              {canManageRequesters && requesterPickerOpen ? (
                <div
                  className="ticket-requester-combobox__options"
                  id="ticket-requester-options"
                  role="listbox"
                >
                  {currentSelectedRequester ? (
                    <p className="ticket-requester-combobox__current">
                      Ausgewählt: {currentSelectedRequester.displayName}
                    </p>
                  ) : null}
                  {[...requesterQuery.trim()].length < 2 ? (
                    <p className="data-caption">
                      Mindestens 2 Zeichen eingeben.
                    </p>
                  ) : currentRequesterLookup?.status === "loading" ? (
                    <p className="data-caption" role="status">
                      Personen werden gesucht …
                    </p>
                  ) : currentRequesterLookup?.status === "error" ? (
                    <p className="error" role="alert">
                      {currentRequesterLookup.error}
                    </p>
                  ) : currentRequesterLookup?.status === "loaded" &&
                    currentRequesterLookup.requesters.length === 0 ? (
                    <p className="data-caption">
                      Keine passende Person gefunden.
                    </p>
                  ) : null}
                  {currentRequesterLookup?.status === "loaded"
                    ? currentRequesterLookup.requesters.map((requester) => (
                        <button
                          aria-selected={
                            currentSelectedRequester?.id === requester.id
                          }
                          className="ticket-requester-combobox__option"
                          key={requester.id}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            selectRequester(requester);
                            setRequesterPickerOpen(false);
                          }}
                          role="option"
                          type="button"
                        >
                          {requester.displayName}
                        </button>
                      ))
                    : null}
                  {options.currentRequester &&
                  currentSelectedRequester?.id !==
                    options.currentRequester.id ? (
                    <button
                      className="ticket-requester-combobox__option ticket-requester-combobox__option--action"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        if (options.currentRequester)
                          selectRequester(options.currentRequester);
                        setRequesterPickerOpen(false);
                      }}
                      type="button"
                    >
                      Mich auswählen
                    </button>
                  ) : null}
                  <button
                    className="ticket-requester-combobox__option ticket-requester-combobox__option--action"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      openRequesterForm();
                      setRequesterPickerOpen(false);
                    }}
                    type="button"
                  >
                    + Neue anfragende Person
                    {requesterQuery.trim()
                      ? ` «${requesterQuery.trim()}» anlegen`
                      : " anlegen"}
                  </button>
                </div>
              ) : null}
              {!currentSelectedRequester && !requesterPickerOpen ? (
                <p className="data-caption" id="ticket-requester-help">
                  Eine anfragende Person muss ausgewählt sein, bevor ein Ticket
                  erstellt werden kann.
                </p>
              ) : (
                <span hidden id="ticket-requester-help" />
              )}
            </div>
            {canManageRequesters && (
              <>
                {requesterDraft && (
                  <div
                    aria-label="Neue anfragende Person"
                    id="ticket-requester-form"
                    role="group"
                  >
                    <label>
                      Name
                      <input
                        autoComplete="off"
                        autoFocus
                        disabled={saving || requesterSaving}
                        maxLength={160}
                        minLength={2}
                        onChange={(event) => {
                          const name = event.target.value;
                          setRequesterDraft((current) =>
                            current ? { ...current, name } : null,
                          );
                          setRequesterError("");
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void createRequester();
                          }
                        }}
                        placeholder="Vor- und Nachname"
                        value={requesterDraft.name}
                      />
                    </label>
                    <label>
                      E-Mail (optional)
                      <input
                        autoComplete="off"
                        disabled={saving || requesterSaving}
                        maxLength={254}
                        onChange={(event) => {
                          const email = event.target.value;
                          setRequesterDraft((current) =>
                            current ? { ...current, email } : null,
                          );
                          setRequesterError("");
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void createRequester();
                          }
                        }}
                        placeholder="E-Mail-Adresse"
                        type="email"
                        value={requesterDraft.email}
                      />
                    </label>
                    <button
                      className="text-button"
                      disabled={saving || requesterSaving}
                      onClick={() => {
                        setRequesterDraft(null);
                        setRequesterError("");
                      }}
                      type="button"
                    >
                      Abbrechen
                    </button>
                    <button
                      className="primary-button"
                      disabled={
                        saving || requesterSaving || !requesterDraft.name.trim()
                      }
                      onClick={() => void createRequester()}
                      type="button"
                    >
                      {requesterSaving
                        ? "Wird gespeichert …"
                        : "Speichern und auswählen"}
                    </button>
                  </div>
                )}
              </>
            )}
            {requesterError && (
              <p className="error" role="alert">
                {requesterError}
              </p>
            )}
          </div>
          {deflectionNotice && (
            <p
              className="ticket-suggestions-confirmation ticket-compose-description"
              role="status"
            >
              <CheckCircle2 aria-hidden="true" size={18} strokeWidth={1.8} />
              Schön, dass es geklappt hat – es wurde kein Ticket erstellt.
            </p>
          )}
          <p className="ticket-compose-hint ticket-compose-description">
            <strong>Für eine schnelle Lösung:</strong> Nennen Sie im Betreff das
            Ziel, beschreiben Sie den Fehler und seit wann er auftritt. Ergänzen
            Sie bereits versuchte Schritte sowie Meldungen oder Auswirkungen –
            aber keine Passwörter, Schlüssel oder andere Geheimnisse.
          </p>
          <label className="ticket-compose-subject">
            Betreff
            <input
              aria-describedby={
                selectedTemplate
                  ? "ticket-template-preview"
                  : fieldErrors.subject
                    ? "ticket-subject-error"
                    : undefined
              }
              aria-invalid={Boolean(fieldErrors.subject)}
              disabled={saving || options.departments.length === 0}
              minLength={3}
              onChange={(event) => {
                setSubject(event.target.value);
                setDeflectionNotice(false);
                setFieldErrors((current) => {
                  const { subject: _subject, ...next } = current;
                  return next;
                });
              }}
              placeholder="Worum geht es?"
              readOnly={selectedTemplate !== null}
              required
              value={selectedTemplatePreview?.subject ?? subject}
            />
            {fieldErrors.subject && (
              <span className="error" id="ticket-subject-error" role="alert">
                {fieldErrors.subject}
              </span>
            )}
          </label>
          <TicketSuggestionPanel
            articleChoices={Object.fromEntries(
              Object.entries(articleChoices).map(([id, value]) => [
                id,
                value.choice,
              ]),
            )}
            disabled={saving}
            onArticleChoice={(article, choice) =>
              setArticleChoices((current) => {
                const next = { ...current };
                if (choice) next[article.id] = { choice, title: article.title };
                else delete next[article.id];
                return next;
              })
            }
            onDeflected={finishWithArticle}
            onOpenKnowledgeArticle={openSuggestedArticle}
            onOpenTicket={openSuggestedTicket}
            subject={draftSubject}
            suggestions={suggestions}
            tenantId={tenantId}
          />
          <section
            aria-labelledby="ticket-routing-heading"
            className="ticket-compose-routing"
          >
            <div className="ticket-compose-section-heading">
              <p className="eyebrow">EINORDNUNG & ZUSTÄNDIGKEIT</p>
              <h3 id="ticket-routing-heading">Ticket einordnen</h3>
            </div>
            <label>
              Abteilung / Angebot
              <select
                aria-describedby={
                  options.requesterContext.isInternal && contextDepartmentName
                    ? "ticket-requester-department"
                    : undefined
                }
                disabled={saving || options.departments.length === 0}
                id="ticket-department-selection"
                onChange={(event) => changeDepartment(event.target.value)}
                ref={departmentSelectRef}
                required
                value={departmentId}
              >
                {options.departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
              {options.requesterContext.isInternal && contextDepartmentName && (
                <span className="data-caption" id="ticket-requester-department">
                  Vorausgefüllt: {contextDepartmentName}
                </span>
              )}
            </label>
            {departmentSuggestion && (
              <ClassificationSuggestion
                disabled={saving}
                onApply={() => {
                  changeDepartment(departmentSuggestion.id);
                }}
                vote={departmentSuggestion}
              />
            )}
            <div className="ticket-compose-description ticket-compose-template">
              <label>
                Ticketvorlage (optional)
                <select
                  disabled={
                    saving ||
                    options.departments.length === 0 ||
                    currentTemplateLookup?.status === "loading"
                  }
                  onChange={(event) => {
                    setTemplateId(event.target.value);
                    setFieldErrors({});
                  }}
                  value={selectedTemplate?.id ?? ""}
                >
                  <option value="">
                    {currentTemplateLookup?.status === "loading"
                      ? "Vorlagen werden geladen …"
                      : "Ohne Vorlage erfassen"}
                  </option>
                  {availableTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
              {currentTemplateLookup?.error && (
                <p className="error" role="alert">
                  {currentTemplateLookup.error}
                </p>
              )}
              {selectedTemplate && (
                <p className="data-caption" id="ticket-template-preview">
                  Betreff, Beschreibung und
                  {selectedTemplate.priorityKey ? " die Priorität" : ""} werden
                  beim Erstellen auf dem Server aus dieser Vorlage übernommen.
                  Platzhalter werden nur mit Mandantenkontext ersetzt; die
                  Ticketnummer wird erst beim Erstellen vergeben.
                </p>
              )}
            </div>
            {agentLookupAllowed && assignableAgents.length > 0 && (
              <label>
                Zugewiesener Agent
                <select
                  disabled={saving}
                  onChange={(event) => setAssignedAgentId(event.target.value)}
                  value={assignedAgentId}
                >
                  <option value="">Nicht zugewiesen</option>
                  {assignableAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.displayName ?? "Aktiver Agent"}
                      {agent.id === currentUserId ? " (Ich)" : ""}
                    </option>
                  ))}
                </select>
                <span className="data-caption">
                  Alle aktiven, für diese Abteilung berechtigten Agenten des
                  Mandanten stehen zur Auswahl.
                </span>
              </label>
            )}
            {agentLookupAllowed ? (
              <TicketAssetPicker
                disabled={saving}
                onChange={setPickedAssets}
                selected={pickedAssets}
                tenantId={tenantId}
              />
            ) : null}
            {currentCategoryLookup?.status === "loading" && (
              <p
                className="data-caption ticket-compose-description"
                role="status"
              >
                Kategorien werden geladen …
              </p>
            )}
            {currentCategoryLookup?.error && (
              <p className="ticket-compose-description error" role="alert">
                {currentCategoryLookup.error}
              </p>
            )}
            {categoriesLoaded && (
              <div className="ticket-compose-description ticket-compose-category">
                <label>
                  Kategorie
                  <select
                    disabled={
                      saving || categorySaving || categoryDraft !== null
                    }
                    onChange={(event) => {
                      if (event.target.value === NEW_CATEGORY_OPTION) {
                        openCategoryForm(null);
                        return;
                      }
                      setCategoryId(event.target.value);
                      setSubcategoryId("");
                      setCategoryError("");
                    }}
                    value={selectedCategory?.id ?? ""}
                  >
                    <option value="">Keine Auswahl</option>
                    {rootCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                    <option value={NEW_CATEGORY_OPTION}>
                      + Neue Kategorie …
                    </option>
                  </select>
                  {categorySuggestion && (
                    <ClassificationSuggestion
                      disabled={
                        saving || categorySaving || categoryDraft !== null
                      }
                      onApply={() => {
                        setCategoryId(categorySuggestion.id);
                        setSubcategoryId("");
                        setCategoryError("");
                      }}
                      vote={categorySuggestion}
                    />
                  )}
                </label>
                {selectedCategory && (
                  <label>
                    Unterkategorie
                    <select
                      disabled={
                        saving || categorySaving || categoryDraft !== null
                      }
                      onChange={(event) => {
                        if (event.target.value === NEW_CATEGORY_OPTION) {
                          openCategoryForm(selectedCategory.id);
                          return;
                        }
                        setSubcategoryId(event.target.value);
                      }}
                      value={selectedSubcategory?.id ?? ""}
                    >
                      <option value="">Keine Auswahl</option>
                      {subcategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                      <option value={NEW_CATEGORY_OPTION}>
                        + Neue Unterkategorie …
                      </option>
                    </select>
                  </label>
                )}
                {categoryDraft && (
                  <div
                    aria-label={
                      draftParent ? "Neue Unterkategorie" : "Neue Kategorie"
                    }
                    id="ticket-category-form"
                    role="group"
                  >
                    <p className="data-caption">
                      {draftParent
                        ? `Unterkategorie von: ${draftParent.name}`
                        : "Neue Kategorie ohne übergeordnete Kategorie"}
                    </p>
                    <label>
                      Name
                      <input
                        autoFocus
                        disabled={saving || categorySaving}
                        onChange={(event) => {
                          const name = event.target.value;
                          setCategoryDraft((current) =>
                            current ? { ...current, name } : null,
                          );
                          setCategoryError("");
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void createCategory();
                          }
                        }}
                        placeholder={
                          draftParent
                            ? "Name der Unterkategorie"
                            : "Name der Kategorie"
                        }
                        value={categoryDraft.name}
                      />
                    </label>
                    <button
                      className="text-button"
                      disabled={saving || categorySaving}
                      onClick={() => {
                        setCategoryDraft(null);
                        setCategoryError("");
                      }}
                      type="button"
                    >
                      Abbrechen
                    </button>
                    <button
                      className="primary-button"
                      disabled={
                        saving || categorySaving || !categoryDraft.name.trim()
                      }
                      onClick={() => void createCategory()}
                      type="button"
                    >
                      {categorySaving ? "Wird gespeichert …" : "Speichern"}
                    </button>
                  </div>
                )}
                {categoryError && (
                  <p className="error" role="alert">
                    {categoryError}
                  </p>
                )}
              </div>
            )}
            {matchingIncidentNotices.length > 0 && (
              <aside className="ticket-compose-description" role="note">
                <p className="data-caption">
                  <AlertTriangle aria-hidden="true" size={16} strokeWidth={2} />{" "}
                  <strong>Passende aktive Störung:</strong> Prüfen Sie vor dem
                  Erstellen, ob Ihr Anliegen bereits betroffen ist. Ein Ticket
                  kann bei Bedarf trotzdem erfasst werden.
                </p>
                <ul className="data-caption">
                  {matchingIncidentNotices.map((notice) => (
                    <li key={notice.id}>
                      <strong>{notice.title}:</strong> {notice.description}
                    </li>
                  ))}
                </ul>
              </aside>
            )}
            <label className="ticket-compose-priority">
              Priorität
              <select
                disabled={
                  saving ||
                  options.priorities.length === 0 ||
                  priorityFixedByTemplate
                }
                onChange={(event) => setPriorityKey(event.target.value)}
                required
                value={effectivePriorityKey}
              >
                {options.priorities.map((priority) => (
                  <option key={priority.key} value={priority.key}>
                    {priority.label}
                  </option>
                ))}
              </select>
              {prioritySuggestion && (
                <ClassificationSuggestion
                  disabled={saving}
                  onApply={() => setPriorityKey(prioritySuggestion.key)}
                  vote={prioritySuggestion}
                />
              )}
            </label>
            <p className="ticket-compose-description data-caption" role="note">
              <Clock3 aria-hidden="true" size={16} strokeWidth={2} /> Die
              erwartete Reaktions- und Lösungszeit wird nach dem Erstellen für
              die gewählte Priorität und Kategorie angezeigt.
            </p>
          </section>
          {selectedTemplate && selectedTemplate.formFields.length > 0 && (
            <TicketTemplateFormFields
              answers={templateFormAnswers}
              disabled={saving}
              errors={templateFormErrors}
              fields={selectedTemplate.formFields}
              onChange={(key, value) => {
                const { [key]: _removed, ...remainingErrors } =
                  templateFormErrors;
                setTemplateFormState({
                  templateId: selectedTemplate.id,
                  answers: { ...templateFormAnswers, [key]: value },
                  errors: remainingErrors,
                });
              }}
            />
          )}
          <label className="ticket-compose-description">
            Beschreibung
            <textarea
              aria-describedby={
                selectedTemplate
                  ? "ticket-template-preview"
                  : fieldErrors.description
                    ? "ticket-description-error"
                    : undefined
              }
              aria-invalid={Boolean(fieldErrors.description)}
              disabled={saving || options.departments.length === 0}
              minLength={1}
              onChange={(event) => {
                setDescription(event.target.value);
                setDeflectionNotice(false);
                setFieldErrors((current) => {
                  const { description: _description, ...next } = current;
                  return next;
                });
              }}
              placeholder="Beschreiben Sie das Anliegen so konkret wie möglich."
              readOnly={selectedTemplate !== null}
              required
              rows={4}
              value={selectedTemplatePreview?.description ?? description}
            />
            {fieldErrors.description && (
              <span
                className="error"
                id="ticket-description-error"
                role="alert"
              >
                {fieldErrors.description}
              </span>
            )}
          </label>
          <button
            className="primary-button"
            disabled={
              saving ||
              !currentSelectedRequester ||
              requesterSaving ||
              requesterDraft !== null ||
              categorySaving ||
              categoryDraft !== null ||
              options.departments.length === 0 ||
              options.priorities.length === 0
            }
            type="submit"
          >
            {saving ? "Ticket wird erstellt …" : "Ticket erstellen"}
          </button>
        </form>
      )}
      {error && <p className="ticket-compose-message error">{error}</p>}
      {confirmation && (
        <aside className="ticket-success-toast" aria-live="polite">
          <CheckCircle2 aria-hidden="true" size={24} strokeWidth={1.8} />
          <div>
            <strong>Ticket erstellt</strong>
            <span>{confirmation.ticketNumber}</span>
            {confirmation.expectation && (
              <span>
                {confirmation.expectation.message}
                {localSlaDate(confirmation.expectation.responseDueAt) &&
                  ` Reaktion bis ${localSlaDate(confirmation.expectation.responseDueAt)}.`}
                {localSlaDate(confirmation.expectation.resolutionDueAt) &&
                  ` Lösung bis ${localSlaDate(confirmation.expectation.resolutionDueAt)}.`}
              </span>
            )}
          </div>
          <button
            className="ticket-toast-open"
            onClick={() =>
              onCreated(confirmation.ticketId, confirmation.ticketNumber)
            }
            type="button"
          >
            Öffnen
            <ArrowRight aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
          <button
            aria-label="Bestätigung schliessen"
            className="ticket-toast-dismiss"
            onClick={() => setConfirmation(null)}
            type="button"
          >
            <X aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
        </aside>
      )}
      {confirmation && currentWatcherLookup && (
        <section
          aria-labelledby="ticket-watcher-title"
          className="ticket-watcher-panel"
        >
          <div className="ticket-watcher-head">
            <Users aria-hidden="true" size={18} strokeWidth={1.8} />
            <div>
              <h3 id="ticket-watcher-title">Personen in Kopie setzen</h3>
              <p>
                Personen in Kopie sehen den Verlauf dieses Tickets. Sie werden
                nicht zugewiesen.
              </p>
            </div>
          </div>
          <label className="ticket-watcher-search">
            <span>Person suchen</span>
            <input
              autoComplete="off"
              onChange={(event) => setWatcherQuery(event.target.value)}
              placeholder="Mindestens zwei Zeichen des Namens"
              type="search"
              value={watcherQuery}
            />
          </label>
          {watcherSearching && (
            <p className="ticket-watcher-hint" role="status">
              Personen werden gesucht …
            </p>
          )}
          {!watcherSearching &&
            Array.from(watcherQuery.trim()).length >= 2 &&
            matchingWatcherPeople.length === 0 && (
              <p className="ticket-watcher-hint">
                Keine passende Person gefunden.
              </p>
            )}
          {matchingWatcherPeople.length > 0 && (
            <ul className="ticket-watcher-results" aria-label="Suchtreffer">
              {matchingWatcherPeople.map((person) => (
                <li key={person.id}>
                  <button
                    onClick={() => {
                      setSelectedWatchers((current) =>
                        current.some((selected) => selected.id === person.id)
                          ? current
                          : [...current, person].slice(0, 20),
                      );
                      setWatcherNotice("");
                    }}
                    type="button"
                  >
                    <Plus aria-hidden="true" size={14} strokeWidth={1.8} />
                    {person.displayName}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selectedWatchers.length > 0 && (
            <ul
              className="ticket-watcher-chips"
              aria-label="Ausgewählte Personen"
            >
              {selectedWatchers.map((person) => (
                <li key={person.id}>
                  <span>{person.displayName}</span>
                  <button
                    aria-label={`${person.displayName} entfernen`}
                    onClick={() =>
                      setSelectedWatchers((current) =>
                        current.filter((selected) => selected.id !== person.id),
                      )
                    }
                    type="button"
                  >
                    <X aria-hidden="true" size={14} strokeWidth={1.8} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="ticket-watcher-actions">
            <button
              className="primary-action"
              disabled={watcherSaving || selectedWatchers.length === 0}
              onClick={() => void addSelectedWatchers()}
              type="button"
            >
              {watcherSaving ? "Wird gespeichert …" : "In Kopie setzen"}
            </button>
            {watcherNotice && (
              <p className="ticket-watcher-hint" role="status">
                {watcherNotice}
              </p>
            )}
          </div>
        </section>
      )}
    </section>
  );
}
