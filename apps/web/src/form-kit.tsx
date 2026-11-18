import { X } from "lucide-react";
import { useEffect, useId, type FormEvent, type ReactNode } from "react";
import "./form-kit.css";

/**
 * Gemeinsamer Rahmen der grossen Erfassen-/Bearbeiten-Formulare: Dialog mit
 * Zusammenfassung links, Abschnitten als Karten rechts und fixer Fusszeile.
 * Nur Darstellung: Zustand, Validierung und Speichern bleiben im Formular.
 */

export function FormDialog({
  children,
  eyebrow,
  error,
  footerLeft,
  onClose,
  onSubmit,
  side,
  submitDisabled,
  submitLabel = "Speichern",
  submitting,
  title,
}: {
  children: ReactNode;
  eyebrow?: string;
  /** Fehlermeldung über der Fusszeile. */
  error?: string | null;
  /** Zusatzaktionen links in der Fusszeile (Löschen, Archivieren). */
  footerLeft?: ReactNode;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Zusammenfassung und Schalter links (FormSummary, FormSwitch …). */
  side?: ReactNode;
  submitDisabled?: boolean;
  submitLabel?: string;
  submitting?: boolean;
  title: string;
}) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fk-backdrop" onClick={onClose} role="presentation">
      <form
        aria-labelledby={titleId}
        aria-modal="true"
        className={`fk-dialog${side ? " fk-dialog--side" : ""}`}
        onClick={(event) => event.stopPropagation()}
        onSubmit={onSubmit}
        role="dialog"
      >
        <header className="fk-head">
          <div>
            {eyebrow ? <p className="fk-eyebrow">{eyebrow}</p> : null}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            aria-label="Schliessen"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <div className="fk-body">
          {side ? <aside className="fk-side">{side}</aside> : null}
          <div className="fk-main">{children}</div>
        </div>
        {error ? (
          <p className="fk-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer className="fk-foot">
          <div className="fk-foot-left">{footerLeft}</div>
          <div className="fk-foot-right">
            <button
              className="secondary-button"
              onClick={onClose}
              type="button"
            >
              Abbrechen
            </button>
            <button
              className="primary-button"
              disabled={submitDisabled || submitting}
              type="submit"
            >
              {submitting ? "Speichert …" : submitLabel}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

/** Karte mit Titel; `collapsed` macht daraus einen eingeklappten Bereich. */
export function FormCard({
  children,
  collapsed,
  sub,
  title,
}: {
  children: ReactNode;
  collapsed?: boolean;
  sub?: string;
  title: string;
}) {
  if (collapsed) {
    return (
      <details className="fk-card fk-card--more">
        <summary>{title}</summary>
        <div className="fk-card-body">{children}</div>
      </details>
    );
  }
  return (
    <section className="fk-card">
      <header>
        <h3>{title}</h3>
        {sub ? <span>{sub}</span> : null}
      </header>
      <div className="fk-card-body">{children}</div>
    </section>
  );
}

/** Raster mit 1 bis 3 Spalten (stapelt auf schmalen Bildschirmen). */
export function FormGrid({
  children,
  cols = 2,
}: {
  children: ReactNode;
  cols?: 1 | 2 | 3;
}) {
  return <div className={`fk-grid fk-grid--${cols}`}>{children}</div>;
}

/** Beschriftung um ein Eingabefeld; Pflicht mit Stern, sonst ohne Zusatz. */
export function FormField({
  children,
  hint,
  label,
  optional,
  required,
}: {
  children: ReactNode;
  hint?: string;
  label: string;
  /** Nur setzen, wo «optional» wirklich hilft (sonst leer lassen). */
  optional?: boolean;
  required?: boolean;
}) {
  return (
    <label className="fk-field">
      <span className="fk-label">
        {label}
        {required ? (
          <b aria-hidden="true" className="fk-req">
            {" "}
            *
          </b>
        ) : null}
        {optional ? <em className="fk-opt"> optional</em> : null}
      </span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

/** Schieber mit Beschriftung (statt Checkbox). */
export function FormSwitch({
  checked,
  disabled,
  hint,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="fk-switch">
      <button
        aria-checked={checked}
        aria-label={label}
        className={`fk-slider${checked ? " is-on" : ""}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span />
      </button>
      <span className="fk-switch-text">
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
    </div>
  );
}

/** Auswahl als Chips: Einfachauswahl (Radio) oder Mehrfachauswahl. */
export function FormChips<T extends string>({
  label,
  multiple,
  onChange,
  options,
  value,
}: {
  label: string;
  multiple?: boolean;
  onChange: (next: T[]) => void;
  options: readonly { label: string; value: T }[];
  value: readonly T[];
}) {
  return (
    <div
      aria-label={label}
      className="fk-chips"
      role={multiple ? "group" : "radiogroup"}
    >
      {options.map((option) => {
        const on = value.includes(option.value);
        return (
          <button
            aria-checked={multiple ? undefined : on}
            aria-pressed={multiple ? on : undefined}
            className={`fk-chip${on ? " is-on" : ""}`}
            key={option.value}
            onClick={() =>
              onChange(
                multiple
                  ? on
                    ? value.filter((entry) => entry !== option.value)
                    : [...value, option.value]
                  : [option.value],
              )
            }
            role={multiple ? undefined : "radio"}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Zusammenfassung links: wie der Datensatz in der Liste wirkt. */
export function FormSummary({
  eyebrow,
  rows,
  title,
}: {
  eyebrow: string;
  rows?: readonly (readonly [string, string])[];
  title: string;
}) {
  return (
    <div className="fk-summary">
      <div className="fk-summary-top">
        <small>{eyebrow}</small>
        <strong>{title || "Neu"}</strong>
      </div>
      {rows && rows.length > 0 ? (
        <dl>
          {rows.map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{value || "–"}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** Hinweis (gestrichelte Box), z. B. in der Seitenleiste. */
export function FormNote({ children }: { children: ReactNode }) {
  return <p className="fk-note">{children}</p>;
}

/** Zusammenfassung links und Karten rechts für Formulare, die kein Dialog sind. */
export function FormLayout({
  children,
  side,
}: {
  children: ReactNode;
  side?: ReactNode;
}) {
  return (
    <div className={`fk-layout${side ? " fk-layout--side" : ""}`}>
      {side ? <aside className="fk-side">{side}</aside> : null}
      <div className="fk-main">{children}</div>
    </div>
  );
}
