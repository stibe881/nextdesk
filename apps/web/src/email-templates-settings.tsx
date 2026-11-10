import { LoaderCircle, RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  /** Nur vom Standard abweichende, gespeicherte Texte. */
  values: Record<string, string>;
};
type Preview = { subject: string; html: string };

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

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase)
    throw new Error("Die Verbindung zu nextDesk ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("email-templates", {
    body,
  });
  if (error)
    throw new Error("Die E-Mail-Vorlagen konnten nicht geladen werden.");
  const response = data as { data?: T; error?: { message?: string } } | null;
  if (response?.error)
    throw new Error(response.error.message ?? "Aktion fehlgeschlagen.");
  if (!response?.data) throw new Error("Keine Daten erhalten.");
  return response.data;
}

/** Texte, wie sie versendet werden: angepasst oder Standard. */
function effectiveValues(template: Template): Record<string, string> {
  return Object.fromEntries(
    template.fields.map((field) => [
      field.key,
      template.values[field.key] ?? field.default,
    ]),
  );
}

function TemplateItem({
  busy,
  onReset,
  onSave,
  onToggle,
  template,
  tenantId,
}: {
  busy: boolean;
  onReset: () => void;
  onSave: (values: Record<string, string>) => void;
  onToggle: () => void;
  template: Template;
  tenantId: string;
}) {
  const saved = effectiveValues(template);
  const [values, setValues] = useState<Record<string, string>>(saved);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const savedKey = JSON.stringify(saved);

  // Nach Speichern/Zurücksetzen gelten wieder die gespeicherten Texte.
  useEffect(() => {
    setValues(JSON.parse(savedKey) as Record<string, string>);
  }, [savedKey]);

  const changed = JSON.stringify(values) !== savedKey;
  const customised = Object.keys(template.values).length > 0;
  const valuesKey = JSON.stringify(values);
  const requestId = useRef(0);

  // Live-Vorschau: kurz nach der letzten Eingabe vom Server rendern lassen.
  useEffect(() => {
    if (!open) return;
    const id = ++requestId.current;
    const timer = window.setTimeout(() => {
      call<Preview>({
        action: "preview",
        tenantId,
        templateKey: template.key,
        fields: JSON.parse(valuesKey),
      })
        .then((result) => {
          if (id === requestId.current) {
            setPreview(result);
            setPreviewError(false);
          }
        })
        .catch(() => id === requestId.current && setPreviewError(true));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [open, valuesKey, tenantId, template.key]);

  return (
    <details
      className="email-templates__item"
      onToggle={(event) => setOpen(event.currentTarget.open)}
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
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggle();
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
      {open ? (
        <div className="email-templates__body">
          <div className="email-templates__editor">
            <p className="email-templates__description">
              {template.description}
            </p>
            {template.fields.map((field) => {
              const id = `email-template-${template.key}-${field.key}`;
              const onChange = (value: string) =>
                setValues((current) => ({ ...current, [field.key]: value }));
              return (
                <div className="email-templates__field" key={field.key}>
                  <label htmlFor={id}>{field.label}</label>
                  {field.multiline ? (
                    <textarea
                      id={id}
                      maxLength={4000}
                      onChange={(event) => onChange(event.target.value)}
                      rows={Math.min(
                        10,
                        Math.max(
                          3,
                          (values[field.key] ?? "").split("\n").length + 1,
                        ),
                      )}
                      value={values[field.key] ?? ""}
                    />
                  ) : (
                    <input
                      id={id}
                      maxLength={4000}
                      onChange={(event) => onChange(event.target.value)}
                      type="text"
                      value={values[field.key] ?? ""}
                    />
                  )}
                </div>
              );
            })}
            <p className="email-templates__placeholders">
              Platzhalter:{" "}
              {template.placeholders.length ? (
                template.placeholders.map((placeholder) => (
                  <code key={placeholder.name} title={placeholder.description}>
                    {`{{${placeholder.name}}}`}
                  </code>
                ))
              ) : (
                <span>keine</span>
              )}
            </p>
            <div className="email-templates__actions">
              <button
                className="primary-button"
                disabled={!changed || busy}
                onClick={() => onSave(values)}
                type="button"
              >
                <Save aria-hidden="true" size={16} /> Speichern
              </button>
              <button
                className="secondary-button"
                disabled={busy || (!customised && !changed)}
                onClick={onReset}
                type="button"
              >
                <RotateCcw aria-hidden="true" size={16} /> Auf Standard
              </button>
            </div>
          </div>
          <div className="email-templates__preview">
            <h4>Vorschau mit Beispieldaten</h4>
            {previewError ? (
              <p className="email-templates__loading">
                Die Vorschau konnte nicht geladen werden.
              </p>
            ) : preview ? (
              <>
                <p className="email-templates__subject">
                  <span>Betreff</span>
                  {preview.subject}
                </p>
                <iframe
                  className="email-templates__frame"
                  sandbox=""
                  srcDoc={preview.html}
                  title={`Vorschau ${template.label}`}
                />
              </>
            ) : (
              <p className="email-templates__loading">
                <LoaderCircle aria-hidden="true" className="spin" size={16} />{" "}
                Vorschau wird erstellt …
              </p>
            )}
          </div>
        </div>
      ) : null}
    </details>
  );
}

export function EmailTemplatesSettings({ tenantId }: { tenantId: string }) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const load = useCallback(
    (body: Record<string, unknown>) =>
      call<{ templates: Template[] }>({ tenantId, ...body }).then((result) =>
        setTemplates(result.templates),
      ),
    [tenantId],
  );

  useEffect(() => {
    load({ action: "list" }).catch((error: Error) =>
      setFeedback({ kind: "error", message: error.message }),
    );
  }, [load]);

  async function run(key: string, body: Record<string, unknown>, ok: string) {
    setBusy(key);
    setFeedback(null);
    try {
      await load({ templateKey: key, ...body });
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
            je Vorlage mit dem Schieber ein- oder ausschalten. In den Feldern
            steht der Text, der so versendet wird. Platzhalter wie{" "}
            <code>{"{{ticketNumber}}"}</code> werden beim Versand ersetzt.
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
                {inCategory.map((template) => (
                  <TemplateItem
                    busy={busy === template.key}
                    key={template.key}
                    onReset={() =>
                      void run(
                        template.key,
                        { action: "reset" },
                        `«${template.label}» auf Standard zurückgesetzt.`,
                      )
                    }
                    onSave={(values) =>
                      void run(
                        template.key,
                        {
                          action: "save",
                          enabled: template.enabled,
                          fields: values,
                        },
                        `«${template.label}» gespeichert.`,
                      )
                    }
                    onToggle={() =>
                      void run(
                        template.key,
                        {
                          action: "save",
                          enabled: !template.enabled,
                          fields: template.values,
                        },
                        `«${template.label}» ${template.enabled ? "ausgeschaltet" : "eingeschaltet"}.`,
                      )
                    }
                    template={template}
                    tenantId={tenantId}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
