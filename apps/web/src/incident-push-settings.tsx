import { useEffect, useState } from "react";
import { tn } from "./lib/formality";
import {
  getIncidentPushSettings,
  saveIncidentPushSettings,
  toggleIncidentService,
  type IncidentPushSettings,
} from "./lib/incident-push";

/**
 * Persönliche Einstellungen → Benachrichtigungen: Push-Mitteilung, sobald eine
 * Störung gemeldet wird (dann, wenn auch der Banner erscheint), wahlweise nur
 * für einzelne Dienste.
 */
export function IncidentPushSettingsSection({
  tenantId,
}: {
  tenantId: string;
}) {
  const [settings, setSettings] = useState<IncidentPushSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setSettings(null);
    void getIncidentPushSettings(tenantId)
      .then((loaded) => {
        if (mounted) setSettings(loaded);
      })
      .catch(() => {
        // Ohne Anfragendenportal oder vor der Bereitstellung bleibt der
        // Abschnitt ausgeblendet.
      });
    return () => {
      mounted = false;
    };
  }, [tenantId]);

  if (!settings) return null;

  async function save(
    next: Pick<IncidentPushSettings, "enabled" | "serviceIds">,
  ) {
    if (saving || !settings) return;
    const previous = settings;
    setSaving(true);
    setError(null);
    setSettings({ ...settings, ...next });
    try {
      setSettings(await saveIncidentPushSettings(tenantId, next));
    } catch (failure) {
      setSettings(previous);
      setError(
        failure instanceof Error
          ? failure.message
          : "Die Einstellung konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  const chosen = new Set(
    settings.serviceIds ?? settings.services.map((service) => service.id),
  );

  return (
    <section
      aria-labelledby="personal-incident-push-heading"
      className="personal-settings__incident-push"
    >
      <div className="personal-settings__incident-push-head">
        <div>
          <h4 id="personal-incident-push-heading">Störungen</h4>
          <p className="personal-settings__hint">
            {tn(
              "Du erhältst eine Push-Mitteilung auf iPhone oder Android, sobald eine Störung gemeldet wird – dann, wenn auch der Banner erscheint.",
              "Sie erhalten eine Push-Mitteilung auf iPhone oder Android, sobald eine Störung gemeldet wird – dann, wenn auch der Banner erscheint.",
            )}
          </p>
        </div>
        <button
          aria-checked={settings.enabled}
          aria-label="Störungen per Push"
          className="personal-settings__switch"
          disabled={saving}
          onClick={() =>
            void save({
              enabled: !settings.enabled,
              serviceIds: settings.serviceIds,
            })
          }
          role="switch"
          type="button"
        >
          <span aria-hidden="true" />
        </button>
      </div>
      {settings.enabled && settings.services.length > 0 ? (
        <fieldset
          className="personal-settings__incident-services"
          disabled={saving}
        >
          <legend>
            Dienste
            <small>
              {settings.serviceIds === null
                ? " · alle"
                : ` · ${chosen.size} von ${settings.services.length}`}
            </small>
          </legend>
          <div className="personal-settings__incident-actions">
            <button
              className="secondary"
              disabled={settings.serviceIds === null}
              onClick={() => void save({ enabled: true, serviceIds: null })}
              type="button"
            >
              Alle
            </button>
            <button
              className="secondary"
              disabled={chosen.size === 0}
              onClick={() => void save({ enabled: true, serviceIds: [] })}
              type="button"
            >
              Keine
            </button>
          </div>
          <ul>
            {settings.services.map((service) => (
              <li key={service.id}>
                <label>
                  <input
                    checked={chosen.has(service.id)}
                    onChange={() =>
                      void save({
                        enabled: true,
                        serviceIds: toggleIncidentService(settings, service.id),
                      })
                    }
                    type="checkbox"
                  />
                  <span>{service.name}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="personal-settings__hint">
            Störungen ohne zugeordneten Dienst werden immer gemeldet.
          </p>
        </fieldset>
      ) : null}
      {error ? (
        <p className="personal-settings__hint" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
