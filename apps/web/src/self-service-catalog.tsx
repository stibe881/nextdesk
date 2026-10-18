import { useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, Search, X } from "lucide-react";
import { supabase } from "./lib/supabase";
import "./self-service.css";

export type ServiceCatalogItem = {
  id: string;
  name: string;
  description: string | null;
  criticality: "low" | "medium" | "high" | "critical";
};

type CatalogState =
  | { status: "loading" }
  | { status: "ready"; services: ServiceCatalogItem[] }
  | { status: "unavailable"; message: string }
  | { status: "hidden" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

function isSafeText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function parseServices(value: unknown): ServiceCatalogItem[] {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.services) ||
    value.data.services.length > 500
  ) {
    throw new Error("invalid_service_catalog");
  }

  const services = value.data.services.map((service) => {
    if (
      !isRecord(service) ||
      !isUuid(service.id) ||
      !isSafeText(service.name) ||
      (service.description !== null && !isSafeText(service.description)) ||
      (service.criticality !== "low" &&
        service.criticality !== "medium" &&
        service.criticality !== "high" &&
        service.criticality !== "critical")
    ) {
      throw new Error("invalid_service_catalog");
    }

    return {
      id: service.id.toLowerCase(),
      name: service.name.trim(),
      description:
        typeof service.description === "string"
          ? service.description.trim()
          : null,
      criticality: service.criticality,
    } satisfies ServiceCatalogItem;
  });

  if (new Set(services.map((service) => service.id)).size !== services.length) {
    throw new Error("invalid_service_catalog");
  }

  return services;
}

function portalSelfServiceEnabled(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.features)
  ) {
    return false;
  }
  return value.data.features.some(
    (feature) =>
      isRecord(feature) &&
      feature.key === "portal.self-service" &&
      feature.enabled === true,
  );
}

async function functionErrorCode(error: unknown): Promise<string | null> {
  if (!isRecord(error) || !(error.context instanceof Response)) return null;
  try {
    const body: unknown = await error.context.clone().json();
    return isRecord(body) &&
      isRecord(body.error) &&
      typeof body.error.code === "string"
      ? body.error.code
      : null;
  } catch {
    return null;
  }
}

function unavailableCatalogMessage(code: string | null): string {
  switch (code) {
    case "experience_feature_disabled":
      return "Der Servicekatalog ist für diesen Mandanten nicht aktiviert.";
    case "experience_hub_not_configured":
      return "Der Servicekatalog wird für diesen Mandanten noch eingerichtet.";
    case "tenant_feature_lookup_failed":
    case "authorization_check_failed":
      return "Der Servicekatalog kann im Moment nicht geprüft werden.";
    default:
      return "Der Servicekatalog ist im Moment nicht verfügbar. Sie können das Ticket weiterhin ohne Auswahl erfassen.";
  }
}

function criticalityLabel(value: ServiceCatalogItem["criticality"]): string {
  return {
    low: "Niedrige Kritikalität",
    medium: "Mittlere Kritikalität",
    high: "Hohe Kritikalität",
    critical: "Kritischer Service",
  }[value];
}

