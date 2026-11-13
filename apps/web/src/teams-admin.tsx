import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PeoplePicker } from "./shop-teams";
import {
  describeHistory,
  lifeProgress,
  matchesTeamFilter,
  sortTeams,
  TEAM_FILTERS,
  TEAM_SORTS,
  teamColor,
  teamInitials,
  teamKpis,
  teamsAdminApi,
  type AdminTeam,
  type AdminTeamMember,
  type TeamFilter,
  type TeamHistoryEvent,
  type TeamSort,
} from "./lib/teams-admin";
import { addMonthsIso, EXTENSIONS, formatTeamDate } from "./lib/teams";
import "./teams-admin.css";

/** Menü «Teams»: alle Teams ansehen und verwalten (Berechtigung shop.manage). */

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function statusPill(team: AdminTeam) {
  if (team.archived) return { label: "Archiviert", tone: "mute" };
  if (team.ownerCount === 0) return { label: "Verwaist", tone: "bad" };
  if (team.daysLeft !== null && team.daysLeft <= 30) {
    return { label: "Läuft ab", tone: "warn" };
  }
  return { label: "Aktiv", tone: "ok" };
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="teams-admin__avatar"
      style={{ background: teamColor(name) }}
    >
      {teamInitials(name)}
    </span>
  );
}

function Lifetime({ team, today }: { team: AdminTeam; today: string }) {
  const progress = lifeProgress(team, today);
  if (progress === null || team.endDate === null) {
    return <span className="teams-admin__muted">kein Ende</span>;
  }
  const soon = team.daysLeft !== null && team.daysLeft <= 30;
  return (
    <div className="teams-admin__life">
      <div className="teams-admin__track">
        <i
          className={soon ? "is-warn" : ""}
          style={{ width: `${Math.max(3, progress)}%` }}
        />
      </div>
      <span className={soon ? "is-warn" : "teams-admin__muted"}>
        {team.daysLeft !== null && team.daysLeft <= 0
          ? "endet heute"
          : `noch ${team.daysLeft} Tag(e)`}
      </span>
    </div>
  );
}

