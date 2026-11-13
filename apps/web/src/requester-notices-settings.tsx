import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FormCard,
  FormChips,
  FormDialog,
  FormField,
  FormGrid,
  FormNote,
  FormSummary,
  FormSwitch,
} from "./form-kit";
import {
  BODY_MAX,
  BUTTON_MAX,
  COLOR_OPTIONS,
  DEFAULT_FREQUENCY_DAYS,
  FREQUENCY_MAX_DAYS,
  LINK_OPTIONS,
  SYMBOL_MAX,
  TITLE_MAX,
  charCount,
  clickRate,
  contentIssue,
  draftFromNotice,
  emptyNoticeDraft,
  formatCount,
  frequencyIssue,
  noticeApi,
  noticeColors,
  noticeIssue,
  noticePeriodLabel,
  noticePlacementLabels,
  noticeStateLabel,
  noticeStateTone,
  todayIso,
  type AdminNotice,
  type MailPreviewKind,
  type NoticeDraft,
  type NoticeState,
  type NoticeView,
} from "./lib/requester-notices";
import { tn } from "./lib/formality";
import { NoticeBanner, NoticeBar } from "./requester-notice-banner";
import "./requester-notices-settings.css";

/** Einstellungen → Funktionen → «Hinweise für Anfragende» (Mandanten-Administration). */

type Filter = "all" | NoticeState;

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "active", label: "Aktiv" },
  { value: "scheduled", label: "Geplant" },
  { value: "draft", label: "Entwurf" },
  { value: "paused", label: "Pausiert" },
  { value: "expired", label: "Abgelaufen" },
];

