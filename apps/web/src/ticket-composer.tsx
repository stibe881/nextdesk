import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, X } from "lucide-react";
import { supabase } from "./lib/supabase";
import {
  SelfServiceCatalog,
  type ServiceCatalogItem,
} from "./self-service-catalog";

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
  checklistItems: Array<{ description: string; position: number }>;
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
    if (
      !isRecord(item) ||
      !isNonemptyString(item.description) ||
      item.description.length > 1000 ||
      typeof item.position !== "number" ||
      !Number.isSafeInteger(item.position)
    ) {
      throw new Error("Die Checkliste der Ticketvorlage ist ungültig.");
    }
    return { description: item.description, position: item.position };
  });
  return {
    id: value.id,
    name: value.name.trim(),
    subjectTemplate: value.subjectTemplate,
    descriptionTemplate: value.descriptionTemplate,
    priorityKey:
      typeof value.priorityKey === "string" ? value.priorityKey : null,
    checklistItems,
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

export function TicketComposer({
  currentUserId,
  tenantId,
  onCreated,
}: {
  currentUserId: string | null;
  tenantId: string;
  onCreated: (ticketId: string) => void;
}) {
  const [options, setOptions] = useState<OptionsResponse>(EMPTY_OPTIONS);
  const [optionsTenantId, setOptionsTenantId] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState("");
  const [departmentSelectionOpen, setDepartmentSelectionOpen] = useState(false);
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
  const [priorityKey, setPriorityKey] = useState("normal");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    null,
  );
  const [showServiceCatalog, setShowServiceCatalog] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    ticketId: string;
    ticketNumber: string;
  } | null>(null);
  const [error, setError] = useState("");
  const departmentSelectRef = useRef<HTMLSelectElement>(null);
  const categoryRequestRef = useRef(0);
  const templateRequestRef = useRef(0);
  const requesterScopeRef = useRef(0);
  const requesterSearchRef = useRef(0);
  const requesterCreationRef = useRef<number | null>(null);
  const formReady = !loading && optionsTenantId === tenantId;
  const currentRequesterManagement =
    formReady && requesterManagement?.tenantId === tenantId
      ? requesterManagement
      : null;
  const canManageRequesters = currentRequesterManagement?.allowed === true;
  const requesterFormOpen = requesterDraft !== null;
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
    setLoading(true);
    setError("");
    setSaving(false);
    setConfirmation(null);
    setOptions(EMPTY_OPTIONS);
    setOptionsTenantId(null);
    setDepartmentId("");
    setDepartmentSelectionOpen(false);
    setCategoryDraft(null);
    setTemplateLookup(null);
    setTemplateId("");
    setSelectedServiceId(null);
    setShowServiceCatalog(true);
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
        setDepartmentId(
          parsedOptions.requesterContext.isInternal &&
            contextDepartmentId &&
            parsedOptions.departments.some(
              (department) => department.id === contextDepartmentId,
            )
            ? contextDepartmentId
            : (parsedOptions.departments[0]?.id ?? ""),
        );
        setPriorityKey(
          parsedOptions.priorities.some((item) => item.key === "normal")
            ? "normal"
            : (parsedOptions.priorities[0]?.key ?? ""),
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
      })
      .catch((requestError: unknown) => {
        if (requesterScopeRef.current !== requestId) return;
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
      })
      .catch(() => {
        if (!mounted) return;
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

  function openDepartmentSelection() {
    setDepartmentSelectionOpen(true);
    window.requestAnimationFrame(() => departmentSelectRef.current?.focus());
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

  function selectCatalogService(service: ServiceCatalogItem) {
    if (saving) return;
    setSelectedServiceId(service.id);
    setSubject((current) => current.trim() || service.name);
    const matchingCategory = rootCategories.find(
      (category) =>
        category.name.trim().localeCompare(service.name.trim(), "de-CH", {
          sensitivity: "base",
        }) === 0,
    );
    if (matchingCategory) {
      setCategoryId(matchingCategory.id);
      setSubcategoryId("");
    }
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

  async function createTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
            categoryId: selectedCategory?.id ?? null,
            subcategoryId: selectedSubcategory?.id ?? null,
          },
        },
      );
      if (requestError) throw requestError;
      const created = parseCreatedTicket(data);
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
          setConfirmation(created);
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
      if (requesterScopeRef.current !== requestId) return;
      setSubject("");
      setDescription("");
      setTemplateId("");
      setConfirmation(created);
      onCreated(created.ticketId);
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
  const selectedTemplatePreview = selectedTemplate
    ? templatePreview(
        selectedTemplate,
        currentSelectedRequester?.displayName ?? "Anfragende Person",
        selectedDepartmentName,
      )
    : null;
  const effectivePriorityKey = selectedTemplate?.priorityKey ?? priorityKey;
  const draftParent = categoryDraft?.parentId
    ? rootCategories.find((category) => category.id === categoryDraft.parentId)
    : null;
  const showDepartmentSelection =
    options.requesterContext.isInternal || departmentSelectionOpen;
  const requesterDepartmentIsValid =
    options.requesterContext.isInternal &&
    options.requesterContext.departmentId !== undefined &&
    options.departments.some(
      (department) => department.id === options.requesterContext.departmentId,
    );
  const contextDepartmentName = requesterDepartmentIsValid
    ? options.requesterContext.departmentName
    : undefined;

  return (
    <section className="ticket-compose panel" aria-label="Ticket erfassen">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">NEUER VORGANG</p>
          <h2>Ticket erfassen</h2>
        </div>
        <span className="data-caption">Mandantenzugriff aktiv</span>
      </div>
      {loading || optionsTenantId !== tenantId ? (
        <p className="empty-state">Erfassungsoptionen werden geladen …</p>
      ) : (
        <form className="ticket-compose-form" onSubmit={createTicket}>
          {showServiceCatalog ? (
            <SelfServiceCatalog
              disabled={saving}
              onSelect={selectCatalogService}
              onSkip={() => {
                setSelectedServiceId(null);
                setShowServiceCatalog(false);
              }}
              selectedServiceId={selectedServiceId}
              tenantId={tenantId}
            />
          ) : null}
          <div className="ticket-compose-description ticket-compose-requester">
            <label>
              Anfragende Person <span aria-hidden="true">*</span>
              <input
                aria-describedby="ticket-requester-help"
                aria-invalid={!currentSelectedRequester}
                disabled={saving}
                readOnly
                required
                value={currentSelectedRequester?.displayName ?? ""}
              />
            </label>
            <p className="data-caption" id="ticket-requester-help">
              {currentSelectedRequester
                ? "Diese Person ist für das Ticket ausgewählt."
                : "Eine anfragende Person muss ausgewählt sein, bevor ein Ticket erstellt werden kann."}
            </p>
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
            {canManageRequesters && (
              <>
                {!requesterFormOpen && (
                  <label>
                    Andere anfragende Person suchen
                    <input
                      aria-describedby="ticket-requester-search-help"
                      autoComplete="off"
                      disabled={saving || requesterSaving}
                      maxLength={120}
                      onChange={(event) => {
                        // Invalidate before the effect: no old result may win a keystroke race.
                        ++requesterSearchRef.current;
                        setRequesterQuery(event.target.value);
                        setRequesterLookup(null);
                        setRequesterError("");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.preventDefault();
                      }}
                      placeholder="Name eingeben"
                      type="search"
                      value={requesterQuery}
                    />
                    <span
                      className="data-caption"
                      id="ticket-requester-search-help"
                    >
                      Suche ab 2 Zeichen. Ein Suchtext allein ändert die
                      ausgewählte Person nicht.
                    </span>
                  </label>
                )}
                {currentRequesterLookup?.status === "loading" && (
                  <p className="data-caption" role="status">
                    Personen werden gesucht …
                  </p>
                )}
                {currentRequesterLookup?.status === "error" && (
                  <p className="error" role="alert">
                    {currentRequesterLookup.error}
                  </p>
                )}
                {currentRequesterLookup?.status === "loaded" && (
                  <div>
                    <p className="data-caption" role="status">
                      {currentRequesterLookup.requesters.length === 0
                        ? "Keine passende Person gefunden. Sie können eine neue anfragende Person anlegen."
                        : "Bitte wählen Sie die passende Person aus."}
                    </p>
                    {currentRequesterLookup.requesters.length > 0 && (
                      <ul aria-label="Gefundene anfragende Personen">
                        {currentRequesterLookup.requesters.map((requester) => (
                          <li key={requester.id}>
                            <button
                              aria-pressed={
                                currentSelectedRequester?.id === requester.id
                              }
                              className="text-button"
                              disabled={saving || requesterSaving}
                              onClick={() => selectRequester(requester)}
                              type="button"
                            >
                              {requester.displayName}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <div>
                  {!requesterFormOpen && (
                    <button
                      aria-controls="ticket-requester-form"
                      aria-expanded={requesterFormOpen}
                      className="text-button"
                      disabled={saving || requesterSaving}
                      onClick={openRequesterForm}
                      type="button"
                    >
                      Neue anfragende Person
                    </button>
                  )}
                  {!requesterFormOpen &&
                    options.currentRequester &&
                    currentSelectedRequester?.id !==
                      options.currentRequester.id && (
                      <button
                        className="text-button"
                        disabled={saving || requesterSaving}
                        onClick={() => {
                          if (options.currentRequester)
                            selectRequester(options.currentRequester);
                        }}
                        type="button"
                      >
                        Mich auswählen
                      </button>
                    )}
                </div>
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
          <label className="ticket-compose-subject">
            Betreff
            <input
              aria-describedby={
                selectedTemplate ? "ticket-template-preview" : undefined
              }
              disabled={saving || options.departments.length === 0}
              minLength={3}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Worum geht es?"
              readOnly={selectedTemplate !== null}
              required
              value={selectedTemplatePreview?.subject ?? subject}
            />
          </label>
          <section
            aria-labelledby="ticket-routing-heading"
            className="ticket-compose-routing"
          >
            <div className="ticket-compose-section-heading">
              <p className="eyebrow">EINORDNUNG & ZUSTÄNDIGKEIT</p>
              <h3 id="ticket-routing-heading">Ticket einordnen</h3>
            </div>
            {showDepartmentSelection && (
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
                {options.requesterContext.isInternal &&
                  contextDepartmentName && (
                    <span
                      className="data-caption"
                      id="ticket-requester-department"
                    >
                      Vorausgefüllt: {contextDepartmentName}
                    </span>
                  )}
              </label>
            )}
            {!showDepartmentSelection && (
              <button
                aria-controls={
                  showDepartmentSelection
                    ? "ticket-department-selection"
                    : undefined
                }
                aria-expanded={showDepartmentSelection}
                className="text-button"
                disabled={saving || options.departments.length === 0}
                onClick={openDepartmentSelection}
                type="button"
              >
                Zuordnung anpassen
              </button>
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
                  onChange={(event) => setTemplateId(event.target.value)}
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
                  </select>
                </label>
                {selectedCategory && (
                  <label>
                    Unterkategorie
                    <select
                      disabled={
                        saving || categorySaving || categoryDraft !== null
                      }
                      onChange={(event) => setSubcategoryId(event.target.value)}
                      value={selectedSubcategory?.id ?? ""}
                    >
                      <option value="">Keine Auswahl</option>
                      {subcategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div>
                  <button
                    aria-controls={
                      categoryDraft ? "ticket-category-form" : undefined
                    }
                    aria-expanded={categoryDraft?.parentId === null}
                    className="text-button"
                    disabled={saving || categorySaving}
                    onClick={() => openCategoryForm(null)}
                    type="button"
                  >
                    Neue Kategorie
                  </button>
                  {selectedCategory && (
                    <button
                      aria-controls={
                        categoryDraft ? "ticket-category-form" : undefined
                      }
                      aria-expanded={
                        categoryDraft?.parentId === selectedCategory.id
                      }
                      className="text-button"
                      disabled={saving || categorySaving}
                      onClick={() => openCategoryForm(selectedCategory.id)}
                      type="button"
                    >
                      Neue Unterkategorie
                    </button>
                  )}
                </div>
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
            <label className="ticket-compose-priority">
              Priorität
              <select
                disabled={
                  saving ||
                  options.priorities.length === 0 ||
                  (selectedTemplate?.priorityKey !== null &&
                    selectedTemplate?.priorityKey !== undefined)
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
            </label>
          </section>
          <label className="ticket-compose-description">
            Beschreibung
            <textarea
              aria-describedby={
                selectedTemplate ? "ticket-template-preview" : undefined
              }
              disabled={saving || options.departments.length === 0}
              minLength={1}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Beschreiben Sie das Anliegen so konkret wie möglich."
              readOnly={selectedTemplate !== null}
              required
              rows={4}
              value={selectedTemplatePreview?.description ?? description}
            />
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
          </div>
          <button
            className="ticket-toast-open"
            onClick={() => onCreated(confirmation.ticketId)}
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
    </section>
  );
}
