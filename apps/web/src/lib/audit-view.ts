// Audit-Ansicht: reine Logik ohne Abhängigkeiten (Bereiche, Bezeichnungen,
// Filterprüfung, Schutz vertraulicher Werte, Vorher/Nachher-Vergleich, CSV).
//
// Diese Datei existiert identisch zweimal:
//   supabase/functions/_shared/audit-view.ts (Edge Functions, Deno)
//   apps/web/src/lib/audit-view.ts (Web-App, Vite)
// Ein Vitest-Test prüft, dass beide Kopien übereinstimmen. Änderungen immer in
// beiden Dateien vornehmen.

export const AUDIT_LIST_DEFAULT_LIMIT = 50;
export const AUDIT_LIST_MAX_LIMIT = 200;
export const AUDIT_EXPORT_MAX_ROWS = 10_000;
export const AUDIT_FREE_TEXT_MAX = 200;
export const AUDIT_REDACTED = "[verborgen]";

export const AUDIT_SEVERITIES = [
  "info",
  "warning",
  "security",
  "critical",
] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

export const AUDIT_SEVERITY_LABELS: Record<AuditSeverity, string> = {
  info: "Information",
  warning: "Warnung",
  security: "Sicherheit",
  critical: "Kritisch",
};

export function auditSeverityLabel(severity: string): string {
  return (
    (AUDIT_SEVERITY_LABELS as Record<string, string>)[severity] ?? severity
  );
}

// ---------------------------------------------------------------------------
// Bereiche: Aktionen werden über ihr Präfix einem Bereich zugeordnet. Das
// längste passende Präfix gewinnt (z. B. «tenant.role.» vor «tenant.»).
// ---------------------------------------------------------------------------

export type AuditAreaKey =
  | "tickets"
  | "users"
  | "settings"
  | "assets"
  | "ai"
  | "monitoring"
  | "knowledge"
  | "shop"
  | "events"
  | "onboarding"
  | "other";

export type AuditArea = {
  key: AuditAreaKey;
  label: string;
  prefixes: readonly string[];
};

export const AUDIT_AREAS: readonly AuditArea[] = [
  {
    key: "tickets",
    label: "Tickets",
    prefixes: [
      "ticket.",
      "tickets.",
      "ticketing.",
      "ticket_handover_notes.",
      "ticket_knowledge_articles.",
      "problem.",
      "problems.",
      "problem_tickets.",
      "request.",
      "requester.",
      "email_ingress.",
      "sla.",
    ],
  },
  {
    key: "users",
    label: "Benutzer & Rollen",
    prefixes: [
      "tenant.role.",
      "tenant.user.",
      "tenant.user_invitation.",
      "tenant.invitation.",
      "tenant.admin.",
      "tenant.member.",
      "tenant.sso_",
      "tenant.entra_",
      "team.",
      "department.",
      "delegation.",
      "user.",
      "role.",
    ],
  },
  {
    key: "settings",
    label: "Einstellungen",
    prefixes: [
      "tenant.",
      "audit.",
      "automation.",
      "exchange_mail.",
      "notification.",
      "notifications.",
      "service_status_page.",
      "service_status_maintenance.",
      "platform.",
      "webhooks.",
      "integrations.",
    ],
  },
  {
    key: "assets",
    label: "Assets & Infrastruktur",
    prefixes: [
      "asset.",
      "assets.",
      "asset_inventory.",
      "infrastructure.",
      "inventory.",
      "contract.",
      "contracts.",
      "services.",
      "service_tasks.",
    ],
  },
  {
    key: "ai",
    label: "KI",
    prefixes: ["ai.", "knowledge.article.ai_"],
  },
  { key: "monitoring", label: "Monitoring", prefixes: ["monitoring."] },
  { key: "knowledge", label: "Wissen", prefixes: ["knowledge."] },
  { key: "shop", label: "Shop", prefixes: ["shop."] },
  {
    key: "events",
    label: "Raumbuchungen & Anlässe",
    prefixes: ["event_spaces.", "event."],
  },
  { key: "onboarding", label: "Onboarding", prefixes: ["onboarding."] },
  { key: "other", label: "Sonstiges", prefixes: [] },
];

