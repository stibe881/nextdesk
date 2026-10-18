import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { supabase } from "./lib/supabase";
import { functionErrorMessage } from "./lib/function-error";

type Policy = {
  ticketRetentionDays: number;
  attachmentRetentionDays: number;
  auditRetentionDays: number;
  legalHold: boolean;
};
const initial: Policy = {
  ticketRetentionDays: 730,
  attachmentRetentionDays: 730,
  auditRetentionDays: 1825,
  legalHold: false,
};
function isPolicy(value: unknown): value is Policy {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    [
      "ticketRetentionDays",
      "attachmentRetentionDays",
      "auditRetentionDays",
    ].every(
      (key) => typeof item[key] === "number" && Number.isInteger(item[key]),
    ) && typeof item.legalHold === "boolean"
  );
}

export function TenantDataRetention({ tenantId }: { tenantId: string }) {
  const [policy, setPolicy] = useState<Policy>(initial);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "tenant-data-retention",
        { body: { type: "get", tenantId } },
      );
      if (error || !isPolicy(data?.data?.policy))
        throw error ?? new Error("Ungültige Retention-Antwort");
      setPolicy(data.data.policy);
    } catch (error) {
      setMessage(
        await functionErrorMessage(
          error,
          "Die Datenschutzrichtlinie konnte nicht geladen werden.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId]);
  useEffect(() => {
    void load();
  }, [load]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setMessage("");
    try {
      const { error } = await supabase.functions.invoke(
        "tenant-data-retention",
        { body: { type: "update", tenantId, ...policy } },
      );
      if (error) throw error;
      setMessage(
        "Die Retention-Richtlinie wurde gespeichert. Es wurde nichts automatisch gelöscht.",
      );
    } catch (error) {
      setMessage(
        await functionErrorMessage(
          error,
          "Die Datenschutzrichtlinie konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }
  const update = (key: keyof Policy, value: number | boolean) =>
    setPolicy((current) => ({ ...current, [key]: value }));
  return (
    <section
      aria-busy={loading}
      aria-labelledby="tenant-retention-heading"
      className="tenant-admin-settings__section tenant-retention"
    >
      <div className="tenant-admin-settings__section-heading">
        <div>
          <p className="eyebrow">DATENSCHUTZ</p>
          <h2 id="tenant-retention-heading">Aufbewahrung & Datenschutz</h2>
          <p>
            Definiere Retentionsziele dieses Mandanten. Automatische Löschungen
            werden nie direkt ausgelöst.
          </p>
        </div>
        <ShieldCheck aria-hidden="true" size={25} />
      </div>
      {loading ? (
        <p className="data-caption">
          <LoaderCircle
            aria-hidden="true"
            className="ticket-detail-spinner"
            size={16}
          />{" "}
          Richtlinie wird geladen …
        </p>
      ) : (
        <form className="tenant-retention__form" onSubmit={save}>
          <div className="tenant-retention__grid">
            <label>
              Geschlossene Tickets <span>in Tagen</span>
              <input
                min="30"
                max="3650"
                onChange={(event) =>
                  update("ticketRetentionDays", Number(event.target.value))
                }
                required
                type="number"
                value={policy.ticketRetentionDays}
              />
            </label>
            <label>
              Private Anhänge <span>in Tagen</span>
              <input
                min="30"
                max="3650"
                onChange={(event) =>
                  update("attachmentRetentionDays", Number(event.target.value))
                }
                required
                type="number"
                value={policy.attachmentRetentionDays}
              />
            </label>
            <label>
              Audit-Protokoll <span>in Tagen</span>
              <input
                min="365"
                max="3650"
                onChange={(event) =>
                  update("auditRetentionDays", Number(event.target.value))
                }
                required
                type="number"
                value={policy.auditRetentionDays}
              />
            </label>
          </div>
          <label className="tenant-retention__hold">
            <input
              checked={policy.legalHold}
              onChange={(event) => update("legalHold", event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Rechtliche Aufbewahrungssperre</strong>
              <small>
                Es dürfen keine späteren kontrollierten Löschvorgänge für diesen
                Mandanten ausgeführt werden.
              </small>
            </span>
          </label>
          <p className="tenant-retention__note">
            Die Werte sind Richtlinien und werden protokolliert. Bevor Daten je
            gelöscht werden, muss ein separater, mandantenautorisierter
            Überprüfungslauf vorliegen.
          </p>
          <div className="form-actions">
            <button disabled={saving} type="submit">
              {saving ? (
                <>
                  <LoaderCircle
                    aria-hidden="true"
                    className="ticket-detail-spinner"
                    size={16}
                  />{" "}
                  Wird gespeichert …
                </>
              ) : (
                "Richtlinie speichern"
              )}
            </button>
          </div>
          {message && (
            <p aria-live="polite" className="data-caption">
              {message}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
