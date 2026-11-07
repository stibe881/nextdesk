import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { supabase } from "./lib/supabase";

type LifecycleSettings = {
  waitingReminderEnabled: boolean;
  waitingReminderDays: number;
  waitingResolveEnabled: boolean;
  waitingResolveDays: number;
  resolvedCloseEnabled: boolean;
  resolvedCloseDays: number;
};

const DEFAULTS: LifecycleSettings = {
  waitingReminderEnabled: false,
  waitingReminderDays: 3,
  waitingResolveEnabled: false,
  waitingResolveDays: 7,
  resolvedCloseEnabled: false,
  resolvedCloseDays: 5,
};

function parse(value: unknown): LifecycleSettings {
  if (!value || typeof value !== "object") return DEFAULTS;
  const row = value as Record<string, unknown>;
  const bool = (key: keyof LifecycleSettings) =>
    typeof row[key] === "boolean" ? (row[key] as boolean) : DEFAULTS[key];
  const num = (key: keyof LifecycleSettings) =>
    typeof row[key] === "number" ? (row[key] as number) : DEFAULTS[key];
  return {
    waitingReminderEnabled: bool("waitingReminderEnabled") as boolean,
    waitingReminderDays: num("waitingReminderDays") as number,
    waitingResolveEnabled: bool("waitingResolveEnabled") as boolean,
    waitingResolveDays: num("waitingResolveDays") as number,
    resolvedCloseEnabled: bool("resolvedCloseEnabled") as boolean,
    resolvedCloseDays: num("resolvedCloseDays") as number,
  };
}

/**
 * Ticket lifecycle rules: remind requesters who owe an answer, solve tickets
 * without an answer and close solved tickets after a waiting period.
 */
export function TicketLifecycleSettings({ tenantId }: { tenantId: string }) {
  const [settings, setSettings] = useState<LifecycleSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error: loadError } = await supabase.rpc(
      "get_ticket_lifecycle_settings",
      { p_tenant_id: tenantId },
    );
    setLoading(false);
    if (loadError) {
      setError("Die Regeln konnten nicht geladen werden.");
      return;
    }
    setSettings(parse(data));
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(next: LifecycleSettings) {
    if (!supabase) return;
    setSettings(next);
    setSaving(true);
    setError("");
    setMessage("");
    const { data, error: saveError } = await supabase.rpc(
      "save_ticket_lifecycle_settings",
      { p_tenant_id: tenantId, p_settings: next },
    );
    setSaving(false);
    if (saveError) {
      setError(
        saveError.message.includes("resolve_after_reminder")
          ? "Das automatische Lösen muss später als die Erinnerung erfolgen."
          : "Die Regeln konnten nicht gespeichert werden.",
      );
      void load();
      return;
    }
    setSettings(parse(data));
    setMessage("Gespeichert. Die Regeln werden stündlich angewendet.");
  }

  const days = (
    key: "waitingReminderDays" | "waitingResolveDays" | "resolvedCloseDays",
    max: number,
  ) => (
    <input
      aria-label="Tage"
      disabled={saving || loading}
      max={max}
      min={1}
      onChange={(event) =>
        setSettings({ ...settings, [key]: Number(event.target.value) })
      }
      onBlur={() => void save(settings)}
      type="number"
      value={settings[key]}
    />
  );
  const toggle = (
    key:
      | "waitingReminderEnabled"
      | "waitingResolveEnabled"
      | "resolvedCloseEnabled",
  ) => (
    <label className="tenant-automation__switch">
      <input
        checked={settings[key]}
        disabled={saving || loading}
        onChange={(event) =>
          void save({ ...settings, [key]: event.target.checked })
        }
        type="checkbox"
      />
      <span>{settings[key] ? "Aktiv" : "Inaktiv"}</span>
    </label>
  );

  return (
    <section
      aria-labelledby="ticket-lifecycle-heading"
      className="tenant-automation ticket-lifecycle"
    >
      <div className="tenant-automation__heading">
        <div>
          <p className="eyebrow">TICKET-ABLAUF</p>
          <h2 id="ticket-lifecycle-heading">Erinnern, lösen, schliessen</h2>
          <p>
            Diese Regeln laufen stündlich und automatisch. Antwortet die
            anfragende Person, beginnt die Wartezeit neu.
          </p>
        </div>
        {loading ? (
          <LoaderCircle
            aria-label="Wird geladen"
            className="ticket-detail-spinner"
            size={18}
          />
        ) : null}
      </div>
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="tenant-automation__message" role="status">
          {message}
        </p>
      ) : null}
      <ul className="tenant-automation__list">
        <li>
          <div className="tenant-automation__policy">
            <div>
              <strong>Erinnerung bei «Wartend auf Kunde»</strong>
              <span>
                Wartet ein Ticket auf die anfragende Person, erhält sie nach der
                eingestellten Zeit automatisch eine Erinnerung im Namen der
                zuständigen Person (per E-Mail bzw. App).
              </span>
            </div>
            {toggle("waitingReminderEnabled")}
          </div>
          <div className="tenant-automation__controls">
            <label>
              Erinnern nach Tagen
              {days("waitingReminderDays", 60)}
            </label>
          </div>
        </li>
        <li>
          <div className="tenant-automation__policy">
            <div>
              <strong>Ohne Rückmeldung als gelöst markieren</strong>
              <span>
                Kommt auch danach keine Antwort, wird das Ticket gelöst. Die
                anfragende Person wird wie bei jeder Lösung informiert.
              </span>
            </div>
            {toggle("waitingResolveEnabled")}
          </div>
          <div className="tenant-automation__controls">
            <label>
              Lösen nach Tagen (ab Beginn der Wartezeit)
              {days("waitingResolveDays", 90)}
            </label>
          </div>
        </li>
        <li>
          <div className="tenant-automation__policy">
            <div>
              <strong>Gelöste Tickets automatisch schliessen</strong>
              <span>
                Gelöste Tickets werden nach der Wartezeit geschlossen. Meldet
                sich die anfragende Person vorher, wird das Ticket wieder
                geöffnet.
              </span>
            </div>
            {toggle("resolvedCloseEnabled")}
          </div>
          <div className="tenant-automation__controls">
            <label>
              Schliessen nach Tagen
              {days("resolvedCloseDays", 90)}
            </label>
          </div>
        </li>
      </ul>
    </section>
  );
}