const AREA_KEYS = new Set<string>(AUDIT_AREAS.map((area) => area.key));

export function isAuditAreaKey(value: unknown): value is AuditAreaKey {
  return typeof value === "string" && AREA_KEYS.has(value);
}

export function auditActionArea(action: string): AuditAreaKey {
  let best: { key: AuditAreaKey; length: number } | null = null;
  for (const area of AUDIT_AREAS) {
    for (const prefix of area.prefixes) {
      if (
        action.startsWith(prefix) &&
        (best === null || prefix.length > best.length)
      ) {
        best = { key: area.key, length: prefix.length };
      }
    }
  }
  return best?.key ?? "other";
}

export function auditAreaLabel(key: AuditAreaKey): string {
  return AUDIT_AREAS.find((area) => area.key === key)?.label ?? key;
}

/**
 * Präfixfilter für die serverseitige Suche: eine Aktion gehört zum Bereich,
 * wenn sie mit einem «include»-Präfix beginnt und mit keinem «exclude»-Präfix
 * (längere Präfixe anderer Bereiche). «include = null» heisst: keine
 * Einschränkung (nur für «Sonstiges», das alle bekannten Präfixe ausschliesst).
 */
export function auditAreaPrefixFilter(key: AuditAreaKey): {
  include: string[] | null;
  exclude: string[];
} {
  const area = AUDIT_AREAS.find((candidate) => candidate.key === key);
  const others = AUDIT_AREAS.filter((candidate) => candidate.key !== key);
  if (!area || area.prefixes.length === 0) {
    return {
      include: null,
      exclude: others.flatMap((candidate) => [...candidate.prefixes]).sort(),
    };
  }
  const exclude = others
    .flatMap((candidate) => [...candidate.prefixes])
    .filter((prefix) =>
      area.prefixes.some(
        (own) => prefix.length > own.length && prefix.startsWith(own),
      ),
    )
    .sort();
  return { include: [...area.prefixes], exclude };
}

// ---------------------------------------------------------------------------
// Lesbare Bezeichnungen für häufige Aktionen. Unbekannte Aktionen werden
// unverändert (technisch) angezeigt.
// ---------------------------------------------------------------------------

