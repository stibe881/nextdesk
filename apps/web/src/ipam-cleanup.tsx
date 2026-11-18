// Bereinigungs-Assistent: Vorschläge des Backends (cleanupSuggestions)
// auswählen und in einem Schritt übernehmen (applyCleanup).

import { tn } from "./lib/formality";
import { useEffect, useState, type FormEvent } from "react";
import { FormDialog, FormNote } from "./form-kit";
import { errorText, useIpamQuery } from "./ipam-ui";
import { ipamCall } from "./lib/ipam-api";
import type {
  CleanupResult,
  CleanupSuggestion,
} from "./lib/ipam-redesign-types";

export function IpamCleanupDialog({
  onApplied,
  onClose,
  tenantId,
}: {
  onApplied: (message: string) => void;
  onClose: () => void;
  tenantId: string;
}) {
  const query = useIpamQuery<{ suggestions: CleanupSuggestion[] }>(
    { type: "cleanupSuggestions", tenantId },
    tenantId,
  );
  const suggestions = query.data?.suggestions ?? null;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<CleanupResult["failed"]>([]);

  useEffect(() => {
    if (!suggestions) return;
    setSelected(
      new Set(
        suggestions
          .filter((entry) => entry.defaultOn)
          .map((entry) => entry.key),
      ),
    );
  }, [suggestions]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected.size) return;
    setBusy(true);
    setError(null);
    try {
      const result = await ipamCall<CleanupResult>({
        type: "applyCleanup",
        tenantId,
        keys: [...selected],
      });
      if (result.failed.length) {
        setFailed(result.failed);
        query.reload();
        onApplied(
          `${result.applied} Vorschläge übernommen, ${result.failed.length} nicht möglich.`,
        );
        return;
      }
      onApplied(
        result.applied === 1
          ? "1 Vorschlag übernommen."
          : `${result.applied} Vorschläge übernommen.`,
      );
      onClose();
    } catch (failure) {
      setError(
        errorText(failure, "Die Vorschläge konnten nicht übernommen werden."),
      );
    } finally {
      setBusy(false);
    }
  };

  const count = selected.size;
  return (
    <FormDialog
      error={error ?? query.error}
      eyebrow="IP-Adressen"
      onClose={onClose}
      onSubmit={(event) => void submit(event)}
      submitDisabled={!count}
      submitLabel={
        count === 1
          ? "1 Vorschlag übernehmen"
          : `${count} Vorschläge übernehmen`
      }
      submitting={busy}
      title="Bereinigungs-Assistent"
    >
      {!suggestions ? (
        <p className="ipam-muted">Auffälligkeiten werden gesucht …</p>
      ) : suggestions.length === 0 ? (
        <FormNote>
          Keine Auffälligkeiten gefunden. Netze, VLANs und Beschreibungen sind
          aufgeräumt.
        </FormNote>
      ) : (
        <>
          <FormNote>
            nextDesk hat {suggestions.length}{" "}
            {suggestions.length === 1 ? "Auffälligkeit" : "Auffälligkeiten"}{" "}
            {tn(
              "gefunden, z. B. aus einem Import. Wähle, was übernommen werden soll. Jede Änderung erscheint im Änderungsprotokoll und lässt sich dort rückgängig machen.",
              "gefunden, z. B. aus einem Import. Wählen Sie, was übernommen werden soll. Jede Änderung erscheint im Änderungsprotokoll und lässt sich dort rückgängig machen.",
            )}
          </FormNote>
          <ul className="ipam-cleanup">
            {suggestions.map((entry) => {
              const failure = failed.find((item) => item.key === entry.key);
              return (
                <li key={entry.key}>
                  <label>
                    <input
                      checked={selected.has(entry.key)}
                      onChange={() =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(entry.key)) next.delete(entry.key);
                          else next.add(entry.key);
                          return next;
                        })
                      }
                      type="checkbox"
                    />
                    <span>
                      <strong>{entry.title}</strong>
                      <span className="ipam-muted">{entry.detail}</span>
                      <span>
                        <span className="ipam-muted">Vorschlag:</span>{" "}
                        {entry.fix}
                      </span>
                      {failure ? (
                        <span className="ipam-tone-danger" role="alert">
                          {failure.message}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </FormDialog>
  );
}
