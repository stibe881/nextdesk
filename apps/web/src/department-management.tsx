import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  Archive,
  Pencil,
  Plus,
  RefreshCw,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";

import {
  shouldShowDepartmentQuestionRouting,
  type DepartmentQuestionRoutingState,
} from "./lib/department-question-routing-visibility";
import {
  archiveDepartmentTeam,
  listDepartmentTeams,
  replaceDepartmentTeamMembers,
  saveDepartmentTeam,
  type DepartmentTeam,
  type DepartmentTeamsList,
} from "./lib/department-teams";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";

export type DepartmentManagementProps = {
  tenantId: string;
};

type Department = {
  id: string;
  key: string;
  name: string;
  kind: "ict" | "infrastructure" | "custom";
  active: boolean;
  createdAt: string;
};

type DepartmentForm = {
  id: string | null;
  name: string;
};

type TeamForm = {
  id: string | null;
  departmentId: string;
  name: string;
};

type DepartmentQuestionRoute = {
  department: Pick<Department, "id" | "key" | "name">;
  primaryUserId: string | null;
  backupUserId: string | null;
  updatedAt: string | null;
  candidates: { userId: string; displayName: string | null }[];
};

type DepartmentRequest =
  | { type: "listDepartments"; tenantId: string }
  | { type: "saveDepartment"; tenantId: string; id?: string; name: string }
  | { type: "archiveDepartment"; tenantId: string; id: string };

const EMPTY_FORM: DepartmentForm = { id: null, name: "" };
const EMPTY_TEAM_FORM: TeamForm = { id: null, departmentId: "", name: "" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDepartment(value: unknown): Department | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const key = value.key;
  const name = value.name;
  const kind = value.kind;
  const active = value.active;
  const createdAt = value.created_at;
  if (
    typeof id !== "string" ||
    typeof key !== "string" ||
    typeof name !== "string" ||
    (kind !== "ict" && kind !== "infrastructure" && kind !== "custom") ||
    typeof active !== "boolean" ||
    typeof createdAt !== "string"
  ) {
    return null;
  }
  return { id, key, name, kind, active, createdAt };
}

function departmentKindLabel(kind: Department["kind"]): string {
  if (kind === "ict") return "ICT";
  if (kind === "infrastructure") return "Infrastruktur";
  return "Eigene Abteilung";
}

async function requestDepartments(body: DepartmentRequest): Promise<unknown> {
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
        "Die Abteilungsverwaltung ist derzeit nicht erreichbar.",
      ),
    );
  }
  if (!isRecord(data) || !isRecord(data.data)) {
    throw new Error(
      "Die Abteilungsverwaltung hat keine verwertbaren Daten geliefert.",
    );
  }
  return data.data;
}

function parseDepartmentList(value: unknown): Department[] {
  if (!isRecord(value) || !Array.isArray(value.departments)) {
    throw new Error("Die Abteilungsliste ist unvollständig.");
  }
  const departments = value.departments.map(parseDepartment);
  if (departments.some((department) => department === null)) {
    throw new Error("Die Abteilungsliste enthält ungültige Daten.");
  }
  return departments as Department[];
}

function parseDepartmentSave(value: unknown): Department {
  if (!isRecord(value)) {
    throw new Error("Die Abteilungsantwort ist unvollständig.");
  }
  const department = parseDepartment(value.department);
  if (!department) {
    throw new Error("Die gespeicherte Abteilung ist unvollständig.");
  }
  return department;
}

async function requestDepartmentQuestions(
  body: Record<string, unknown>,
): Promise<unknown> {
  if (!supabase) {
    throw new Error("Die Verbindung zu nextDesk ist nicht konfiguriert.");
  }
  const { data, error } = await supabase.functions.invoke<unknown>(
    "department-questions",
    { body },
  );
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Die Abteilungsrückfragen sind derzeit nicht erreichbar.",
      ),
    );
  }
  if (!isRecord(data) || !isRecord(data.data)) {
    throw new Error(
      "Die Abteilungsrückfragen haben keine verwertbaren Daten geliefert.",
    );
  }
  return data.data;
}