export const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  // Tickets
  "ticket.created": "Ticket erstellt",
  "ticket.updated": "Ticket geändert",
  "ticket.deleted": "Ticket gelöscht",
  "tickets.insert": "Ticket erstellt",
  "tickets.update": "Ticket geändert",
  "tickets.delete": "Ticket gelöscht",
  "ticket.status_changed": "Ticketstatus geändert",
  "ticket.assigned": "Ticket zugewiesen",
  "ticket.department_changed": "Ticket in andere Abteilung verschoben",
  "ticket.csv_exported": "Tickets als CSV exportiert",
  "ticket.csv_imported": "Tickets aus CSV importiert",
  "ticket.pdf_exported": "Ticket als PDF exportiert",
  "ticket.template.applied": "Ticketvorlage angewendet",
  "ticket.approval.requested": "Genehmigung angefordert",
  "ticket.approval.decided": "Genehmigung entschieden",
  "ticket.approval.cancelled": "Genehmigung zurückgezogen",
  "ticket.category.insert": "Ticketkategorie erstellt",
  "ticket.category.update": "Ticketkategorie geändert",
  "ticket.category.delete": "Ticketkategorie gelöscht",
  "ticket.custom_field_definition.created": "Zusatzfeld erstellt",
  "ticket.custom_field_definition.updated": "Zusatzfeld geändert",
  "ticket.custom_field_definition.retired": "Zusatzfeld stillgelegt",
  "ticket.custom_fields.updated": "Zusatzfelder eines Tickets geändert",
  "ticket.custom_field.section.created": "Zusatzfeld-Abschnitt erstellt",
  "ticket.custom_field.section.updated": "Zusatzfeld-Abschnitt geändert",
  "ticket.custom_field.layout.reordered": "Zusatzfelder neu angeordnet",
  "ticket.department_question.created": "Abteilungsrückfrage gestellt",
  "ticket.department_question.answered": "Abteilungsrückfrage beantwortet",
  "ticket.email_ingress.created": "Ticket aus E-Mail erstellt",
  "ticket.email_ingress.comment_added": "E-Mail-Antwort als Kommentar erfasst",
  "ticket.knowledge.sent": "Wissensartikel an Anfragende gesendet",
  "ticket.quality.review.submitted": "Qualitätsprüfung erfasst",
  "ticket.quality.review.updated": "Qualitätsprüfung geändert",
  "ticket.satisfaction.submitted": "Zufriedenheitsbewertung abgegeben",
  "ticket.satisfaction.updated": "Zufriedenheitsbewertung geändert",
  "ticket.requester.insert": "Anfragende Person erfasst",
  "ticket.requester.update": "Anfragende Person geändert",
  "ticket.requester.delete": "Anfragende Person entfernt",
  "problem.created_from_tickets": "Problem aus Tickets erstellt",
  "problems.insert": "Problem erstellt",
  "problems.update": "Problem geändert",
  "problems.delete": "Problem gelöscht",
  "email_ingress.rejected": "Eingehende E-Mail abgewiesen",
  // Benutzer & Rollen
  "tenant.role.created": "Rolle erstellt",
  "tenant.role.updated": "Rolle geändert",
  "tenant.role.assigned": "Rolle zugewiesen",
  "tenant.role.revoked": "Rolle entzogen",
  "tenant.user.invited": "Benutzer eingeladen",
  "tenant.user.removed": "Benutzer entfernt",
  "tenant.user.manager_updated": "Vorgesetzte Person geändert",
  "tenant.user_invitation.revoked": "Einladung widerrufen",
  "tenant.admin.invited": "Administrator eingeladen",
  "tenant.invitation.sent": "Einladung versendet",
  "tenant.invitation.prepared": "Einladung vorbereitet",
  "tenant.invitation.accepted": "Einladung angenommen",
  "tenant.invitation.cancelled": "Einladung zurückgezogen",
  "tenant.invitation.failed": "Einladung fehlgeschlagen",
  "tenant.sso_invitation.accepted": "SSO-Einladung angenommen",
  "tenant.sso_person.provisioned": "Person über SSO angelegt",
  "tenant.sso_entra_identity_conflict": "SSO-Identitätskonflikt erkannt",
  "tenant.entra_directory.sync_started": "Verzeichnisabgleich gestartet",
  "tenant.entra_directory.sync_completed": "Verzeichnisabgleich abgeschlossen",
  "tenant.entra_directory.sync_failed": "Verzeichnisabgleich fehlgeschlagen",
  "tenant.entra_directory.configuration_updated":
    "Verzeichnisabgleich konfiguriert",
  "tenant.entra_directory.connection_test_succeeded":
    "Verzeichnisverbindung erfolgreich getestet",
  "tenant.entra_person.agent_requested": "Agentenzugang beantragt",
  "tenant.entra_person.agent_request_revoked": "Agentenantrag widerrufen",
  "team.created": "Team erstellt",
  "team.archived": "Team archiviert",
  "team.members_replaced": "Teammitglieder geändert",
  "team.tickets.reassigned": "Teamtickets neu zugewiesen",
  "department.membership.updated": "Abteilungsmitgliedschaft geändert",
  "department.question_route.saved": "Rückfrage-Weiterleitung gespeichert",
  // Einstellungen
  "tenant.settings.updated": "Mandanteneinstellungen geändert",
  "tenant.data_retention.updated": "Aufbewahrungsrichtlinie geändert",
  "tenant.audit_log.exported": "Änderungsprotokoll exportiert",
  "audit.exported": "Änderungsprotokoll exportiert",
  "automation.policy.updated": "Automationsrichtlinie geändert",
  "automation.ticket_rule.saved": "Ticketregel gespeichert",
  "automation.ticket_rule.deleted": "Ticketregel gelöscht",
  "automation.lifecycle.updated": "Ticket-Lebenszyklus geändert",
  "automation.auto_close.prepared": "Automatisches Schliessen vorbereitet",
  "automation.auto_close.executed": "Tickets automatisch geschlossen",
  "exchange_mail.connection.started": "E-Mail-Verbindung gestartet",
  "exchange_mail.connection.connected": "E-Mail-Postfach verbunden",
  "exchange_mail.connection.failed": "E-Mail-Verbindung fehlgeschlagen",
  "exchange_mail.connection.rejected": "E-Mail-Verbindung abgelehnt",
  "exchange_mail.connection.cancelled": "E-Mail-Verbindung abgebrochen",
  "exchange_mail.channel.activated": "E-Mail-Kanal aktiviert",
  "exchange_mail.channel.paused": "E-Mail-Kanal pausiert",
  "exchange_mail.channel.deleted": "E-Mail-Kanal gelöscht",
  "notification.center.mark_all_read": "Alle Benachrichtigungen gelesen",
  "service_status_page.updated": "Statusseite geändert",
  "platform.tenant.updated": "Mandant durch Plattform geändert",
  // Assets & Infrastruktur
  "assets.insert": "Asset erstellt",
  "assets.update": "Asset geändert",
  "assets.delete": "Asset gelöscht",
  "services.insert": "Service erstellt",
  "services.update": "Service geändert",
  "services.delete": "Service gelöscht",
  "asset.intune_manual_sync.started": "Intune-Abgleich gestartet",
  "asset.intune_manual_sync.succeeded": "Intune-Abgleich erfolgreich",
  "asset.intune_manual_sync.blocked": "Intune-Abgleich blockiert",
  "asset.intune_manual_sync.configuration_updated":
    "Intune-Abgleich konfiguriert",
  "asset.intune_preflight.configuration_updated":
    "Intune-Vorprüfung konfiguriert",
  "inventory.item.upserted": "Lagerartikel gespeichert",
  "inventory.location.upserted": "Lagerort gespeichert",
  "inventory.movement.posted": "Lagerbewegung gebucht",
  "inventory.reservation.created": "Reservation erstellt",
  "inventory.reservation.released": "Reservation freigegeben",
  "inventory.count.started": "Inventur gestartet",
  "inventory.count.closed": "Inventur abgeschlossen",
  "contract.insert": "Vertrag erstellt",
  "contract.update": "Vertrag geändert",
  "contract.delete": "Vertrag gelöscht",
  // KI
  "ai.assist": "KI-Assistent verwendet",
  "ai.anthropic_approval.updated": "KI-Freigabe geändert",
  "knowledge.article.ai_draft_failed": "KI-Artikelentwurf fehlgeschlagen",
  "knowledge.article.ai_suggestion_draft_requested":
    "KI-Artikelentwurf angefordert",
  // Monitoring
  "monitoring.integration.updated": "Monitoring-Anbindung geändert",
  "monitoring.integration.token_rotated":
    "Monitoring-Zugangsschlüssel erneuert",
  "monitoring.ticket.created": "Ticket aus Monitoring-Alarm erstellt",
  // Wissen
  "knowledge.article.created": "Wissensartikel erstellt",
  "knowledge.article.updated": "Wissensartikel geändert",
  "knowledge.article.published": "Wissensartikel veröffentlicht",
  "knowledge.article.deleted": "Wissensartikel gelöscht",
  "knowledge.suggestion.dismissed": "Wissensvorschlag verworfen",
  // Shop
  "shop.order.submitted": "Shop-Bestellung aufgegeben",
  // Raumbuchungen & Onboarding
  "event_spaces.request.created": "Raumanfrage erstellt",
  "event_spaces.request.details_updated": "Raumanfrage geändert",
  "event_spaces.email_ticket_intake.created": "Raumanfrage aus E-Mail erstellt",
  "onboarding.entry.created": "Onboarding erfasst",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export function hasAuditActionLabel(action: string): boolean {
  return Object.prototype.hasOwnProperty.call(AUDIT_ACTION_LABELS, action);
}

