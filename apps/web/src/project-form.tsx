import { type FormEvent, useState } from "react";
import { FormCard, FormDialog, FormField, FormGrid } from "./form-kit";
import {
  type ProjectOptions,
  type ProjectSummary,
  projectsCall,
} from "./lib/projects-api";
import {
  HEALTH_LABELS,
  hoursInput,
  localToday,
  parseHours,
} from "./lib/projects-model";

/** Projektformular sowie Ampel und Balken, die mehrere Ansichten teilen. */

export type ProjectFormState = {
  project: ProjectSummary | null;
  templateId: string;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ProgressBar({
  percent,
  tone = "primary",
  label,
}: {
  percent: number;
  tone?: "primary" | "good" | "warn" | "bad";
  label?: string;
}) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <span
      aria-label={label ?? `${percent} %`}
      className={`pj-bar pj-bar--${tone}`}
      role="img"
    >
      <i style={{ width: `${width}%` }} />
    </span>
  );
}

export function HealthDot({ health }: { health: ProjectSummary["health"] }) {
  return (
    <span
      aria-label={`Ampel ${HEALTH_LABELS[health]}`}
      className={`pj-dot pj-dot--${health}`}
      role="img"
      title={`Ampel ${HEALTH_LABELS[health]}`}
    />
  );
}

export function budgetTone(percent: number | null): "good" | "warn" | "bad" {
  if (percent === null || percent < 80) return "good";
  return percent <= 100 ? "warn" : "bad";
}

function amountInput(cents: number | null): string {
  return cents === null ? "" : String(Math.round(cents) / 100);
}

