import { tn } from "./lib/formality";
import { Printer, QrCode, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  LABEL_FORMATS,
  buildLabelDocument,
  labelFormat,
  labelsPerPage,
  MAX_LABEL_COPIES,
  pageCount,
  repeatLabelItems,
  type LabelFormatId,
  type LabelItem,
  type LabelQrMode,
} from "./lib/asset-labels";
import "./asset-labels.css";

export type LabelBranding = { name: string | null; logoUrl: string | null };

const FORMAT_STORAGE_KEY = "nextdesk:asset-label-format";

function storedFormat(): LabelFormatId {
  try {
    return labelFormat(window.localStorage.getItem(FORMAT_STORAGE_KEY) ?? "")
      .id;
  } catch {
    return LABEL_FORMATS[0]!.id;
  }
}

/** Base URL of the web app, used for the web fallback link in the QR code. */
export function webAppBaseUrl(): string {
  return new URL(import.meta.env.BASE_URL || "/", window.location.origin).href;
}

/** Selection toolbar shared by the asset and infrastructure views. */
export function LabelSelectionBar({
  selectedCount,
  visibleCount,
  onSelectVisible,
  onClear,
  onPrint,
  extra,
}: {
  selectedCount: number;
  visibleCount: number;
  onSelectVisible: () => void;
  onClear: () => void;
  onPrint: () => void;
  extra?: string | undefined;
}) {
  return (
    <div aria-label="Etiketten" className="asset-label-bar" role="toolbar">
      <QrCode aria-hidden="true" size={16} />
      <span className="asset-label-bar__count">
        {selectedCount === 0
          ? "Für Etiketten auswählen"
          : `${selectedCount} ausgewählt${extra ? ` (${extra})` : ""}`}
      </span>
      <button
        className="text-button"
        disabled={visibleCount === 0}
        onClick={onSelectVisible}
        type="button"
      >
        Alle sichtbaren ({visibleCount})
      </button>
      {selectedCount > 0 ? (
        <button className="text-button" onClick={onClear} type="button">
          Auswahl aufheben
        </button>
      ) : null}
      <button
        className="secondary-button"
        disabled={selectedCount === 0}
        onClick={onPrint}
        type="button"
      >
        <Printer aria-hidden="true" size={15} /> Etiketten drucken
      </button>
    </div>
  );
}

/**
 * Print dialog: format, offset on partly used sheets, QR content. Opens a
 * print view (also «Als PDF speichern» in the browser print dialog).
 */
