import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";

export type SlaManagementProps = {
  tenantId: string;
  headingLevel?: "h1" | "h2";
};

type SlaRule = {
  id: string;
  name: string;
  priorityKey: string;
  departmentId: string | null;
  responseMinutes: number;
  resolutionMinutes: number;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

type EscalationTicket = {
  id: string;
  departmentId: string;
  ticketNumber: string;
  subject: string;
};

type SlaEvent = {
  id: string;
  eventType: string;
  occurredAt: string;
  metadata: unknown;
};

type Escalation = {
  id: string;
  ticketId: string;
  level: number;
  kind: string;
  reason: string;
  openedBy: string | null;
  resolvedBy: string | null;
  openedAt: string;
  resolvedAt: string | null;
  ticket: EscalationTicket | null;
  slaEvents: SlaEvent[];
};

type Department = {
  id: string;
  key: string;
  name: string;
  kind: string;
};

type Priority = {
  key: string;
  label: string;
  sortOrder: number;
};

type FormOptions = {
  departments: Department[];
  priorities: Priority[];
};

type RuleDraft = {
  name: string;
  priorityKey: string;
  departmentId: string;
  responseMinutes: string;
  resolutionMinutes: string;
  active: boolean;
};

type SlaListResponse = {
  rules: SlaRule[];
  truncated: boolean;
};

type EscalationListResponse = {
  escalations: Escalation[];
  truncated: boolean;
};

type ListRulesAction = {
  type: "listRules";
  tenantId: string;
};

type ListEscalationsAction = {
  type: "listEscalations";
  tenantId: string;
  limit: number;
};

type SaveRuleFields = {
  tenantId: string;
  name: string;
  priorityKey: string;
  departmentId: string | null;
  responseMinutes: number;
  resolutionMinutes: number;
  active: boolean;
};

type CreateRuleAction = SaveRuleFields & {
  type: "saveRule";
};

type UpdateRuleAction = SaveRuleFields & {
  type: "saveRule";
  ruleId: string;
};

type ArchiveRuleAction = {
  type: "archiveRule";
  tenantId: string;
  ruleId: string;
};

type SlaAction =
  | ListRulesAction
  | ListEscalationsAction
  | CreateRuleAction
  | UpdateRuleAction
  | ArchiveRuleAction;

type FormOptionsAction = {
  type: "getFormOptions";
  tenantId: string;
};

type SavingState = "create" | "update" | "archive" | null;

const MAX_SLA_MINUTES = 525600;
const ESCALATION_LIMIT = 50;
const EMPTY_OPTIONS: FormOptions = { departments: [], priorities: [] };

function emptyDraft(): RuleDraft {
  return {
    name: "",
    priorityKey: "",
    departmentId: "",
    responseMinutes: "",
    resolutionMinutes: "",
    active: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function responseData(value: unknown): Record<string, unknown> | null {
  return isRecord(value) && isRecord(value.data) ? value.data : null;
}

function parseSlaRule(value: unknown): SlaRule | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.priorityKey !== "string" ||
    !isNullableString(value.departmentId) ||
    !isFiniteInteger(value.responseMinutes) ||
    !isFiniteInteger(value.resolutionMinutes) ||
    typeof value.active !== "boolean" ||
    !isNullableString(value.createdAt) ||
    !isNullableString(value.updatedAt)
  ) {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    priorityKey: value.priorityKey,
    departmentId: value.departmentId,
    responseMinutes: value.responseMinutes,
    resolutionMinutes: value.resolutionMinutes,
    active: value.active,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseTicket(value: unknown): EscalationTicket | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.departmentId !== "string" ||
    typeof value.ticketNumber !== "string" ||
    typeof value.subject !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    departmentId: value.departmentId,
    ticketNumber: value.ticketNumber,
    subject: value.subject,
  };
}

function parseSlaEvent(value: unknown): SlaEvent | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.eventType !== "string" ||
    typeof value.occurredAt !== "string" ||
    !("metadata" in value)
  ) {
    return null;
  }
  return {
    id: value.id,
    eventType: value.eventType,
    occurredAt: value.occurredAt,
    metadata: value.metadata,
  };
}