function parseAmount(value: string): number | null | undefined {
  const trimmed = value
    .trim()
    .replace(/['’\s]/g, "")
    .replace(",", ".");
  if (!trimmed) return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  return Math.round(amount * 100);
}

export function ProjectForm({
  onClose,
  onSaved,
  options,
  state,
  tenantId,
}: {
  onClose: () => void;
  onSaved: (projectId: string) => void;
  options: ProjectOptions;
  state: ProjectFormState;
  tenantId: string;
}) {
  const { project } = state;
  const [title, setTitle] = useState(project?.title ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [managerId, setManagerId] = useState(project?.managerId ?? "");
  const [customerId, setCustomerId] = useState(
    project?.customerOrganizationId ?? "",
  );
  const [locationId, setLocationId] = useState(project?.locationId ?? "");
  const [departmentId, setDepartmentId] = useState(project?.departmentId ?? "");
  const [startsOn, setStartsOn] = useState(
    project ? (project.startsOn ?? "") : localToday(),
  );
  const [endsOn, setEndsOn] = useState(project?.endsOn ?? "");
  const [budgetHours, setBudgetHours] = useState(
    hoursInput(project?.budgetMinutes ?? null),
  );
  const [budgetAmount, setBudgetAmount] = useState(
    amountInput(project?.budgetAmountCents ?? null),
  );
  const [hourlyRate, setHourlyRate] = useState(
    amountInput(project?.hourlyRateCents ?? null),
  );
  const [scheduleMode, setScheduleMode] = useState(
    project?.scheduleMode ?? "auto",
  );
  const [templateId, setTemplateId] = useState(state.templateId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const budgetMinutes = budgetHours.trim() ? parseHours(budgetHours) : null;
    const amount = parseAmount(budgetAmount);
    const rate = parseAmount(hourlyRate);
    if (budgetHours.trim() && budgetMinutes === null) {
      setError("Das Stundenbudget ist keine gültige Zahl.");
      return;
    }
    if (amount === undefined || rate === undefined) {
      setError("Budget und Stundensatz müssen Zahlen sein.");
      return;
    }
    if (startsOn && endsOn && endsOn < startsOn) {
      setError("Das Ende liegt vor dem Start.");
      return;
    }
    setSaving(true);
    setError("");
    const fields = {
      tenantId,
      title,
      description,
      managerId: managerId || null,
      customerOrganizationId: customerId || null,
      locationId: locationId || null,
      departmentId: departmentId || null,
      startsOn: startsOn || null,
      endsOn: endsOn || null,
      budgetMinutes,
      budgetAmountCents: amount,
      hourlyRateCents: rate,
      scheduleMode,
    };
    try {
      if (project) {
        await projectsCall({
          type: "updateProject",
          projectId: project.id,
          ...fields,
        });
        onSaved(project.id);
      } else {
        const created = await projectsCall<{ projectId: string }>({
          type: "createProject",
          templateId: templateId || null,
          ...fields,
        });
        onSaved(created.projectId);
      }
    } catch (nextError) {
      setError(errorText(nextError));
      setSaving(false);
    }
  };

  const select = (
    value: string,
    onChange: (value: string) => void,
    entries: readonly { id: string; name: string }[],
    empty: string,
  ) => (
    <select onChange={(event) => onChange(event.target.value)} value={value}>
      <option value="">{empty}</option>
      {entries.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.name}
        </option>
      ))}
    </select>
  );

  return (
    <FormDialog
      error={error}
      eyebrow="Projekte"
      onClose={onClose}
      onSubmit={(event) => void submit(event)}
      submitDisabled={!title.trim()}
      submitLabel={project ? "Speichern" : "Projekt anlegen"}
      submitting={saving}
      title={project ? `${project.number} bearbeiten` : "Neues Projekt"}
    >
      <FormCard title="Projekt">
        <FormField label="Titel" required>
          <input
            autoFocus
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            required
            value={title}
          />
        </FormField>
        <FormField label="Beschreibung" optional>
          <textarea
            maxLength={20000}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            value={description}
          />
        </FormField>
        {!project && options.templates.length > 0 ? (
          <FormField
            hint="Übernimmt Phasen, Aufgaben, Checklisten, Abhängigkeiten und Termine ab dem Startdatum."
            label="Vorlage"
            optional
          >
            <select
              onChange={(event) => setTemplateId(event.target.value)}
              value={templateId}
            >
              <option value="">Ohne Vorlage</option>
              {options.templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} ({template.itemCount} Elemente)
                </option>
              ))}
            </select>
          </FormField>
        ) : null}
      </FormCard>
      <FormCard title="Zuständigkeit">
        <FormGrid cols={2}>
          <FormField label="Projektleitung">
            {select(managerId, setManagerId, options.people, "Ich selbst")}
          </FormField>
          <FormField label="Abteilung" optional>
            {select(
              departmentId,
              setDepartmentId,
              options.departments,
              "Keine",
            )}
          </FormField>
          <FormField label="Kunde" optional>
            {select(customerId, setCustomerId, options.customers, "Kein Kunde")}
          </FormField>
          <FormField label="Standort" optional>
            {select(
              locationId,
              setLocationId,
              options.locations,
              "Kein Standort",
            )}
          </FormField>
        </FormGrid>
      </FormCard>
      <FormCard title="Zeitraum und Budget">
        <FormGrid cols={2}>
          <FormField label="Start" optional>
            <input
              onChange={(event) => setStartsOn(event.target.value)}
              type="date"
              value={startsOn}
            />
          </FormField>
          <FormField label="Ende" optional>
            <input
              min={startsOn || undefined}
              onChange={(event) => setEndsOn(event.target.value)}
              type="date"
              value={endsOn}
            />
          </FormField>
          <FormField label="Stundenbudget" optional>
            <input
              inputMode="decimal"
              onChange={(event) => setBudgetHours(event.target.value)}
              placeholder="z. B. 120"
              value={budgetHours}
            />
          </FormField>
          <FormField label="Budget in CHF" optional>
            <input
              inputMode="decimal"
              onChange={(event) => setBudgetAmount(event.target.value)}
              placeholder="z. B. 18000"
              value={budgetAmount}
            />
          </FormField>
          <FormField
            hint="Ist-Kosten = gebuchte Stunden × Stundensatz."
            label="Stundensatz in CHF"
            optional
          >
            <input
              inputMode="decimal"
              onChange={(event) => setHourlyRate(event.target.value)}
              placeholder="z. B. 150"
              value={hourlyRate}
            />
          </FormField>
          <FormField
            hint="Automatisch: verzögert sich ein Vorgänger, rücken die Nachfolger sofort nach. Manuell: die Verschiebung wird nur vorgeschlagen."
            label="Terminplanung"
          >
            <select
              onChange={(event) =>
                setScheduleMode(event.target.value as "auto" | "manual")
              }
              value={scheduleMode}
            >
              <option value="auto">Automatisch</option>
              <option value="manual">Manuell</option>
            </select>
          </FormField>
        </FormGrid>
      </FormCard>
    </FormDialog>
  );
}
