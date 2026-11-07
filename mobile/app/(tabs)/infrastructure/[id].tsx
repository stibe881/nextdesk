import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import {
  MobileFeatureLoadingScreen,
  MobileFeatureUnavailableScreen,
  useMobileFeatures,
} from "@/components/mobile-feature-gate";
import { useMobileNetworkStatus } from "@/components/offline-status";
import {
  INFRA_LIFECYCLE,
  MAINTENANCE_KINDS,
  addInfrastructureMaintenance,
  categoryIcons,
  categoryLabels,
  criticalityLabels,
  dueItems,
  formatDay,
  getInfrastructureDetail,
  lifecycleLabels,
  listInfrastructure,
  maintenanceLabels,
  setInfrastructureLifecycle,
  todayIso,
  type InfraDetail,
  type InfraDevice,
  type InfraLifecycle,
  type MaintenanceKind,
} from "@/lib/infrastructure";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";

type Sheet = "lifecycle" | "maintenance" | null;

function label(value: string | null | undefined, fallback = "–"): string {
  return value && value.trim() ? value : fallback;
}

function lifecycleName(value: string | null): string {
  if (!value) return "–";
  return lifecycleLabels[value as InfraLifecycle] ?? value;
}

function formatMoment(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function InfrastructureDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const styles = useStyles();
  const colors = useAppColors();
  const checkingSession = useMobileSessionGuard();
  const { isEnabled, loading: checkingFeatures } = useMobileFeatures();
  const enabled = isEnabled("assets.management");
  const { recoveryEpoch } = useMobileNetworkStatus();
  const [device, setDevice] = useState<InfraDevice | null>(null);
  const [detail, setDetail] = useState<InfraDetail | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [saving, setSaving] = useState(false);
  const [nextState, setNextState] = useState<InfraLifecycle>("active");
  const [reason, setReason] = useState("");
  const [maintenanceKind, setMaintenanceKind] =
    useState<MaintenanceKind>("maintenance");
  const [maintenanceDate, setMaintenanceDate] = useState(todayIso());
  const [maintenanceNote, setMaintenanceNote] = useState("");

  const load = useCallback(
    async (pull = false) => {
      if (!id) return;
      setError("");
      if (pull) setRefreshing(true);
      try {
        const tenant = await loadCurrentTenant();
        setTenantId(tenant.id);
        const [list, nextDetail] = await Promise.all([
          listInfrastructure(tenant.id),
          getInfrastructureDetail(tenant.id, id),
        ]);
        const found = list.devices.find((entry) => entry.id === id) ?? null;
        if (!found) throw new Error("Das Gerät wurde nicht gefunden.");
        setDevice(found);
        setDetail(nextDetail);
        setCanManage(list.canManage);
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Das Gerät konnte nicht geladen werden.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [id],
  );

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      if (!checkingSession && !checkingFeatures && enabled) void load();
    }, [checkingFeatures, checkingSession, enabled, load, recoveryEpoch]),
  );

  async function submitLifecycle() {
    if (!device || saving) return;
    setSaving(true);
    try {
      await setInfrastructureLifecycle(
        tenantId,
        device.id,
        nextState,
        reason.trim(),
      );
      setSheet(null);
      setReason("");
      await load();
    } catch (nextError) {
      Alert.alert(
        "Status nicht geändert",
        nextError instanceof Error
          ? nextError.message
          : "Bitte versuche es erneut.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function submitMaintenance() {
    if (!device || saving) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(maintenanceDate)) {
      Alert.alert("Datum prüfen", "Bitte gib das Datum als JJJJ-MM-TT ein.");
      return;
    }
    if (!maintenanceNote.trim()) {
      Alert.alert("Notiz fehlt", "Beschreibe kurz, was gemacht wurde.");
      return;
    }
    setSaving(true);
    try {
      await addInfrastructureMaintenance(
        tenantId,
        device.id,
        maintenanceDate,
        maintenanceKind,
        maintenanceNote.trim(),
      );
      setSheet(null);
      setMaintenanceNote("");
      await load();
    } catch (nextError) {
      Alert.alert(
        "Wartung nicht gespeichert",
        nextError instanceof Error
          ? nextError.message
          : "Bitte versuche es erneut.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (checkingSession || checkingFeatures) {
    return <MobileFeatureLoadingScreen />;
  }
  if (!enabled) {
    return (
      <MobileFeatureUnavailableScreen
        feature="assets.management"
        title="Infrastruktur"
      />
    );
  }
  if (loading) {
    return (
      <ScreenContainer className="px-5">
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </ScreenContainer>
    );
  }

  const header = (
    <Pressable
      accessibilityLabel="Zurück zur Infrastruktur"
      accessibilityRole="button"
      hitSlop={10}
      onPress={() =>
        router.canGoBack()
          ? router.back()
          : router.replace("/infrastructure" as never)
      }
      style={styles.back}
    >
      <Ionicons color={colors.primaryText} name="chevron-back" size={20} />
      <Text style={styles.backText}>Infrastruktur</Text>
    </Pressable>
  );

  if (!device || !detail) {
    return (
      <ScreenContainer className="px-5">
        <View style={styles.content}>
          {header}
          <View style={styles.errorCard}>
            <Ionicons
              color={colors.error}
              name="alert-circle-outline"
              size={19}
            />
            <Text style={styles.errorText}>
              {error || "Das Gerät konnte nicht geladen werden."}
            </Text>
          </View>
        </View>
      </ScreenContainer>
    );
  }

  const due = dueItems(device);
  const currentIndex = INFRA_LIFECYCLE.indexOf(device.lifecycleState);
  const facts: [string, string][] = [
    ["Kategorie", categoryLabels[device.category]],
    [
      "Kritikalität",
      criticalityLabels[device.criticality] ?? device.criticality,
    ],
    [
      "Hersteller / Modell",
      label([device.manufacturer, device.model].filter(Boolean).join(" ")),
    ],
    ["Seriennummer", label(device.serialNumber)],
    ["Inventarnummer", label(device.inventoryNumber ?? device.assetTag)],
    ["Standort", label(device.locationName)],
    [
      "Rack",
      device.rack
        ? `${device.rack}${device.rackUnit ? ` / HE ${device.rackUnit}` : ""}`
        : "–",
    ],
  ];
  const network: [string, string][] = [
    ["Hostname", label(device.hostname)],
    ["IP-Adresse", label(device.ipAddress)],
    ["MAC-Adresse", label(device.macAddress)],
    ["Firmware", label(device.firmwareVersion)],
    [
      "Uplink",
      device.uplinkName
        ? `${device.uplinkName}${device.uplinkPort ? ` · Port ${device.uplinkPort}` : ""}`
        : "–",
    ],
  ];
  const lifecycleDates: [string, string][] = [
    ["Kaufdatum", formatDay(device.purchaseDate)],
    [
      "Kaufpreis",
      device.purchasePrice !== null
        ? `CHF ${device.purchasePrice.toFixed(2)}`
        : "–",
    ],
    ["Lieferant", label(device.supplier)],
    ["Garantie bis", formatDay(device.warrantyUntil)],
    ["Support bis", formatDay(device.supportUntil)],
    ["End of Life", formatDay(device.endOfLife)],
    ["Ersatz geplant", formatDay(device.plannedReplacement)],
    [
      "Wartungsintervall",
      device.maintenanceIntervalMonths
        ? `alle ${device.maintenanceIntervalMonths} Monate`
        : "–",
    ],
    ["Letzte Wartung", formatDay(device.lastMaintenanceOn)],
  ];

  const renderFacts = (rows: [string, string][]) =>
    rows.map(([key, value]) => (
      <View key={key} style={styles.factRow}>
        <Text style={styles.factKey}>{key}</Text>
        <Text selectable style={styles.factValue}>
          {value}
        </Text>
      </View>
    ));

  return (
    <ScreenContainer className="px-5">
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            onRefresh={() => void load(true)}
            refreshing={refreshing}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {header}
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons
              color={colors.primaryText}
              name={categoryIcons[device.category] as never}
              size={28}
            />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>
              {categoryLabels[device.category].toUpperCase()}
            </Text>
            <Text style={styles.title}>{device.name}</Text>
            <Text style={styles.subtitle}>
              {lifecycleName(device.lifecycleState)}
            </Text>
          </View>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Ionicons
              color={colors.error}
              name="alert-circle-outline"
              size={19}
            />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {due.length > 0 ? (
          <View style={styles.dueCard}>
            <Ionicons color={colors.warning} name="alarm-outline" size={20} />
            <View style={styles.dueCopy}>
              {due.map((item) => (
                <Text key={item.reason} style={styles.dueText}>
                  {item.label} {item.overdue ? "überfällig seit" : "fällig am"}{" "}
                  {formatDay(item.dueOn)}
                </Text>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.stepper}>
          {INFRA_LIFECYCLE.map((state, index) => (
            <View key={state} style={styles.step}>
              <View
                style={[
                  styles.stepDot,
                  index <= currentIndex ? styles.stepDotDone : null,
                  index === currentIndex ? styles.stepDotCurrent : null,
                ]}
              />
              <Text
                numberOfLines={2}
                style={[
                  styles.stepLabel,
                  index === currentIndex ? styles.stepLabelCurrent : null,
                ]}
              >
                {lifecycleLabels[state]}
              </Text>
            </View>
          ))}
        </View>

        {canManage ? (
          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setNextState(device.lifecycleState);
                setSheet("lifecycle");
              }}
              style={[styles.actionButton, styles.actionPrimary]}
            >
              <Ionicons
                color={colors.onPrimary}
                name="sync-outline"
                size={18}
              />
              <Text style={[styles.actionText, styles.actionTextPrimary]}>
                Status ändern
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMaintenanceDate(todayIso());
                setSheet("maintenance");
              }}
              style={styles.actionButton}
            >
              <Ionicons
                color={colors.primaryText}
                name="construct-outline"
                size={18}
              />
              <Text style={styles.actionText}>Wartung erfassen</Text>
            </Pressable>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({
              pathname: "/ticket/new",
              params: {
                subject: `${device.name}: `,
                description: [
                  `Gerät: ${device.name} (${categoryLabels[device.category]})`,
                  device.hostname ? `Hostname: ${device.hostname}` : null,
                  device.ipAddress ? `IP-Adresse: ${device.ipAddress}` : null,
                  device.serialNumber
                    ? `Seriennummer: ${device.serialNumber}`
                    : null,
                  device.locationName
                    ? `Standort: ${device.locationName}`
                    : null,
                  "",
                  "Problem:",
                ]
                  .filter((line) => line !== null)
                  .join("\n"),
              },
            })
          }
          style={styles.actionButton}
        >
          <Ionicons
            color={colors.primaryText}
            name="add-circle-outline"
            size={18}
          />
          <Text style={styles.actionText}>Ticket zu diesem Gerät</Text>
        </Pressable>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Übersicht</Text>
          {renderFacts(facts)}
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Netzwerk</Text>
          {renderFacts(network)}
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Beschaffung & Fristen</Text>
          {renderFacts(lifecycleDates)}
        </View>
        {device.notes ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notizen</Text>
            <Text selectable style={styles.noteText}>
              {device.notes}
            </Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Wartung</Text>
          {detail.maintenance.length === 0 ? (
            <Text style={styles.emptyText}>Noch keine Wartung erfasst.</Text>
          ) : (
            detail.maintenance.map((entry) => (
              <View key={entry.id} style={styles.timelineRow}>
                <Text style={styles.timelineMeta}>
                  {formatDay(entry.performedOn)} ·{" "}
                  {maintenanceLabels[entry.kind as MaintenanceKind] ??
                    entry.kind}
                  {entry.actorName ? ` · ${entry.actorName}` : ""}
                </Text>
                <Text style={styles.timelineText}>{entry.note}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Lebenszyklus</Text>
          {detail.lifecycle.length === 0 ? (
            <Text style={styles.emptyText}>Noch keine Statuswechsel.</Text>
          ) : (
            detail.lifecycle.map((entry) => (
              <View key={entry.id} style={styles.timelineRow}>
                <Text style={styles.timelineMeta}>
                  {formatMoment(entry.at)}
                  {entry.actorName ? ` · ${entry.actorName}` : ""}
                </Text>
                <Text style={styles.timelineText}>
                  {entry.from
                    ? `${lifecycleName(entry.from)} → ${lifecycleName(entry.to)}`
                    : lifecycleName(entry.to)}
                </Text>
                {entry.reason ? (
                  <Text style={styles.timelineReason}>{entry.reason}</Text>
                ) : null}
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Angeschlossene Geräte</Text>
          {detail.connected.length === 0 ? (
            <Text style={styles.emptyText}>Keine Geräte an diesem Uplink.</Text>
          ) : (
            detail.connected.map((entry) => (
              <Pressable
                accessibilityRole="button"
                key={entry.id}
                onPress={() =>
                  router.push(`/infrastructure/${entry.id}` as never)
                }
                style={styles.linkRow}
              >
                <Text numberOfLines={1} style={styles.linkText}>
                  {entry.name}
                </Text>
                <Text style={styles.linkMeta}>
                  {entry.port
                    ? `Port ${entry.port}`
                    : lifecycleName(entry.lifecycleState)}
                </Text>
                <Ionicons
                  color={colors.subtle}
                  name="chevron-forward"
                  size={16}
                />
              </Pressable>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tickets</Text>
          {detail.tickets.length === 0 ? (
            <Text style={styles.emptyText}>Keine verknüpften Tickets.</Text>
          ) : (
            detail.tickets.map((ticket) => (
              <Pressable
                accessibilityRole="button"
                key={ticket.id}
                onPress={() =>
                  router.push({
                    pathname: "/ticket/[id]",
                    params: { id: ticket.id },
                  })
                }
                style={styles.linkRow}
              >
                <Text numberOfLines={1} style={styles.linkText}>
                  {ticket.ticketNumber ? `#${ticket.ticketNumber} ` : ""}
                  {ticket.subject}
                </Text>
                <Text
                  style={[
                    styles.linkMeta,
                    ticket.open ? styles.linkOpen : null,
                  ]}
                >
                  {ticket.open ? "offen" : "erledigt"}
                </Text>
                <Ionicons
                  color={colors.subtle}
                  name="chevron-forward"
                  size={16}
                />
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>

      <Modal
        animationType="slide"
        onRequestClose={() => setSheet(null)}
        presentationStyle="pageSheet"
        visible={sheet !== null}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.sheet}
        >
          <View style={styles.sheetHeader}>
            <Text style={styles.eyebrow}>
              {sheet === "lifecycle" ? "LEBENSZYKLUS" : "WARTUNG"}
            </Text>
            <Pressable
              accessibilityLabel="Schliessen"
              accessibilityRole="button"
              hitSlop={12}
              onPress={() => setSheet(null)}
            >
              <Ionicons color={colors.text} name="close" size={26} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.sheetTitle}>{device.name}</Text>
            {sheet === "lifecycle" ? (
              <>
                <View style={styles.optionGrid}>
                  {INFRA_LIFECYCLE.map((state) => (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ selected: nextState === state }}
                      key={state}
                      onPress={() => setNextState(state)}
                      style={[
                        styles.option,
                        nextState === state ? styles.optionActive : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.optionText,
                          nextState === state ? styles.optionTextActive : null,
                        ]}
                      >
                        {lifecycleLabels[state]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  multiline
                  onChangeText={setReason}
                  placeholder="Grund (optional)"
                  placeholderTextColor={colors.subtle}
                  style={[styles.input, styles.inputMultiline]}
                  value={reason}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={saving || nextState === device.lifecycleState}
                  onPress={() => void submitLifecycle()}
                  style={[
                    styles.submit,
                    saving || nextState === device.lifecycleState
                      ? styles.submitDisabled
                      : null,
                  ]}
                >
                  {saving ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <Text style={styles.submitText}>Status speichern</Text>
                  )}
                </Pressable>
              </>
            ) : (
              <>
                <View style={styles.optionGrid}>
                  {MAINTENANCE_KINDS.map((kind) => (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{
                        selected: maintenanceKind === kind,
                      }}
                      key={kind}
                      onPress={() => setMaintenanceKind(kind)}
                      style={[
                        styles.option,
                        maintenanceKind === kind ? styles.optionActive : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.optionText,
                          maintenanceKind === kind
                            ? styles.optionTextActive
                            : null,
                        ]}
                      >
                        {maintenanceLabels[kind]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.inputLabel}>Datum (JJJJ-MM-TT)</Text>
                <TextInput
                  autoCapitalize="none"
                  keyboardType="numbers-and-punctuation"
                  onChangeText={setMaintenanceDate}
                  placeholder="2026-11-07"
                  placeholderTextColor={colors.subtle}
                  style={styles.input}
                  value={maintenanceDate}
                />
                <Text style={styles.inputLabel}>Was wurde gemacht?</Text>
                <TextInput
                  multiline
                  onChangeText={setMaintenanceNote}
                  placeholder="z. B. Firmware auf 7.2.1 aktualisiert"
                  placeholderTextColor={colors.subtle}
                  style={[styles.input, styles.inputMultiline]}
                  value={maintenanceNote}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => void submitMaintenance()}
                  style={[styles.submit, saving ? styles.submitDisabled : null]}
                >
                  {saving ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <Text style={styles.submitText}>Wartung speichern</Text>
                  )}
                </Pressable>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenContainer>
  );
}

const useStyles = makeThemedStyles((c) => ({
  actionButton: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 14,
    flex: 1,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  actionPrimary: { backgroundColor: c.primary },
  actionRow: { flexDirection: "row", gap: 10 },
  actionText: { color: c.primaryText, fontSize: 13, fontWeight: "800" },
  actionTextPrimary: { color: c.onPrimary },
  back: { alignItems: "center", flexDirection: "row", gap: 2 },
  backText: { color: c.primaryText, fontSize: 14, fontWeight: "700" },
  centered: { alignItems: "center", flex: 1, justifyContent: "center" },
  content: { gap: 16, paddingBottom: 40, paddingTop: 14 },
  dueCard: {
    alignItems: "flex-start",
    backgroundColor: c.warningSoft,
    borderColor: c.warningBorder,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 13,
  },
  dueCopy: { flex: 1, gap: 3 },
  dueText: { color: c.warning, fontSize: 13, fontWeight: "700" },
  emptyText: { color: c.muted, fontSize: 13 },
  errorCard: {
    alignItems: "flex-start",
    backgroundColor: c.errorSoft,
    borderRadius: 16,
    flexDirection: "row",
    gap: 9,
    padding: 13,
  },
  errorText: { color: c.error, flex: 1, fontSize: 12, lineHeight: 18 },
  eyebrow: {
    color: c.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  factKey: { color: c.muted, flex: 1, fontSize: 13 },
  factRow: {
    borderTopColor: c.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingVertical: 8,
  },
  factValue: {
    color: c.foreground,
    flex: 1.4,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "right",
  },
  hero: { alignItems: "center", flexDirection: "row", gap: 14 },
  heroCopy: { flex: 1 },
  heroIcon: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 18,
    height: 58,
    justifyContent: "center",
    width: 58,
  },
  input: {
    backgroundColor: c.surface,
    borderColor: c.borderStrong,
    borderRadius: 14,
    borderWidth: 1,
    color: c.text,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputLabel: { color: c.muted, fontSize: 12, fontWeight: "700" },
  inputMultiline: { minHeight: 90, textAlignVertical: "top" },
  linkMeta: { color: c.muted, fontSize: 12 },
  linkOpen: { color: c.warning, fontWeight: "700" },
  linkRow: {
    alignItems: "center",
    borderTopColor: c.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingVertical: 10,
  },
  linkText: { color: c.foreground, flex: 1, fontSize: 13, fontWeight: "600" },
  noteText: { color: c.text, fontSize: 13, lineHeight: 19 },
  option: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  optionActive: { backgroundColor: c.primary, borderColor: c.primary },
  optionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optionText: { color: c.text, fontSize: 13, fontWeight: "700" },
  optionTextActive: { color: c.onPrimary },
  section: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  sectionTitle: {
    color: c.foreground,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 4,
  },
  sheet: { backgroundColor: c.background, flex: 1 },
  sheetContent: { gap: 14, paddingBottom: 40, paddingHorizontal: 20 },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  sheetTitle: { color: c.foreground, fontSize: 22, fontWeight: "900" },
  step: { alignItems: "center", flex: 1, gap: 5 },
  stepDot: {
    backgroundColor: c.border,
    borderRadius: 999,
    height: 12,
    width: 12,
  },
  stepDotCurrent: {
    borderColor: c.primarySoft,
    borderWidth: 3,
    height: 18,
    width: 18,
  },
  stepDotDone: { backgroundColor: c.primary },
  stepLabel: {
    color: c.muted,
    fontSize: 9,
    fontWeight: "700",
    textAlign: "center",
  },
  stepLabelCurrent: { color: c.foreground },
  stepper: {
    alignItems: "flex-start",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    paddingHorizontal: 6,
    paddingVertical: 12,
  },
  submit: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: c.onPrimary, fontSize: 15, fontWeight: "800" },
  subtitle: { color: c.muted, fontSize: 13, marginTop: 2 },
  timelineMeta: { color: c.muted, fontSize: 11, fontWeight: "700" },
  timelineReason: { color: c.muted, fontSize: 12, fontStyle: "italic" },
  timelineRow: {
    borderTopColor: c.border,
    borderTopWidth: 1,
    gap: 2,
    paddingVertical: 8,
  },
  timelineText: { color: c.foreground, fontSize: 13 },
  title: {
    color: c.foreground,
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: -0.6,
    marginTop: 2,
  },
}));