function parseEscalation(value: unknown): Escalation | null {
  if (!isRecord(value) || !Array.isArray(value.slaEvents)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.ticketId !== "string" ||
    !isFiniteInteger(value.level) ||
    typeof value.kind !== "string" ||
    typeof value.reason !== "string" ||
    !isNullableString(value.openedBy) ||
    !isNullableString(value.resolvedBy) ||
    typeof value.openedAt !== "string" ||
    !isNullableString(value.resolvedAt) ||
    (value.ticket !== null && !isRecord(value.ticket))
  ) {
    return null;
  }

  const ticket = value.ticket === null ? null : parseTicket(value.ticket);
  if (ticket === null && value.ticket !== null) return null;

  const slaEvents: SlaEvent[] = [];
  for (const event of value.slaEvents) {
    const parsedEvent = parseSlaEvent(event);
    if (!parsedEvent) return null;
    slaEvents.push(parsedEvent);
  }

  return {
    id: value.id,
    ticketId: value.ticketId,
    level: value.level,
    kind: value.kind,
    reason: value.reason,
    openedBy: value.openedBy,
    resolvedBy: value.resolvedBy,
    openedAt: value.openedAt,
    resolvedAt: value.resolvedAt,
    ticket,
    slaEvents,
  };
}

function parseSlaListResponse(value: unknown): SlaListResponse {
  const data = responseData(value);
  if (!data || !Array.isArray(data.rules)) {
    throw new Error("Die Antwort für SLA-Regeln ist unvollständig.");
  }

  const rules: SlaRule[] = [];
  for (const rule of data.rules) {
    const parsedRule = parseSlaRule(rule);
    if (!parsedRule) {
      throw new Error("Die Antwort enthält eine ungültige SLA-Regel.");
    }
    rules.push(parsedRule);
  }

  return {
    rules,
    truncated: typeof data.truncated === "boolean" ? data.truncated : false,
  };
}

function parseEscalationListResponse(value: unknown): EscalationListResponse {
  const data = responseData(value);
  if (!data || !Array.isArray(data.escalations)) {
    throw new Error("Die Antwort für Eskalationen ist unvollständig.");
  }

  const escalations: Escalation[] = [];
  for (const escalation of data.escalations) {
    const parsedEscalation = parseEscalation(escalation);
    if (!parsedEscalation) {
      throw new Error("Die Antwort enthält eine ungültige Eskalation.");
    }
    escalations.push(parsedEscalation);
  }

  return {
    escalations,
    truncated: typeof data.truncated === "boolean" ? data.truncated : false,
  };
}

function parseRuleResponse(value: unknown): SlaRule {
  const data = responseData(value);
  const rule = data ? parseSlaRule(data.rule) : null;
  if (!rule) throw new Error("Die gespeicherte SLA-Regel ist unvollständig.");
  return rule;
}

function parseFormOptions(value: unknown): FormOptions {
  const data = responseData(value);
  if (
    !data ||
    !Array.isArray(data.departments) ||
    !Array.isArray(data.priorities)
  ) {
    throw new Error(
      "Prioritäten und Abteilungen konnten nicht gelesen werden.",
    );
  }

  const departments: Department[] = [];
  for (const department of data.departments) {
    if (
      !isRecord(department) ||
      typeof department.id !== "string" ||
      typeof department.key !== "string" ||
      typeof department.name !== "string" ||
      typeof department.kind !== "string"
    ) {
      throw new Error("Die Abteilungsdaten sind ungültig.");
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
      typeof priority.key !== "string" ||
      typeof priority.label !== "string" ||
      !isFiniteInteger(priority.sort_order)
    ) {
      throw new Error("Die Prioritätsdaten sind ungültig.");
    }
    priorities.push({
      key: priority.key,
      label: priority.label,
      sortOrder: priority.sort_order,
    });
  }

  return { departments, priorities };
}