export function SelfServiceCatalog({
  disabled = false,
  onSelect,
  onSkip,
  selectedServiceId,
  tenantId,
}: {
  disabled?: boolean;
  onSelect: (service: ServiceCatalogItem) => void;
  onSkip: () => void;
  selectedServiceId: string | null;
  tenantId: string;
}) {
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!supabase) {
      setCatalog({
        status: "unavailable",
        message:
          "Der Servicekatalog ist in dieser Umgebung nicht konfiguriert. Sie können die Erfassung ohne Auswahl fortsetzen.",
      });
      return;
    }

    const client = supabase;
    let mounted = true;
    setCatalog({ status: "loading" });
    setQuery("");
    void client.functions
      .invoke("tenant-feature-flags", {
        body: { type: "list", tenantId },
      })
      .then(async ({ data, error }) => {
        if (error) throw error;
        if (!portalSelfServiceEnabled(data)) {
          if (mounted) setCatalog({ status: "hidden" });
          return;
        }
        const response = await client.functions.invoke("experience-hub", {
          body: { type: "listServiceCatalog", tenantId },
        });
        if (response.error) throw response.error;
        const services = parseServices(response.data);
        if (mounted) setCatalog({ status: "ready", services });
      })
      .catch(async (error: unknown) => {
        if (!mounted) return;
        const code = await functionErrorCode(error);
        if (code === "experience_feature_disabled") {
          setCatalog({ status: "hidden" });
          return;
        }
        setCatalog({
          status: "unavailable",
          message: unavailableCatalogMessage(code),
        });
      });

    return () => {
      mounted = false;
    };
  }, [tenantId]);

  const filteredServices = useMemo(() => {
    if (catalog.status !== "ready") return [];
    const normalizedQuery = query.trim().toLocaleLowerCase("de-CH");
    if (!normalizedQuery) return catalog.services;
    return catalog.services.filter((service) =>
      [service.name, service.description]
        .filter((value): value is string => Boolean(value))
        .some((value) =>
          value.toLocaleLowerCase("de-CH").includes(normalizedQuery),
        ),
    );
  }, [catalog, query]);

  if (catalog.status === "hidden") return null;

  return (
    <section
      aria-labelledby="self-service-catalog-heading"
      className="self-service-catalog"
    >
      <div className="self-service-catalog__heading">
        <div>
          <p className="self-service-catalog__eyebrow">OPTIONALER START</p>
          <h3 id="self-service-catalog-heading">Service auswählen</h3>
          <p>
            Wählen Sie einen Service, wenn er zum Anliegen passt. Die Auswahl
            übernimmt den Namen in den bestehenden Betreff und, falls vorhanden,
            in die passende Kategorie.
          </p>
        </div>
        <button
          className="self-service-catalog__skip"
          disabled={disabled}
          onClick={onSkip}
          type="button"
        >
          Ohne Auswahl fortfahren
          <X aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
      </div>

      <aside className="self-service-catalog__guidance">
        <CircleAlert aria-hidden="true" size={18} strokeWidth={1.8} />
        <div>
          <strong>Für eine schnelle Lösung</strong>
          <p>
            Nennen Sie im Betreff das Ziel, beschreiben Sie den Fehler und seit
            wann er auftritt. Ergänzen Sie bereits versuchte Schritte sowie
            Meldungen oder Auswirkungen – aber keine Passwörter, Schlüssel oder
            andere Geheimnisse.
          </p>
        </div>
      </aside>

      {catalog.status === "loading" ? (
        <p className="self-service-catalog__state" role="status">
          Servicekatalog wird geladen …
        </p>
      ) : null}

      {catalog.status === "unavailable" ? (
        <p className="self-service-catalog__state" role="status">
          {catalog.message}
        </p>
      ) : null}

      {catalog.status === "ready" ? (
        <>
          <label className="self-service-catalog__search">
            <Search aria-hidden="true" size={17} strokeWidth={1.8} />
            <span className="self-service-catalog__visually-hidden">
              Servicekatalog durchsuchen
            </span>
            <input
              aria-controls="self-service-catalog-results"
              disabled={disabled}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Services durchsuchen"
              type="search"
              value={query}
            />
          </label>
          {catalog.services.length === 0 ? (
            <p className="self-service-catalog__state">
              Für diesen Mandanten sind keine aktiven Services hinterlegt. Sie
              können die Erfassung ohne Auswahl fortsetzen.
            </p>
          ) : filteredServices.length === 0 ? (
            <p className="self-service-catalog__state" role="status">
              Keine Services entsprechen Ihrer Suche.
            </p>
          ) : (
            <ul
              aria-label="Verfügbare Services"
              className="self-service-catalog__results"
              id="self-service-catalog-results"
            >
              {filteredServices.map((service) => {
                const selected = selectedServiceId === service.id;
                return (
                  <li key={service.id}>
                    <button
                      aria-pressed={selected}
                      className={
                        selected
                          ? "self-service-catalog__card self-service-catalog__card--selected"
                          : "self-service-catalog__card"
                      }
                      disabled={disabled}
                      onClick={() => onSelect(service)}
                      type="button"
                    >
                      <span className="self-service-catalog__card-heading">
                        <strong>{service.name}</strong>
                        {selected ? (
                          <span className="self-service-catalog__selected">
                            <Check
                              aria-hidden="true"
                              size={15}
                              strokeWidth={2}
                            />
                            Ausgewählt
                          </span>
                        ) : null}
                      </span>
                      {service.description ? (
                        <span>{service.description}</span>
                      ) : null}
                      <small>{criticalityLabel(service.criticality)}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
