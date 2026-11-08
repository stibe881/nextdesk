export type PickerTeam = {
  id: string;
  name: string;
  departmentId: string;
  active: boolean;
};

/** Team checkboxes for an agent, limited to their ticket access department. */
export function TeamPicker({
  teams,
  departmentId,
  value,
  onChange,
  disabled,
}: {
  teams: PickerTeam[];
  departmentId: string;
  value: string[];
  onChange: (teamIds: string[]) => void;
  disabled?: boolean;
}) {
  const options = teams.filter(
    (team) => team.active && team.departmentId === departmentId,
  );
  return (
    <fieldset className="team-picker" disabled={disabled}>
      <legend>Team</legend>
      {!departmentId ? (
        <small className="tenant-admin-settings__field-hint">
          Wählen Sie zuerst den Ticketzugriffsbereich.
        </small>
      ) : options.length === 0 ? (
        <small className="tenant-admin-settings__field-hint">
          Diese Abteilung hat noch keine Teams.
        </small>
      ) : (
        <div className="team-picker__options">
          {options.map((team) => (
            <label key={team.id}>
              <input
                checked={value.includes(team.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...value, team.id]
                      : value.filter((id) => id !== team.id),
                  )
                }
                type="checkbox"
              />
              <span>{team.name}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/** Keeps only selected teams that belong to the department. */
export function teamsInDepartment(
  teams: PickerTeam[],
  departmentId: string,
  teamIds: string[],
): string[] {
  const allowed = new Set(
    teams
      .filter((team) => team.active && team.departmentId === departmentId)
      .map((team) => team.id),
  );
  return teamIds.filter((id) => allowed.has(id));
}