async function invokeSlaManagement(action: SlaAction): Promise<unknown> {
  if (!supabase) {
    throw new Error("Die Verbindung zu Supabase ist nicht konfiguriert.");
  }

  const { data, error } = await supabase.functions.invoke<unknown>(
    "sla-management",
    { body: action },
  );
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Die SLA-Verwaltung ist derzeit nicht erreichbar.",
      ),
    );
  }
  return data;
}

async function invokeFormOptions(action: FormOptionsAction): Promise<unknown> {
  if (!supabase) {
    throw new Error("Die Verbindung zu Supabase ist nicht konfiguriert.");
  }

  const { data, error } = await supabase.functions.invoke<unknown>(
    "ticket-actions",
    { body: action },
  );
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Die Erfassungsoptionen konnten nicht geladen werden.",
      ),
    );
  }
  return data;
}

function errorStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  if (typeof error.status === "number") return error.status;

  const context = error.context;
  if (context instanceof Response) return context.status;
  if (isRecord(context) && typeof context.status === "number") {
    return context.status;
  }
  return null;
}

function isForbiddenError(error: unknown): boolean {
  return errorStatus(error) === 403;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function formatMinutes(totalMinutes: number): string {
  const days = Math.floor(totalMinutes / 1440);
  const remainingAfterDays = totalMinutes % 1440;
  const hours = Math.floor(remainingAfterDays / 60);
  const minutes = remainingAfterDays % 60;
  const parts: string[] = [];

  if (days > 0) parts.push(`${days} ${days === 1 ? "Tag" : "Tage"}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "Stunde" : "Stunden"}`);
  if (minutes > 0 || parts.length === 0) {
    parts.push(`${minutes} ${minutes === 1 ? "Minute" : "Minuten"}`);
  }
  return parts.join(" ");
}

function formatDate(value: string | null): string {
  if (!value || Number.isNaN(new Date(value).getTime()))
    return "Nicht verfügbar";
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  }).format(new Date(value));
}

function escalationKindLabel(kind: string): string {
  switch (kind) {
    case "technical":
      return "Technisch";
    case "organizational":
      return "Organisatorisch";
    case "sla":
      return "SLA";
    default:
      return kind;
  }
}

function eventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    started: "SLA gestartet",
    paused: "SLA pausiert",
    resumed: "SLA fortgesetzt",
    first_response: "Erste Reaktion",
    response_breached: "Reaktionszeit überschritten",
    resolution_breached: "Lösungszeit überschritten",
    resolved: "Gelöst",
  };
  return labels[eventType] ?? eventType;
}

function validationError(draft: RuleDraft): string | null {
  const name = draft.name.trim();
  const priorityKey = draft.priorityKey.trim();
  if (name.length < 1 || name.length > 160) {
    return "Bitte geben Sie einen Namen mit höchstens 160 Zeichen ein.";
  }
  if (priorityKey.length < 1 || priorityKey.length > 63) {
    return "Bitte wählen Sie eine gültige Priorität aus.";
  }
  if (draft.departmentId && !isUuid(draft.departmentId)) {
    return "Bitte wählen Sie eine gültige Abteilung aus.";
  }

  const responseMinutes = Number(draft.responseMinutes);
  const resolutionMinutes = Number(draft.resolutionMinutes);
  if (
    !Number.isInteger(responseMinutes) ||
    responseMinutes < 1 ||
    responseMinutes > MAX_SLA_MINUTES
  ) {
    return "Die Reaktionszeit muss eine ganze Zahl zwischen 1 und 525.600 Minuten sein.";
  }
  if (
    !Number.isInteger(resolutionMinutes) ||
    resolutionMinutes < 1 ||
    resolutionMinutes > MAX_SLA_MINUTES
  ) {
    return "Die Lösungszeit muss eine ganze Zahl zwischen 1 und 525.600 Minuten sein.";
  }
  return null;
}

function draftFromRule(rule: SlaRule): RuleDraft {
  return {
    name: rule.name,
    priorityKey: rule.priorityKey,
    departmentId: rule.departmentId ?? "",
    responseMinutes: String(rule.responseMinutes),
    resolutionMinutes: String(rule.resolutionMinutes),
    active: rule.active,
  };
}

