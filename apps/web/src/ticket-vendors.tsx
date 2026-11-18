import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Pencil, Plus } from "lucide-react";
import { tn } from "./lib/formality";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";
import { FormField, FormGrid, FormSwitch } from "./form-kit";
import "./ticket-coordination.css";

type Vendor = {
  id: string;
  name: string;
  contactEmail: string | null;
  contactPhone: string | null;
  reminderAfterHours: number;
  active: boolean;
};

type Draft = {
  vendorId: string | null;
  name: string;
  contactEmail: string;
  contactPhone: string;
  reminderAfterHours: string;
  active: boolean;
};

const EMPTY_DRAFT: Draft = {
  vendorId: null,
  name: "",
  contactEmail: "",
  contactPhone: "",
  reminderAfterHours: "48",
  active: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function invoke(body: Record<string, unknown>): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke(
    "ticket-coordination",
    { body },
  );
  if (error) throw error;
  return data;
}

async function vendorError(error: unknown, fallback: string): Promise<string> {
  if (isRecord(error) && error.context instanceof Response) {
    try {
      const body: unknown = await error.context.clone().json();
      const code =
        isRecord(body) && isRecord(body.error) ? body.error.code : null;
      if (code === "vendor_name_exists") {
        return "Ein Drittanbieter mit diesem Namen ist bereits erfasst.";
      }
      if (code === "vendor_manage_denied") {
        return tn(
          "Für die Verwaltung der Drittanbieter fehlt dir die Berechtigung «Automationen verwalten».",
          "Für die Verwaltung der Drittanbieter fehlt Ihnen die Berechtigung «Automationen verwalten».",
        );
      }
    } catch {
      // fall through to the generic message
    }
  }
  return functionErrorMessage(error, fallback);
}

/**
 * «Lieferantenfälle»: list of external vendors (Swisscom, manufacturer
 * support …) a ticket can be handed to, with the reminder interval.
 */
export function TicketVendors({ tenantId }: { tenantId: string }) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoke({ type: "listVendors", tenantId });
      const rows =
        isRecord(data) &&
        isRecord(data.data) &&
        Array.isArray(data.data.vendors)
          ? data.data.vendors.filter(isRecord)
          : [];
      setVendors(
        rows.map((row) => ({
          id: String(row.id),
          name: String(row.name ?? ""),
          contactEmail:
            typeof row.contactEmail === "string" ? row.contactEmail : null,
          contactPhone:
            typeof row.contactPhone === "string" ? row.contactPhone : null,
          reminderAfterHours: Number(row.reminderAfterHours ?? 48),
          active: row.active === true,
        })),
      );
      setError("");
    } catch (nextError) {
      setError(
        await vendorError(
          nextError,
          "Die Drittanbieter konnten nicht geladen werden.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!draft) return;
    const hours = Number(draft.reminderAfterHours);
    if (draft.name.trim().length < 2) {
      setError(
        tn(
          "Bitte gib einen Namen mit mindestens 2 Zeichen ein.",
          "Bitte geben Sie einen Namen mit mindestens 2 Zeichen ein.",
        ),
      );
      return;
    }
    if (!Number.isInteger(hours) || hours < 1 || hours > 2160) {
      setError(
        "Die Erinnerung muss zwischen 1 und 2160 Stunden (90 Tage) liegen.",
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      await invoke({
        type: "saveVendor",
        tenantId,
        vendor: {
          ...(draft.vendorId ? { vendorId: draft.vendorId } : {}),
          name: draft.name.trim(),
          contactEmail: draft.contactEmail.trim() || null,
          contactPhone: draft.contactPhone.trim() || null,
          reminderAfterHours: hours,
          active: draft.active,
        },
      });
      setDraft(null);
      await load();
    } catch (nextError) {
      setError(
        await vendorError(
          nextError,
          "Der Drittanbieter konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="ticket-vendors-heading"
      className="tenant-automation ticket-vendors"
    >
      <div className="tenant-automation__heading">
        <div>
          <p className="eyebrow">LIEFERANTENFÄLLE</p>
          <h3 id="ticket-vendors-heading">Drittanbieter</h3>
          <p className="ticket-coordination__muted">
            Tickets können an diese Drittanbieter übergeben werden. Ohne
            Rückmeldung wird die zugewiesene Person nach der eingestellten Zeit
            erinnert.
          </p>
        </div>
        <button
          className="primary-button"
          disabled={saving || draft !== null}
          onClick={() => setDraft({ ...EMPTY_DRAFT })}
          type="button"
        >
          <Plus aria-hidden="true" size={15} />
          Drittanbieter erfassen
        </button>
      </div>

      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}

      {draft ? (
        <form
          className="ticket-coordination__split-form ticket-vendors__form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <FormGrid cols={2}>
            <FormField label="Name" required>
              <input
                maxLength={160}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                required
                value={draft.name}
              />
            </FormField>
            <FormField label="E-Mail">
              <input
                maxLength={254}
                onChange={(event) =>
                  setDraft({ ...draft, contactEmail: event.target.value })
                }
                type="email"
                value={draft.contactEmail}
              />
            </FormField>
            <FormField label="Telefon">
              <input
                maxLength={40}
                onChange={(event) =>
                  setDraft({ ...draft, contactPhone: event.target.value })
                }
                value={draft.contactPhone}
              />
            </FormField>
            <FormField label="Erinnerung nach (Stunden)">
              <input
                max={2160}
                min={1}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    reminderAfterHours: event.target.value,
                  })
                }
                type="number"
                value={draft.reminderAfterHours}
              />
            </FormField>
            <FormSwitch
              checked={draft.active}
              hint="Inaktive Drittanbieter werden in der Liste als inaktiv gekennzeichnet."
              label="Aktiv"
              onChange={(checked) => setDraft({ ...draft, active: checked })}
            />
          </FormGrid>
          <div className="ticket-coordination__actions">
            <button
              className="secondary-button"
              disabled={saving}
              onClick={() => setDraft(null)}
              type="button"
            >
              Abbrechen
            </button>
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={15}
                />
              ) : null}
              Speichern
            </button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <p className="ticket-coordination__muted">
          Drittanbieter werden geladen …
        </p>
      ) : vendors.length === 0 ? (
        <p className="empty-state">Noch keine Drittanbieter erfasst.</p>
      ) : (
        <ul className="ticket-coordination__list">
          {vendors.map((vendor) => (
            <li key={vendor.id}>
              <span className="ticket-coordination__item-main">
                <strong>{vendor.name}</strong>
                <span>
                  {[vendor.contactEmail, vendor.contactPhone]
                    .filter(Boolean)
                    .join(" · ") || "Ohne Kontaktangaben"}
                </span>
              </span>
              <span className="ticket-coordination__item-meta">
                Erinnerung nach {vendor.reminderAfterHours} Std. ohne
                Rückmeldung
              </span>
              <span className="ticket-coordination__actions">
                <span
                  className={`tone-chip ${vendor.active ? "tone-chip--success" : "tone-chip--neutral"}`}
                >
                  {vendor.active ? "Aktiv" : "Inaktiv"}
                </span>
                <button
                  aria-label={`${vendor.name} bearbeiten`}
                  className="icon-button"
                  disabled={saving || draft !== null}
                  onClick={() =>
                    setDraft({
                      vendorId: vendor.id,
                      name: vendor.name,
                      contactEmail: vendor.contactEmail ?? "",
                      contactPhone: vendor.contactPhone ?? "",
                      reminderAfterHours: String(vendor.reminderAfterHours),
                      active: vendor.active,
                    })
                  }
                  type="button"
                >
                  <Pencil aria-hidden="true" size={15} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