function parseDepartmentQuestionRoutes(
  value: unknown,
): DepartmentQuestionRoute[] {
  if (!isRecord(value) || !Array.isArray(value.routes)) {
    throw new Error("Die Zuordnung der Abteilungsleitungen ist unvollständig.");
  }
  return value.routes.map((route) => {
    if (
      !isRecord(route) ||
      !isRecord(route.department) ||
      !Array.isArray(route.candidates)
    ) {
      throw new Error(
        "Die Zuordnung der Abteilungsleitungen enthält ungültige Daten.",
      );
    }
    const id = route.department.id;
    const key = route.department.key;
    const name = route.department.name;
    if (
      typeof id !== "string" ||
      typeof key !== "string" ||
      typeof name !== "string"
    ) {
      throw new Error(
        "Die Zuordnung der Abteilungsleitungen enthält ungültige Daten.",
      );
    }
    if (
      (route.primaryUserId !== null &&
        typeof route.primaryUserId !== "string") ||
      (route.backupUserId !== null && typeof route.backupUserId !== "string")
    ) {
      throw new Error(
        "Die Zuordnung der Abteilungsleitungen enthält ungültige Daten.",
      );
    }
    return {
      department: { id, key, name },
      primaryUserId: route.primaryUserId,
      backupUserId: route.backupUserId,
      updatedAt: typeof route.updatedAt === "string" ? route.updatedAt : null,
      candidates: route.candidates.map((candidate) => {
        if (
          !isRecord(candidate) ||
          typeof candidate.userId !== "string" ||
          (candidate.displayName !== null &&
            typeof candidate.displayName !== "string")
        ) {
          throw new Error(
            "Die Auswahlliste der Abteilungsleitungen ist ungültig.",
          );
        }
        return {
          userId: candidate.userId,
          displayName: candidate.displayName,
        };
      }),
    };
  });
}