const slaManagementStyles = `
  .sla-management {
    display: grid;
    gap: 20px;
    color: #173246;
  }
  .sla-management__toolbar,
  .sla-management__heading-row,
  .sla-management__rule-actions,
  .sla-management__form-actions,
  .sla-management__meta,
  .sla-management__escalation-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 9px;
  }
  .sla-management__toolbar,
  .sla-management__heading-row {
    justify-content: space-between;
    gap: 14px;
  }
  .sla-management__toolbar h1,
  .sla-management__toolbar h2 {
    margin: 0;
    font-size: 18px;
  }
  .sla-management__intro {
    margin: 4px 0 0;
    color: #627780;
    font-size: 13px;
    line-height: 1.45;
  }
  .sla-management__button {
    appearance: none;
    border: 1px solid #b9cbd2;
    border-radius: 5px;
    background: #fff;
    color: #1e5166;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    padding: 8px 11px;
  }
  .sla-management__button:hover:not(:disabled) { background: #f1f7f8; }
  .sla-management__button:disabled { cursor: wait; opacity: .62; }
  .sla-management__button--primary {
    border-color: #1c756b;
    background: #1e7b70;
    color: #fff;
  }
  .sla-management__button--primary:hover:not(:disabled) { background: #16685f; }
  .sla-management__button--danger { border-color: #eac2ba; color: #9d3526; }
  .sla-management__panel {
    border: 1px solid #dce7ea;
    border-radius: 8px;
    background: #fff;
    padding: 18px;
  }
  .sla-management__panel h2,
  .sla-management__panel h3 { margin: 0; }
  .sla-management__panel h2 { font-size: 16px; }
  .sla-management__panel h3 { font-size: 14px; }
  .sla-management__message {
    margin: 0;
    border-radius: 6px;
    padding: 11px 13px;
    font-size: 13px;
    line-height: 1.45;
  }
  .sla-management__message--error {
    border: 1px solid #efc6be;
    background: #fff5f2;
    color: #9d3526;
  }
  .sla-management__message--success {
    border: 1px solid #bce2d9;
    background: #effaf7;
    color: #216c5e;
  }
  .sla-management__form {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    margin-top: 15px;
  }
  .sla-management__form label {
    display: grid;
    gap: 6px;
    color: #294858;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: .05em;
    text-transform: uppercase;
  }
  .sla-management__form input,
  .sla-management__form select {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #c4d3d8;
    border-radius: 5px;
    background: #fff;
    color: #173246;
    font: inherit;
    letter-spacing: normal;
    padding: 9px 10px;
    text-transform: none;
  }
  .sla-management__form-help {
    margin: 0;
    color: #687b84;
    font-size: 12px;
    line-height: 1.4;
  }
  .sla-management__checkbox {
    display: flex !important;
    align-items: center;
    gap: 8px !important;
    letter-spacing: normal !important;
    text-transform: none !important;
  }
  .sla-management__checkbox input { width: 16px !important; height: 16px; }
  .sla-management__form-actions { grid-column: 1 / -1; justify-content: flex-end; }
  .sla-management__list {
    display: grid;
    gap: 10px;
    margin: 14px 0 0;
    padding: 0;
    list-style: none;
  }
  .sla-management__rule,
  .sla-management__escalation {
    border: 1px solid #e0e8ea;
    border-radius: 7px;
    padding: 14px;
  }
  .sla-management__rule--inactive { background: #fafcfc; }
  .sla-management__rule-title,
  .sla-management__escalation-title { margin: 0; color: #173246; font-size: 14px; }
  .sla-management__badge {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 4px 8px;
    background: #e5f6f1;
    color: #177c69;
    font-size: 10px;
    font-weight: 800;
  }
  .sla-management__badge--muted { background: #f0f3f4; color: #687b84; }
  .sla-management__badge--alert { background: #fff0eb; color: #a13b27; }
  .sla-management__meta,
  .sla-management__escalation-meta {
    margin: 7px 0 0;
    color: #607781;
    font-size: 12px;
    line-height: 1.45;
  }
  .sla-management__rule-actions { margin-top: 12px; }
  .sla-management__reason { margin: 9px 0 0; color: #365767; font-size: 13px; line-height: 1.45; }
  .sla-management__event { margin: 7px 0 0; color: #687b84; font-size: 12px; }
  .sla-management__empty { margin: 14px 0 0; color: #687b84; font-size: 13px; }
  .sla-management__notice { margin: 10px 0 0; color: #687b84; font-size: 12px; }
  @media (max-width: 680px) {
    .sla-management__form { grid-template-columns: 1fr; }
    .sla-management__form-actions { grid-column: auto; justify-content: flex-start; }
    .sla-management__panel { padding: 15px; }
  }
`;