const MAIL_KINDS = [
  { value: "resolution", label: "Ticket gelöst" },
  { value: "acknowledgement", label: "Ticket erstellt" },
  { value: "agent_reply", label: "Antwort vom Support" },
] as const satisfies readonly { value: MailPreviewKind; label: string }[];

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function RequesterNoticesSettings({ tenantId }: { tenantId: string }) {
  const [notices, setNotices] = useState<AdminNotice[] | null>(null);
  const [frequency, setFrequency] = useState(String(DEFAULT_FREQUENCY_DAYS));
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<NoticeDraft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await noticeApi.list(tenantId);
      setNotices(result.notices);
      setFrequency(String(result.settings.frequencyDays));
      setError("");
    } catch (nextError) {
      setError(errorText(nextError, "Fehler beim Laden."));
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const result: Record<Filter, number> = {
      all: notices?.length ?? 0,
      active: 0,
      scheduled: 0,
      draft: 0,
      paused: 0,
      expired: 0,
    };
    for (const notice of notices ?? []) result[notice.state] += 1;
    return result;
  }, [notices]);

  const visible = (notices ?? []).filter(
    (notice) => filter === "all" || notice.state === filter,
  );

  const run = async (
    id: string,
    action: () => Promise<unknown>,
    done: string,
  ) => {
    setBusyId(id);
    setMessage("");
    setError("");
    try {
      await action();
      setMessage(done);
      await load();
    } catch (nextError) {
      setError(errorText(nextError, "Die Aktion ist fehlgeschlagen."));
    } finally {
      setBusyId(null);
      setConfirmDelete(null);
    }
  };

  const frequencyValue = Number(frequency);
  const frequencyProblem =
    frequency.trim() === ""
      ? "Bitte eine Zahl eingeben."
      : frequencyIssue(frequencyValue);

  const saveSettings = async () => {
    setSavingSettings(true);
    setMessage("");
    setError("");
    try {
      await noticeApi.saveSettings(tenantId, frequencyValue);
      setMessage("Regeln gespeichert.");
    } catch (nextError) {
      setError(errorText(nextError, "Speichern fehlgeschlagen."));
    } finally {
      setSavingSettings(false);
    }
  };

  if (!notices) {
    return error ? (
      <p className="fk-error">{error}</p>
    ) : (
      <p className="empty-state">Wird geladen …</p>
    );
  }

  return (
    <div className="notices-settings">
      <div className="notices-settings__head">
        <p>
          Eigene Mitteilungen der ICT, die Anfragende im Portal (Banner und
          Hinweisleiste), in Ticket-E-Mails und in der App sehen. Zielgruppe
          sind immer alle Anfragenden.
        </p>
        <button
          className="primary-button"
          onClick={() => setEditing(emptyNoticeDraft())}
          type="button"
        >
          + Neuer Hinweis
        </button>
      </div>

      <FormChips<Filter>
        label="Hinweise filtern"
        onChange={(next) => setFilter(next[0] ?? "all")}
        options={FILTERS.map((entry) => ({
          value: entry.value,
          label: `${entry.label} (${counts[entry.value]})`,
        }))}
        value={[filter]}
      />

      {visible.length === 0 ? (
        <p className="empty-state">
          {notices.length === 0
            ? tn(
                "Noch keine Hinweise. Mit «+ Neuer Hinweis» legst du den ersten an.",
                "Noch keine Hinweise. Mit «+ Neuer Hinweis» legen Sie den ersten an.",
              )
            : "Keine Hinweise in dieser Ansicht."}
        </p>
      ) : (
        <ul className="notices-settings__list">
          {visible.map((notice) => {
            const colors = noticeColors(notice.color);
            const busy = busyId === notice.id;
            const places = noticePlacementLabels(notice);
            return (
              <li className="notices-settings__item" key={notice.id}>
                <span
                  aria-hidden="true"
                  className="notices-settings__thumb"
                  style={{
                    background: `linear-gradient(135deg, ${colors.from}, ${colors.to})`,
                  }}
                >
                  {notice.symbol ?? "•"}
                </span>
                <div className="notices-settings__info">
                  <div>
                    <strong>{notice.title}</strong>{" "}
                    <span
                      className={`notices-settings__chip notices-settings__chip--${noticeStateTone(notice.state)}`}
                    >
                      {noticeStateLabel(notice.state)}
                    </span>
                  </div>
                  <span className="notices-settings__meta">
                    {places.join(" + ") || "Kein Ort"} · alle Anfragenden ·{" "}
                    {noticePeriodLabel(notice)}
                  </span>
                  {notice.state === "draft" ? null : (
                    <span className="notices-settings__stats">
                      <span>{formatCount(notice.stats.views)} Ansichten</span>
                      <span>
                        {formatCount(notice.stats.clicks)} Klicks (
                        {clickRate(notice.stats.clicks, notice.stats.views)} %)
                      </span>
                      <span>
                        {formatCount(notice.stats.dismissals)} weggeklickt
                      </span>
                      {notice.showMail ? (
                        <span>
                          Mail: {formatCount(notice.stats.mailViews)} Ansichten,{" "}
                          {formatCount(notice.stats.mailClicks)} Klicks
                        </span>
                      ) : null}
                    </span>
                  )}
                </div>
                <div className="notices-settings__actions">
                  {confirmDelete === notice.id ? (
                    <>
                      <span className="notices-settings__confirm">
                        Wirklich löschen?
                      </span>
                      <button
                        className="danger-action"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            notice.id,
                            () => noticeApi.remove(tenantId, notice.id),
                            "Hinweis gelöscht.",
                          )
                        }
                        type="button"
                      >
                        Ja, löschen
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => setConfirmDelete(null)}
                        type="button"
                      >
                        Nein
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => setEditing(draftFromNotice(notice))}
                        type="button"
                      >
                        Bearbeiten
                      </button>
                      {notice.status === "active" &&
                      notice.state !== "expired" ? (
                        <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              notice.id,
                              () =>
                                noticeApi.setStatus(
                                  tenantId,
                                  notice.id,
                                  "paused",
                                ),
                              "Hinweis pausiert.",
                            )
                          }
                          type="button"
                        >
                          Pausieren
                        </button>
                      ) : null}
                      {notice.status !== "active" &&
                      notice.state !== "expired" ? (
                        <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              notice.id,
                              () =>
                                noticeApi.setStatus(
                                  tenantId,
                                  notice.id,
                                  "active",
                                ),
                              "Hinweis aktiviert.",
                            )
                          }
                          type="button"
                        >
                          Aktivieren
                        </button>
                      ) : null}
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => setConfirmDelete(notice.id)}
                        type="button"
                      >
                        Löschen
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section className="notices-settings__rules">
        <h4>Allgemeine Regeln</h4>
        <div className="notices-settings__rule-row">
          <label>
            Abstand in Mails (Tage)
            <input
              max={FREQUENCY_MAX_DAYS}
              min={0}
              onChange={(event) => setFrequency(event.target.value)}
              type="number"
              value={frequency}
            />
          </label>
          <button
            className="secondary-button"
            disabled={savingSettings || frequencyProblem !== ""}
            onClick={() => void saveSettings()}
            type="button"
          >
            {savingSettings ? "Speichert …" : "Regeln speichern"}
          </button>
        </div>
        <small>
          Pro Person höchstens 1 Hinweis in Mails alle N Tage; 0 = immer.
        </small>
        {frequencyProblem ? (
          <small className="notices-settings__bad">{frequencyProblem}</small>
        ) : null}
        <FormNote>
          Nie in Sicherheits-, Phishing-, Erinnerungs- und Freigabemails.
        </FormNote>
      </section>

      {message ? (
        <p className="notices-settings__ok" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="fk-error" role="alert">
          {error}
        </p>
      ) : null}

      {editing ? (
        <NoticeEditor
          draft={editing}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null);
            setMessage(text);
            void load();
          }}
          tenantId={tenantId}
        />
      ) : null}
    </div>
  );
}