function DepartmentQuestionRouting({ tenantId }: { tenantId: string }) {
  const [routes, setRoutes] = useState<DepartmentQuestionRoute[]>([]);
  const [state, setState] = useState<DepartmentQuestionRoutingState>("loading");
  const [savingDepartmentId, setSavingDepartmentId] = useState<string | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const data = await requestDepartmentQuestions({
        type: "listRoutes",
        tenantId,
      });
      setRoutes(parseDepartmentQuestionRoutes(data));
      setState("ready");
    } catch (nextError) {
      setRoutes([]);
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Abteilungsleitungen konnten nicht geladen werden.",
      );
      setState("unavailable");
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!shouldShowDepartmentQuestionRouting(state)) return null;

  async function save(route: DepartmentQuestionRoute) {
    if (!route.primaryUserId) {
      setError("Bitte wählen Sie zuerst eine Abteilungsleitung.");
      return;
    }
    setSavingDepartmentId(route.department.id);
    setError("");
    setMessage("");
    try {
      await requestDepartmentQuestions({
        type: "saveRoute",
        tenantId,
        departmentId: route.department.id,
        primaryUserId: route.primaryUserId,
        backupUserId: route.backupUserId,
      });
      setMessage(
        `Die Abteilungsleitung für „${route.department.name}“ wurde gespeichert.`,
      );
      await load();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Abteilungsleitung konnte nicht gespeichert werden.",
      );
    } finally {
      setSavingDepartmentId(null);
    }
  }

  return (
    <section className="department-management__question-routing">
      <div className="department-management__group-heading">
        <div>
          <p className="eyebrow">RÜCKFRAGEN</p>
          <h3>Abteilungsleitungen</h3>
          <p>
            Die zugewiesene Agentin oder der zugewiesene Agent kann eine
            Rückfrage an diese Person richten. Antworten werden dem aktuell
            zugewiesenen Agenten zugestellt.
          </p>
        </div>
        <button
          disabled={state === "loading" || savingDepartmentId !== null}
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
      {message ? (
        <p
          className="tenant-admin-settings__notice tenant-admin-settings__notice--success"
          role="status"
        >
          {message}
        </p>
      ) : null}
      {state === "loading" ? (
        <p className="tenant-admin-settings__loading" role="status">
          Abteilungsleitungen werden geladen …
        </p>
      ) : null}
      {state === "ready" ? (
        <ul className="department-management__list">
          {routes.map((route) => (
            <li key={route.department.id}>
              <div className="department-management__item-main">
                <span className="department-management__icon">
                  <UserRoundCheck aria-hidden="true" size={18} />
                </span>
                <div>
                  <strong>{route.department.name}</strong>
                  <span>
                    Für interne Rückfragen zu Tickets dieser Abteilung
                  </span>
                </div>
              </div>
              <div className="department-management__item-actions">
                {route.candidates.length ? (
                  <>
                    <label>
                      Leitung
                      <select
                        disabled={savingDepartmentId === route.department.id}
                        onChange={(event) =>
                          setRoutes((current) =>
                            current.map((item) =>
                              item.department.id === route.department.id
                                ? {
                                    ...item,
                                    primaryUserId: event.target.value || null,
                                    backupUserId:
                                      event.target.value === item.backupUserId
                                        ? null
                                        : item.backupUserId,
                                  }
                                : item,
                            ),
                          )
                        }
                        value={route.primaryUserId ?? ""}
                      >
                        <option value="">Bitte wählen</option>
                        {route.candidates.map((candidate) => (
                          <option
                            key={candidate.userId}
                            value={candidate.userId}
                          >
                            {candidate.displayName ?? "Person ohne Anzeigename"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Stellvertretung
                      <select
                        disabled={savingDepartmentId === route.department.id}
                        onChange={(event) =>
                          setRoutes((current) =>
                            current.map((item) =>
                              item.department.id === route.department.id
                                ? {
                                    ...item,
                                    backupUserId: event.target.value || null,
                                  }
                                : item,
                            ),
                          )
                        }
                        value={route.backupUserId ?? ""}
                      >
                        <option value="">Keine</option>
                        {route.candidates
                          .filter(
                            (candidate) =>
                              candidate.userId !== route.primaryUserId,
                          )
                          .map((candidate) => (
                            <option
                              key={candidate.userId}
                              value={candidate.userId}
                            >
                              {candidate.displayName ??
                                "Person ohne Anzeigename"}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      className="primary-button"
                      disabled={
                        savingDepartmentId === route.department.id ||
                        !route.primaryUserId
                      }
                      onClick={() => void save(route)}
                      type="button"
                    >
                      {savingDepartmentId === route.department.id
                        ? "Speichert …"
                        : "Speichern"}
                    </button>
                  </>
                ) : (
                  <span>
                    Keine berechtigte Person in dieser Abteilung verfügbar.
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function teamMemberSummary(team: DepartmentTeam): string {
  if (team.members.length === 0) return "Noch keine Mitglieder zugeordnet.";
  const names = team.members.map((member) => member.displayName);
  const visibleNames = names.slice(0, 3).join(", ");
  return names.length > 3
    ? `${visibleNames} und ${names.length - 3} weitere Person(en)`
    : visibleNames;
}

function DepartmentTeams({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<DepartmentTeamsList | null>(null);
  const [dataTenantId, setDataTenantId] = useState<string | null>(null);
  const [form, setForm] = useState<TeamForm>(EMPTY_TEAM_FORM);
  const [formVisible, setFormVisible] = useState(false);
  const [memberEditorTeamId, setMemberEditorTeamId] = useState<string | null>(
    null,
  );
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingTarget, setSavingTarget] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const requestVersion = useRef(0);

  const visibleData = dataTenantId === tenantId ? data : null;
  const activeDepartments = useMemo(
    () =>
      visibleData?.departments.filter((department) => department.active) ?? [],
    [visibleData],
  );
  const activeTeams = useMemo(
    () =>
      visibleData?.teams.filter(
        (team) =>
          team.active &&
          visibleData.departments.some(
            (department) =>
              department.id === team.departmentId && department.active,
          ),
      ) ?? [],
    [visibleData],
  );
  const archivedTeams = useMemo(
    () =>
      visibleData?.teams.filter(
        (team) =>
          !team.active ||
          !visibleData.departments.some(
            (department) =>
              department.id === team.departmentId && department.active,
          ),
      ) ?? [],
    [visibleData],
  );

  const load = useCallback(async (): Promise<boolean> => {
    const currentRequest = requestVersion.current + 1;
    requestVersion.current = currentRequest;
    setLoading(true);
    setData(null);
    setDataTenantId(null);
    setError("");

    try {
      const nextData = await listDepartmentTeams(tenantId);
      if (currentRequest !== requestVersion.current) return false;
      setData(nextData);
      setDataTenantId(tenantId);
      return true;
    } catch (nextError) {
      if (currentRequest !== requestVersion.current) return false;
      setData(null);
      setDataTenantId(null);
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Teams konnten nicht geladen werden.",
      );
      return false;
    } finally {
      if (currentRequest === requestVersion.current) setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    setForm(EMPTY_TEAM_FORM);
    setFormVisible(false);
    setMemberEditorTeamId(null);
    setSelectedMemberIds([]);
    setMessage("");
    void load();
  }, [load]);

  function startCreate() {
    setForm({
      ...EMPTY_TEAM_FORM,
      departmentId: activeDepartments[0]?.id ?? "",
    });
    setFormVisible(true);
    setMemberEditorTeamId(null);
    setMessage("");
    setError("");
  }

  function startEdit(team: DepartmentTeam) {
    setForm({
      id: team.id,
      departmentId: team.departmentId,
      name: team.name,
    });
    setFormVisible(true);
    setMemberEditorTeamId(null);
    setMessage("");
    setError("");
  }

  function openMemberEditor(team: DepartmentTeam) {
    const candidateIds = new Set(
      visibleData?.candidates
        .filter((candidate) =>
          candidate.departmentIds.includes(team.departmentId),
        )
        .map(({ id }) => id),
    );
    setSelectedMemberIds(
      team.members
        .map((member) => member.userId)
        .filter((userId) => candidateIds.has(userId)),
    );
    setMemberEditorTeamId(team.id);
    setFormVisible(false);
    setMessage("");
    setError("");
  }

  function toggleMember(userId: string) {
    setSelectedMemberIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  }

  async function saveTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.trim();
    if (Array.from(name).length < 2 || Array.from(name).length > 120) {
      setError("Der Teamname muss zwischen 2 und 120 Zeichen lang sein.");
      return;
    }
    if (
      !activeDepartments.some(
        (department) => department.id === form.departmentId,
      )
    ) {
      setError("Bitte wählen Sie eine aktive Abteilung für das Team aus.");
      return;
    }

    setSavingTarget("team-form");
    setError("");
    setMessage("");
    try {
      await saveDepartmentTeam({
        tenantId,
        ...(form.id ? { id: form.id } : {}),
        departmentId: form.departmentId,
        name,
      });
      setForm(EMPTY_TEAM_FORM);
      setFormVisible(false);
      if (await load()) {
        setMessage(
          form.id
            ? `Das Team „${name}“ wurde gespeichert.`
            : `Das Team „${name}“ wurde angelegt.`,
        );
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Das Team konnte nicht gespeichert werden.",
      );
    } finally {
      setSavingTarget(null);
    }
  }

  async function archiveTeam(team: DepartmentTeam) {
    setSavingTarget(`archive:${team.id}`);
    setError("");
    setMessage("");
    try {
      await archiveDepartmentTeam({ tenantId, id: team.id });
      if (form.id === team.id) {
        setForm(EMPTY_TEAM_FORM);
        setFormVisible(false);
      }
      if (memberEditorTeamId === team.id) setMemberEditorTeamId(null);
      if (await load()) {
        setMessage(`Das Team „${team.name}“ wurde archiviert.`);
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Das Team konnte nicht archiviert werden.",
      );
    } finally {
      setSavingTarget(null);
    }
  }

  async function saveMembers(team: DepartmentTeam) {
    const candidateIds = new Set(visibleData?.candidates.map(({ id }) => id));
    const userIds = selectedMemberIds.filter((userId) =>
      candidateIds.has(userId),
    );
    if (userIds.length !== selectedMemberIds.length) {
      setError(
        "Die Mitgliederauswahl wurde aktualisiert. Bitte prüfen Sie die Auswahl erneut.",
      );
      return;
    }

    setSavingTarget(`members:${team.id}`);
    setError("");
    setMessage("");
    try {
      await replaceDepartmentTeamMembers({
        tenantId,
        teamId: team.id,
        userIds: [...userIds].sort(),
      });
      setMemberEditorTeamId(null);
      setSelectedMemberIds([]);
      if (await load()) {
        setMessage(`Die Mitglieder von „${team.name}“ wurden gespeichert.`);
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Teammitglieder konnten nicht gespeichert werden.",
      );
    } finally {
      setSavingTarget(null);
    }
  }

  const isSaving = savingTarget !== null;

  return (
    <section
      aria-labelledby="department-teams-heading"
      className="department-management__teams"
    >
      <div className="department-management__team-heading">
        <div>
          <p className="eyebrow">TEAMS</p>
          <h3 id="department-teams-heading">Teams pro Abteilung</h3>
          <p>
            Teammitgliedschaften grenzen Teamtickets zusätzlich ein. Wählbar
            sind aktive Personen derselben Abteilung – auch ohne aktuelle
            Ticketzuweisung.
          </p>
        </div>
        <div className="department-management__header-actions">
          <button
            aria-label="Teams aktualisieren"
            disabled={loading || isSaving}
            onClick={() => void load()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} /> Aktualisieren
          </button>
          <button
            className="primary-button"
            disabled={loading || isSaving}
            onClick={startCreate}
            type="button"
          >
            <Plus aria-hidden="true" size={16} /> Team anlegen
          </button>
        </div>
      </div>

      {error ? (
        <p
          className="tenant-admin-settings__notice tenant-admin-settings__notice--error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          className="tenant-admin-settings__notice tenant-admin-settings__notice--success"
          role="status"
        >
          {message}
        </p>
      ) : null}

      {formVisible ? (
        <form className="department-management__team-form" onSubmit={saveTeam}>
          <div>
            <h4>{form.id ? "Team bearbeiten" : "Neues Team"}</h4>
            <p>Ordnen Sie jedes Team genau einer aktiven Abteilung zu.</p>
          </div>
          <label>
            Name des Teams
            <input
              autoFocus
              disabled={isSaving}
              maxLength={120}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Zum Beispiel Service Desk"
              required
              value={form.name}
            />
          </label>
          <label>
            Abteilung
            <select
              disabled={isSaving}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  departmentId: event.target.value,
                }))
              }
              required
              value={form.departmentId}
            >
              <option value="">Aktive Abteilung auswählen</option>
              {activeDepartments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <div className="department-management__form-actions">
            <button
              className="primary-button"
              disabled={isSaving}
              type="submit"
            >
              {savingTarget === "team-form"
                ? "Wird gespeichert …"
                : form.id
                  ? "Änderungen speichern"
                  : "Team anlegen"}
            </button>
            <button
              disabled={isSaving}
              onClick={() => {
                setForm(EMPTY_TEAM_FORM);
                setFormVisible(false);
              }}
              type="button"
            >
              Abbrechen
            </button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <p className="tenant-admin-settings__loading" role="status">
          Teams werden geladen …
        </p>
      ) : visibleData ? (
        <div className="department-management__team-groups">
          {activeDepartments.length === 0 ? (
            <p className="department-management__empty">
              Es gibt keine aktive Abteilung, der ein Team zugeordnet werden
              kann.
            </p>
          ) : (
            activeDepartments.map((department) => {
              const teams = activeTeams.filter(
                (team) => team.departmentId === department.id,
              );
              const headingId = `department-team-group-${department.id}`;
              return (
                <section aria-labelledby={headingId} key={department.id}>
                  <div className="department-management__group-heading">
                    <h4 id={headingId}>{department.name}</h4>
                    <span>{teams.length}</span>
                  </div>
                  {teams.length === 0 ? (
                    <p className="department-management__empty">
                      Für diese Abteilung gibt es noch kein Team.
                    </p>
                  ) : (
                    <ul className="department-management__list">
                      {teams.map((team) => (
                        <li
                          className="department-management__team-row"
                          key={team.id}
                        >
                          <div className="department-management__item-main">
                            <span className="department-management__icon">
                              <UsersRound aria-hidden="true" size={18} />
                            </span>
                            <div>
                              <strong>{team.name}</strong>
                              <span>{teamMemberSummary(team)}</span>
                            </div>
                          </div>
                          <div className="department-management__item-actions">
                            <button
                              aria-label={`Mitglieder von ${team.name} verwalten`}
                              disabled={isSaving}
                              onClick={() => openMemberEditor(team)}
                              type="button"
                            >
                              Mitglieder verwalten
                            </button>
                            <button
                              aria-label={`Team ${team.name} bearbeiten`}
                              disabled={isSaving}
                              onClick={() => startEdit(team)}
                              type="button"
                            >
                              <Pencil aria-hidden="true" size={15} /> Bearbeiten
                            </button>
                            <button
                              aria-label={`Team ${team.name} archivieren`}
                              disabled={isSaving}
                              onClick={() => void archiveTeam(team)}
                              type="button"
                            >
                              <Archive aria-hidden="true" size={15} />
                              Archivieren
                            </button>
                          </div>
                          {memberEditorTeamId === team.id ? (
                            <div className="department-management__member-editor">
                              <fieldset disabled={isSaving}>
                                <legend>
                                  Mitglieder von „{team.name}“ auswählen
                                </legend>
                                <p>
                                  Diese Zuordnung ist rein organisatorisch und
                                  ändert keine Rollen oder Berechtigungen.
                                </p>
                                {visibleData.candidates.filter((candidate) =>
                                  candidate.departmentIds.includes(
                                    team.departmentId,
                                  ),
                                ).length === 0 ? (
                                  <p className="department-management__empty">
                                    Es sind keine aktiven Personen dieser
                                    Abteilung verfügbar.
                                  </p>
                                ) : (
                                  <div
                                    aria-label={`Aktive Personen aus ${team.name} auswählen`}
                                    className="department-management__member-options"
                                  >
                                    {visibleData.candidates
                                      .filter((candidate) =>
                                        candidate.departmentIds.includes(
                                          team.departmentId,
                                        ),
                                      )
                                      .map((candidate) => (
                                        <label key={candidate.id}>
                                          <input
                                            aria-label={`${candidate.displayName} als Teammitglied auswählen`}
                                            checked={selectedMemberIds.includes(
                                              candidate.id,
                                            )}
                                            onChange={() =>
                                              toggleMember(candidate.id)
                                            }
                                            type="checkbox"
                                          />
                                          <span>{candidate.displayName}</span>
                                        </label>
                                      ))}
                                  </div>
                                )}
                              </fieldset>
                              <div className="department-management__form-actions">
                                <button
                                  className="primary-button"
                                  disabled={isSaving}
                                  onClick={() => void saveMembers(team)}
                                  type="button"
                                >
                                  {savingTarget === `members:${team.id}`
                                    ? "Wird gespeichert …"
                                    : "Mitglieder speichern"}
                                </button>
                                <button
                                  disabled={isSaving}
                                  onClick={() => {
                                    setMemberEditorTeamId(null);
                                    setSelectedMemberIds([]);
                                  }}
                                  type="button"
                                >
                                  Abbrechen
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })
          )}

          {archivedTeams.length > 0 ? (
            <section aria-labelledby="archived-teams-heading">
              <div className="department-management__group-heading">
                <h4 id="archived-teams-heading">Archivierte Teams</h4>
                <span>{archivedTeams.length}</span>
              </div>
              <ul className="department-management__list department-management__list--archived">
                {archivedTeams.map((team) => (
                  <li className="department-management__team-row" key={team.id}>
                    <div className="department-management__item-main">
                      <span className="department-management__icon">
                        <Archive aria-hidden="true" size={18} />
                      </span>
                      <div>
                        <strong>{team.name}</strong>
                        <span>{teamMemberSummary(team)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function DepartmentManagement({ tenantId }: DepartmentManagementProps) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState<DepartmentForm>(EMPTY_FORM);
  const [formVisible, setFormVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const activeDepartments = useMemo(
    () => departments.filter((department) => department.active),
    [departments],
  );
  const archivedDepartments = useMemo(
    () => departments.filter((department) => !department.active),
    [departments],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await requestDepartments({
        type: "listDepartments",
        tenantId,
      });
      setDepartments(parseDepartmentList(data));
    } catch (nextError) {
      setDepartments([]);
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Abteilungen konnten nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setForm(EMPTY_FORM);
    setFormVisible(false);
    setMessage("");
    setError("");
  }, [tenantId]);

  function startCreate() {
    setForm(EMPTY_FORM);
    setFormVisible(true);
    setMessage("");
    setError("");
  }

  function startEdit(department: Department) {
    setForm({ id: department.id, name: department.name });
    setFormVisible(true);
    setMessage("");
    setError("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.trim();
    if (Array.from(name).length < 2 || Array.from(name).length > 120) {
      setError("Der Abteilungsname muss zwischen 2 und 120 Zeichen lang sein.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const data = await requestDepartments({
        type: "saveDepartment",
        tenantId,
        ...(form.id ? { id: form.id } : {}),
        name,
      });
      const saved = parseDepartmentSave(data);
      setDepartments((current) =>
        [
          ...current.filter((department) => department.id !== saved.id),
          saved,
        ].sort((left, right) => left.name.localeCompare(right.name, "de-CH")),
      );
      setForm(EMPTY_FORM);
      setFormVisible(false);
      setMessage(
        form.id
          ? `Die Abteilung „${saved.name}“ wurde gespeichert.`
          : `Die Abteilung „${saved.name}“ wurde angelegt.`,
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Abteilung konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function archive(department: Department) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const data = await requestDepartments({
        type: "archiveDepartment",
        tenantId,
        id: department.id,
      });
      const saved = parseDepartmentSave(data);
      setDepartments((current) =>
        current
          .map((item) => (item.id === saved.id ? saved : item))
          .sort((left, right) => left.name.localeCompare(right.name, "de-CH")),
      );
      if (form.id === saved.id) {
        setForm(EMPTY_FORM);
        setFormVisible(false);
      }
      setMessage(`Die Abteilung „${saved.name}“ wurde archiviert.`);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Abteilung konnte nicht archiviert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="department-management-heading"
      className="tenant-admin-settings__section department-management"
    >
      <div className="tenant-admin-settings__section-heading department-management__heading">
        <div>
          <p className="eyebrow">STRUKTUR</p>
          <h2 id="department-management-heading">Abteilungen</h2>
          <p>
            Abteilungen steuern Zuständigkeiten, Ticketzuordnung und die Auswahl
            von Agent*innen. Personen werden im Bereich „Personen“ einer
            Abteilung zugeordnet. Teams organisieren die Zusammenarbeit
            innerhalb einer Abteilung und verleihen keine Rechte.
          </p>
        </div>
        <div className="department-management__header-actions">
          <button
            disabled={loading || saving}
            onClick={() => void load()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} /> Aktualisieren
          </button>
          <button
            className="primary-button"
            disabled={saving}
            onClick={startCreate}
            type="button"
          >
            <Plus aria-hidden="true" size={16} /> Abteilung anlegen
          </button>
        </div>
      </div>

      {error ? (
        <p
          className="tenant-admin-settings__notice tenant-admin-settings__notice--error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          className="tenant-admin-settings__notice tenant-admin-settings__notice--success"
          role="status"
        >
          {message}
        </p>
      ) : null}

      {formVisible ? (
        <form className="department-management__form" onSubmit={save}>
          <div>
            <h3>{form.id ? "Abteilung bearbeiten" : "Neue Abteilung"}</h3>
            <p>
              Die technische Kennung wird beim Anlegen sicher aus dem Namen
              erzeugt und danach beibehalten.
            </p>
          </div>
          <label>
            Name der Abteilung
            <input
              autoFocus
              disabled={saving}
              maxLength={120}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Zum Beispiel ICT oder Finanzen"
              required
              value={form.name}
            />
          </label>
          <div className="department-management__form-actions">
            <button className="primary-button" disabled={saving} type="submit">
              {saving
                ? "Wird gespeichert …"
                : form.id
                  ? "Änderungen speichern"
                  : "Abteilung anlegen"}
            </button>
            <button
              disabled={saving}
              onClick={() => {
                setForm(EMPTY_FORM);
                setFormVisible(false);
              }}
              type="button"
            >
              Abbrechen
            </button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <p className="tenant-admin-settings__loading" role="status">
          Abteilungen werden geladen …
        </p>
      ) : (
        <div className="department-management__groups">
          <section aria-labelledby="active-departments-heading">
            <div className="department-management__group-heading">
              <h3 id="active-departments-heading">Aktive Abteilungen</h3>
              <span>{activeDepartments.length}</span>
            </div>
            {activeDepartments.length === 0 ? (
              <p className="department-management__empty">
                Es gibt noch keine aktive Abteilung.
              </p>
            ) : (
              <ul className="department-management__list">
                {activeDepartments.map((department) => (
                  <li key={department.id}>
                    <div className="department-management__item-main">
                      <span className="department-management__icon">
                        <UsersRound aria-hidden="true" size={18} />
                      </span>
                      <div>
                        <strong>{department.name}</strong>
                        <span>
                          {departmentKindLabel(department.kind)} · Kennung:{" "}
                          {department.key}
                        </span>
                      </div>
                    </div>
                    <div className="department-management__item-actions">
                      <button
                        disabled={saving}
                        onClick={() => startEdit(department)}
                        type="button"
                      >
                        <Pencil aria-hidden="true" size={15} /> Bearbeiten
                      </button>
                      <button
                        disabled={saving}
                        onClick={() => void archive(department)}
                        type="button"
                      >
                        <Archive aria-hidden="true" size={15} /> Archivieren
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {archivedDepartments.length > 0 ? (
            <section aria-labelledby="archived-departments-heading">
              <div className="department-management__group-heading">
                <h3 id="archived-departments-heading">Archiviert</h3>
                <span>{archivedDepartments.length}</span>
              </div>
              <ul className="department-management__list department-management__list--archived">
                {archivedDepartments.map((department) => (
                  <li key={department.id}>
                    <div className="department-management__item-main">
                      <span className="department-management__icon">
                        <Archive aria-hidden="true" size={18} />
                      </span>
                      <div>
                        <strong>{department.name}</strong>
                        <span>
                          {departmentKindLabel(department.kind)} · Kennung:{" "}
                          {department.key}
                        </span>
                      </div>
                    </div>
                    <button
                      disabled={saving}
                      onClick={() => startEdit(department)}
                      type="button"
                    >
                      <Pencil aria-hidden="true" size={15} /> Öffnen
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
      <DepartmentTeams tenantId={tenantId} />
      <DepartmentQuestionRouting tenantId={tenantId} />
    </section>
  );
}
