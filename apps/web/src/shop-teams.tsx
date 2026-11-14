import { Check, X } from "lucide-react";
import { tn } from "./lib/formality";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  FormCard,
  FormChips,
  FormDialog,
  FormField,
  FormGrid,
  FormNote,
  FormSwitch,
} from "./form-kit";
import {
  addMonthsIso,
  emptyDraft,
  EXTENSIONS,
  formatTeamDate,
  lifetimeLabel,
  stepIssue,
  teamsApi,
  WIZARD_STEPS,
  type TeamDraft,
  type TeamMember,
  type TeamPerson,
  type TeamRequestSummary,
  type TeamsContext,
} from "./lib/teams";
import "./shop-teams.css";

/** Shop-Artikel «Microsoft Teams: neues Team»: Wizard und «Meine Teams». */

const STATUS_LABEL: Record<string, string> = {
  queued: "Geplant",
  provisioning: "Wird erstellt",
  ready: "Aktiv",
  failed: "Fehlgeschlagen",
  archived: "Archiviert",
};

export function TeamsTile({
  context,
  onOpen,
}: {
  context: TeamsContext;
  onOpen: () => void;
}) {
  return (
    <section className="shop-teams-tile" aria-label="Microsoft Teams bestellen">
      <div className="shop-teams-tile__logo" aria-hidden="true">
        T
      </div>
      <div className="shop-teams-tile__text">
        <strong>Microsoft Teams: neues Team</strong>
        <span>
          Teamraum mit Kanälen, Mitgliedern und Laufzeit. Wird nach der
          Bestellung automatisch angelegt, ohne Genehmigung.
        </span>
        {!context.available ? (
          <small>
            {context.reason === "not_configured"
              ? "Noch nicht eingerichtet. Bitte den Support informieren."
              : tn(
                  "Für dich derzeit nicht verfügbar.",
                  "Für Sie derzeit nicht verfügbar.",
                )}
          </small>
        ) : null}
      </div>
      <button
        className="primary-button"
        disabled={!context.available}
        onClick={onOpen}
        type="button"
      >
        Team zusammenstellen …
      </button>
    </section>
  );
}

