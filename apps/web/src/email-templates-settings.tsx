import { LoaderCircle, RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";

type TemplateField = {
  key: string;
  label: string;
  multiline?: boolean;
  default: string;
};
type Template = {
  key: string;
  label: string;
  category: string;
  description: string;
  audience: "customer" | "staff" | "subscriber";
  placeholders: { name: string; description: string }[];
  fields: TemplateField[];
  enabled: boolean;
  values: Record<string, string>;
};
type Draft = { enabled: boolean; values: Record<string, string> };

const categoryOrder = [
  "Tickets",
  "Phishing-Meldungen",
  "Interne Mitteilungen",
  "Statusseite",
];

const audienceLabels: Record<Template["audience"], string> = {
  customer: "Anfragende Personen",
  staff: "Mitarbeitende",
  subscriber: "Abonnent:innen der Statusseite",
};

async function call(body: Record<string, unknown>): Promise<Template[]> {
  if (!supabase)
    throw new Error("Die Verbindung zu nextDesk ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("email-templates", {
    body,
  });
  if (error)
    throw new Error("Die E-Mail-Vorlagen konnten nicht geladen werden.");
  const response = data as {
    data?: { templates?: Template[] };
    error?: { message?: string };
  } | null;
  if (response?.error)
    throw new Error(response.error.message ?? "Aktion fehlgeschlagen.");
  return response?.data?.templates ?? [];
}

function toDraft(template: Template): Draft {
  return { enabled: template.enabled, values: { ...template.values } };
}

export function EmailTemplatesSettings({ tenantId }: { tenantId: string }) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const apply = useCallback((list: Template[]) => {
    setTemplates(list);
    setDrafts(Object.fromEntries(list.map((t) => [t.key, toDraft(t)])));
  }, []);

  useEffect(() => {
    let cancelled = false;
    call({ action: "list", tenantId })
      .then((list) => !cancelled && apply(list))
      .catch((error: Error) =>
        setFeedback({ kind: "error", message: error.message }),
      );
    return () => {
      cancelled = true;
    };
  }, [tenantId, apply]);

  function patch(key: string, change: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [key]: { ...current[key]!, ...change },
    }));
  }

  async function run(key: string, body: Record<string, unknown>, ok: string) {
    setBusy(key);
    setFeedback(null);
    try {
      apply(await call({ tenantId, templateKey: key, ...body }));
      setFeedback({ kind: "success", message: ok });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Fehlgeschlagen.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-labelledby="tenant-email-templates-heading"
      className="tenant-admin-settings__section email-templates"
    >
      <div className="tenant-admin-settings__section-heading">
        <div>
          <h2 id="tenant-email-templates-heading" tabIndex={-1}>
            E-Mail-Vorlagen
          </h2>
          <p>
            Texte aller automatisch versendeten E-Mails anpassen und den Versand
            je Vorlage ein- oder ausschalten. Leere Felder verwenden den
            Standardtext. Platzhalter wie <code>{"{{ticketNumber}}"}</code>{" "}
            werden beim Versand ersetzt.
          </p>
        </div>
      </div>

      {feedback ? (
        <p
          className={`email-templates__feedback is-${feedback.kind}`}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      ) : null}

      {!templates ? (
        <p className="email-templates__loading">
          <LoaderCircle aria-hidden="true" className="spin" size={16} /> Lädt …
        </p>
      ) : (
        <div className="email-templates__list">
          {categoryOrder.map((category) => {
            const inCategory = templates.filter(
              (template) => template.category === category,
            );
            if (!inCategory.length) return null;
            return (
              <div className="email-templates__group" key={category}>
                <h3>{category}</h3>
                {inCategory.map((template) => {
                  const draft = drafts[template.key] ?? toDraft(template);
                  const changed =
                    JSON.stringify(draft.values) !==
                    JSON.stringify(template.values);
                  const customised = Object.keys(template.values).length > 0;
                  return (
                    <details
                      className="email-templates__item"
                      key={template.key}
                    >
                      <summary>
                        <span className="email-templates__title">
                          <strong>{template.label}</strong>
                          <small>{audienceLabels[template.audience]}</small>
                        </span>
                        <span className="email-templates__badges">
                          {customised ? <em>Angepasst</em> : null}
                          <button
                            aria-checked={template.enabled}
                            aria-label={`${template.label}: Versand ${template.enabled ? "aktiv" : "aus"}`}
                            className={`email-templates__slider${template.enabled ? " is-on" : ""}`}
                            disabled={busy === template.key}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void run(
                                template.key,
                                {
                                  action: "save",
                                  enabled: !template.enabled,
                                  fields: template.values,
                                },
                                `«${template.label}» ${template.enabled ? "ausgeschaltet" : "eingeschaltet"}.`,
                              );
                            }}
                            role="switch"
                            title={
                              template.enabled
                                ? "Versand aktiv – zum Ausschalten klicken"
                                : "Versand aus – zum Einschalten klicken"
                            }
                            type="button"
                          >
                            <span />
                          </button>
                        </span>
                      </summary>
                      <div className="email-templates__body">
                        <p className="email-templates__description">
                          {template.description}
                        </p>
                        {template.fields.map((field) => {
                          const id = `email-template-${template.key}-${field.key}`;
                          const value = draft.values[field.key] ?? "";
                          return (
                            <div
                              className="email-templates__field"
                              key={field.key}
                            >
                              <label htmlFor={id}>{field.label}</label>
                              {field.multiline ? (
                                <textarea
                                  id={id}
                                  maxLength={4000}
                                  onChange={(event) =>
                                    patch(template.key, {
                                      values: {
                                        ...draft.values,
                                        [field.key]: event.target.value,
                                      },
                                    })
                                  }
                                  placeholder={field.default}
                                  rows={3}
                                  value={value}
                                />
                              ) : (
                                <input
                                  id={id}
                                  maxLength={4000}
                                  onChange={(event) =>
                                    patch(template.key, {
                                      values: {
                                        ...draft.values,
                                        [field.key]: event.target.value,
                                      },
                                    })
                                  }
                                  placeholder={field.default}
                                  type="text"
                                  value={value}
                                />
                              )}
                            </div>
                          );
                        })}
                        <p className="email-templates__placeholders">
                          Platzhalter:{" "}
                          {template.placeholders.map((placeholder) => (
                            <code
                              key={placeholder.name}
                              title={placeholder.description}
                            >
                              {`{{${placeholder.name}}}`}
                            </code>
                          ))}
                        </p>
                        <div className="email-templates__actions">
                          <button
                            className="primary-button"
                            disabled={!changed || busy === template.key}
                            onClick={() =>
                              void run(
                                template.key,
                                {
                                  action: "save",
                                  enabled: template.enabled,
                                  fields: draft.values,
                                },
                                `«${template.label}» gespeichert.`,
                              )
                            }
                            type="button"
                          >
                            <Save aria-hidden="true" size={16} /> Speichern
                          </button>
                          <button
                            className="secondary-button"
                            disabled={
                              busy === template.key ||
                              (!customised && template.enabled)
                            }
                            onClick={() =>
                              void run(
                                template.key,
                                { action: "reset" },
                                `«${template.label}» auf Standard zurückgesetzt.`,
                              )
                            }
                            type="button"
                          >
                            <RotateCcw aria-hidden="true" size={16} /> Auf
                            Standard
                          </button>
                        </div>
                      </div>
                    </details>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