export function AssetLabelDialog({
  buildItems,
  count,
  branding,
  onClose,
  webOnly = false,
}: {
  /** Creates the label items for the chosen QR mode. */
  buildItems: (mode: LabelQrMode, baseUrl: string) => LabelItem[];
  count: number;
  branding?: LabelBranding | undefined;
  onClose: () => void;
  /** Only a web link is offered (e.g. stock articles have no app link). */
  webOnly?: boolean;
}) {
  const [formatId, setFormatId] = useState<LabelFormatId>(storedFormat);
  const [skip, setSkip] = useState(0);
  const [copies, setCopies] = useState(1);
  const total = count * copies;
  const [mode, setMode] = useState<LabelQrMode>(webOnly ? "web" : "app");
  const [withLogo, setWithLogo] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const format = labelFormat(formatId);
  const perPage = labelsPerPage(format);
  const pages = useMemo(
    () => pageCount(format, total, skip),
    [total, format, skip],
  );
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const hasLogo = Boolean(branding?.logoUrl || branding?.name);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    firstFieldRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function print() {
    // Opened synchronously in the click handler so pop-up blockers allow it.
    const view = window.open(
      "",
      "nextdesk-asset-labels",
      "popup,width=920,height=760",
    );
    if (!view) {
      setError(
        tn(
          "Das Druckfenster wurde blockiert. Bitte erlaube Pop-ups für nextDesk.",
          "Das Druckfenster wurde blockiert. Bitte erlauben Sie Pop-ups für nextDesk.",
        ),
      );
      return;
    }
    setPending(true);
    setError("");
    try {
      try {
        window.localStorage.setItem(FORMAT_STORAGE_KEY, format.id);
      } catch {
        // Remembering the format is a convenience only.
      }
      const items = repeatLabelItems(buildItems(mode, webAppBaseUrl()), copies);
      // QR library is loaded only when labels are printed.
      const QRCode = await import("qrcode");
      const qrSvgs = new Map<string, string>();
      for (const item of items) {
        qrSvgs.set(
          item.key,
          await QRCode.toString(item.qrText, {
            type: "svg",
            errorCorrectionLevel: "M",
            margin: 0,
            color: { dark: "#000000", light: "#ffffff" },
          }),
        );
      }
      view.document.open();
      view.document.write(
        buildLabelDocument({
          format,
          items,
          skip,
          qrSvgs,
          branding: withLogo ? branding : undefined,
        }),
      );
      view.document.close();
      onClose();
    } catch (nextError) {
      view.close();
      setError(
        nextError instanceof Error
          ? `Die Etiketten konnten nicht erstellt werden: ${nextError.message}`
          : "Die Etiketten konnten nicht erstellt werden.",
      );
    } finally {
      setPending(false);
    }
  }

  return createPortal(
    <div
      className="asset-label-dialog__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <section
        aria-labelledby="asset-label-dialog-heading"
        aria-modal="true"
        className="asset-label-dialog"
        role="dialog"
      >
        <header className="panel-heading">
          <div>
            <p className="eyebrow">Etiketten mit QR-Code</p>
            <h2 id="asset-label-dialog-heading">
              {total === 1 ? "1 Etikett drucken" : `${total} Etiketten drucken`}
            </h2>
          </div>
          <button
            aria-label="Dialog schliessen"
            className="icon-button"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void print();
          }}
        >
          <label>
            Format
            <select
              onChange={(event) => {
                setFormatId(labelFormat(event.target.value).id);
                setSkip(0);
              }}
              ref={firstFieldRef}
              value={format.id}
            >
              {LABEL_FORMATS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <small>{format.description}</small>
          </label>
          <label>
            {count === 1 ? "Anzahl Etiketten" : "Anzahl Etiketten pro Eintrag"}
            <input
              max={MAX_LABEL_COPIES}
              min={1}
              onChange={(event) =>
                setCopies(
                  Math.min(
                    MAX_LABEL_COPIES,
                    Math.max(1, Math.floor(Number(event.target.value) || 1)),
                  ),
                )
              }
              type="number"
              value={copies}
            />
            {count > 1 ? (
              <small>
                {count} ausgewählte Einträge × {copies} = {total} Etiketten
              </small>
            ) : null}
          </label>
          {format.kind === "sheet" ? (
            <label>
              Bereits verwendete Etiketten überspringen
              <input
                max={perPage - 1}
                min={0}
                onChange={(event) =>
                  setSkip(
                    Math.min(
                      perPage - 1,
                      Math.max(0, Number(event.target.value) || 0),
                    ),
                  )
                }
                type="number"
                value={skip}
              />
              <small>
                Für angebrochene Bögen: Die ersten {skip} Felder bleiben leer.
              </small>
            </label>
          ) : (
            <p className="asset-label-dialog__hint">
              {tn(
                <>
                  Stelle im Druckdialog den Etikettendrucker und die
                  Papiergrösse {format.labelWidthMm} × {format.labelHeightMm} mm
                  ein, Ränder «Keine».
                </>,
                <>
                  Stellen Sie im Druckdialog den Etikettendrucker und die
                  Papiergrösse {format.labelWidthMm} × {format.labelHeightMm} mm
                  ein, Ränder «Keine».
                </>,
              )}
            </p>
          )}
          {webOnly ? (
            <p className="asset-label-dialog__hint">
              Der QR-Code enthält einen Web-Link: Er öffnet den Artikel im Lager
              von nextDesk (Anmeldung nötig).
            </p>
          ) : (
            <fieldset>
              <legend>Inhalt des QR-Codes</legend>
              <label className="asset-label-dialog__choice">
                <input
                  checked={mode === "app"}
                  name="asset-label-qr"
                  onChange={() => setMode("app")}
                  type="radio"
                />
                <span>
                  <strong>App-Link</strong>
                  <small>
                    Öffnet das Gerät direkt in der nextDesk-App (Scanner oder
                    Kamera).
                  </small>
                </span>
              </label>
              <label className="asset-label-dialog__choice">
                <input
                  checked={mode === "web"}
                  name="asset-label-qr"
                  onChange={() => setMode("web")}
                  type="radio"
                />
                <span>
                  <strong>Web-Link</strong>
                  <small>
                    Öffnet nextDesk im Browser; der App-Scanner erkennt den Link
                    ebenfalls.
                  </small>
                </span>
              </label>
            </fieldset>
          )}
          {hasLogo ? (
            <label className="asset-label-dialog__choice">
              <input
                checked={withLogo}
                onChange={(event) => setWithLogo(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>Logo des Mandanten</strong>
                <small>Nur auf Etiketten ab 60 × 28 mm.</small>
              </span>
            </label>
          ) : null}
          <p className="asset-label-dialog__summary" role="status">
            {format.kind === "sheet"
              ? `${pages} ${pages === 1 ? "Bogen" : "Bögen"} A4 · ${perPage} Etiketten pro Bogen`
              : `${count} Einzeletiketten`}
          </p>
          {error ? (
            <p className="form-message form-message--error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <button
              className="text-button"
              disabled={pending}
              onClick={onClose}
              type="button"
            >
              Abbrechen
            </button>
            <button
              className="primary-button"
              disabled={pending || count === 0}
              type="submit"
            >
              <Printer aria-hidden="true" size={16} />
              {pending ? "Wird vorbereitet …" : "Drucken / als PDF"}
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
}
