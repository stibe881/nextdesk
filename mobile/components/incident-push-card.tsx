import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { tn } from "@/lib/formality";
import {
  getIncidentPushSettings,
  saveIncidentPushSettings,
  toggleIncidentService,
  type IncidentPushSettings,
} from "@/lib/nextdesk-portal";
import { useAppColors } from "@/lib/themed-styles";

/**
 * Benachrichtigungen → «Störungen»: Push, sobald eine Störung gemeldet wird
 * (dann, wenn auch der Banner erscheint), wahlweise nur für einzelne Dienste.
 * Ohne Anfragendenportal oder auf älteren Servern bleibt die Karte verborgen.
 */
export function IncidentPushCard() {
  const colors = useAppColors();
  const [settings, setSettings] = useState<IncidentPushSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void getIncidentPushSettings()
        .then((loaded) => {
          if (
            mounted &&
            loaded &&
            typeof loaded.enabled === "boolean" &&
            Array.isArray(loaded.services)
          ) {
            setSettings(loaded);
          }
        })
        .catch(() => undefined);
      return () => {
        mounted = false;
      };
    }, []),
  );

  if (!settings) return null;

  async function save(
    next: Pick<IncidentPushSettings, "enabled" | "serviceIds">,
  ) {
    if (saving || !settings) return;
    const previous = settings;
    setSaving(true);
    setFailed(false);
    setSettings({ ...settings, ...next });
    try {
      setSettings(await saveIncidentPushSettings(next));
    } catch {
      setSettings(previous);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  const chosen = new Set(
    settings.serviceIds ?? settings.services.map((service) => service.id),
  );

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={styles.heading}>
        <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
          <Ionicons
            color={colors.primaryText}
            name="warning-outline"
            size={20}
          />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Störungen
          </Text>
          <Text style={[styles.hint, { color: colors.muted }]}>
            {tn(
              "Du erhältst eine Push-Mitteilung, sobald eine Störung gemeldet wird.",
              "Sie erhalten eine Push-Mitteilung, sobald eine Störung gemeldet wird.",
            )}
          </Text>
        </View>
        <Switch
          accessibilityLabel="Störungen per Push"
          accessibilityRole="switch"
          accessibilityState={{ checked: settings.enabled, disabled: saving }}
          disabled={saving}
          onValueChange={(enabled) =>
            void save({ enabled, serviceIds: settings.serviceIds })
          }
          thumbColor={settings.enabled ? colors.onPrimary : colors.surface}
          trackColor={{ false: colors.border, true: colors.primary }}
          value={settings.enabled}
        />
      </View>
      {settings.enabled && settings.services.length > 0 ? (
        <View style={styles.services}>
          <View style={styles.servicesHead}>
            <Text style={[styles.servicesTitle, { color: colors.foreground }]}>
              {settings.serviceIds === null
                ? "Dienste · alle"
                : `Dienste · ${chosen.size} von ${settings.services.length}`}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={saving || settings.serviceIds === null}
              onPress={() => void save({ enabled: true, serviceIds: null })}
            >
              <Text
                style={[
                  styles.action,
                  {
                    color:
                      settings.serviceIds === null
                        ? colors.muted
                        : colors.primaryText,
                  },
                ]}
              >
                Alle
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={saving || chosen.size === 0}
              onPress={() => void save({ enabled: true, serviceIds: [] })}
            >
              <Text
                style={[
                  styles.action,
                  {
                    color:
                      chosen.size === 0 ? colors.muted : colors.primaryText,
                  },
                ]}
              >
                Keine
              </Text>
            </Pressable>
          </View>
          {settings.services.map((service) => {
            const checked = chosen.has(service.id);
            return (
              <Pressable
                accessibilityLabel={service.name}
                accessibilityRole="checkbox"
                accessibilityState={{ checked, disabled: saving }}
                disabled={saving}
                key={service.id}
                onPress={() =>
                  void save({
                    enabled: true,
                    serviceIds: toggleIncidentService(settings, service.id),
                  })
                }
                style={[styles.row, { borderTopColor: colors.border }]}
              >
                <Ionicons
                  color={checked ? colors.primaryText : colors.muted}
                  name={checked ? "checkbox" : "square-outline"}
                  size={22}
                />
                <Text style={[styles.rowText, { color: colors.foreground }]}>
                  {service.name}
                </Text>
              </Pressable>
            );
          })}
          <Text style={[styles.hint, { color: colors.muted }]}>
            Störungen ohne zugeordneten Dienst werden immer gemeldet.
          </Text>
        </View>
      ) : null}
      {failed ? (
        <Text style={[styles.hint, { color: colors.error }]}>
          Die Einstellung konnte nicht gespeichert werden.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: { fontSize: 13, fontWeight: "800", paddingHorizontal: 6 },
  card: { borderRadius: 21, borderWidth: 1, gap: 12, padding: 17 },
  copy: { flex: 1, gap: 2 },
  heading: { alignItems: "center", flexDirection: "row", gap: 10 },
  hint: { fontSize: 12, lineHeight: 18 },
  icon: {
    alignItems: "center",
    borderRadius: 11,
    height: 37,
    justifyContent: "center",
    width: 37,
  },
  row: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    minHeight: 44,
    paddingVertical: 8,
  },
  rowText: { flex: 1, fontSize: 14 },
  services: { gap: 4 },
  servicesHead: { alignItems: "center", flexDirection: "row", gap: 6 },
  servicesTitle: { flex: 1, fontSize: 13, fontWeight: "800" },
  title: { fontSize: 16, fontWeight: "900" },
});