export function PeoplePicker({
  label,
  onChange,
  selected,
  tenantId,
  hint,
  required,
}: {
  hint?: string;
  label: string;
  onChange: (people: TeamPerson[]) => void;
  required?: boolean;
  selected: TeamPerson[];
  tenantId: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TeamPerson[]>([]);
  const [searching, setSearching] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const run = ++latest.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      teamsApi
        .searchPeople(tenantId, term)
        .then((people) => {
          if (run === latest.current) setResults(people);
        })
        .catch(() => {
          if (run === latest.current) setResults([]);
        })
        .finally(() => {
          if (run === latest.current) setSearching(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, tenantId]);

  const chosen = new Set(selected.map((person) => person.id));
  const options = results.filter((person) => !chosen.has(person.id));
  return (
    <div className="shop-teams-people">
      <FormField
        label={label}
        {...(hint ? { hint } : {})}
        {...(required ? { required } : {})}
      >
        <input
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name oder E-Mail suchen …"
          type="search"
          value={query}
        />
      </FormField>
      {query.trim().length >= 2 ? (
        <ul className="shop-teams-people__results" aria-label="Treffer">
          {options.map((person) => (
            <li key={person.id}>
              <button
                onClick={() => {
                  onChange([...selected, person]);
                  setQuery("");
                  setResults([]);
                }}
                type="button"
              >
                <strong>{person.displayName}</strong>
                <small>{person.email ?? person.jobTitle ?? ""}</small>
              </button>
            </li>
          ))}
          {!searching && options.length === 0 ? (
            <li className="shop-teams-people__empty">Keine Treffer.</li>
          ) : null}
        </ul>
      ) : null}
      {selected.length > 0 ? (
        <div className="shop-teams-chips">
          {selected.map((person) => (
            <span className="shop-teams-chip" key={person.id}>
              {person.displayName}
              <button
                aria-label={`${person.displayName} entfernen`}
                onClick={() =>
                  onChange(selected.filter((entry) => entry.id !== person.id))
                }
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="shop-teams-steps" aria-label="Fortschritt">
      {WIZARD_STEPS.map((label, index) => (
        <li
          aria-current={index === step ? "step" : undefined}
          className={
            index < step ? "is-done" : index === step ? "is-current" : ""
          }
          key={label}
        >
          <i>
            {index < step ? <Check aria-hidden="true" size={14} /> : index + 1}
          </i>
          {label}
        </li>
      ))}
    </ol>
  );
}

export function TeamWizard({
  context,
  onClose,
  onOrdered,
  tenantId,
}: {
  context: TeamsContext;
  onClose: () => void;
  onOrdered: () => void;
  tenantId: string;
}) {
  const [draft, setDraft] = useState<TeamDraft>(() => emptyDraft(context));
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [guestInput, setGuestInput] = useState("");
  const last = WIZARD_STEPS.length - 1;
  const update = (patch: Partial<TeamDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const issue = stepIssue(step, draft, context);
    if (issue) {
      setError(issue);
      return;
    }
    setError("");
    if (step < last) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    try {
      await teamsApi.create(tenantId, draft);
      onOrdered();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Bestellung konnte nicht gesendet werden.",
      );
    } finally {
      setBusy(false);
    }
  };

  const addGuest = () => {
    const email = guestInput.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) {
      setError("Bitte eine gültige E-Mail-Adresse für den Gast eingeben.");
      return;
    }
    setError("");
    if (!draft.guests.includes(email)) {
      update({ guests: [...draft.guests, email] });
    }
    setGuestInput("");
  };

  const channelLine = useMemo(
    () =>
      [
        "Allgemein",
        ...draft.channels.map(
          (channel) =>
            `${channel.name}${channel.isPrivate ? " (privat)" : ""}${
              channel.tabs.length ? ` (${channel.tabs.length} Tab)` : ""
            }`,
        ),
      ].join(" · "),
    [draft.channels],
  );

  return (
    <FormDialog
      error={error}
      eyebrow="Shop · Microsoft Teams"
      footerLeft={
        step > 0 ? (
          <button
            className="secondary-button"
            onClick={() => {
              setError("");
              setStep(step - 1);
            }}
            type="button"
          >
            Zurück
          </button>
        ) : null
      }
      onClose={onClose}
      onSubmit={submit}
      submitLabel={step === last ? "Verbindlich bestellen" : "Weiter"}
      submitting={busy}
      title={
        step === last
          ? tn("Übersicht deiner Bestellung", "Übersicht Ihrer Bestellung")
          : "Neues Team zusammenstellen"
      }
    >
      <Stepper step={step} />

      {step === 0 ? (
        <>
          <FormCard title="Grunddaten">
            <FormField label="Name des Teams" required>
              <input
                maxLength={120}
                onChange={(event) => update({ name: event.target.value })}
                value={draft.name}
              />
            </FormField>
            <FormField label="Beschreibung" optional>
              <textarea
                maxLength={1000}
                onChange={(event) =>
                  update({ description: event.target.value })
                }
                rows={2}
                value={draft.description}
              />
            </FormField>
          </FormCard>
          <FormCard title="Sichtbarkeit und Gäste">
            <FormChips<"private" | "public">
              label="Sichtbarkeit"
              onChange={(next) => {
                const visibility = next[next.length - 1];
                if (visibility) update({ visibility });
              }}
              options={[
                { value: "private", label: "Privat" },
                { value: "public", label: "Öffentlich" },
              ]}
              value={[draft.visibility]}
            />
            <FormNote>
              {draft.visibility === "private"
                ? "Nur eingeladene Personen sehen das Team und treten bei."
                : "Alle in der Organisation können das Team finden und beitreten."}
            </FormNote>
            {context.allowGuests ? (
              <FormSwitch
                checked={draft.allowGuests}
                hint="Externe Personen (z. B. Lieferanten) können als Gast eingeladen werden."
                label="Gäste erlauben"
                onChange={(allowGuests) => update({ allowGuests })}
              />
            ) : null}
          </FormCard>
        </>
      ) : null}

      {step === 1 ? (
        <FormCard
          sub="«Allgemein» legt Teams immer selbst an"
          title="Kanäle und Tabs"
        >
          {draft.channels.map((channel, index) => (
            <div className="shop-teams-channel" key={index}>
              <FormGrid cols={2}>
                <FormField label="Kanalname" required>
                  <input
                    maxLength={50}
                    onChange={(event) =>
                      update({
                        channels: draft.channels.map((entry, at) =>
                          at === index
                            ? { ...entry, name: event.target.value }
                            : entry,
                        ),
                      })
                    }
                    value={channel.name}
                  />
                </FormField>
                <FormSwitch
                  checked={channel.isPrivate}
                  hint="Nur ausgewählte Mitglieder sehen den Kanal."
                  label="Privater Kanal"
                  onChange={(isPrivate) =>
                    update({
                      channels: draft.channels.map((entry, at) =>
                        at === index ? { ...entry, isPrivate } : entry,
                      ),
                    })
                  }
                />
              </FormGrid>
              {channel.tabs.map((tab, tabIndex) => (
                <FormGrid cols={2} key={tabIndex}>
                  <FormField label="Website-Tab: Titel">
                    <input
                      maxLength={60}
                      onChange={(event) =>
                        update({
                          channels: draft.channels.map((entry, at) =>
                            at === index
                              ? {
                                  ...entry,
                                  tabs: entry.tabs.map((item, ti) =>
                                    ti === tabIndex
                                      ? { ...item, title: event.target.value }
                                      : item,
                                  ),
                                }
                              : entry,
                          ),
                        })
                      }
                      value={tab.title}
                    />
                  </FormField>
                  <FormField label="Adresse (https)">
                    <input
                      inputMode="url"
                      onChange={(event) =>
                        update({
                          channels: draft.channels.map((entry, at) =>
                            at === index
                              ? {
                                  ...entry,
                                  tabs: entry.tabs.map((item, ti) =>
                                    ti === tabIndex
                                      ? { ...item, url: event.target.value }
                                      : item,
                                  ),
                                }
                              : entry,
                          ),
                        })
                      }
                      placeholder="https://"
                      value={tab.url}
                    />
                  </FormField>
                </FormGrid>
              ))}
              <div className="shop-teams-actions">
                {channel.tabs.length < 5 ? (
                  <button
                    className="secondary-button"
                    onClick={() =>
                      update({
                        channels: draft.channels.map((entry, at) =>
                          at === index
                            ? {
                                ...entry,
                                tabs: [...entry.tabs, { title: "", url: "" }],
                              }
                            : entry,
                        ),
                      })
                    }
                    type="button"
                  >
                    + Website-Tab
                  </button>
                ) : null}
                <button
                  className="secondary-button"
                  onClick={() =>
                    update({
                      channels: draft.channels.filter((_, at) => at !== index),
                    })
                  }
                  type="button"
                >
                  Kanal entfernen
                </button>
              </div>
            </div>
          ))}
          {draft.channels.length < 10 ? (
            <button
              className="secondary-button"
              onClick={() =>
                update({
                  channels: [
                    ...draft.channels,
                    { name: "", isPrivate: false, tabs: [] },
                  ],
                })
              }
              type="button"
            >
              + Kanal hinzufügen
            </button>
          ) : null}
          <FormNote>
            Beiträge und Dateien gibt es in jedem Kanal von Anfang an. Weitere
            Tabs (Planner, OneNote …) kann das Team danach in Teams selbst
            ergänzen.
          </FormNote>
        </FormCard>
      ) : null}

      {step === 2 ? (
        <>
          <FormCard sub="mindestens 1 Person" title="Owner">
            <PeoplePicker
              hint="Owner verwalten das Team und werden vor dem Ende erinnert."
              label="Owner hinzufügen"
              onChange={(owners) => update({ owners })}
              required
              selected={draft.owners}
              tenantId={tenantId}
            />
          </FormCard>
          <FormCard
            sub={`${draft.members.length} ausgewählt`}
            title="Mitglieder"
          >
            <PeoplePicker
              label="Mitglieder hinzufügen"
              onChange={(members) => update({ members })}
              selected={draft.members}
              tenantId={tenantId}
            />
          </FormCard>
          {draft.allowGuests ? (
            <FormCard title="Gäste">
              <FormField
                hint="Gäste erhalten eine Einladung von Microsoft und erscheinen erst nach Annahme im Team."
                label="E-Mail-Adresse des Gasts"
              >
                <input
                  onChange={(event) => setGuestInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addGuest();
                    }
                  }}
                  type="email"
                  value={guestInput}
                />
              </FormField>
              <div className="shop-teams-actions">
                <button
                  className="secondary-button"
                  onClick={addGuest}
                  type="button"
                >
                  Gast hinzufügen
                </button>
              </div>
              {draft.guests.length > 0 ? (
                <div className="shop-teams-chips">
                  {draft.guests.map((email) => (
                    <span className="shop-teams-chip" key={email}>
                      {email}
                      <button
                        aria-label={`${email} entfernen`}
                        onClick={() =>
                          update({
                            guests: draft.guests.filter(
                              (entry) => entry !== email,
                            ),
                          })
                        }
                        type="button"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </FormCard>
          ) : null}
        </>
      ) : null}

      {step === 3 ? (
        <FormCard title="Laufzeit">
          <FormGrid cols={2}>
            <FormField label="Start" required>
              <input
                min={context.today}
                onChange={(event) => update({ startDate: event.target.value })}
                type="date"
                value={draft.startDate}
              />
            </FormField>
            <FormField
              hint={`Pflichtangabe, höchstens ${lifetimeLabel(context.maxLifetimeMonths)} ab Start.`}
              label="Ende"
              required
            >
              <input
                max={addMonthsIso(
                  draft.startDate || context.today,
                  context.maxLifetimeMonths,
                )}
                min={draft.startDate || context.today}
                onChange={(event) => update({ endDate: event.target.value })}
                type="date"
                value={draft.endDate}
              />
            </FormField>
          </FormGrid>
          <FormNote>
            {tn(
              // formality-ok: "Ihr" ist hier die Du-Form im Plural
              "Was passiert am Ende? Das Team wird nicht gelöscht. Ihr werdet 14 Tage, 7 Tage und 1 Tag vorher per E-Mail und Push gefragt, ob das Team weitergeführt (Laufzeit verlängern) werden soll. Ohne Verlängerung wird es nach dem Ende archiviert und bleibt lesbar.",
              "Was passiert am Ende? Das Team wird nicht gelöscht. Sie werden 14 Tage, 7 Tage und 1 Tag vorher per E-Mail und Push gefragt, ob das Team weitergeführt (Laufzeit verlängern) werden soll. Ohne Verlängerung wird es nach dem Ende archiviert und bleibt lesbar.",
            )}
          </FormNote>
        </FormCard>
      ) : null}

      {step === last ? (
        <FormCard title={draft.name.trim()}>
          <dl className="shop-teams-summary">
            <div>
              <dt>Sichtbarkeit</dt>
              <dd>
                {draft.visibility === "private" ? "Privat" : "Öffentlich"}
                {draft.allowGuests ? " · Gäste erlaubt" : ""}
              </dd>
            </div>
            {draft.description.trim() ? (
              <div>
                <dt>Beschreibung</dt>
                <dd>{draft.description.trim()}</dd>
              </div>
            ) : null}
            <div>
              <dt>Kanäle</dt>
              <dd>{channelLine}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>
                {draft.owners.map((person) => person.displayName).join(", ")}
              </dd>
            </div>
            <div>
              <dt>Mitglieder</dt>
              <dd>
                {draft.members.length} Person(en)
                {draft.guests.length
                  ? ` · ${draft.guests.length} Gast/Gäste`
                  : ""}
              </dd>
            </div>
            <div>
              <dt>Laufzeit</dt>
              <dd>
                {formatTeamDate(draft.startDate)} –{" "}
                {formatTeamDate(draft.endDate)}
              </dd>
            </div>
          </dl>
          <FormNote>
            Das Team wird ohne Genehmigung angelegt
            {draft.startDate > context.today
              ? ` und entsteht am ${formatTeamDate(draft.startDate)}`
              : " und erscheint innerhalb weniger Minuten in Microsoft Teams"}
            {tn(
              ". Den Stand siehst du unter «Meine Teams».",
              ". Den Stand sehen Sie unter «Meine Teams».",
            )}
          </FormNote>
        </FormCard>
      ) : null}
    </FormDialog>
  );
}

function TeamEditDialog({
  onChanged,
  onClose,
  request,
  tenantId,
}: {
  onChanged: () => void;
  onClose: () => void;
  request: TeamRequestSummary;
  tenantId: string;
}) {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);

  const load = useCallback(() => {
    teamsApi
      .members(tenantId, request.id)
      .then(setMembers)
      .catch((nextError: Error) => setError(nextError.message));
  }, [request.id, tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (work: () => Promise<unknown>, reload = true) => {
    setBusy(true);
    setError("");
    try {
      await work();
      onChanged();
      if (reload) load();
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

  const owners = members?.filter((member) => member.isOwner) ?? [];
  const regular =
    members?.filter((member) => !member.isOwner && !member.isGuest) ?? [];
  const guests = members?.filter((member) => member.isGuest) ?? [];
  const row = (member: TeamMember) => (
    <li key={member.membershipId}>
      <span className="shop-teams-edit__who">
        {member.displayName}
        {member.email ? <small>{member.email}</small> : null}
      </span>
      {!member.isGuest ? (
        <button
          className="text-button"
          disabled={busy}
          onClick={() =>
            void run(() =>
              teamsApi.setOwner(
                tenantId,
                request.id,
                member.membershipId,
                !member.isOwner,
              ),
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
          void run(() =>
            teamsApi.removeMember(tenantId, request.id, member.membershipId),
          )
        }
        type="button"
      >
        <X aria-hidden="true" size={14} />
      </button>
    </li>
  );

  return (
    <div className="fk-backdrop" onClick={onClose} role="presentation">
      <div
        aria-label={`${request.name} bearbeiten`}
        aria-modal="true"
        className="fk-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="fk-head">
          <div>
            <p className="fk-eyebrow">Meine Teams</p>
            <h2>{request.name}</h2>
          </div>
          <button
            aria-label="Schliessen"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
        <div className="fk-body">
          <div className="fk-main">
            <FormCard
              sub={`Ende ${formatTeamDate(request.endDate)}`}
              title="Laufzeit"
            >
              <div className="shop-teams-extend">
                <span>Verlängern um:</span>
                {EXTENSIONS.map((option) => (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    key={option.months}
                    onClick={() =>
                      void run(
                        () =>
                          teamsApi.extend(tenantId, request.id, option.months),
                        false,
                      )
                    }
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </FormCard>
            <FormCard title="Personen">
              <PeoplePicker
                label="Person hinzufügen"
                onChange={(added) => {
                  const person = added[added.length - 1];
                  if (person)
                    void run(() =>
                      teamsApi.addMember(
                        tenantId,
                        request.id,
                        person.id,
                        false,
                      ),
                    );
                }}
                selected={[]}
                tenantId={tenantId}
              />
              {members === null ? (
                <p className="shop-teams-edit__muted">Wird geladen …</p>
              ) : (
                <>
                  <strong>Owner ({owners.length})</strong>
                  <ul className="shop-teams-edit__list">{owners.map(row)}</ul>
                  <strong>Mitglieder ({regular.length})</strong>
                  <ul className="shop-teams-edit__list">{regular.map(row)}</ul>
                  {guests.length > 0 ? (
                    <>
                      <strong>Gäste ({guests.length})</strong>
                      <ul className="shop-teams-edit__list">
                        {guests.map(row)}
                      </ul>
                    </>
                  ) : null}
                </>
              )}
            </FormCard>
            <FormNote>
              {tn(
                "Name, Kanäle und Tabs änderst du direkt in Microsoft Teams. Hier pflegst du Personen und Laufzeit.",
                "Name, Kanäle und Tabs ändern Sie direkt in Microsoft Teams. Hier pflegen Sie Personen und Laufzeit.",
              )}
            </FormNote>
          </div>
        </div>
        {error ? (
          <p className="fk-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer className="fk-foot">
          <div className="fk-foot-left">
            {confirmArchive ? (
              <>
                <span>Team wirklich archivieren?</span>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await teamsApi.archive(tenantId, request.id);
                      onClose();
                    }, false)
                  }
                  type="button"
                >
                  Ja, archivieren
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setConfirmArchive(false)}
                  type="button"
                >
                  Nein
                </button>
              </>
            ) : (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setConfirmArchive(true)}
                type="button"
              >
                Archivieren
              </button>
            )}
          </div>
          <div className="fk-foot-right">
            <button className="primary-button" onClick={onClose} type="button">
              Fertig
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export function MyTeams({
  onChanged,
  requests,
  tenantId,
}: {
  onChanged: () => void;
  requests: TeamRequestSummary[];
  tenantId: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<TeamRequestSummary | null>(null);
  const extend = async (request: TeamRequestSummary, months: number) => {
    setBusy(request.id);
    setError("");
    try {
      await teamsApi.extend(tenantId, request.id, months);
      onChanged();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Verlängern nicht möglich.",
      );
    } finally {
      setBusy(null);
    }
  };
  if (requests.length === 0) {
    return (
      <p className="empty-state">
        {tn(
          "Du hast noch kein Team bestellt.",
          "Sie haben noch kein Team bestellt.",
        )}
      </p>
    );
  }
  return (
    <div className="shop-teams-list">
      {error ? (
        <p className="fk-error" role="alert">
          {error}
        </p>
      ) : null}
      {requests.map((request) => {
        const soon = request.daysLeft !== null && request.daysLeft <= 14;
        return (
          <article className="shop-teams-card" key={request.id}>
            <header>
              <h3>{request.name}</h3>
              <span
                className={`shop-teams-status shop-teams-status--${
                  request.status === "ready" && soon ? "soon" : request.status
                }`}
              >
                {request.status === "ready" && soon
                  ? request.daysLeft === 0
                    ? "Endet heute"
                    : `Noch ${request.daysLeft} Tag(e)`
                  : STATUS_LABEL[request.status]}
              </span>
            </header>
            <p>
              {request.visibility === "private" ? "Privat" : "Öffentlich"} ·
              Owner: {request.owners.join(", ") || "–"} · {request.memberCount}{" "}
              Mitglieder · {formatTeamDate(request.startDate)} –{" "}
              {formatTeamDate(request.endDate)}
            </p>
            {request.status === "failed" ? (
              <p className="shop-teams-warning">
                {tn(
                  "Das Team konnte nicht angelegt werden. Der Support wurde informiert; bitte melde dich bei Rückfragen dort.",
                  "Das Team konnte nicht angelegt werden. Der Support wurde informiert; bitte melden Sie sich bei Rückfragen dort.",
                )}
              </p>
            ) : null}
            {request.status === "ready" && request.warningCount > 0 ? (
              <p className="shop-teams-warning">
                Das Team wurde angelegt. Nicht ergänzt werden konnten
                {request.warningSteps?.length
                  ? `: ${request.warningSteps.join(", ")}`
                  : " einzelne Kanäle, Tabs oder Gäste"}
                . Bitte in Teams selbst ergänzen.
              </p>
            ) : null}
            {request.status === "ready" ? (
              <div className="shop-teams-extend">
                <button
                  className="primary-button"
                  onClick={() => setEditing(request)}
                  type="button"
                >
                  Bearbeiten
                </button>
                <span>Laufzeit verlängern:</span>
                {EXTENSIONS.map((option) => (
                  <button
                    className="secondary-button"
                    disabled={busy === request.id}
                    key={option.months}
                    onClick={() => void extend(request, option.months)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </article>
        );
      })}
      {editing ? (
        <TeamEditDialog
          onChanged={onChanged}
          onClose={() => setEditing(null)}
          request={editing}
          tenantId={tenantId}
        />
      ) : null}
    </div>
  );
}
