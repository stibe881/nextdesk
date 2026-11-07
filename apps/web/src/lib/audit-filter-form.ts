import {
  AUDIT_ACTION_LABELS,
  AUDIT_AREAS,
  AUDIT_SEVERITIES,
  auditActionArea,
  isAuditAreaKey,
  type AuditAreaKey,
  type AuditFilters,
  type AuditSeverity,
} from "./audit-view";

/** Eingaben des Filterformulars der Audit-Ansicht (alles als Text). */
export type AuditFilterForm = {
  actorId: string;
  actorLabel: string;
  /** "" | "area:<bereich>" | "action:<aktion>" */
  action: string;
  entityType: string;
  severity: string;
  /** Datum im Format JJJJ-MM-TT (lokale Zeit) */
  from: string;
  to: string;
  freeText: string;
};

export const EMPTY_AUDIT_FILTER_FORM: AuditFilterForm = {
  actorId: "",
  actorLabel: "",
  action: "",
  entityType: "",
  severity: "",
  from: "",
  to: "",
  freeText: "",
};

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Lokaler Tagesbeginn bzw. Tagesende als ISO-Zeitpunkt, sonst null. */
export function localDayBoundary(
  value: string,
  boundary: "start" | "end",
): string | null {
  const match = DATE_PATTERN.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date =
    boundary === "start"
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date.toISOString();
}

/**
 * Wandelt das Formular in die Filter der Edge Function um. Ungültige oder
 * leere Angaben werden weggelassen; liegt «Von» nach «Bis», werden beide
 * Daten getauscht.
 */
export function auditFiltersFromForm(form: AuditFilterForm): AuditFilters {
  const filters: AuditFilters = {};
  if (form.actorId) filters.actorId = form.actorId;
  if (form.action.startsWith("area:")) {
    const area = form.action.slice(5);
    if (isAuditAreaKey(area)) filters.area = area;
  } else if (form.action.startsWith("action:")) {
    const action = form.action.slice(7).trim();
    if (action) filters.action = action;
  }
  if (form.entityType) filters.entityType = form.entityType;
  if ((AUDIT_SEVERITIES as readonly string[]).includes(form.severity)) {
    filters.severity = form.severity as AuditSeverity;
  }
  let start = localDayBoundary(form.from, "start");
  let end = localDayBoundary(form.to, "end");
  if (start && end && Date.parse(start) > Date.parse(end)) {
    start = localDayBoundary(form.to, "start");
    end = localDayBoundary(form.from, "end");
  }
  if (start) filters.startAt = start;
  if (end) filters.endAt = end;
  const freeText = form.freeText.trim().slice(0, 200);
  if (freeText) filters.freeText = freeText;
  return filters;
}

export function activeAuditFilterCount(filters: AuditFilters): number {
  return Object.values(filters).filter((value) => value !== undefined).length;
}

export type AuditActionOption = { value: string; label: string };
export type AuditActionGroup = {
  area: AuditAreaKey;
  label: string;
  options: AuditActionOption[];
};

/**
 * Auswahl «Aktion», gruppiert nach Bereich: zuerst «Alle … », danach die
 * bekannten Aktionen des Bereichs alphabetisch nach Bezeichnung (bei gleicher
 * Bezeichnung mit technischem Namen ergänzt).
 */
export function auditActionGroups(): AuditActionGroup[] {
  return AUDIT_AREAS.map((area) => {
    const entries = Object.entries(AUDIT_ACTION_LABELS).filter(
      ([action]) => auditActionArea(action) === area.key,
    );
    const labelCounts = new Map<string, number>();
    for (const [, label] of entries) {
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    }
    const options = entries
      .map(([action, label]) => ({
        value: `action:${action}`,
        label:
          (labelCounts.get(label) ?? 0) > 1 ? `${label} (${action})` : label,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "de-CH"));
    return {
      area: area.key,
      label: area.label,
      options: [
        { value: `area:${area.key}`, label: `Alle Aktionen: ${area.label}` },
        ...options,
      ],
    };
  });
}

/** Ergänzt das UTF-8-BOM, falls der Browser es beim Dekodieren entfernt hat. */
export function csvWithBom(text: string): string {
  return text.startsWith("﻿") ? text : `﻿${text}`;
}

export function auditExportFileName(
  format: "csv" | "json",
  now = new Date(),
): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `nextdesk-audit-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${format}`;
}