function previewNotice(draft: NoticeDraft): NoticeView {
  return {
    id: draft.id ?? "preview",
    title: draft.title.trim() || "Titel des Hinweises",
    body: draft.body.trim() || "Hier steht der Text des Hinweises.",
    buttonLabel: draft.buttonLabel.trim() || "Mehr erfahren",
    linkKind: draft.linkKind,
    linkTarget: draft.linkTarget || null,
    symbol: draft.symbol.trim() || null,
    color: draft.color,
    dismissible: draft.dismissible,
  };
}

function Counter({ max, value }: { max: number; value: string }) {
  const count = charCount(value.trim());
  return (
    <>
      {" "}
      <span className={count > max ? "notices-settings__bad" : undefined}>
        ({count}/{max})
      </span>
    </>
  );
}

function NoticeEditor({
  draft: initial,
  onClose,
  onSaved,
  tenantId,
}: {
  draft: NoticeDraft;
  onClose: () => void;
  onSaved: (message: string) => void;
  tenantId: string;
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState<"draft" | "publish" | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"portal" | "mail">("portal");
  const [mailKind, setMailKind] = useState<MailPreviewKind>("resolution");
  const [mail, setMail] = useState<{ html: string; subject: string } | null>(
    null,
  );
  const [mailState, setMailState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [articleQuery, setArticleQuery] = useState("");
  const [articles, setArticles] = useState<{ id: string; title: string }[]>([]);
  const mailRequest = useRef(0);

  const patch = (next: Partial<NoticeDraft>) =>
    setDraft((current) => ({ ...current, ...next }));

  const issue = noticeIssue(draft);
  const contentProblem = contentIssue(draft);

  // Live-Vorschau der E-Mail, entprellt.
  useEffect(() => {
    if (tab !== "mail" || contentProblem) return;
    const request = ++mailRequest.current;
    setMailState("loading");
    const timer = window.setTimeout(() => {
      void noticeApi
        .previewMail(tenantId, draft, mailKind)
        .then((result) => {
          if (request !== mailRequest.current) return;
          setMail(result);
          setMailState("idle");
        })
        .catch(() => {
          if (request !== mailRequest.current) return;
          setMailState("error");
        });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [tab, contentProblem, draft, mailKind, tenantId]);

  // Wissensartikel suchen (entprellt).
  useEffect(() => {
    if (draft.linkKind !== "knowledge") return;
    let active = true;
    const timer = window.setTimeout(() => {
      void noticeApi
        .articles(tenantId, articleQuery)
        .then((result) => {
          if (!active) return;
          setArticles(result);
          setDraft((current) => {
            if (current.linkTargetLabel || !current.linkTarget) return current;
            const match = result.find(
              (entry) => entry.id === current.linkTarget,
            );
            return match
              ? { ...current, linkTargetLabel: match.title }
              : current;
          });
        })
        .catch(() => {
          if (active) setArticles([]);
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [articleQuery, draft.linkKind, tenantId]);

  const save = async (publish: boolean) => {
    if (issue) {
      setError(issue);
      return;
    }
    setSaving(publish ? "publish" : "draft");
    setError("");
    try {
      await noticeApi.save(tenantId, draft, publish);
      onSaved(publish ? "Hinweis veröffentlicht." : "Entwurf gespeichert.");
    } catch (nextError) {
      setError(errorText(nextError, "Speichern fehlgeschlagen."));
      setSaving(null);
    }
  };

  const places = noticePlacementLabels(draft);
  const preview = previewNotice(draft);

  return (
    <FormDialog
      error={error || null}
      eyebrow="Hinweise für Anfragende"
      footerLeft={
        <button
          className="secondary-button"
          disabled={saving !== null || issue !== ""}
          onClick={() => void save(false)}
          type="button"
        >
          {saving === "draft" ? "Speichert …" : "Als Entwurf speichern"}
        </button>
      }
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        void save(true);
      }}
      side={
        <>
          <FormSummary
            eyebrow="Hinweis"
            rows={[
              ["Orte", places.join(", ")],
              ["Zielgruppe", "Alle Anfragenden"],
              [
                "Zeitraum",
                draft.endsOn
                  ? noticePeriodLabel({
                      startsOn: draft.startsOn || todayIso(),
                      endsOn: draft.endsOn,
                      state: "active",
                    })
                  : "",
              ],
            ]}
            title={draft.title.trim()}
          />
          <FormNote>
            Statt eines Bildes gibt es ein kurzes Symbol (Buchstabe oder Emoji).
          </FormNote>
        </>
      }
      submitDisabled={issue !== "" || saving === "draft"}
      submitLabel="Veröffentlichen"
      submitting={saving === "publish"}
      title={draft.id ? "Hinweis bearbeiten" : "Neuer Hinweis"}
    >
      <FormCard sub="So sehen Anfragende den Hinweis" title="Vorschau">
        <FormChips<"portal" | "mail">
          label="Vorschau"
          onChange={(next) => setTab(next[0] ?? "portal")}
          options={[
            { value: "portal", label: "Portal" },
            { value: "mail", label: "E-Mail" },
          ]}
          value={[tab]}
        />
        {tab === "portal" ? (
          <div className="notices-settings__preview">
            <NoticeBanner notice={preview} />
            <NoticeBar notice={preview} />
          </div>
        ) : (
          <div className="notices-settings__mail">
            <FormChips<MailPreviewKind>
              label="Art der E-Mail"
              onChange={(next) => setMailKind(next[0] ?? "resolution")}
              options={MAIL_KINDS}
              value={[mailKind]}
            />
            {contentProblem ? (
              <p className="notices-settings__hint">
                Die Mail-Vorschau erscheint, sobald Titel, Text, Schaltfläche
                und Ziel ausgefüllt sind.
              </p>
            ) : (
              <>
                {mailState === "loading" ? (
                  <p className="notices-settings__hint">
                    Vorschau wird erstellt …
                  </p>
                ) : null}
                {mailState === "error" ? (
                  <p className="notices-settings__bad" role="alert">
                    Die Mail-Vorschau ist gerade nicht verfügbar.
                  </p>
                ) : null}
                {mail ? (
                  <>
                    <p className="notices-settings__hint">
                      Betreff: <strong>{mail.subject}</strong>
                    </p>
                    <iframe
                      className="notices-settings__frame"
                      sandbox=""
                      srcDoc={mail.html}
                      title="Vorschau der E-Mail"
                    />
                  </>
                ) : null}
              </>
            )}
          </div>
        )}
      </FormCard>

      <FormCard title="Inhalt">
        <FormField
          hint={`Kurz und klar, höchstens ${TITLE_MAX} Zeichen.`}
          label="Titel"
          required
        >
          <input
            maxLength={TITLE_MAX * 2}
            onChange={(event) => patch({ title: event.target.value })}
            value={draft.title}
          />
        </FormField>
        <Counter max={TITLE_MAX} value={draft.title} />
        <FormField label="Text" required>
          <textarea
            onChange={(event) => patch({ body: event.target.value })}
            rows={3}
            value={draft.body}
          />
        </FormField>
        <Counter max={BODY_MAX} value={draft.body} />
        <FormGrid>
          <FormField label="Schaltfläche (Text)" required>
            <input
              maxLength={BUTTON_MAX * 2}
              onChange={(event) => patch({ buttonLabel: event.target.value })}
              value={draft.buttonLabel}
            />
          </FormField>
          <FormField
            hint={`Höchstens ${SYMBOL_MAX} Zeichen, z. B. «T» oder ein Emoji.`}
            label="Symbol"
            optional
          >
            <input
              onChange={(event) => patch({ symbol: event.target.value })}
              value={draft.symbol}
            />
          </FormField>
        </FormGrid>
        <div className="fk-field">
          <span className="fk-label">Ziel der Schaltfläche</span>
          <FormChips
            label="Ziel der Schaltfläche"
            onChange={(next) =>
              patch({
                linkKind: next[0] ?? "shop",
                linkTarget: "",
                linkTargetLabel: "",
              })
            }
            options={LINK_OPTIONS}
            value={[draft.linkKind]}
          />
        </div>
        {draft.linkKind === "url" ? (
          <FormField label="Adresse" required>
            <input
              inputMode="url"
              onChange={(event) => patch({ linkTarget: event.target.value })}
              placeholder="https://"
              type="url"
              value={draft.linkTarget}
            />
          </FormField>
        ) : null}
        {draft.linkKind === "knowledge" ? (
          <div className="notices-settings__articles">
            <FormField
              hint={
                draft.linkTarget
                  ? `Gewählt: ${draft.linkTargetLabel || "Wissensartikel"}`
                  : "Artikel suchen und anklicken."
              }
              label="Wissensartikel"
              required
            >
              <input
                onChange={(event) => setArticleQuery(event.target.value)}
                placeholder="Artikel suchen …"
                type="search"
                value={articleQuery}
              />
            </FormField>
            {articles.length > 0 ? (
              <ul className="notices-settings__article-list">
                {articles.map((article) => (
                  <li key={article.id}>
                    <button
                      aria-pressed={draft.linkTarget === article.id}
                      className={
                        draft.linkTarget === article.id ? "is-on" : undefined
                      }
                      onClick={() =>
                        patch({
                          linkTarget: article.id,
                          linkTargetLabel: article.title,
                        })
                      }
                      type="button"
                    >
                      {article.title}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <div className="fk-field">
          <span className="fk-label">Farbe</span>
          <FormChips
            label="Farbe"
            onChange={(next) => patch({ color: next[0] ?? "brand" })}
            options={COLOR_OPTIONS}
            value={[draft.color]}
          />
        </div>
      </FormCard>

      <FormCard
        sub="Mindestens ein Ort"
        title="Wo soll der Hinweis erscheinen?"
      >
        <FormSwitch
          checked={draft.showPortalBanner}
          hint="Grosses Banner oben im Portal (höchstens eines)."
          label="Portal-Banner"
          onChange={(checked) => patch({ showPortalBanner: checked })}
        />
        <FormSwitch
          checked={draft.showPortalBar}
          hint="Schmale Leiste oben im Portal."
          label="Portal-Hinweisleiste"
          onChange={(checked) => patch({ showPortalBar: checked })}
        />
        <FormSwitch
          checked={draft.showMail}
          hint="Unter dem Inhalt von Ticket-E-Mails, nie in Sicherheitsmeldungen."
          label="E-Mails an Anfragende"
          onChange={(checked) => patch({ showMail: checked })}
        />
        <FormSwitch
          checked={draft.showApp}
          label="App"
          onChange={(checked) => patch({ showApp: checked })}
        />
      </FormCard>

      <FormCard title="Für wen und wann?">
        <p className="notices-settings__hint">Zielgruppe: alle Anfragenden.</p>
        <FormGrid>
          <FormField hint="Leer = heute." label="Anzeigen ab" optional>
            <input
              onChange={(event) => patch({ startsOn: event.target.value })}
              type="date"
              value={draft.startsOn}
            />
          </FormField>
          <FormField label="Bis" required>
            <input
              min={draft.startsOn || undefined}
              onChange={(event) => patch({ endsOn: event.target.value })}
              type="date"
              value={draft.endsOn}
            />
          </FormField>
        </FormGrid>
        <FormSwitch
          checked={draft.dismissible}
          hint="Wer den Hinweis wegklickt, sieht ihn nicht mehr."
          label="Im Portal wegklicken erlauben"
          onChange={(checked) => patch({ dismissible: checked })}
        />
      </FormCard>
    </FormDialog>
  );
}
