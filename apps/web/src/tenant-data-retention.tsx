import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { supabase } from "./lib/supabase";
import { functionErrorMessage } from "./lib/function-error";

type Policy = {
  ticketRetentionDays: number;
  attachmentRetentionDays: number;
  auditRetentionDays: number;
  legalHold: boolean;
  /** Betriebsdaten, täglich automatisch bereinigt (Monate). */
  monitoringRetentionMonths: number;
  ipamRetentionMonths: number;
  phishingRetentionMonths: number;
};
const initial: Policy = {
  ticketRetentionDays: 730,
  attachmentRetentionDays: 730,
  auditRetentionDays: 1825,
  legalHold: false,
  monitoringRetentionMonths: 24,
  ipamRetentionMonths: 24,
  phishingRetentionMonths: 12,
};
const OPERATIONAL_FIELDS: {
  key:
    | "monitoringRetentionMonths"
    | "ipamRetentionMonths"
    | "phishingRetentionMonths";
  label: string;
  hint: string;
}[] = [
  {
    key: "monitoringRetentionMonths",
    label: "Monitoring",
    hint: "Gelöste PRTG-Meldungen, Verlauf abgeschlossener Störungen, veraltete Sensorzustände",
  },
  {
    key: "ipamRetentionMonths",
    label: "IP-Adressverwaltung",
    hint: "Beobachtungen der Discovery, Adressverlauf, Änderungsprotokoll",
  },
  {
    key: "phishingRetentionMonths",
    label: "Phishing-Meldungen",
    hint: "Meldende Personen und Kopfzeilen abgeschlossener Fälle werden anonymisiert, nicht gelöscht",
  },
];
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
function withOperationalDefaults(value: Policy): Policy {
  const months = (entry: unknown, fallback: number) =>
    typeof entry === "number" && Number.isInteger(entry) ? entry : fallback;
  return {
    ...value,
    monitoringRetentionMonths: months(value.monitoringRetentionMonths, 24),
    ipamRetentionMonths: months(value.ipamRetentionMonths, 24),
    phishingRetentionMonths: months(value.phishingRetentionMonths, 12),
  };
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
      setPolicy(withOperationalDefaults(data.data.policy));
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
        "Die Retention-Richtlinie wurde gespeichert. Tickets und Anhänge werden nicht automatisch gelöscht; Betriebsdaten werden nach den angegebenen Fristen täglich bereinigt.",
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
          <fieldset className="tenant-retention__operational">
            <legend>Betriebsdaten (automatische Bereinigung)</legend>
            <p className="data-caption">
              Diese Daten werden täglich nach Ablauf der Frist gelöscht bzw.
              anonymisiert. Die Aufbewahrungssperre unten hält die Bereinigung
              an.
            </p>
            <div className="tenant-retention__grid">
              {OPERATIONAL_FIELDS.map((field) => (
                <label key={field.key}>
                  {field.label} <span>in Monaten</span>
                  <input
                    max="120"
                    min="1"
                    onChange={(event) =>
                      update(field.key, Number(event.target.value))
                    }
                    required
                    type="number"
                    value={policy[field.key]}
                  />
                  <small>{field.hint}</small>
                </label>
              ))}
            </div>
          </fieldset>
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
                Mandanten ausgeführt werden; auch die automatische Bereinigung
                der Betriebsdaten pausiert.
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
