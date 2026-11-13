import { tn } from "./lib/formality";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, LoaderCircle, Webhook } from "lucide-react";
import { supabase } from "./lib/supabase";
import { functionErrorMessage } from "./lib/function-error";
import {
  deliveryStatusLabel,
  IPAM_WEBHOOK_EVENTS,
  type IpamApiSettingsData,
  type IpamWebhook,
  type IpamWebhookEvent,
  ipamApiBaseUrl,
  parseIpamApiSettings,
  webhookEventLabel,
  webhookStatusLabel,
  webhookUrlProblem,
} from "./lib/ipam-api-settings-model";
import "./ipam-integrations.css";

/*
 * REST-API und Webhooks der IP-Adressverwaltung: API-Schlüssel erstellen
 * (wird nur einmal angezeigt) und widerrufen, Webhooks anlegen, testen,
 * pausieren und das Signatur-Geheimnis erneuern. Die Funktion ipam-sync
 * prüft ipam.manage; ohne Verwaltungsrecht ist alles nur lesbar.
 */

type Props = { tenantId: string; canManage: boolean };

type Secret = { title: string; value: string; hint: string };

function formatDate(value: string | null): string {
  if (!value) return "—";
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Intl.DateTimeFormat("de-CH", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(time))
    : "—";
}

async function invoke(body: Record<string, unknown>): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("ipam-sync", {
    body,
  });
  if (error) throw error;
  return (data as { data?: unknown } | null)?.data ?? null;
}