export const AUDIT_ENTITY_TYPE_LABELS: Readonly<Record<string, string>> = {
  ticket: "Ticket",
  tickets: "Ticket",
  team: "Team",
  tenant: "Mandant",
  tenant_settings: "Mandanteneinstellungen",
  tenant_membership: "Mitgliedschaft",
  tenant_user_invitation: "Einladung",
  tenant_invitation: "Einladung",
  tenant_role: "Rolle",
  role: "Rolle",
  user_role_assignment: "Rollenzuweisung",
  tenant_entra_directory_person: "Verzeichnisperson",
  tenant_data_retention_policy: "Aufbewahrungsrichtlinie",
  tenant_automation_policy: "Automationsrichtlinie",
  audit_log_export: "Protokollexport",
  exchange_mail_connection: "E-Mail-Verbindung",
  exchange_mail_channel: "E-Mail-Kanal",
  knowledge_article: "Wissensartikel",
  knowledge_suggestion: "Wissensvorschlag",
  article: "Wissensartikel",
  monitoring_integration: "Monitoring-Anbindung",
  asset: "Asset",
  assets: "Asset",
  services: "Service",
  problem: "Problem",
  problems: "Problem",
  contract: "Vertrag",
  shop_catalog_item: "Shop-Artikel",
  shop_order: "Shop-Bestellung",
  service_status_page: "Statusseite",
  ticket_template: "Ticketvorlage",
  ticket_attachment: "Ticketanhang",
  ticket_satisfaction: "Zufriedenheitsbewertung",
  ticket_quality_review: "Qualitätsprüfung",
  ticket_export: "Ticketexport",
  ticket_import: "Ticketimport",
  saved_ticket_view: "Gespeicherte Ansicht",
  ai_provider_approval: "KI-Freigabe",
};