export function TeamsAdmin({
  tenantId,
  today,
}: {
  tenantId: string;
  today: string;
}) {
  const [teams, setTeams] = useState<AdminTeam[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [filter, setFilter] = useState<TeamFilter>("all");
  const [sort, setSort] = useState<TeamSort>("name");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const result = await teamsAdminApi.list(tenantId);
    setTeams(Array.isArray(result.teams) ? result.teams : []);
    setSyncedAt(result.syncedAt);
    return result;
  }, [tenantId]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError("");
    try {
      await teamsAdminApi.sync(tenantId);
      await load();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Abgleich fehlgeschlagen.",
      );
    } finally {
      setSyncing(false);
    }
  }, [load, tenantId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    load()
      .then((result) => {
        const stale =
          !result.syncedAt ||
          Date.now() - new Date(result.syncedAt).getTime() > STALE_AFTER_MS;
        if (active && stale) void sync();
      })
      .catch((nextError: Error) => active && setError(nextError.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [load, sync]);

  const kpis = useMemo(() => teamKpis(teams), [teams]);
  const guestTeams = useMemo(
    () => teams.filter((team) => matchesTeamFilter(team, "guests")).length,
    [teams],
  );
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("de-CH");
    return sortTeams(
      teams.filter(
        (team) =>
          matchesTeamFilter(team, filter) &&
          (!term ||
            team.name.toLocaleLowerCase("de-CH").includes(term) ||
            (team.description ?? "")
              .toLocaleLowerCase("de-CH")
              .includes(term) ||
            team.owners.some((owner) =>
              owner.toLocaleLowerCase("de-CH").includes(term),
            )),
      ),
      sort,
    );
  }, [teams, filter, query, sort]);
  const selected = teams.find((team) => team.teamId === selectedId) ?? null;
  const checkedTeams = teams.filter((team) => checked.has(team.teamId));
  const allVisibleChecked =
    visible.length > 0 && visible.every((team) => checked.has(team.teamId));

  const toggle = (teamId: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });

  const tile = (
    key: TeamFilter,
    label: string,
    value: number,
    tone: "bad" | "warn" | "info" | "",
    hint: string,
  ) => (
    <button
      className={`teams-admin__tile${tone ? ` is-${tone}` : ""}${filter === key ? " is-active" : ""}`}
      onClick={() => setFilter(filter === key && key !== "all" ? "all" : key)}
      type="button"
    >
      <small>{label}</small>
      <b>{value}</b>
      <em>{hint}</em>
    </button>
  );

  return (
    <section className="teams-admin" aria-label="Teams">
      <div className="teams-admin__tiles">
        {tile(
          "no_owner",
          "Brauchen einen Owner",
          kpis.noOwner,
          kpis.noOwner > 0 ? "bad" : "",
          "Jetzt zuweisen →",
        )}
        {tile(
          "expiring",
          "Laufen in 30 Tagen ab",
          kpis.expiring,
          kpis.expiring > 0 ? "warn" : "",
          "Ansehen →",
        )}
        {tile("guests", "Teams mit Gästen", guestTeams, "info", "Ansehen →")}
        {tile(
          "all",
          `Teams gesamt · ${kpis.archived} archiviert`,
          kpis.total,
          "",
          "Alle anzeigen →",
        )}
      </div>

      <div className="teams-admin__toolbar">
        <input
          aria-label="Teams durchsuchen"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Team, Beschreibung oder Owner suchen …"
          type="search"
          value={query}
        />
        <div className="teams-admin__filters">
          {TEAM_FILTERS.map((option) => (
            <button
              aria-pressed={filter === option.key}
              className={filter === option.key ? "is-on" : ""}
              key={option.key}
              onClick={() => setFilter(option.key)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <select
          aria-label="Sortierung"
          onChange={(event) => setSort(event.target.value as TeamSort)}
          value={sort}
        >
          {TEAM_SORTS.map((option) => (
            <option key={option.key} value={option.key}>
              Sortiert: {option.label}
            </option>
          ))}
        </select>
        <button
          className="secondary-button"
          disabled={syncing}
          onClick={() => void sync()}
          type="button"
        >
          {syncing ? "Gleicht ab …" : "Mit Microsoft abgleichen"}
        </button>
      </div>
      <p className="teams-admin__hint">
        {syncedAt
          ? `Stand ${new Date(syncedAt).toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" })} · ${visible.length} von ${teams.length} Teams`
          : "Noch nicht abgeglichen."}
      </p>
      {error ? (
        <p className="fk-error" role="alert">
          {error}
        </p>
      ) : null}

      {checkedTeams.length > 0 ? (
        <BulkBar
          onClear={() => setChecked(new Set())}
          onDone={() => void load()}
          teams={checkedTeams}
          tenantId={tenantId}
          today={today}
        />
      ) : null}

      <div className={`teams-admin__layout${selected ? " has-detail" : ""}`}>
        <div className="teams-admin__list">
          {loading && teams.length === 0 ? (
            <p className="empty-state">Teams werden geladen …</p>
          ) : visible.length === 0 ? (
            <p className="empty-state">Keine Teams für diese Auswahl.</p>
          ) : (
            <>
              <div className="teams-admin__row teams-admin__row--head">
                <input
                  aria-label="Alle sichtbaren Teams auswählen"
                  checked={allVisibleChecked}
                  onChange={() =>
                    setChecked(
                      allVisibleChecked
                        ? new Set()
                        : new Set(visible.map((team) => team.teamId)),
                    )
                  }
                  type="checkbox"
                />
                <span>Team</span>
                <span>Owner · Mitglieder</span>
                <span>Erstellt</span>
                <span>Laufzeit</span>
                <span>Status</span>
              </div>
              {visible.map((team) => {
                const pill = statusPill(team);
                return (
                  <div
                    className={`teams-admin__row${team.teamId === selectedId ? " is-selected" : ""}`}
                    key={team.teamId}
                  >
                    <input
                      aria-label={`${team.name} auswählen`}
                      checked={checked.has(team.teamId)}
                      onChange={() => toggle(team.teamId)}
                      type="checkbox"
                    />
                    <button
                      className="teams-admin__name"
                      onClick={() => setSelectedId(team.teamId)}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className="teams-admin__icon"
                        style={{ background: teamColor(team.name) }}
                      >
                        {teamInitials(team.name)}
                      </span>
                      <span className="teams-admin__nm">
                        <b>{team.name}</b>
                        <small>
                          <span className="teams-admin__pill is-brand">
                            {team.visibility === "public"
                              ? "Öffentlich"
                              : "Privat"}
                          </span>
                          <span
                            className={`teams-admin__pill ${team.source === "order" ? "is-info" : "is-mute"}`}
                          >
                            {team.source === "order"
                              ? "über nextDesk"
                              : "bestehend"}
                          </span>
                          {(team.guestCount ?? 0) > 0 ? (
                            <span className="teams-admin__pill is-warn">
                              {team.guestCount} Gast
                            </span>
                          ) : null}
                          {team.description ? (
                            <span className="teams-admin__desc">
                              {team.description}
                            </span>
                          ) : null}
                        </small>
                      </span>
                    </button>
                    <div className="teams-admin__owners">
                      {team.ownerCount === 0 ? (
                        <button
                          className="teams-admin__pill is-bad"
                          onClick={() => setSelectedId(team.teamId)}
                          type="button"
                        >
                          kein Owner · festlegen
                        </button>
                      ) : (
                        <span
                          className="teams-admin__avatars"
                          title={team.owners.join(", ")}
                        >
                          {team.owners.slice(0, 3).map((owner) => (
                            <Avatar key={owner} name={owner} />
                          ))}
                          {team.ownerCount > 3 ? (
                            <em>+{team.ownerCount - 3}</em>
                          ) : null}
                        </span>
                      )}
                      <small className="teams-admin__muted">
                        {team.memberCount !== null
                          ? `${team.memberCount} Mitgl.`
                          : "–"}
                      </small>
                    </div>
                    <span className="teams-admin__small">
                      {team.createdAt
                        ? formatTeamDate(team.createdAt.slice(0, 10))
                        : "–"}
                    </span>
                    <Lifetime team={team} today={today} />
                    <span className={`teams-admin__pill is-${pill.tone}`}>
                      {pill.label}
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </div>
        {selected ? (
          <TeamDetail
            key={selected.teamId}
            onChanged={() => void load()}
            onClose={() => setSelectedId(null)}
            team={selected}
            tenantId={tenantId}
            today={today}
          />
        ) : null}
      </div>
    </section>
  );
}

function BulkBar({
  onClear,
  onDone,
  teams,
  tenantId,
  today,
}: {
  onClear: () => void;
  onDone: () => void;
  teams: AdminTeam[];
  tenantId: string;
  today: string;
}) {
  const [mode, setMode] = useState<"end" | "owner" | null>(null);
  const [endDate, setEndDate] = useState(addMonthsIso(today, 12));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const runAll = async (
    label: string,
    work: (team: AdminTeam) => Promise<unknown>,
  ) => {
    setBusy(true);
    setMessage("");
    const failed: string[] = [];
    for (const team of teams) {
      try {
        await work(team);
      } catch (nextError) {
        failed.push(
          `${team.name}: ${nextError instanceof Error ? nextError.message : "Fehler"}`,
        );
      }
    }
    setBusy(false);
    onDone();
    if (failed.length === 0) {
      setMessage(`${label}: ${teams.length} Team(s) erledigt.`);
      setMode(null);
    } else {
      setMessage(
        `${label}: ${teams.length - failed.length} erledigt, ${failed.length} fehlgeschlagen. ${failed.slice(0, 3).join(" · ")}`,
      );
    }
  };

  return (
    <div
      className="teams-admin__bulk"
      role="region"
      aria-label="Mehrfachauswahl"
    >
      <div className="teams-admin__bulk-row">
        <b>{teams.length} ausgewählt</b>
        <span className="teams-admin__spacer" />
        <button
          disabled={busy}
          onClick={() => setMode(mode === "end" ? null : "end")}
          type="button"
        >
          Ende setzen …
        </button>
        <button
          disabled={busy}
          onClick={() => setMode(mode === "owner" ? null : "owner")}
          type="button"
        >
          Owner hinzufügen …
        </button>
        <button
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                `${teams.length} Team(s) archivieren? Die Teams bleiben lesbar und lassen sich wiederherstellen.`,
              )
            ) {
              void runAll("Archivieren", (team) =>
                teamsAdminApi.archive(tenantId, team.teamId, true),
              );
            }
          }}
          type="button"
        >
          Archivieren
        </button>
        <button disabled={busy} onClick={onClear} type="button">
          Auswahl aufheben
        </button>
      </div>
      {mode === "end" ? (
        <div className="teams-admin__bulk-row">
          <input
            min={today}
            onChange={(event) => setEndDate(event.target.value)}
            type="date"
            value={endDate}
          />
          <button
            disabled={busy || endDate <= today}
            onClick={() =>
              void runAll("Ende setzen", (team) =>
                teamsAdminApi.setEnd(tenantId, team.teamId, endDate),
              )
            }
            type="button"
          >
            {busy ? "Läuft …" : "Für alle übernehmen"}
          </button>
        </div>
      ) : null}
      {mode === "owner" ? (
        <div className="teams-admin__bulk-picker">
          <PeoplePicker
            label="Person als Owner hinzufügen"
            onChange={(added) => {
              const person = added[added.length - 1];
              if (person) {
                void runAll("Owner hinzufügen", (team) =>
                  teamsAdminApi.addMember(
                    tenantId,
                    team.teamId,
                    person.id,
                    true,
                  ),
                );
              }
            }}
            selected={[]}
            tenantId={tenantId}
          />
        </div>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}

type DetailTab = "overview" | "people" | "history";

function TeamDetail({
  onChanged,
  onClose,
  team,
  tenantId,
  today,
}: {
  onChanged: () => void;
  onClose: () => void;
  team: AdminTeam;
  tenantId: string;
  today: string;
}) {
  const [tab, setTab] = useState<DetailTab>(
    team.ownerCount === 0 ? "people" : "overview",
  );
  const [members, setMembers] = useState<AdminTeamMember[] | null>(null);
  const [history, setHistory] = useState<TeamHistoryEvent[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [endInput, setEndInput] = useState(team.endDate ?? "");

  const loadMembers = useCallback(() => {
    teamsAdminApi
      .members(tenantId, team.teamId)
      .then(setMembers)
      .catch((nextError: Error) => setError(nextError.message));
  }, [team.teamId, tenantId]);

  useEffect(() => {
    if (tab === "people" && members === null) loadMembers();
    if (tab === "history" && history === null) {
      teamsAdminApi
        .history(tenantId, team.teamId)
        .then(setHistory)
        .catch((nextError: Error) => setError(nextError.message));
    }
  }, [tab, members, history, loadMembers, tenantId, team.teamId]);

  const run = async (
    work: () => Promise<unknown>,
    reload: { members?: boolean } = {},
  ) => {
    setBusy(true);
    setError("");
    try {
      await work();
      onChanged();
      setHistory(null);
      if (reload.members) loadMembers();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Aktion fehlgeschlagen.",
      );
    } finally {
      setBusy(false);
    }
  };

  const base = team.endDate ?? today;
  const owners = members?.filter((member) => member.isOwner) ?? [];
  const regular =
    members?.filter((member) => !member.isOwner && !member.isGuest) ?? [];
  const guests = members?.filter((member) => member.isGuest) ?? [];
  const personRow = (member: AdminTeamMember) => (
    <li key={member.membershipId}>
      <Avatar name={member.displayName} />
      <span className="teams-admin__grow">
        {member.displayName}
        {member.email ? <small>{member.email}</small> : null}
      </span>
      {!member.isGuest ? (
        <button
          className="text-button"
          disabled={busy}
          onClick={() =>
            void run(
              () =>
                teamsAdminApi.setOwner(
                  tenantId,
                  team.teamId,
                  member.membershipId,
                  !member.isOwner,
                ),
              {
                members: true,
              },
            )
          }
          type="button"
        >
          {member.isOwner ? "Kein Owner mehr" : "Zum Owner"}
        </button>
      ) : null}
      <button
        aria-label={`${member.displayName} entfernen`}
        className="text-button"
        disabled={busy}
        onClick={() =>
          void run(
            () =>
              teamsAdminApi.removeMember(
                tenantId,
                team.teamId,
                member.membershipId,
              ),
            { members: true },
          )
        }
        type="button"
      >
        <X aria-hidden="true" size={14} />
      </button>
    </li>
  );

  return (
    <aside className="teams-admin__drawer" aria-label={`Details ${team.name}`}>
      <header className="teams-admin__drawer-head">
        <div className="teams-admin__drawer-top">
          <span className="teams-admin__pill is-glass">
            {team.visibility === "public" ? "Öffentlich" : "Privat"} ·{" "}
            {team.source === "order" ? "über nextDesk" : "bestehend"}
          </span>
          <button aria-label="Schliessen" onClick={onClose} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        <h3>{team.name}</h3>
        <span>
          {team.description ? `${team.description} · ` : ""}
          {team.createdAt
            ? `erstellt am ${formatTeamDate(team.createdAt.slice(0, 10))}`
            : ""}
        </span>
      </header>
      <nav className="teams-admin__tabs" aria-label="Bereiche">
        {(
          [
            ["overview", "Übersicht"],
            ["people", "Personen"],
            ["history", "Verlauf"],
          ] as [DetailTab, string][]
        ).map(([key, label]) => (
          <button
            className={tab === key ? "is-on" : ""}
            key={key}
            onClick={() => setTab(key)}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="teams-admin__drawer-body">
        {error ? (
          <p className="fk-error" role="alert">
            {error}
          </p>
        ) : null}

        {tab === "overview" ? (
          <>
            <div className="teams-admin__facts">
              <div>
                <small>Mitglieder</small>
                <b>{team.memberCount ?? "–"}</b>
              </div>
              <div>
                <small>Gäste</small>
                <b>{team.guestCount ?? "–"}</b>
              </div>
              <div>
                <small>Owner</small>
                <b>{team.ownerCount}</b>
              </div>
              <div>
                <small>Ende</small>
                <b>
                  {team.endDate ? formatTeamDate(team.endDate) : "kein Ende"}
                </b>
              </div>
            </div>
            {!team.archived && team.requestStatus !== "archived" ? (
              <div className="teams-admin__block">
                <strong>
                  {team.endDate ? "Laufzeit verlängern" : "Ende setzen"}
                </strong>
                {team.endDate ? (
                  <div className="teams-admin__chips">
                    {EXTENSIONS.map((option) => (
                      <button
                        disabled={busy}
                        key={option.months}
                        onClick={() =>
                          void run(() =>
                            teamsAdminApi.setEnd(
                              tenantId,
                              team.teamId,
                              addMonthsIso(base, option.months),
                            ),
                          )
                        }
                        type="button"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="teams-admin__chips">
                    {[6, 12, 24].map((months) => (
                      <button
                        disabled={busy}
                        key={months}
                        onClick={() =>
                          void run(() =>
                            teamsAdminApi.setEnd(
                              tenantId,
                              team.teamId,
                              addMonthsIso(today, months),
                            ),
                          )
                        }
                        type="button"
                      >
                        {months === 12
                          ? "in 1 Jahr"
                          : months === 24
                            ? "in 2 Jahren"
                            : `in ${months} Monaten`}
                      </button>
                    ))}
                  </div>
                )}
                <div className="teams-admin__chips">
                  <input
                    aria-label="Ende"
                    min={today}
                    onChange={(event) => setEndInput(event.target.value)}
                    type="date"
                    value={endInput}
                  />
                  <button
                    disabled={busy || !endInput || endInput <= today}
                    onClick={() =>
                      void run(() =>
                        teamsAdminApi.setEnd(tenantId, team.teamId, endInput),
                      )
                    }
                    type="button"
                  >
                    Übernehmen
                  </button>
                  {team.source === "import" && team.endDate ? (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          teamsAdminApi.clearEnd(tenantId, team.teamId),
                        )
                      }
                      type="button"
                    >
                      Ende entfernen
                    </button>
                  ) : null}
                </div>
                <small className="teams-admin__muted">
                  Die Owner werden 14, 7 und 1 Tag vorher erinnert; danach wird
                  das Team archiviert.
                </small>
              </div>
            ) : null}
            <div className="teams-admin__chips">
              {team.webUrl ? (
                <a
                  className="primary-button"
                  href={team.webUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  In Teams öffnen
                </a>
              ) : null}
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    teamsAdminApi.archive(
                      tenantId,
                      team.teamId,
                      !team.archived,
                    ),
                  )
                }
                type="button"
              >
                {team.archived ? "Wiederherstellen" : "Archivieren"}
              </button>
            </div>
          </>
        ) : null}

        {tab === "people" ? (
          <>
            <PeoplePicker
              label="Person hinzufügen"
              onChange={(added) => {
                const person = added[added.length - 1];
                if (person) {
                  void run(
                    () =>
                      teamsAdminApi.addMember(
                        tenantId,
                        team.teamId,
                        person.id,
                        team.ownerCount === 0,
                      ),
                    {
                      members: true,
                    },
                  );
                }
              }}
              selected={[]}
              tenantId={tenantId}
              {...(team.ownerCount === 0
                ? {
                    hint: "Dieses Team hat keinen Owner: die erste hinzugefügte Person wird Owner.",
                  }
                : {})}
            />
            {members === null ? (
              <small className="teams-admin__muted">Wird geladen …</small>
            ) : (
              <>
                <strong>Owner ({owners.length})</strong>
                <ul className="teams-admin__people">{owners.map(personRow)}</ul>
                <strong>Mitglieder ({regular.length})</strong>
                <ul className="teams-admin__people">
                  {regular.map(personRow)}
                </ul>
                {guests.length > 0 ? (
                  <>
                    <strong>Gäste ({guests.length})</strong>
                    <ul className="teams-admin__people">
                      {guests.map(personRow)}
                    </ul>
                  </>
                ) : null}
              </>
            )}
          </>
        ) : null}

        {tab === "history" ? (
          history === null ? (
            <small className="teams-admin__muted">Wird geladen …</small>
          ) : history.length === 0 ? (
            <p className="teams-admin__muted">
              Noch keine Einträge. Hier erscheinen Bestellung, Verlängerungen,
              Erinnerungen und Änderungen im Menü «Teams».
            </p>
          ) : (
            <ol className="teams-admin__timeline">
              {history.map((event, index) => {
                const info = describeHistory(event);
                return (
                  <li key={`${event.at}-${index}`}>
                    <i />
                    <span>
                      <b>{info.title}</b>
                      <small>
                        {[
                          info.detail,
                          event.actor,
                          new Date(event.at).toLocaleString("de-CH", {
                            dateStyle: "short",
                            timeStyle: "short",
                          }),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                  </li>
                );
              })}
            </ol>
          )
        ) : null}
      </div>
    </aside>
  );
}