export function SlaManagement({
  tenantId,
  headingLevel = "h1",
}: SlaManagementProps) {
  const [rules, setRules] = useState<SlaRule[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [options, setOptions] = useState<FormOptions>(EMPTY_OPTIONS);
  const [draft, setDraft] = useState<RuleDraft>(emptyDraft);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<SavingState>(null);
  const [readForbidden, setReadForbidden] = useState(false);
  const [manageForbidden, setManageForbidden] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [rulesTruncated, setRulesTruncated] = useState(false);
  const [escalationsTruncated, setEscalationsTruncated] = useState(false);
  const requestVersion = useRef(0);

  const departmentsById = useMemo(
    () =>
      new Map(
        options.departments.map((department) => [
          department.id,
          department.name,
        ]),
      ),
    [options.departments],
  );
  const prioritiesByKey = useMemo(
    () =>
      new Map(
        options.priorities.map((priority) => [priority.key, priority.label]),
      ),
    [options.priorities],
  );

  const loadData = useCallback(async () => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setLoading(true);
    setError("");
    setSuccess("");
    setReadForbidden(false);

    try {
      const [rulesResponse, escalationsResponse, optionsResponse] =
        await Promise.all([
          invokeSlaManagement({ type: "listRules", tenantId }),
          invokeSlaManagement({
            type: "listEscalations",
            tenantId,
            limit: ESCALATION_LIMIT,
          }),
          invokeFormOptions({ type: "getFormOptions", tenantId }),
        ]);
      const parsedRules = parseSlaListResponse(rulesResponse);
      const parsedEscalations =
        parseEscalationListResponse(escalationsResponse);
      const parsedOptions = parseFormOptions(optionsResponse);
      if (requestVersion.current !== version) return;

      setRules(parsedRules.rules);
      setRulesTruncated(parsedRules.truncated);
      setEscalations(parsedEscalations.escalations);
      setEscalationsTruncated(parsedEscalations.truncated);
      setOptions(parsedOptions);
    } catch (requestError) {
      if (requestVersion.current !== version) return;
      if (isForbiddenError(requestError)) {
        setReadForbidden(true);
      } else {
        setError(
          "SLA-Regeln und Eskalationen konnten nicht geladen werden. Bitte versuchen Sie es erneut.",
        );
      }
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void loadData();
    return () => {
      requestVersion.current += 1;
    };
  }, [loadData]);

  function startCreate() {
    setDraft(emptyDraft());
    setEditingRuleId(null);
    setIsFormVisible(true);
    setError("");
    setSuccess("");
  }

  function startEdit(rule: SlaRule) {
    setDraft(draftFromRule(rule));
    setEditingRuleId(rule.id);
    setIsFormVisible(true);
    setError("");
    setSuccess("");
  }

  function cancelEditing() {
    setDraft(emptyDraft());
    setEditingRuleId(null);
    setIsFormVisible(false);
  }

  async function saveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draftError = validationError(draft);
    if (draftError) {
      setError(draftError);
      setSuccess("");
      return;
    }

    const fields: SaveRuleFields = {
      tenantId,
      name: draft.name.trim(),
      priorityKey: draft.priorityKey.trim(),
      departmentId: draft.departmentId || null,
      responseMinutes: Number(draft.responseMinutes),
      resolutionMinutes: Number(draft.resolutionMinutes),
      active: draft.active,
    };
    const isEditing = editingRuleId !== null;
    const action: CreateRuleAction | UpdateRuleAction = editingRuleId
      ? { type: "saveRule", ruleId: editingRuleId, ...fields }
      : { type: "saveRule", ...fields };

    setSaving(isEditing ? "update" : "create");
    setError("");
    setSuccess("");
    try {
      const savedRule = parseRuleResponse(await invokeSlaManagement(action));
      setRules((current) =>
        [...current.filter((rule) => rule.id !== savedRule.id), savedRule].sort(
          (left, right) => left.name.localeCompare(right.name, "de"),
        ),
      );
      cancelEditing();
      setSuccess(
        isEditing
          ? "Die SLA-Regel wurde gespeichert."
          : "Die SLA-Regel wurde erstellt.",
      );
    } catch (requestError) {
      if (isForbiddenError(requestError)) {
        setManageForbidden(true);
        setError(
          "Sie haben keine Berechtigung, SLA-Regeln zu erstellen oder zu bearbeiten. Wenden Sie sich an eine Person mit der Berechtigung „SLA-Profile verwalten“.",
        );
      } else {
        setError(
          "Die SLA-Regel konnte nicht gespeichert werden. Prüfen Sie Priorität und Abteilung und versuchen Sie es erneut.",
        );
      }
    } finally {
      setSaving(null);
    }
  }

  async function archiveRule(rule: SlaRule) {
    setSaving("archive");
    setError("");
    setSuccess("");
    try {
      const archivedRule = parseRuleResponse(
        await invokeSlaManagement({
          type: "archiveRule",
          tenantId,
          ruleId: rule.id,
        }),
      );
      setRules((current) =>
        current.map((currentRule) =>
          currentRule.id === archivedRule.id ? archivedRule : currentRule,
        ),
      );
      if (editingRuleId === rule.id) cancelEditing();
      setSuccess(`Die SLA-Regel „${rule.name}“ wurde archiviert.`);
    } catch (requestError) {
      if (isForbiddenError(requestError)) {
        setManageForbidden(true);
        setError(
          "Sie haben keine Berechtigung, SLA-Regeln zu archivieren. Wenden Sie sich an eine Person mit der Berechtigung „SLA-Profile verwalten“.",
        );
      } else {
        setError(
          "Die SLA-Regel konnte nicht archiviert werden. Bitte versuchen Sie es erneut.",
        );
      }
    } finally {
      setSaving(null);
    }
  }

  const missingSelectedDepartment =
    Boolean(draft.departmentId) &&
    !options.departments.some(
      (department) => department.id === draft.departmentId,
    );
  const missingSelectedPriority =
    Boolean(draft.priorityKey) &&
    !options.priorities.some((priority) => priority.key === draft.priorityKey);
  const Heading = headingLevel;

  return (
    <section
      className="sla-management"
      aria-labelledby="sla-management-heading"
    >
      <style>{slaManagementStyles}</style>
      <div className="sla-management__toolbar">
        <div>
          <Heading id="sla-management-heading">SLA-Verwaltung</Heading>
          <p className="sla-management__intro">
            Reale SLA-Regeln und die jüngsten Eskalationen dieses Mandanten.
          </p>
        </div>
        <div className="sla-management__toolbar">
          <button
            className="sla-management__button"
            type="button"
            onClick={() => void loadData()}
            disabled={loading || saving !== null}
          >
            Aktualisieren
          </button>
          {!readForbidden && !manageForbidden && (
            <button
              className="sla-management__button sla-management__button--primary"
              type="button"
              onClick={startCreate}
              disabled={loading || saving !== null}
            >
              Neue SLA-Regel
            </button>
          )}
        </div>
      </div>

      {readForbidden && (
        <p
          className="sla-management__message sla-management__message--error"
          role="alert"
        >
          Sie haben keine Berechtigung, SLA-Regeln oder Eskalationen für diesen
          Mandanten anzuzeigen. Bitte wenden Sie sich an eine berechtigte
          Person.
        </p>
      )}
      {error && !readForbidden && (
        <p
          className="sla-management__message sla-management__message--error"
          role="alert"
        >
          {error}
        </p>
      )}
      {success && (
        <p
          className="sla-management__message sla-management__message--success"
          role="status"
        >
          {success}
        </p>
      )}

      {!readForbidden && isFormVisible && (
        <section
          className="sla-management__panel"
          aria-labelledby="sla-rule-form-heading"
        >
          <div className="sla-management__heading-row">
            <h2 id="sla-rule-form-heading">
              {editingRuleId ? "SLA-Regel bearbeiten" : "SLA-Regel erstellen"}
            </h2>
          </div>
          <form className="sla-management__form" onSubmit={saveRule}>
            <label>
              Name der Regel
              <input
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                maxLength={160}
                required
                disabled={saving !== null}
              />
            </label>
            <label>
              Priorität
              <select
                value={draft.priorityKey}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    priorityKey: event.target.value,
                  }))
                }
                required
                disabled={saving !== null || options.priorities.length === 0}
              >
                <option value="">Priorität wählen</option>
                {missingSelectedPriority && (
                  <option value={draft.priorityKey}>
                    {draft.priorityKey} (nicht mehr verfügbar)
                  </option>
                )}
                {options.priorities.map((priority) => (
                  <option key={priority.key} value={priority.key}>
                    {priority.label} ({priority.key})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Abteilung
              <select
                value={draft.departmentId}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    departmentId: event.target.value,
                  }))
                }
                disabled={saving !== null}
              >
                <option value="">Mandantenweit</option>
                {missingSelectedDepartment && (
                  <option value={draft.departmentId}>
                    {draft.departmentId} (nicht mehr aktiv)
                  </option>
                )}
                {options.departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name} ({department.key})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reaktionszeit in Minuten
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max={MAX_SLA_MINUTES}
                step="1"
                value={draft.responseMinutes}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    responseMinutes: event.target.value,
                  }))
                }
                required
                disabled={saving !== null}
              />
            </label>
            <label>
              Lösungszeit in Minuten
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max={MAX_SLA_MINUTES}
                step="1"
                value={draft.resolutionMinutes}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    resolutionMinutes: event.target.value,
                  }))
                }
                required
                disabled={saving !== null}
              />
            </label>
            <label className="sla-management__checkbox">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    active: event.target.checked,
                  }))
                }
                disabled={saving !== null}
              />
              Regel aktiv
            </label>
            <p className="sla-management__form-help">
              Eine mandantenweite Regel kann nur von Personen mit
              mandantenweiter SLA-Berechtigung gespeichert werden.
            </p>
            <div className="sla-management__form-actions">
              <button
                className="sla-management__button"
                type="button"
                onClick={cancelEditing}
                disabled={saving !== null}
              >
                Abbrechen
              </button>
              <button
                className="sla-management__button sla-management__button--primary"
                type="submit"
                disabled={saving !== null || options.priorities.length === 0}
              >
                {saving === "create" || saving === "update"
                  ? "Wird gespeichert …"
                  : "Speichern"}
              </button>
            </div>
          </form>
        </section>
      )}

      {!readForbidden && (
        <section
          className="sla-management__panel"
          aria-labelledby="sla-rules-heading"
          aria-busy={loading}
        >
          <div className="sla-management__heading-row">
            <h2 id="sla-rules-heading">SLA-Regeln</h2>
            <span className="sla-management__badge">
              {rules.length} geladen
            </span>
          </div>
          {loading ? (
            <p className="sla-management__empty">SLA-Regeln werden geladen …</p>
          ) : rules.length === 0 ? (
            <p className="sla-management__empty">
              Für diesen Mandanten sind keine SLA-Regeln hinterlegt.
            </p>
          ) : (
            <ul className="sla-management__list">
              {rules.map((rule) => (
                <li
                  className={`sla-management__rule${rule.active ? "" : " sla-management__rule--inactive"}`}
                  key={rule.id}
                >
                  <div className="sla-management__heading-row">
                    <h3 className="sla-management__rule-title">{rule.name}</h3>
                    <span
                      className={`sla-management__badge${rule.active ? "" : " sla-management__badge--muted"}`}
                    >
                      {rule.active ? "Aktiv" : "Archiviert"}
                    </span>
                  </div>
                  <p className="sla-management__meta">
                    <span>
                      Priorität:{" "}
                      {prioritiesByKey.get(rule.priorityKey) ??
                        rule.priorityKey}
                    </span>
                    <span>
                      Abteilung:{" "}
                      {rule.departmentId
                        ? (departmentsById.get(rule.departmentId) ??
                          rule.departmentId)
                        : "Mandantenweit"}
                    </span>
                    <span>Reaktion: {formatMinutes(rule.responseMinutes)}</span>
                    <span>Lösung: {formatMinutes(rule.resolutionMinutes)}</span>
                  </p>
                  <p className="sla-management__meta">
                    Zuletzt geändert:{" "}
                    {formatDate(rule.updatedAt ?? rule.createdAt)}
                  </p>
                  {!manageForbidden && (
                    <div className="sla-management__rule-actions">
                      <button
                        className="sla-management__button"
                        type="button"
                        onClick={() => startEdit(rule)}
                        disabled={saving !== null}
                      >
                        Bearbeiten
                      </button>
                      {rule.active && (
                        <button
                          className="sla-management__button sla-management__button--danger"
                          type="button"
                          onClick={() => void archiveRule(rule)}
                          disabled={saving !== null}
                        >
                          {saving === "archive"
                            ? "Wird archiviert …"
                            : "Archivieren"}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {rulesTruncated && (
            <p className="sla-management__notice">
              Die Liste wurde aus Leistungsgründen gekürzt.
            </p>
          )}
        </section>
      )}

      {!readForbidden && (
        <section
          className="sla-management__panel"
          aria-labelledby="escalations-heading"
          aria-busy={loading}
        >
          <div className="sla-management__heading-row">
            <h2 id="escalations-heading">Aktuelle Eskalationen</h2>
            <span className="sla-management__badge sla-management__badge--alert">
              {
                escalations.filter(
                  (escalation) => escalation.resolvedAt === null,
                ).length
              }{" "}
              offen
            </span>
          </div>
          {loading ? (
            <p className="sla-management__empty">
              Eskalationen werden geladen …
            </p>
          ) : escalations.length === 0 ? (
            <p className="sla-management__empty">
              Es liegen keine aktuellen Eskalationen vor.
            </p>
          ) : (
            <ul className="sla-management__list">
              {escalations.map((escalation) => {
                const lastEvent = escalation.slaEvents[0];
                return (
                  <li
                    className="sla-management__escalation"
                    key={escalation.id}
                  >
                    <div className="sla-management__heading-row">
                      <h3 className="sla-management__escalation-title">
                        {escalation.ticket
                          ? `${escalation.ticket.ticketNumber}: ${escalation.ticket.subject}`
                          : `Ticket ${escalation.ticketId}`}
                      </h3>
                      <span
                        className={`sla-management__badge${escalation.resolvedAt === null ? " sla-management__badge--alert" : " sla-management__badge--muted"}`}
                      >
                        {escalation.resolvedAt === null ? "Offen" : "Gelöst"}
                      </span>
                    </div>
                    <p className="sla-management__reason">
                      {escalation.reason}
                    </p>
                    <p className="sla-management__escalation-meta">
                      <span>Stufe {escalation.level}</span>
                      <span>Art: {escalationKindLabel(escalation.kind)}</span>
                      <span>Eröffnet: {formatDate(escalation.openedAt)}</span>
                      {escalation.resolvedAt && (
                        <span>Gelöst: {formatDate(escalation.resolvedAt)}</span>
                      )}
                    </p>
                    {lastEvent && (
                      <p className="sla-management__event">
                        Letztes SLA-Ereignis: {eventLabel(lastEvent.eventType)}{" "}
                        · {formatDate(lastEvent.occurredAt)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {escalationsTruncated && (
            <p className="sla-management__notice">
              Es werden die neuesten {ESCALATION_LIMIT} Eskalationen angezeigt.
            </p>
          )}
        </section>
      )}
    </section>
  );
}