export function auditEntityTypeLabel(entityType: string): string {
  return AUDIT_ENTITY_TYPE_LABELS[entityType] ?? entityType;
}

// ---------------------------------------------------------------------------
// Vertrauliche Werte: Schlüssel mit token, secret, password oder key werden
// unabhängig von der Verschachtelung durch «[verborgen]» ersetzt.
// ---------------------------------------------------------------------------

const SECRET_KEY_PATTERN = /token|secret|password|key/i;
const MAX_REDACTION_DEPTH = 12;

export function isSecretAuditKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function redactAuditSecrets(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    if (depth >= MAX_REDACTION_DEPTH) return AUDIT_REDACTED;
    return value.map((item) => redactAuditSecrets(item, depth + 1));
  }
  if (typeof value === "object" && value !== null) {
    if (depth >= MAX_REDACTION_DEPTH) return AUDIT_REDACTED;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = isSecretAuditKey(key)
        ? AUDIT_REDACTED
        : redactAuditSecrets(item, depth + 1);
    }
    return result;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Vorher/Nachher-Vergleich auf Schlüsselebene.
// ---------------------------------------------------------------------------

export type AuditDiffChange = "added" | "removed" | "changed" | "unchanged";
export type AuditDiffEntry = {
  key: string;
  change: AuditDiffChange;
  before: unknown;
  after: unknown;
};

function asPlainObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = asPlainObject(value);
  if (object) {
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * Vergleicht before_data und after_data Schlüssel für Schlüssel. Ist ein Wert
 * kein Objekt (z. B. null), wird er wie ein leeres Objekt behandelt.
 * Reihenfolge: geänderte, hinzugefügte, entfernte, unveränderte Schlüssel;
 * innerhalb jeder Gruppe alphabetisch.
 */
export function auditDiff(before: unknown, after: unknown): AuditDiffEntry[] {
  const left = asPlainObject(before) ?? {};
  const right = asPlainObject(after) ?? {};
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
  const order: Record<AuditDiffChange, number> = {
    changed: 0,
    added: 1,
    removed: 2,
    unchanged: 3,
  };
  return keys
    .map((key): AuditDiffEntry => {
      const inLeft = Object.prototype.hasOwnProperty.call(left, key);
      const inRight = Object.prototype.hasOwnProperty.call(right, key);
      const change: AuditDiffChange = !inLeft
        ? "added"
        : !inRight
          ? "removed"
          : stableJson(left[key]) === stableJson(right[key])
            ? "unchanged"
            : "changed";
      return {
        key,
        change,
        before: inLeft ? left[key] : undefined,
        after: inRight ? right[key] : undefined,
      };
    })
    .sort(
      (a, b) =>
        order[a.change] - order[b.change] ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
}

export function formatAuditValue(value: unknown): string {
  if (value === undefined) return "–";
  if (value === null) return "leer";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "ja" : "nein";
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Verknüpfung zum betroffenen Objekt.
// ---------------------------------------------------------------------------

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAuditUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export type AuditEntityLink = { kind: "ticket"; ticketId: string };

export function auditEntityLink(
  entityType: string,
  entityId: string | null,
  metadata: unknown,
): AuditEntityLink | null {
  if (
    (entityType === "ticket" || entityType === "tickets") &&
    isAuditUuid(entityId)
  ) {
    return { kind: "ticket", ticketId: entityId.toLowerCase() };
  }
  const object = asPlainObject(metadata);
  const candidate = object?.ticket_id ?? object?.ticketId;
  if (isAuditUuid(candidate)) {
    return { kind: "ticket", ticketId: candidate.toLowerCase() };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Filter: strikte Prüfung der vom Browser gesendeten Filter.
// ---------------------------------------------------------------------------

export type AuditFilters = {
  actorId?: string;
  action?: string;
  area?: AuditAreaKey;
  entityType?: string;
  entityId?: string;
  severity?: AuditSeverity;
  startAt?: string;
  endAt?: string;
  freeText?: string;
};

export const AUDIT_FILTER_KEYS = [
  "actorId",
  "action",
  "area",
  "entityType",
  "entityId",
  "severity",
  "startAt",
  "endAt",
  "freeText",
] as const;

function cleanText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    Array.from(trimmed).length > maximum ||
    // deno-lint-ignore no-control-regex
    /[\u0000-\u001f\u007f]/.test(trimmed) ||
    /[\uD800-\uDFFF]/.test(
      trimmed.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ""),
    )
  ) {
    return null;
  }
  return trimmed;
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

/**
 * Liefert die geprüften Filter oder null, wenn ein Wert ungültig ist.
 * Leere Zeichenketten und null gelten als «nicht gesetzt».
 */
export function parseAuditFilters(value: unknown): AuditFilters | null {
  if (value === undefined || value === null) return {};
  const object = asPlainObject(value);
  if (!object) return null;
  const allowed = new Set<string>(AUDIT_FILTER_KEYS);
  if (!Object.keys(object).every((key) => allowed.has(key))) return null;

  const present = (key: string) =>
    object[key] !== undefined && object[key] !== null && object[key] !== "";
  const filters: AuditFilters = {};

  if (present("actorId")) {
    if (!isAuditUuid(object.actorId)) return null;
    filters.actorId = object.actorId.toLowerCase();
  }
  if (present("entityId")) {
    if (!isAuditUuid(object.entityId)) return null;
    filters.entityId = object.entityId.toLowerCase();
  }
  if (present("action")) {
    const action = cleanText(object.action, 160);
    if (!action || !/^[a-z0-9_.:-]+$/i.test(action)) return null;
    filters.action = action;
  }
  if (present("area")) {
    if (!isAuditAreaKey(object.area)) return null;
    filters.area = object.area;
  }
  if (present("entityType")) {
    const entityType = cleanText(object.entityType, 120);
    if (!entityType || !/^[a-z0-9_.:-]+$/i.test(entityType)) return null;
    filters.entityType = entityType;
  }
  if (present("severity")) {
    if (!(AUDIT_SEVERITIES as readonly unknown[]).includes(object.severity)) {
      return null;
    }
    filters.severity = object.severity as AuditSeverity;
  }
  if (present("startAt")) {
    if (!isIsoTimestamp(object.startAt)) return null;
    filters.startAt = object.startAt;
  }
  if (present("endAt")) {
    if (!isIsoTimestamp(object.endAt)) return null;
    filters.endAt = object.endAt;
  }
  if (
    filters.startAt &&
    filters.endAt &&
    Date.parse(filters.startAt) > Date.parse(filters.endAt)
  ) {
    return null;
  }
  if (present("freeText")) {
    const freeText = cleanText(object.freeText, AUDIT_FREE_TEXT_MAX);
    if (!freeText) return null;
    filters.freeText = freeText;
  }
  return filters;
}

// ---------------------------------------------------------------------------
// CSV: Semikolon, CRLF, UTF-8 mit BOM, deutsche Spaltenköpfe. Zellen, die mit
// =, +, -, @, Tab oder CR beginnen, werden gegen Formel-Injection mit einem
// Apostroph entschärft.
// ---------------------------------------------------------------------------

export type AuditExportEntry = {
  id: string;
  occurredAt: string;
  action: string;
  actorId: string | null;
  actorName: string;
  entityType: string;
  entityId: string | null;
  severity: string;
  metadata: unknown;
  beforeData: unknown;
  afterData: unknown;
};

export const AUDIT_CSV_HEADERS = [
  "Zeitpunkt (UTC)",
  "Bereich",
  "Aktion",
  "Aktion (technisch)",
  "Person",
  "Personen-ID",
  "Objekttyp",
  "Objekt-ID",
  "Schweregrad",
  "Metadaten",
  "Vorher",
  "Nachher",
  "Audit-ID",
] as const;

export function auditCsvCell(value: string | null | undefined): string {
  let normalized = value ?? "";
  if (/^[=+\-@\t\r]/.test(normalized)) normalized = `'${normalized}`;
  return /[";\r\n]/.test(normalized)
    ? `"${normalized.replace(/"/g, '""')}"`
    : normalized;
}

function jsonCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const object = asPlainObject(value);
  if (object && Object.keys(object).length === 0) return "";
  return JSON.stringify(redactAuditSecrets(value));
}

export function auditCsvRow(entry: AuditExportEntry): string {
  return [
    entry.occurredAt,
    auditAreaLabel(auditActionArea(entry.action)),
    auditActionLabel(entry.action),
    entry.action,
    entry.actorName,
    entry.actorId,
    auditEntityTypeLabel(entry.entityType),
    entry.entityId,
    auditSeverityLabel(entry.severity),
    jsonCell(entry.metadata),
    jsonCell(entry.beforeData),
    jsonCell(entry.afterData),
    entry.id,
  ]
    .map(auditCsvCell)
    .join(";");
}

export function auditCsvHeaderLine(): string {
  return AUDIT_CSV_HEADERS.map(auditCsvCell).join(";");
}

export function auditCsvDocument(entries: readonly AuditExportEntry[]): string {
  return `﻿${[auditCsvHeaderLine(), ...entries.map(auditCsvRow)].join("\r\n")}\r\n`;
}
