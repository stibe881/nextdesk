import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, Rocket } from "lucide-react";
import { supabase } from "./lib/supabase";
import { functionErrorMessage } from "./lib/function-error";

type Settings = {
  portal_name?: unknown;
  tenant_sso_configurations?: unknown;
  tenant_feature_flags?: unknown;
};
type Person = { status?: unknown };
type Department = { active?: unknown };
type Readiness = { label: string; description: string; complete: boolean };
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object" && !Array.isArray(item)),
      )
    : [];

export function TenantOnboarding({ tenantId }: { tenantId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError("");
    try {
      const [settingsResult, peopleResult, departmentsResult] =
        await Promise.all([
          supabase.functions.invoke("tenant-admin-settings", {
            body: { type: "getSettings", tenantId },
          }),
          supabase.functions.invoke("tenant-admin-settings", {
            body: { type: "listUsers", tenantId },
          }),
          supabase.functions.invoke("tenant-admin-settings", {
            body: { type: "listDepartments", tenantId },
          }),
        ]);
      if (settingsResult.error || peopleResult.error || departmentsResult.error)
        throw (
          settingsResult.error ?? peopleResult.error ?? departmentsResult.error
        );
      setSettings(settingsResult.data?.data as Settings);
      setPeople(records(peopleResult.data?.data?.users));
      setDepartments(records(departmentsResult.data?.data?.departments));
    } catch (nextError) {
      setError(
        await functionErrorMessage(
          nextError,
          "Der Einrichtungsstatus konnte nicht geladen werden.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId]);
  useEffect(() => {
    void load();
  }, [load]);
  const checks = useMemo<Readiness[]>(() => {
    const configuredSso = records(settings?.tenant_sso_configurations).some(
      (item) => item.enabled === true,
    );
    const enabledFeatures = records(settings?.tenant_feature_flags).filter(
      (item) => item.enabled === true,
    ).length;
    const activePeople = people.filter(
      (item) => item.status === "active",
    ).length;
    const activeDepartments = departments.filter(
      (item) => item.active === true,
    ).length;
    return [
      {
        label: "Portalname",
        description: settings?.portal_name
          ? "Das Mandantenportal ist benannt."
          : "Lege unter Design einen Portalnamen fest.",
        complete:
          typeof settings?.portal_name === "string" &&
          settings.portal_name.trim().length > 1,
      },
      {
        label: "Personen",
        description: activePeople
          ? `${activePeople} aktive Person${activePeople === 1 ? "" : "en"} im Mandanten.`
          : "Lade mindestens eine Person ein oder prüfe die SSO-Anmeldung.",
        complete: activePeople > 0,
      },
      {
        label: "Abteilungen",
        description: activeDepartments
          ? `${activeDepartments} aktive Abteilung${activeDepartments === 1 ? "" : "en"} verfügbar.`
          : "Lege mindestens eine Abteilung für Tickets an.",
        complete: activeDepartments > 0,
      },
      {
        label: "Anmeldung",
        description: configuredSso
          ? "SSO ist eingerichtet."
          : "SSO ist optional; die aktuelle Anmeldung kann weiterverwendet werden.",
        complete: true,
      },
      {
        label: "Module",
        description: enabledFeatures
          ? `${enabledFeatures} Funktionsmodul${enabledFeatures === 1 ? "" : "e"} aktiviert.`
          : "Aktiviere bei Bedarf Funktionen wie Assets oder Wissensdatenbank.",
        complete: enabledFeatures > 0,
      },
    ];
  }, [departments, people, settings]);
  if (loading)
    return (
      <section className="tenant-admin-settings__section tenant-onboarding">
        <p className="data-caption">
          <LoaderCircle
            aria-hidden="true"
            className="ticket-detail-spinner"
            size={16}
          />{" "}
          Einrichtungsstatus wird geladen …
        </p>
      </section>
    );
  if (error)
    return (
      <section className="tenant-admin-settings__section tenant-onboarding">
        <p className="form-error" role="alert">
          {error}
        </p>
      </section>
    );
  const complete = checks.filter((check) => check.complete).length;
  return (
    <section
      aria-labelledby="tenant-onboarding-heading"
      className="tenant-admin-settings__section tenant-onboarding"
    >
      <div className="tenant-admin-settings__section-heading">
        <div>
          <p className="eyebrow">EINRICHTUNG</p>
          <h2 id="tenant-onboarding-heading">Bereit für den Arbeitsstart</h2>
          <p>
            {complete} von {checks.length} optionalen und grundlegenden
            Schritten sind erledigt.
          </p>
        </div>
        <Rocket aria-hidden="true" size={25} />
      </div>
      <ul className="tenant-onboarding__list">
        {checks.map((check) => (
          <li
            className={
              check.complete
                ? "tenant-onboarding__item tenant-onboarding__item--complete"
                : "tenant-onboarding__item"
            }
            key={check.label}
          >
            {check.complete ? (
              <CheckCircle2 aria-hidden="true" size={20} />
            ) : (
              <CircleAlert aria-hidden="true" size={20} />
            )}
            <span>
              <strong>{check.label}</strong>
              <small>{check.description}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
