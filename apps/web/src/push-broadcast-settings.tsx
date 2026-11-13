import { useCallback, useEffect, useMemo, useState } from "react";
import { FormCard, FormChips, FormField, FormNote } from "./form-kit";
import { tn } from "./lib/formality";
import {
  BODY_MAX,
  TITLE_MAX,
  audienceLabel,
  broadcastIssue,
  charCount,
  pushBroadcastApi,
  type Audience,
  type AudienceKind,
  type PushBroadcast,
  type PushContext,
  type PushReach,
} from "./lib/push-broadcast";
import "./push-broadcast-settings.css";

/** Einstellungen → Funktionen → «Push-Benachrichtigungen»: Mitteilung an iPhone und Android senden. */

const KINDS = [
  { value: "all", label: "Alle" },
  { value: "roles", label: "Nach Rolle" },
  { value: "departments", label: "Nach Abteilung" },
] as const satisfies readonly { value: AudienceKind; label: string }[];

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? ""
    : date.toLocaleString("de-CH", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function PushBroadcastSettings({ tenantId }: { tenantId: string }) {
  const [context, setContext] = useState<PushContext | null>(null);
  const [history, setHistory] = useState<PushBroadcast[]>([]);
  const [loadError, setLoadError] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<AudienceKind>("all");
  const [ids, setIds] = useState<string[]>([]);
  const [reach, setReach] = useState<PushReach | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const audience: Audience = useMemo(
    () => ({ kind, ids: kind === "all" ? [] : ids }),
    [kind, ids],
  );
  const issue = broadcastIssue({ title, body, audience });

  const load = useCallback(async () => {
    try {
      const [nextContext, list] = await Promise.all([
        pushBroadcastApi.context(tenantId),
        pushBroadcastApi.list(tenantId),
      ]);
      setContext(nextContext);
      setHistory(list.broadcasts);
      setLoadError("");
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Laden fehlgeschlagen.",
      );
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Zahl der erreichten Personen und Geräte, entprellt.
  useEffect(() => {
    if (kind !== "all" && ids.length === 0) {
      setReach(null);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void pushBroadcastApi
        .preview(tenantId, audience)
        .then((result) => {
          if (active) setReach(result);
        })
        .catch(() => {
          if (active) setReach(null);
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [tenantId, audience, kind, ids.length]);

  const options =
    kind === "roles"
      ? (context?.roles ?? [])
      : kind === "departments"
        ? (context?.departments ?? [])
        : [];

  const send = async () => {
    setSending(true);
    setMessage(null);
    try {
      const result = await pushBroadcastApi.send(tenantId, {
        title,
        body,
        audience,
      });
      setMessage({
        ok: true,
        text: `Gesendet: ${result.delivered} Zustellungen${
          result.failed > 0 ? `, ${result.failed} fehlgeschlagen` : ""
        } (${result.iosDevices} iPhone, ${result.androidDevices} Android).`,
      });
      setTitle("");
      setBody("");
      setConfirming(false);
      void load();
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Senden fehlgeschlagen.",
      });
      setConfirming(false);
    } finally {
      setSending(false);
    }
  };

  if (loadError) {
    return (
      <p className="push-broadcast__bad" role="alert">
        {loadError}
      </p>
    );
  }
  if (!context) return <p className="push-broadcast__hint">Wird geladen …</p>;

  return (
    <div className="push-broadcast">
      <div className="push-broadcast__head">
        <div>
          <h3>Push-Mitteilung senden</h3>
          <p>
            Schreibe eine eigene Mitteilung und sende sie an iPhone und Android.
            Sie erscheint auf dem Sperrbildschirm der Geräte. Registriert sind
            zurzeit {context.iosDevices} iPhone- und {context.androidDevices}{" "}
            Android-Geräte.
          </p>
        </div>
      </div>
      {!context.apnsConfigured ? (
        <p className="push-broadcast__bad" role="status">
          Der Versand an iPhones ist auf dem Server noch nicht eingerichtet.
          Android funktioniert unabhängig davon.
        </p>
      ) : null}

      <FormCard title="Mitteilung" sub="So erscheint sie auf dem Gerät">
        <FormField label="Titel" required>
          <input
            maxLength={TITLE_MAX * 2}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="z. B. Wartung am Freitagabend"
            value={title}
          />
        </FormField>
        <small className="push-broadcast__count">
          {charCount(title)}/{TITLE_MAX}
        </small>
        <FormField label="Text" required>
          <textarea
            maxLength={BODY_MAX * 2}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            value={body}
          />
        </FormField>
        <small className="push-broadcast__count">
          {charCount(body)}/{BODY_MAX}
        </small>
        <div className="push-broadcast__phone" aria-label="Vorschau">
          <b>{title.trim() || "Titel der Mitteilung"}</b>
          <span>{body.trim() || "Hier steht der Text der Mitteilung."}</span>
        </div>
      </FormCard>

      <FormCard title="Zielgruppe">
        <FormChips<AudienceKind>
          label="Zielgruppe"
          onChange={(next) => {
            setKind(next[0] ?? "all");
            setIds([]);
          }}
          options={KINDS}
          value={[kind]}
        />
        {kind !== "all" ? (
          options.length === 0 ? (
            <p className="push-broadcast__hint">
              {kind === "roles"
                ? "Es gibt keine Rollen."
                : "Es gibt keine Abteilungen."}
            </p>
          ) : (
            <FormChips<string>
              label={kind === "roles" ? "Rollen" : "Abteilungen"}
              multiple
              onChange={setIds}
              options={options.map((entry) => ({
                value: entry.id,
                label: entry.name,
              }))}
              value={ids}
            />
          )
        ) : null}
        <p className="push-broadcast__reach" role="status">
          {reach
            ? `Erreicht ${reach.peopleReachable} von ${reach.people} Personen (${reach.iosDevices} iPhone, ${reach.androidDevices} Android).`
            : kind === "all"
              ? "Zahl der Empfänger wird berechnet …"
              : "Wähle mindestens einen Eintrag."}
        </p>
        <FormNote>
          {tn(
            "Es erhalten nur Personen die Mitteilung, die Push in der App eingeschaltet haben.",
            "Es erhalten nur Personen die Mitteilung, die Push in der App eingeschaltet haben.",
          )}
        </FormNote>
      </FormCard>

      {issue && (title || body) ? (
        <p className="push-broadcast__hint">{issue}</p>
      ) : null}
      {message ? (
        <p
          className={message.ok ? "push-broadcast__ok" : "push-broadcast__bad"}
          role="status"
        >
          {message.text}
        </p>
      ) : null}

      {confirming ? (
        <div className="push-broadcast__confirm" role="alertdialog">
          <p>
            Die Mitteilung geht sofort an{" "}
            <b>
              {reach
                ? `${reach.iosDevices + reach.androidDevices} Geräte (${reach.peopleReachable} Personen)`
                : "die Zielgruppe"}
            </b>{" "}
            und lässt sich nicht zurückholen. Jetzt senden?
          </p>
          <div>
            <button
              className="primary-button"
              disabled={sending}
              onClick={() => void send()}
              type="button"
            >
              {sending ? "Wird gesendet …" : "Jetzt senden"}
            </button>
            <button
              className="secondary-button"
              disabled={sending}
              onClick={() => setConfirming(false)}
              type="button"
            >
              Abbrechen
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button
            className="primary-button"
            disabled={issue !== "" || sending}
            onClick={() => setConfirming(true)}
            type="button"
          >
            Senden …
          </button>
        </div>
      )}

      <FormCard title="Verlauf" sub="Zuletzt gesendet">
        {history.length === 0 ? (
          <p className="push-broadcast__hint">
            Es wurde noch keine Mitteilung gesendet.
          </p>
        ) : (
          <ul className="push-broadcast__history">
            {history.map((entry) => (
              <li key={entry.id}>
                <div>
                  <b>{entry.title}</b>
                  <span>{entry.body}</span>
                  <small>
                    {formatDate(entry.createdAt)}
                    {entry.createdBy ? ` · ${entry.createdBy}` : ""} ·{" "}
                    {audienceLabel(entry.audienceKind, entry.audienceCount)}
                  </small>
                </div>
                <div className="push-broadcast__stats">
                  <b>{entry.delivered}</b>
                  <small>
                    zugestellt
                    {entry.failed > 0
                      ? ` · ${entry.failed} fehlgeschlagen`
                      : ""}
                  </small>
                  <small>
                    {entry.iosDevices} iPhone · {entry.androidDevices} Android
                  </small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </FormCard>
    </div>
  );
}
