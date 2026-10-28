import { assertEquals } from "jsr:@std/assert@1";
import { defaultPreferences, testPreferenceUpsertValues } from "./index.ts";

Deno.test(
  "low-stock reminders are off until a person opts in explicitly",
  () => {
    const preferences = defaultPreferences();
    assertEquals(
      preferences.enabledCategories.includes("inventory_low_stock"),
      false,
    );
    assertEquals(preferences.categoryModes.inventory_low_stock, "off");
  },
);

Deno.test(
  "sendTest creates missing preferences with the fail-closed low-stock defaults",
  () => {
    const values = testPreferenceUpsertValues(null);

    assertEquals(
      values.enabled_categories.includes("inventory_low_stock"),
      false,
    );
    assertEquals(values.category_modes?.inventory_low_stock, "off");
  },
);

Deno.test("sendTest preserves existing explicit low-stock preferences", () => {
  const existing = {
    enabled_categories: ["assigned", "inventory_low_stock"],
    quiet_hours_enabled: true,
    quiet_start: 20,
    quiet_end: 6,
    timezone: "Europe/Zurich",
    global_enabled: false,
    category_modes: {
      assigned: "summary",
      inventory_low_stock: "immediate",
    },
    summary_hour: 9,
    last_test_at: "2026-10-28T16:00:00.000Z",
  };

  assertEquals(testPreferenceUpsertValues(existing), {
    enabled_categories: existing.enabled_categories,
    quiet_hours_enabled: existing.quiet_hours_enabled,
    quiet_start: existing.quiet_start,
    quiet_end: existing.quiet_end,
    timezone: existing.timezone,
  });
});
