import { useCallback, useEffect, useMemo, useState } from "react";
import { PeoplePicker } from "./shop-teams";
import {
  matchesTeamFilter,
  TEAM_FILTERS,
  teamKpis,
  teamsAdminApi,
  type AdminTeam,
  type AdminTeamMember,
  type TeamFilter,
} from "./lib/teams-admin";
import { addMonthsIso, EXTENSIONS, formatTeamDate } from "./lib/teams";
import "./teams-admin.css";

/** Menü «Teams»: alle Teams ansehen und verwalten (Berechtigung shop.manage). */

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function statusBadge(team: AdminTeam) {
  if (team.archived) return { label: "Archiviert", tone: "muted" };
  if (team.ownerCount === 0) return { label: "Verwaist", tone: "bad" };
  if (team.daysLeft !== null && team.daysLeft <= 30) {
    return {
      label:
        team.daysLeft <= 0 ? "Endet heute" : `Noch ${team.daysLeft} Tag(e)`,
      tone: "warn",
    };
  }
  return { label: "Aktiv", tone: "ok" };
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
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const result = await teamsAdminApi.list(tenantId);
    setTeams(result.teams);
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
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("de-CH");
    return teams.filter(
      (team) =>
        matchesTeamFilter(team, filter) &&
        (!term ||
          team.name.toLocaleLowerCase("de-CH").includes(term) ||
          team.owners.some((owner) =>
            owner.toLocaleLowerCase("de-CH").includes(term),
          )),
    );
  }, [teams, filter, query]);
  const selected = teams.find((team) => team.teamId === selectedId) ?? null;

  return (
    <section className="teams-admin" aria-label="Teams">
      <div className="teams-admin__kpis">
        <div>
          <small>Teams gesamt</small>
          <b>{kpis.total}</b>
        </div>
        <div>
          <small>Läuft bald ab (≤ 30 Tage)</small>
          <b className="is-warn">{kpis.expiring}</b>
        </div>
        <div>
          <small>Ohne Owner</small>
          <b className="is-bad">{kpis.noOwner}</b>
        </div>
        <div>
          <small>Archiviert</small>
          <b>{kpis.archived}</b>
        </div>
      </div>

      <div className="teams-admin__toolbar">
        <input
          aria-label="Team suchen"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Team oder Owner suchen …"
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
          ? `Stand: ${new Date(syncedAt).toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" })}`
          : "Noch nicht abgeglichen."}
      </p>
      {error ? (
        <p className="fk-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className={`teams-admin__layout${selected ? " has-detail" : ""}`}>
        <div className="teams-admin__table-wrap">
          {loading && teams.length === 0 ? (
            <p className="empty-state">Teams werden geladen …</p>
          ) : visible.length === 0 ? (
            <p className="empty-state">Keine Teams für diese Auswahl.</p>
          ) : (
            <table className="teams-admin__table">
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Owner</th>
                  <th>Ende</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((team) => {
                  const badge = statusBadge(team);
                  return (
                    <tr
                      aria-selected={team.teamId === selectedId}
                      className={
                        team.teamId === selectedId ? "is-selected" : ""
                      }
                      key={team.teamId}
                      onClick={() => setSelectedId(team.teamId)}
                    >
                      <td>
                        <button className="teams-admin__name" type="button">
                          {team.name}
                        </button>
                        <small>
                          {team.source === "order"
                            ? "über nextDesk bestellt"
                            : "bestehend"}
                        </small>
                      </td>
                      <td>
                        {team.ownerCount === 0 ? (
                          <span className="is-bad">kein Owner</span>
                        ) : (
                          team.owners.slice(0, 2).join(", ") +
                          (team.ownerCount > 2
                            ? ` +${team.ownerCount - 2}`
                            : "")
                        )}
                      </td>
                      <td>
                        {team.endDate ? formatTeamDate(team.endDate) : "–"}
                      </td>
                      <td>
                        <span
                          className={`teams-admin__badge teams-admin__badge--${badge.tone}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
  const [members, setMembers] = useState<AdminTeamMember[] | null>(null);
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
    loadMembers();
  }, [loadMembers]);

  const run = async (work: () => Promise<unknown>, reloadMembers = false) => {
    setBusy(true);
    setError("");
    try {
      await work();
      onChanged();
      if (reloadMembers) loadMembers();
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
  return (
    <aside className="teams-admin__detail" aria-label={`Details ${team.name}`}>
      <header>
        <h3>{team.name}</h3>
        <button
          aria-label="Schliessen"
          className="icon-button"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </header>
      {team.description ? (
        <p className="teams-admin__muted">{team.description}</p>
      ) : null}
      <p className="teams-admin__muted">
        {team.visibility === "public" ? "Öffentlich" : "Privat"} ·{" "}
        {team.source === "order"
          ? "über nextDesk bestellt"
          : "bestehendes Team"}
        {team.endDate
          ? ` · Ende ${formatTeamDate(team.endDate)}`
          : " · kein Ende gesetzt"}
      </p>
      {error ? (
        <p className="fk-error" role="alert">
          {error}
        </p>
      ) : null}

      {!team.archived && team.requestStatus !== "archived" ? (
        <div className="teams-admin__block">
          <strong>{team.endDate ? "Ende verlängern" : "Ende setzen"}</strong>
          {team.endDate ? (
            <div className="teams-admin__row">
              {EXTENSIONS.map((option) => (
                <button
                  className="secondary-button"
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
          ) : null}
          <div className="teams-admin__row">
            <input
              aria-label="Ende"
              min={today}
              onChange={(event) => setEndInput(event.target.value)}
              type="date"
              value={endInput}
            />
            <button
              className="secondary-button"
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
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void run(() => teamsAdminApi.clearEnd(tenantId, team.teamId))
                }
                type="button"
              >
                Ende entfernen
              </button>
            ) : null}
          </div>
          <small className="teams-admin__muted">
            Die Owner werden 14, 7 und 1 Tag vorher erinnert; danach wird das
            Team archiviert.
          </small>
        </div>
      ) : null}

      <div className="teams-admin__block">
        <strong>Mitglieder</strong>
        {members === null ? (
          <small className="teams-admin__muted">Wird geladen …</small>
        ) : (
          <ul className="teams-admin__members">
            {members.map((member) => (
              <li key={member.membershipId}>
                <span>
                  {member.displayName}
                  {member.isOwner ? <em> Owner</em> : null}
                  {member.isGuest ? <em> Gast</em> : null}
                </span>
                <span className="teams-admin__row">
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
                          true,
                        )
                      }
                      type="button"
                    >
                      {member.isOwner ? "Kein Owner mehr" : "Zum Owner machen"}
                    </button>
                  ) : null}
                  <button
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
                        true,
                      )
                    }
                    type="button"
                  >
                    Entfernen
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
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
                    false,
                  ),
                true,
              );
            }
          }}
          selected={[]}
          tenantId={tenantId}
        />
      </div>

      <div className="teams-admin__row">
        {team.webUrl ? (
          <a
            className="secondary-button"
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
              teamsAdminApi.archive(tenantId, team.teamId, !team.archived),
            )
          }
          type="button"
        >
          {team.archived ? "Wiederherstellen" : "Archivieren"}
        </button>
      </div>
    </aside>
  );
}
