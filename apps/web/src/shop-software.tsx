import { AppWindow, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import {
  formatDate,
  shopApi,
  type IntuneApp,
  type LineSoftware,
} from "./lib/shop";
import {
  SOFTWARE_STATUS_LABEL,
  filterIntuneApps,
  isGuid,
  softwareTone,
  type SoftwareDraft,
} from "./lib/shop-software";
import "./shop-software.css";

/**
 * Intune-Verknüpfung eines Shop-Artikels: App aus Intune wählen (oder ID
 * eintragen) und die Entra-Sicherheitsgruppe, der die App zugewiesen ist.
 */
export function SoftwareLinkEditor({
  tenantId,
  value,
  kind,
  onChange,
}: {
  tenantId: string;
  value: SoftwareDraft;
  kind: "order" | "loan";
  onChange: (next: SoftwareDraft) => void;
}) {
  const [apps, setApps] = useState<IntuneApp[] | null>(null);
  const [loadingApps, setLoadingApps] = useState(false);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [groupName, setGroupName] = useState<string | null>(null);
  const [checkingGroup, setCheckingGroup] = useState(false);

  const shownApps = useMemo(
    () => (apps ? filterIntuneApps(apps, query) : []),
    [apps, query],
  );

  const loadApps = async () => {
    setLoadingApps(true);
    setMessage("");
    try {
      setApps(await shopApi.intuneApps(tenantId));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `${error.message} Sie können die App-ID auch von Hand eintragen.`
          : "Die Intune-Apps konnten nicht geladen werden.",
      );
    } finally {
      setLoadingApps(false);
    }
  };

  const checkGroup = async () => {
    if (!isGuid(value.groupId)) {
      setMessage("Bitte die Objekt-ID der Gruppe (GUID) eintragen.");
      return;
    }
    setCheckingGroup(true);
    setMessage("");
    try {
      const group = await shopApi.entraGroup(tenantId, value.groupId.trim());
      setGroupName(
        group.securityEnabled
          ? group.displayName
          : `${group.displayName} (keine Sicherheitsgruppe)`,
      );
    } catch (error) {
      setGroupName(null);
      setMessage(
        error instanceof Error
          ? error.message
          : "Die Gruppe konnte nicht geprüft werden.",
      );
    } finally {
      setCheckingGroup(false);
    }
  };

  return (
    <fieldset className="shop__options-editor shop-software">
      <legend>Software (Intune)</legend>
      <label className="shop__check">
        <input
          checked={value.enabled}
          disabled={kind === "loan"}
          onChange={(event) =>
            onChange({ ...value, enabled: event.target.checked })
          }
          type="checkbox"
        />
        Software-Artikel: nach der Freigabe automatisch über Intune zuweisen
      </label>
      {kind === "loan" ? (
        <p className="shop__muted">
          Ausleihartikel können keine Software sein.
        </p>
      ) : null}
      {value.enabled ? (
        <>
          <div className="shop-software__apps">
            <button
              className="secondary-button"
              disabled={loadingApps}
              onClick={() => void loadApps()}
              type="button"
            >
              <AppWindow aria-hidden="true" size={15} />
              {loadingApps
                ? "Lädt Apps …"
                : apps
                  ? "Apps neu laden"
                  : "Apps aus Intune laden"}
            </button>
            {apps ? (
              <input
                aria-label="Intune-Apps durchsuchen"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="App suchen"
                type="search"
                value={query}
              />
            ) : null}
          </div>
          {apps ? (
            <ul className="shop-software__app-list" aria-label="Intune-Apps">
              {shownApps.length === 0 ? (
                <li className="shop__muted">Keine App gefunden.</li>
              ) : null}
              {shownApps.map((app) => (
                <li key={app.id}>
                  <button
                    aria-pressed={value.appId === app.id}
                    className={
                      value.appId === app.id
                        ? "shop-software__app shop-software__app--selected"
                        : "shop-software__app"
                    }
                    onClick={() =>
                      onChange({
                        ...value,
                        appId: app.id,
                        appName: app.displayName,
                      })
                    }
                    type="button"
                  >
                    <strong>{app.displayName}</strong>
                    <span className="shop__muted">
                      {[app.publisher, app.appType].filter(Boolean).join(" · ")}
                      {app.isAssigned === false ? " · nicht zugewiesen" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="shop__row shop__row--grid">
            <label>
              Intune-App-ID
              <input
                onChange={(event) =>
                  onChange({ ...value, appId: event.target.value })
                }
                placeholder="00000000-0000-0000-0000-000000000000"
                spellCheck={false}
                value={value.appId}
              />
            </label>
            <label>
              Anzeigename der App
              <input
                maxLength={240}
                onChange={(event) =>
                  onChange({ ...value, appName: event.target.value })
                }
                placeholder="z. B. Microsoft Visio"
                value={value.appName}
              />
            </label>
          </div>
          <label>
            Zuweisung
            <select
              onChange={(event) =>
                onChange({
                  ...value,
                  mode: event.target.value as SoftwareDraft["mode"],
                })
              }
              value={value.mode}
            >
              <option value="user_group">
                Person in die Entra-Gruppe aufnehmen (empfohlen)
              </option>
              <option value="device_group">
                Intune-Geräte der Person in die Entra-Gruppe aufnehmen
              </option>
            </select>
          </label>
          <div className="shop-software__group">
            <label>
              Objekt-ID der Entra-Sicherheitsgruppe
              <input
                onChange={(event) => {
                  setGroupName(null);
                  onChange({ ...value, groupId: event.target.value });
                }}
                placeholder="00000000-0000-0000-0000-000000000000"
                spellCheck={false}
                value={value.groupId}
              />
            </label>
            <button
              className="secondary-button"
              disabled={checkingGroup}
              onClick={() => void checkGroup()}
              type="button"
            >
              {checkingGroup ? "Prüft …" : "Gruppe prüfen"}
            </button>
          </div>
          {groupName ? (
            <p className="shop-software__ok">Gruppe gefunden: {groupName}</p>
          ) : null}
          <label className="shop__check">
            <input
              checked={value.ensureAppAssignment}
              onChange={(event) =>
                onChange({
                  ...value,
                  ensureAppAssignment: event.target.checked,
                })
              }
              type="checkbox"
            />
            App der Gruppe direkt zuweisen, falls die Zuweisung in Intune fehlt
            (Pflichtinstallation, braucht zusätzlich
            DeviceManagementApps.ReadWrite.All)
          </label>
          <p className="shop__muted">
            Benötigte Entra-Berechtigung: GroupMember.ReadWrite.All. Der Gruppe
            muss die App in Intune zugewiesen sein.
          </p>
        </>
      ) : null}
      {message ? (
        <p className="form-error" role="alert">
          {message}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Stand der Intune-Zuweisung einer Bestellzeile. */
export function SoftwareLineStatus({
  software,
  onRetry,
  pending,
}: {
  software: LineSoftware;
  onRetry?: (() => void) | undefined;
  pending?: boolean;
}) {
  const tone = softwareTone(software.status);
  return (
    <span className="shop-software__status">
      <span
        className={`shop-software__badge shop-software__badge--${tone}`}
        role="status"
      >
        {SOFTWARE_STATUS_LABEL[software.status] ?? software.label}
      </span>
      {software.status === "assigned" && software.assignedAt ? (
        <span className="shop__muted">
          seit {formatDate(software.assignedAt)}
        </span>
      ) : null}
      {software.errorMessage ? (
        <span className="shop-software__error">{software.errorMessage}</span>
      ) : null}
      {software.canRetry && onRetry ? (
        <button
          className="secondary-button shop-software__retry"
          disabled={pending}
          onClick={onRetry}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={14} /> Erneut zuweisen
        </button>
      ) : null}
    </span>
  );
}
