import { useCallback, useEffect, useState } from "react";

import { RefreshCw } from "lucide-react";

import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";
import { useTransientSuccessMessage } from "./lib/use-transient-success-message";

export type DepartmentModulesProps = {
  tenantId: string;
  onChanged?: (() => void) | undefined;
};

type ModuleColumn = {
  key: string;
  name: string;
  tenantEnabled: boolean;
};

type DepartmentRow = {
  id: string;
  name: string;
  modules: Record<string, boolean>;
};

type Matrix = {
  modules: ModuleColumn[];
  departments: DepartmentRow[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMatrix(value: unknown): Matrix {
  if (
    !isRecord(value) ||
    !Array.isArray(value.modules) ||
    !Array.isArray(value.departments)
  ) {
    throw new Error("Die Modulübersicht ist unvollständig.");
  }
  const modules: ModuleColumn[] = value.modules.flatMap((entry) =>
    isRecord(entry) && typeof entry.key === "string"
      ? [
          {
            key: entry.key,
            name: typeof entry.name === "string" ? entry.name : entry.key,
            tenantEnabled: entry.tenantEnabled === true,
          },
        ]
      : [],
  );
  const departments: DepartmentRow[] = value.departments.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.name !== "string" ||
      !isRecord(entry.modules)
    ) {
      return [];
    }
    const flags: Record<string, boolean> = {};
    for (const [key, enabled] of Object.entries(entry.modules)) {
      flags[key] = enabled !== false;
    }
    return [{ id: entry.id, name: entry.name, modules: flags }];
  });
  return { modules, departments };
}

async function request(body: Record<string, unknown>): Promise<unknown> {
  if (!supabase) {
    throw new Error("Die Verbindung zu nextDesk ist nicht konfiguriert.");
  }
  const { data, error } = await supabase.functions.invoke<unknown>(
    "tenant-admin-settings",
    { body },
  );
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Die Moduleinstellungen sind derzeit nicht erreichbar.",
      ),
    );
  }
  if (!isRecord(data) || !isRecord(data.data)) {
    throw new Error(
      "Die Moduleinstellungen haben keine verwertbaren Daten geliefert.",
    );
  }
  return data.data;
}

/**
 * Matrix of modules per department. The tenant switch under "Funktionen"
 * stays the master switch; here a department can turn a module off.
 */
export function DepartmentModules({
  tenantId,
  onChanged,
}: DepartmentModulesProps) {
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useTransientSuccessMessage();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMatrix(
        parseMatrix(await request({ type: "listDepartmentModules", tenantId })),
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Moduleinstellungen konnten nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(
    department: DepartmentRow,
    module: ModuleColumn,
    enabled: boolean,
  ) {
    const target = `${department.id}|${module.key}`;
    setSaving(target);
    setError(null);
    setMatrix((current) =>
      current
        ? {
            ...current,
            departments: current.departments.map((row) =>
              row.id === department.id
                ? { ...row, modules: { ...row.modules, [module.key]: enabled } }
                : row,
            ),
          }
        : current,
    );
    try {
      await request({
        type: "setDepartmentModule",
        tenantId,
        departmentId: department.id,
        featureKey: module.key,
        enabled,
      });
      setSuccess(
        `${module.name} ist für ${department.name} ${
          enabled ? "eingeschaltet" : "ausgeschaltet"
        }.`,
      );
      onChanged?.();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Einstellung konnte nicht gespeichert werden.",
      );
      await load();
    } finally {
      setSaving(null);
    }
  }

  return (
    <section
      className="department-modules"
      aria-labelledby="department-modules-heading"
    >
      <div className="department-management__group-heading">
        <div>
          <p className="eyebrow">MODULE</p>
          <h3 id="department-modules-heading">Module pro Abteilung</h3>
          <p>
            Legen Sie fest, welche Abteilung ein Modul nutzt. Wer keiner
            Abteilung angehört, sieht ein Modul, sobald es in mindestens einer
            Abteilung eingeschaltet ist. Module, die unter „Funktionen“
            ausgeschaltet sind, bleiben für alle aus.
          </p>
        </div>
        <button
          disabled={loading || saving !== null}
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} /> Aktualisieren
        </button>
      </div>
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
      {loading && !matrix ? (
        <p className="tenant-admin-settings__loading" role="status">
          Module werden geladen …
        </p>
      ) : matrix && matrix.departments.length === 0 ? (
        <p className="department-management__empty">
          Legen Sie zuerst eine Abteilung an. Bis dahin gilt der Schalter unter
          „Funktionen“ für alle.
        </p>
      ) : matrix ? (
        <div className="department-modules__scroll">
          <table className="department-modules__table">
            <thead>
              <tr>
                <th scope="col">Modul</th>
                {matrix.departments.map((department) => (
                  <th key={department.id} scope="col">
                    {department.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.modules.map((module) => (
                <tr
                  key={module.key}
                  className={module.tenantEnabled ? undefined : "is-off"}
                >
                  <th scope="row">
                    <span>{module.name}</span>
                    {module.tenantEnabled ? null : (
                      <small>Unter „Funktionen“ ausgeschaltet</small>
                    )}
                  </th>
                  {matrix.departments.map((department) => {
                    const enabled = department.modules[module.key] !== false;
                    const target = `${department.id}|${module.key}`;
                    return (
                      <td key={department.id}>
                        <label className="department-modules__switch">
                          <input
                            type="checkbox"
                            role="switch"
                            checked={enabled}
                            disabled={!module.tenantEnabled || saving !== null}
                            aria-label={`${module.name} für ${department.name}`}
                            onChange={(event) =>
                              void toggle(
                                department,
                                module,
                                event.currentTarget.checked,
                              )
                            }
                          />
                          <span aria-hidden="true" />
                          <em>
                            {saving === target
                              ? "Speichert …"
                              : enabled
                                ? "An"
                                : "Aus"}
                          </em>
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
