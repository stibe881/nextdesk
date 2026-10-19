import { resolveTenantFeatureStates } from "./tenant-features.ts";

type FeatureRow = {
  feature_key: string;
  enabled: boolean;
  pilot_ends_at: string | null;
};

function featureAdmin(rows: FeatureRow[] | null, error = false) {
  return {
    from(table: string) {
      if (table !== "tenant_feature_flags") {
        throw new Error(`Unexpected table: ${table}`);
      }
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        in() {
          return Promise.resolve({ data: rows, error: error ? {} : null });
        },
      };
    },
  };
}

Deno.test(
  "tenant feature states remain disabled when a flag is absent, disabled or expired",
  async () => {
    const absent = await resolveTenantFeatureStates(
      featureAdmin([]),
      "10000000-0000-4000-8000-000000000001",
      ["assets.management", "automation.sla"],
    );
    if (
      absent?.["assets.management"] !== false ||
      absent?.["automation.sla"] !== false
    ) {
      throw new Error("Missing feature flags must fail closed");
    }

    const disabled = await resolveTenantFeatureStates(
      featureAdmin([
        {
          feature_key: "assets.management",
          enabled: false,
          pilot_ends_at: null,
        },
        {
          feature_key: "automation.sla",
          enabled: true,
          pilot_ends_at: "2000-01-01T00:00:00.000Z",
        },
      ]),
      "10000000-0000-4000-8000-000000000001",
      ["assets.management", "automation.sla"],
    );
    if (
      disabled?.["assets.management"] !== false ||
      disabled?.["automation.sla"] !== false
    ) {
      throw new Error("Disabled and expired feature flags must fail closed");
    }
  },
);

Deno.test(
  "tenant feature states permit only a current enabled flag",
  async () => {
    const states = await resolveTenantFeatureStates(
      featureAdmin([
        {
          feature_key: "assets.management",
          enabled: true,
          pilot_ends_at: null,
        },
        {
          feature_key: "automation.sla",
          enabled: true,
          pilot_ends_at: "2999-01-01T00:00:00.000Z",
        },
      ]),
      "10000000-0000-4000-8000-000000000001",
      ["assets.management", "automation.sla"],
    );
    if (
      states?.["assets.management"] !== true ||
      states?.["automation.sla"] !== true
    ) {
      throw new Error("Current explicitly enabled flags must remain available");
    }

    const unavailable = await resolveTenantFeatureStates(
      featureAdmin(null, true),
      "10000000-0000-4000-8000-000000000001",
      ["assets.management"],
    );
    if (unavailable !== null) {
      throw new Error("Feature lookup failures must fail closed");
    }
  },
);