export function IpamApiSettings({ tenantId, canManage }: Props) {
  const [settings, setSettings] = useState<IpamApiSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [secret, setSecret] = useState<Secret | null>(null);
  const [keyName, setKeyName] = useState("");
  const [keyWrite, setKeyWrite] = useState(false);
  const [hookName, setHookName] = useState("");
  const [hookUrl, setHookUrl] = useState("");
  const [hookEvents, setHookEvents] = useState<IpamWebhookEvent[]>([
    "address.reserved",
    "address.released",
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = parseIpamApiSettings(
        await invoke({ type: "apiSettings", tenantId }),
      );
      if (!next) throw new Error("Die Antwort war unvollständig.");
      setSettings(next);
      setError("");
    } catch (loadError) {
      setSettings(null);
      setError(
        await functionErrorMessage(
          loadError,
          "Die API-Einstellungen konnten nicht geladen werden.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (
    label: string,
    body: Record<string, unknown>,
    fallback: string,
  ): Promise<Record<string, unknown> | null> => {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const data = await invoke({ ...body, tenantId });
      await load();
      return typeof data === "object" && data !== null
        ? (data as Record<string, unknown>)
        : {};
    } catch (runError) {
      setError(await functionErrorMessage(runError, fallback));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const createKey = async (event: FormEvent) => {
    event.preventDefault();
    if (!keyName.trim()) return;
    const data = await run(
      "createKey",
      {
        type: "createApiKey",
        name: keyName.trim(),
        scopes: keyWrite ? ["read", "write"] : ["read"],
      },
      "Der Schlüssel konnte nicht erstellt werden.",
    );
    if (data && typeof data.secret === "string") {
      setSecret({
        title: `API-Schlüssel «${keyName.trim()}»`,
        value: data.secret,
        hint: tn(
          "Kopiere den Schlüssel jetzt. Er wird nur dieses eine Mal angezeigt.",
          "Kopieren Sie den Schlüssel jetzt. Er wird nur dieses eine Mal angezeigt.",
        ),
      });
      setKeyName("");
      setKeyWrite(false);
    }
  };

  const revokeKey = async (id: string, name: string) => {
    if (
      !window.confirm(
        `Schlüssel «${name}» widerrufen? Integrationen mit diesem Schlüssel funktionieren danach nicht mehr.`,
      )
    ) {
      return;
    }
    const data = await run(
      `revoke-${id}`,
      { type: "revokeApiKey", keyId: id },
      "Der Schlüssel konnte nicht widerrufen werden.",
    );
    if (data) setNotice(`Schlüssel «${name}» wurde widerrufen.`);
  };

  const addWebhook = async (event: FormEvent) => {
    event.preventDefault();
    const problem = webhookUrlProblem(hookUrl);
    if (problem) {
      setError(problem);
      return;
    }
    if (!hookName.trim() || hookEvents.length === 0) {
      setError("Bitte Namen und mindestens ein Ereignis angeben.");
      return;
    }
    const data = await run(
      "addHook",
      {
        type: "saveWebhook",
        name: hookName.trim(),
        url: hookUrl.trim(),
        events: hookEvents,
        active: true,
      },
      "Der Webhook konnte nicht gespeichert werden.",
    );
    if (data && typeof data.secret === "string") {
      setSecret({
        title: `Signatur-Geheimnis für «${hookName.trim()}»`,
        value: data.secret,
        hint: "Damit prüft der Empfänger den Header X-NextDesk-Signature. Das Geheimnis wird nur dieses eine Mal angezeigt.",
      });
      setHookName("");
      setHookUrl("");
    }
  };

  const toggleWebhook = async (hook: IpamWebhook) => {
    await run(
      `toggle-${hook.id}`,
      {
        type: "saveWebhook",
        id: hook.id,
        name: hook.name,
        url: hook.url,
        events: hook.events,
        active: !hook.active,
      },
      "Der Webhook konnte nicht geändert werden.",
    );
  };

  const testWebhook = async (hook: IpamWebhook) => {
    const data = await run(
      `test-${hook.id}`,
      { type: "testWebhook", id: hook.id },
      "Die Testzustellung ist fehlgeschlagen.",
    );
    if (data) {
      setNotice(
        data.ok === true
          ? `Testzustellung an «${hook.name}» erfolgreich (HTTP ${String(data.status)}).`
          : `Testzustellung an «${hook.name}» fehlgeschlagen: ${String(data.error ?? "unbekannter Fehler")}.`,
      );
    }
  };

  const rotateSecret = async (hook: IpamWebhook) => {
    if (
      !window.confirm(
        `Neues Signatur-Geheimnis für «${hook.name}» erzeugen? Der Empfänger muss danach das neue Geheimnis verwenden.`,
      )
    ) {
      return;
    }
    const data = await run(
      `rotate-${hook.id}`,
      { type: "rotateWebhookSecret", id: hook.id },
      "Das Geheimnis konnte nicht erneuert werden.",
    );
    if (data && typeof data.secret === "string") {
      setSecret({
        title: `Neues Signatur-Geheimnis für «${hook.name}»`,
        value: data.secret,
        hint: "Das Geheimnis wird nur dieses eine Mal angezeigt.",
      });
    }
  };

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.value);
      setNotice("In die Zwischenablage kopiert.");
    } catch {
      setNotice("Bitte den Wert manuell markieren und kopieren.");
    }
  };

  const baseUrl = ipamApiBaseUrl(import.meta.env.VITE_SUPABASE_URL);

  return (
    <div className="ipam-api-settings">
      <section className="ipam-api-settings__card">
        <div>
          <p className="eyebrow">REST-API</p>
          <h3>API-Schlüssel</h3>
          <p className="ipam-api-settings__muted">
            Für Ansible, Terraform, Power Automate oder eigene Skripte. Adresse
            der API: <code>{baseUrl}</code> – Schlüssel im Header{" "}
            <code>Authorization: Bearer …</code>. Höchstens 120 Anfragen pro
            Minute und Schlüssel; Änderungen stehen im Audit-Log.
          </p>
        </div>

        {secret ? (
          <div className="ipam-api-settings__secret" role="status">
            <strong>{secret.title}</strong>
            <code>{secret.value}</code>
            <span>{secret.hint}</span>
            <div className="ipam-api-settings__actions">
              <button
                className="secondary-button"
                onClick={() => void copySecret()}
                type="button"
              >
                <Copy aria-hidden="true" size={15} /> Kopieren
              </button>
              <button
                className="secondary-button"
                onClick={() => setSecret(null)}
                type="button"
              >
                Ausblenden
              </button>
            </div>
          </div>
        ) : null}
        {error ? (
          <p className="ipam-api-settings__error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="ipam-api-settings__muted" role="status">
            {notice}
          </p>
        ) : null}

        {canManage ? (
          <form
            className="ipam-api-settings__form"
            onSubmit={(event) => void createKey(event)}
          >
            <label>
              Name der Integration
              <input
                maxLength={80}
                onChange={(event) => setKeyName(event.target.value)}
                placeholder="z. B. Ansible Produktion"
                required
                value={keyName}
              />
            </label>
            <label className="ipam-api-settings__checks">
              <span>
                <input
                  checked={keyWrite}
                  onChange={(event) => setKeyWrite(event.target.checked)}
                  type="checkbox"
                />{" "}
                Schreiben erlauben (reservieren, ändern, freigeben)
              </span>
            </label>
            <button
              className="primary-button"
              disabled={busy !== null || !keyName.trim()}
              type="submit"
            >
              <KeyRound aria-hidden="true" size={15} /> Schlüssel erstellen
            </button>
          </form>
        ) : null}

        {loading && !settings ? (
          <p className="data-caption" role="status">
            <LoaderCircle aria-hidden="true" size={14} /> Wird geladen …
          </p>
        ) : settings && settings.keys.length > 0 ? (
          <table className="ipam-api-settings__table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Schlüssel</th>
                <th>Rechte</th>
                <th>Erstellt</th>
                <th>Zuletzt verwendet</th>
                <th>Status</th>
                {canManage ? <th aria-label="Aktionen" /> : null}
              </tr>
            </thead>
            <tbody>
              {settings.keys.map((key) => (
                <tr key={key.id}>
                  <td>{key.name}</td>
                  <td>
                    <code>{key.prefix}…</code>
                  </td>
                  <td>
                    {key.scopes.includes("write")
                      ? "Lesen und schreiben"
                      : "Nur lesen"}
                  </td>
                  <td>{formatDate(key.createdAt)}</td>
                  <td>{formatDate(key.lastUsedAt)}</td>
                  <td>
                    {key.revokedAt ? (
                      <span className="ipam-badge ipam-badge--neutral">
                        Widerrufen
                      </span>
                    ) : (
                      <span className="ipam-badge ipam-badge--success">
                        Aktiv
                      </span>
                    )}
                  </td>
                  {canManage ? (
                    <td>
                      {key.revokedAt ? null : (
                        <button
                          className="secondary-button"
                          disabled={busy !== null}
                          onClick={() => void revokeKey(key.id, key.name)}
                          type="button"
                        >
                          Widerrufen
                        </button>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : settings ? (
          <p className="ipam-api-settings__muted">
            Noch keine API-Schlüssel erstellt.
          </p>
        ) : null}
      </section>

      <section className="ipam-api-settings__card">
        <div>
          <p className="eyebrow">WEBHOOKS</p>
          <h3>Webhooks</h3>
          <p className="ipam-api-settings__muted">
            nextDesk meldet Reservierungen, Freigaben, Änderungen, neue Subnetze
            und neue Funde per HTTPS-POST (JSON). Jede Zustellung ist mit
            HMAC-SHA256 signiert: Header{" "}
            <code>
              X-NextDesk-Signature: t=&lt;Zeit&gt;,v1=&lt;Signatur&gt;
            </code>{" "}
            über «Zeit.Body». Fehlgeschlagene Zustellungen werden bis zu achtmal
            wiederholt.
          </p>
        </div>

        {canManage ? (
          <form
            className="ipam-api-settings__form"
            onSubmit={(event) => void addWebhook(event)}
          >
            <label>
              Name
              <input
                maxLength={80}
                onChange={(event) => setHookName(event.target.value)}
                placeholder="z. B. Power Automate"
                required
                value={hookName}
              />
            </label>
            <label>
              HTTPS-Adresse
              <input
                maxLength={500}
                onChange={(event) => setHookUrl(event.target.value)}
                placeholder="https://…"
                required
                type="url"
                value={hookUrl}
              />
            </label>
            <fieldset className="ipam-api-settings__checks">
              <legend className="ipam-api-settings__muted">Ereignisse</legend>
              {IPAM_WEBHOOK_EVENTS.map((entry) => (
                <label key={entry.key}>
                  <input
                    checked={hookEvents.includes(entry.key)}
                    onChange={(event) =>
                      setHookEvents((current) =>
                        event.target.checked
                          ? [...current, entry.key]
                          : current.filter((value) => value !== entry.key),
                      )
                    }
                    type="checkbox"
                  />
                  {entry.label}
                </label>
              ))}
            </fieldset>
            <button
              className="primary-button"
              disabled={busy !== null}
              type="submit"
            >
              <Webhook aria-hidden="true" size={15} /> Webhook hinzufügen
            </button>
          </form>
        ) : null}

        {settings && settings.webhooks.length > 0 ? (
          <table className="ipam-api-settings__table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Adresse</th>
                <th>Ereignisse</th>
                <th>Letzter Status</th>
                {canManage ? <th aria-label="Aktionen" /> : null}
              </tr>
            </thead>
            <tbody>
              {settings.webhooks.map((hook) => {
                const recent = settings.deliveries
                  .filter((delivery) => delivery.webhookId === hook.id)
                  .slice(0, 3);
                return (
                  <tr key={hook.id}>
                    <td>{hook.name}</td>
                    <td>
                      <code>{hook.url}</code>
                    </td>
                    <td>{hook.events.map(webhookEventLabel).join(", ")}</td>
                    <td>
                      <span
                        className={`ipam-badge ipam-badge--${
                          !hook.active
                            ? "neutral"
                            : hook.lastError
                              ? "danger"
                              : "success"
                        }`}
                      >
                        {webhookStatusLabel(hook)}
                      </span>
                      {hook.lastDeliveryAt ? (
                        <p className="ipam-api-settings__muted">
                          {formatDate(hook.lastDeliveryAt)}
                        </p>
                      ) : null}
                      {recent.map((delivery) => (
                        <p
                          className="ipam-api-settings__muted"
                          key={delivery.id}
                        >
                          {webhookEventLabel(delivery.event)}:{" "}
                          {deliveryStatusLabel(delivery)}
                        </p>
                      ))}
                    </td>
                    {canManage ? (
                      <td>
                        <div className="ipam-api-settings__actions">
                          <button
                            className="secondary-button"
                            disabled={busy !== null}
                            onClick={() => void testWebhook(hook)}
                            type="button"
                          >
                            {busy === `test-${hook.id}`
                              ? "Wird gesendet …"
                              : "Testen"}
                          </button>
                          <button
                            className="secondary-button"
                            disabled={busy !== null}
                            onClick={() => void toggleWebhook(hook)}
                            type="button"
                          >
                            {hook.active ? "Pausieren" : "Aktivieren"}
                          </button>
                          <button
                            className="secondary-button"
                            disabled={busy !== null}
                            onClick={() => void rotateSecret(hook)}
                            type="button"
                          >
                            Geheimnis erneuern
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : settings ? (
          <p className="ipam-api-settings__muted">
            Noch keine Webhooks eingerichtet.
          </p>
        ) : null}
      </section>
    </div>
  );
}
