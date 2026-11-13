import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
  loadMobileInventory,
  newInventoryRequestId,
  parseReceiptQuantity,
  postMobileInventoryReceipt,
  type MobileInventoryItem,
  type MobileInventoryOverview,
} from "@/lib/inventory";
import { useInventoryItemImages } from "@/lib/inventory-images";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";
import { tn } from "@/lib/formality";

const quantityFormat = new Intl.NumberFormat("de-CH", {
  maximumFractionDigits: 2,
});

export default function InventoryScreen() {
  const router = useRouter();
  const styles = useStyles();
  const colors = useAppColors();
  const checkingSession = useMobileSessionGuard();
  const { isEnabled, loading: checkingFeatures } = useMobileFeatures();
  const inventoryEnabled = isEnabled("inventory.management");
  const { recoveryEpoch } = useMobileNetworkStatus();
  const [overview, setOverview] = useState<MobileInventoryOverview | null>(
    null,
  );
  const [query, setQuery] = useState("");
  // «?item=…» from a scanned article label shows only this article.
  // «?location=…» from an inventory reminder (count due) shows that location.
  const { item: itemParam, location: locationParam } = useLocalSearchParams<{
    item?: string;
    location?: string;
  }>();
  const scannedItemId =
    typeof itemParam === "string" && itemParam.trim()
      ? itemParam.trim().toLowerCase()
      : "";
  const [appliedItemId, setAppliedItemId] = useState(scannedItemId);
  if (scannedItemId !== "" && scannedItemId !== appliedItemId) {
    setAppliedItemId(scannedItemId);
  }
  const requestedLocationId =
    typeof locationParam === "string" && locationParam.trim()
      ? locationParam.trim().toLowerCase()
      : "";
  const [appliedLocationId, setAppliedLocationId] =
    useState(requestedLocationId);
  if (requestedLocationId !== "" && requestedLocationId !== appliedLocationId) {
    setAppliedLocationId(requestedLocationId);
  }
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [receiptItem, setReceiptItem] = useState<MobileInventoryItem | null>(
    null,
  );
  const [receiptQuantity, setReceiptQuantity] = useState("1");
  const [receiptLocationId, setReceiptLocationId] = useState<string | null>(
    null,
  );
  const [receiptRequestId, setReceiptRequestId] = useState("");
  const [receiptSaving, setReceiptSaving] = useState(false);
  const [receiptError, setReceiptError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (pull = false) => {
    setError("");
    if (pull) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const tenant = await loadCurrentTenant();
      setTenantId(tenant.id);
      setOverview(await loadMobileInventory(tenant.id));
    } catch (nextError) {
      setOverview(null);
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Das Lager konnte nicht geladen werden.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      if (!checkingSession && !checkingFeatures && inventoryEnabled) {
        void load();
      }
    }, [
      checkingFeatures,
      checkingSession,
      inventoryEnabled,
      load,
      recoveryEpoch,
    ]),
  );

  const lowStock = useMemo(
    () => new Set(overview?.lowStockIds ?? []),
    [overview],
  );
  const appliedLocation = useMemo(
    () =>
      appliedLocationId
        ? ((overview?.locations ?? []).find(
            (location) => location.id.toLowerCase() === appliedLocationId,
          ) ?? null)
        : null,
    [overview, appliedLocationId],
  );
  const items = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("de-CH");
    return (overview?.items ?? []).filter(
      (item) =>
        (!appliedItemId || item.id.toLowerCase() === appliedItemId) &&
        (!appliedLocation || item.locationName === appliedLocation.name) &&
        (!needle ||
          `${item.name} ${item.articleNumber ?? ""} ${item.locationName ?? ""}`
            .toLocaleLowerCase("de-CH")
            .includes(needle)),
    );
  }, [overview, query, appliedItemId, appliedLocation]);

  // Pictures for all articles (not only the filtered ones), so typing in the
  // search field does not request them again.
  const images = useInventoryItemImages(tenantId, overview?.items ?? []);

  const canReceive = overview?.canMove === true;
  const locations = overview?.locations ?? [];

  const openReceipt = (item: MobileInventoryItem) => {
    setNotice("");
    setReceiptError("");
    setReceiptQuantity("1");
    // Preselect the item's single storage location; otherwise the only one.
    const matching = locations.find(
      (entry) => entry.name === item.locationName,
    );
    setReceiptLocationId(
      matching?.id ?? (locations.length === 1 ? locations[0].id : null),
    );
    setReceiptRequestId(newInventoryRequestId());
    setReceiptItem(item);
  };

  const closeReceipt = () => {
    if (receiptSaving) return;
    setReceiptItem(null);
  };

  const submitReceipt = async () => {
    if (!receiptItem || !tenantId || receiptSaving) return;
    const quantity = parseReceiptQuantity(receiptQuantity);
    if (quantity === null) {
      setReceiptError(tn("Bitte gib eine gültige Menge grösser als 0 ein.", "Bitte geben Sie eine gültige Menge grösser als 0 ein."));
      return;
    }
    if (!receiptLocationId) {
      setReceiptError(
        tn("Bitte wähle einen Lagerort.", "Bitte wählen Sie einen Lagerort."),
      );
      return;
    }
    setReceiptSaving(true);
    setReceiptError("");
    try {
      await postMobileInventoryReceipt({
        tenantId,
        itemId: receiptItem.id,
        locationId: receiptLocationId,
        quantity,
        clientRequestId: receiptRequestId,
      });
      setNotice(
        `${quantityFormat.format(quantity)} ${receiptItem.unit} «${receiptItem.name}» eingebucht.`,
      );
      setReceiptItem(null);
      void load(true);
    } catch (nextError) {
      setReceiptError(
        nextError instanceof Error
          ? nextError.message
          : "Der Wareneingang konnte nicht gebucht werden.",
      );
    } finally {
      setReceiptSaving(false);
    }
  };

  if (checkingSession || checkingFeatures) {
    return <MobileFeatureLoadingScreen />;
  }

  if (!inventoryEnabled) {
    return (
      <MobileFeatureUnavailableScreen
        feature="inventory.management"
        title="Lager"
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
        <View style={styles.headingRow}>
          <View style={styles.headingCopy}>
            <Text style={styles.eyebrow}>LAGER</Text>
            <Text style={styles.title}>Bestände</Text>
            <Text style={styles.subtitle}>
              {overview?.items.length === 1
                ? "1 Artikel"
                : `${overview?.items.length ?? 0} Artikel`}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Zum Assetscanner"
            accessibilityRole="button"
            onPress={() => router.push("/assets/scan" as never)}
            style={styles.scanButton}
          >
            <Ionicons color={colors.onPrimary} name="scan-outline" size={24} />
          </Pressable>
        </View>

        {overview ? (
          <View style={styles.summaryRow}>
            <View
              style={[
                styles.summaryCard,
                overview.criticalItemCount > 0 && styles.summaryCardAlert,
              ]}
            >
              <Text style={styles.summaryValue}>
                {overview.criticalItemCount}
              </Text>
              <Text style={styles.summaryLabel}>Unterbestand</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>
                {overview.openReservationCount}
              </Text>
              <Text style={styles.summaryLabel}>Reservationen</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>
                {overview.activeCountSessionCount}
              </Text>
              <Text style={styles.summaryLabel}>Inventuren</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.searchRow}>
          <Ionicons color={colors.subtle} name="search-outline" size={19} />
          <TextInput
            accessibilityLabel="Lager durchsuchen"
            autoCapitalize="none"
            clearButtonMode="while-editing"
            onChangeText={setQuery}
            placeholder="Artikel, Nummer oder Lagerort"
            placeholderTextColor={colors.subtle}
            style={styles.searchInput}
            value={query}
          />
        </View>

        {appliedLocation ? (
          <Text style={styles.hint}>
            Lagerort «{appliedLocation.name}».{" "}
            <Text
              accessibilityRole="button"
              onPress={() => {
                setAppliedLocationId("");
                router.setParams({ location: "" } as never);
              }}
              style={{ color: colors.primaryText, fontWeight: "700" }}
            >
              Alle Artikel anzeigen
            </Text>
          </Text>
        ) : null}

        {appliedItemId ? (
          <Text style={styles.hint}>
            Nur dieser Artikel.{" "}
            <Text
              accessibilityRole="button"
              onPress={() => {
                setAppliedItemId("");
                router.setParams({ item: "" } as never);
              }}
              style={{ color: colors.primaryText, fontWeight: "700" }}
            >
              Alle Artikel anzeigen
            </Text>
          </Text>
        ) : null}

        {canReceive ? (
          <Text style={styles.hint}>
            {tn(
              "Tippe auf einen Artikel, um einen Wareneingang einzubuchen.",
              "Tippen Sie auf einen Artikel, um einen Wareneingang einzubuchen.",
            )}
          </Text>
        ) : null}

        {notice ? (
          <View style={styles.noticeCard}>
            <Ionicons
              color={colors.primaryText}
              name="checkmark-circle-outline"
              size={19}
            />
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}

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

        <View style={styles.list}>
          {items.map((item) => (
            <Pressable
              accessibilityHint={
                canReceive
                  ? "Öffnet den Wareneingang für diesen Artikel"
                  : undefined
              }
              accessibilityRole={canReceive ? "button" : undefined}
              disabled={!canReceive}
              key={item.id}
              onPress={() => openReceipt(item)}
              style={({ pressed }) => [
                styles.itemCard,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.itemIcon}>
                {images.has(item.id) ? (
                  <Image
                    accessibilityIgnoresInvertColors
                    cachePolicy="memory"
                    contentFit="cover"
                    recyclingKey={item.id}
                    source={{ uri: images.get(item.id) }}
                    style={styles.itemImage}
                    transition={150}
                  />
                ) : (
                  <Ionicons
                    color={colors.primaryText}
                    name="cube-outline"
                    size={22}
                  />
                )}
              </View>
              <View style={styles.itemCopy}>
                <Text numberOfLines={1} style={styles.itemName}>
                  {item.name}
                </Text>
                <Text numberOfLines={1} style={styles.itemMeta}>
                  {[item.articleNumber, item.locationName]
                    .filter(Boolean)
                    .join(" · ") || "Kein Lagerort hinterlegt"}
                </Text>
                {lowStock.has(item.id) ? (
                  <Text style={styles.lowBadge}>Unter Mindestbestand</Text>
                ) : null}
              </View>
              <View style={styles.quantity}>
                <Text style={styles.quantityValue}>
                  {quantityFormat.format(item.availableQuantity)}
                </Text>
                <Text style={styles.quantityUnit}>{item.unit} verfügbar</Text>
                {item.reservedQuantity > 0 ? (
                  <Text style={styles.quantityUnit}>
                    {quantityFormat.format(item.reservedQuantity)} reserviert
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
          {!error && items.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons
                color={colors.primaryText}
                name="file-tray-outline"
                size={28}
              />
              <Text style={styles.emptyTitle}>Keine Artikel gefunden</Text>
              <Text style={styles.emptyText}>
                {tn("Passe die Suche an oder ziehe die Ansicht zum Aktualisieren nach unten.", "Passen Sie die Suche an oder ziehen Sie die Ansicht zum Aktualisieren nach unten.")}
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
      <Modal
        animationType="slide"
        onRequestClose={closeReceipt}
        presentationStyle="pageSheet"
        visible={receiptItem !== null}
      >
        {receiptItem ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.sheet}
          >
            <View style={styles.sheetHeader}>
              <Text style={styles.eyebrow}>WARENEINGANG</Text>
              <Pressable
                accessibilityLabel="Wareneingang schliessen"
                accessibilityRole="button"
                hitSlop={12}
                onPress={closeReceipt}
              >
                <Ionicons color={colors.text} name="close" size={26} />
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.sheetContent}
              keyboardShouldPersistTaps="handled"
            >
              <View>
                <Text style={styles.sheetTitle}>{receiptItem.name}</Text>
                <Text style={styles.itemMeta}>
                  {[
                    receiptItem.articleNumber,
                    `${quantityFormat.format(receiptItem.physicalQuantity)} ${receiptItem.unit} an Lager`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>

              {receiptItem.serialTracked ? (
                <View style={styles.errorCard}>
                  <Ionicons
                    color={colors.error}
                    name="information-circle-outline"
                    size={19}
                  />
                  <Text style={styles.errorText}>
                    {tn(
                      "Dieser Artikel wird mit Seriennummern geführt. Bitte buche ihn in der Webversion ein.",
                      "Dieser Artikel wird mit Seriennummern geführt. Bitte buchen Sie ihn in der Webversion ein.",
                    )}
                  </Text>
                </View>
              ) : (
                <>
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>
                      Menge ({receiptItem.unit})
                    </Text>
                    <View style={styles.quantityRow}>
                      <Pressable
                        accessibilityLabel="Menge verringern"
                        accessibilityRole="button"
                        onPress={() => {
                          const current =
                            parseReceiptQuantity(receiptQuantity) ?? 1;
                          setReceiptQuantity(String(Math.max(1, current - 1)));
                        }}
                        style={styles.stepButton}
                      >
                        <Ionicons color={colors.text} name="remove" size={22} />
                      </Pressable>
                      <TextInput
                        accessibilityLabel="Menge"
                        keyboardType="decimal-pad"
                        onChangeText={setReceiptQuantity}
                        selectTextOnFocus
                        style={styles.quantityInput}
                        value={receiptQuantity}
                      />
                      <Pressable
                        accessibilityLabel="Menge erhöhen"
                        accessibilityRole="button"
                        onPress={() => {
                          const current =
                            parseReceiptQuantity(receiptQuantity) ?? 0;
                          setReceiptQuantity(String(current + 1));
                        }}
                        style={styles.stepButton}
                      >
                        <Ionicons color={colors.text} name="add" size={22} />
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>Lagerort</Text>
                    {locations.length === 0 ? (
                      <Text style={styles.itemMeta}>
                        {tn("Es ist noch kein Lagerort erfasst. Lege ihn in der Webversion an.", "Es ist noch kein Lagerort erfasst. Legen Sie ihn in der Webversion an.")}
                      </Text>
                    ) : (
                      <View style={styles.locationList}>
                        {locations.map((location) => {
                          const selected = location.id === receiptLocationId;
                          return (
                            <Pressable
                              accessibilityRole="radio"
                              accessibilityState={{ selected }}
                              key={location.id}
                              onPress={() => setReceiptLocationId(location.id)}
                              style={[
                                styles.locationChip,
                                selected && styles.locationChipSelected,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.locationChipText,
                                  selected && styles.locationChipTextSelected,
                                ]}
                              >
                                {location.code
                                  ? `${location.name} (${location.code})`
                                  : location.name}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                  </View>

                  {receiptError ? (
                    <View style={styles.errorCard}>
                      <Ionicons
                        color={colors.error}
                        name="alert-circle-outline"
                        size={19}
                      />
                      <Text style={styles.errorText}>{receiptError}</Text>
                    </View>
                  ) : null}

                  <Pressable
                    accessibilityRole="button"
                    disabled={receiptSaving || locations.length === 0}
                    onPress={() => void submitReceipt()}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      (receiptSaving || locations.length === 0) &&
                        styles.disabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    {receiptSaving ? (
                      <ActivityIndicator color={colors.onPrimary} />
                    ) : (
                      <Text style={styles.primaryButtonText}>Einbuchen</Text>
                    )}
                  </Pressable>
                </>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        ) : null}
      </Modal>
    </ScreenContainer>
  );
}

const useStyles = makeThemedStyles((c) => ({
  centered: { alignItems: "center", flex: 1, justifyContent: "center" },
  content: { gap: 18, paddingBottom: 34, paddingTop: 18 },
  emptyCard: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 7,
    padding: 30,
  },
  emptyText: {
    color: c.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  emptyTitle: {
    color: c.foreground,
    fontSize: 15,
    fontWeight: "800",
    marginTop: 2,
  },
  errorCard: {
    alignItems: "flex-start",
    backgroundColor: c.errorSoft,
    borderRadius: 16,
    flexDirection: "row",
    gap: 9,
    padding: 13,
  },
  errorText: { color: c.error, flex: 1, fontSize: 12, lineHeight: 18 },
  disabled: { opacity: 0.5 },
  field: { gap: 8 },
  fieldLabel: { color: c.foreground, fontSize: 13, fontWeight: "800" },
  hint: { color: c.muted, fontSize: 12, marginTop: -6 },
  locationChip: {
    backgroundColor: c.surface,
    borderColor: c.borderStrong,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  locationChipSelected: { backgroundColor: c.primary, borderColor: c.primary },
  locationChipText: { color: c.text, fontSize: 13, fontWeight: "700" },
  locationChipTextSelected: { color: c.onPrimary },
  locationList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  noticeCard: {
    alignItems: "flex-start",
    backgroundColor: c.primarySoft,
    borderRadius: 16,
    flexDirection: "row",
    gap: 9,
    padding: 13,
  },
  noticeText: { color: c.primaryText, flex: 1, fontSize: 12, lineHeight: 18 },
  pressed: { opacity: 0.75 },
  primaryButton: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 16,
    justifyContent: "center",
    minHeight: 52,
    marginTop: 4,
  },
  primaryButtonText: { color: c.onPrimary, fontSize: 16, fontWeight: "800" },
  quantityInput: {
    backgroundColor: c.surface,
    borderColor: c.borderStrong,
    borderRadius: 14,
    borderWidth: 1,
    color: c.foreground,
    flex: 1,
    fontSize: 20,
    fontWeight: "800",
    paddingVertical: 10,
    textAlign: "center",
  },
  quantityRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  sheet: { backgroundColor: c.background, flex: 1 },
  sheetContent: { gap: 20, paddingBottom: 40, paddingHorizontal: 20 },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 8,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  sheetTitle: { color: c.foreground, fontSize: 24, fontWeight: "900" },
  stepButton: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.borderStrong,
    borderRadius: 14,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  eyebrow: {
    color: c.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  headingCopy: { flex: 1 },
  headingRow: { alignItems: "flex-start", flexDirection: "row", gap: 14 },
  itemCard: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 19,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  itemCopy: { flex: 1, gap: 3 },
  itemIcon: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 14,
    height: 46,
    justifyContent: "center",
    overflow: "hidden",
    width: 46,
  },
  itemImage: { height: "100%", width: "100%" },
  itemMeta: { color: c.muted, fontSize: 12 },
  itemName: { color: c.foreground, fontSize: 15, fontWeight: "800" },
  list: { gap: 10 },
  lowBadge: {
    alignSelf: "flex-start",
    backgroundColor: c.errorSoft,
    borderRadius: 8,
    color: c.error,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 4,
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  quantity: { alignItems: "flex-end", gap: 1 },
  quantityUnit: { color: c.muted, fontSize: 10 },
  quantityValue: { color: c.foreground, fontSize: 20, fontWeight: "900" },
  scanButton: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 16,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  searchInput: { color: c.text, flex: 1, fontSize: 13, paddingVertical: 8 },
  searchRow: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.borderStrong,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 12,
  },
  subtitle: { color: c.muted, fontSize: 13, marginTop: 4 },
  summaryCard: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    gap: 2,
    padding: 12,
  },
  summaryCardAlert: { backgroundColor: c.errorSoft, borderColor: c.error },
  summaryLabel: { color: c.muted, fontSize: 11, fontWeight: "700" },
  summaryRow: { flexDirection: "row", gap: 10 },
  summaryValue: { color: c.foreground, fontSize: 22, fontWeight: "900" },
  title: {
    color: c.foreground,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.8,
    marginTop: 3,
  },
}));
