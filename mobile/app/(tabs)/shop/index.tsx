import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  MobileFeatureLoadingScreen,
  MobileFeatureUnavailableScreen,
  useMobileFeatures,
} from "@/components/mobile-feature-gate";
import { ScreenContainer } from "@/components/screen-container";
import { useShopStyles } from "@/components/shop-styles";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import {
  ORDER_STATUS_LABEL,
  STOCK_LABEL,
  formatDate,
  shopApi,
  shopCart,
  useShopCart,
  type CatalogItem,
  type OrderSummary,
  type ShopContext,
} from "@/lib/shop";
import { useAppColors } from "@/lib/themed-styles";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";

type ShopView = "catalog" | "mine" | "approvals" | "work";

export default function ShopScreen() {
  const router = useRouter();
  const styles = useShopStyles();
  const colors = useAppColors();
  const checkingSession = useMobileSessionGuard();
  const { isEnabled, loading: checkingFeatures } = useMobileFeatures();
  const shopEnabled = isEnabled("self_service.shop");
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [context, setContext] = useState<ShopContext | null>(null);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [view, setView] = useState<ShopView>("catalog");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const cart = useShopCart(tenantId);
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  const load = useCallback(
    async (pull = false, nextView: ShopView = view) => {
      setError("");
      if (pull) setRefreshing(true);
      else setLoading(true);
      try {
        const tenant = await loadCurrentTenant();
        setTenantId(tenant.id);
        const [nextContext, nextItems, nextOrders] = await Promise.all([
          shopApi.context(tenant.id),
          nextView === "catalog"
            ? shopApi.catalog(tenant.id)
            : Promise.resolve(null),
          nextView === "catalog"
            ? Promise.resolve(null)
            : shopApi.orders(
                tenant.id,
                nextView === "mine"
                  ? "mine"
                  : nextView === "approvals"
                    ? "approvals"
                    : "all",
                nextView === "work" ? "open" : undefined,
              ),
        ]);
        setContext(nextContext);
        if (nextItems) setItems(nextItems);
        if (nextOrders) setOrders(nextOrders);
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Der Shop konnte nicht geladen werden.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [view],
  );

  useFocusEffect(
    useCallback(() => {
      if (!checkingSession && !checkingFeatures && shopEnabled) void load();
    }, [checkingFeatures, checkingSession, load, shopEnabled]),
  );

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("de-CH");
    return items.filter(
      (item) =>
        !needle ||
        `${item.name} ${item.category} ${item.description ?? ""}`
          .toLocaleLowerCase("de-CH")
          .includes(needle),
    );
  }, [items, query]);

  if (checkingSession || checkingFeatures)
    return <MobileFeatureLoadingScreen />;
  if (!shopEnabled) {
    return (
      <MobileFeatureUnavailableScreen
        feature="self_service.shop"
        title="Shop"
      />
    );
  }

  const segments: { key: ShopView; label: string; count?: number }[] = [
    { key: "catalog", label: "Katalog" },
    { key: "mine", label: "Meine Bestellungen" },
    ...(context && (context.pendingApprovals > 0 || context.canFulfill)
      ? [
          {
            key: "approvals" as ShopView,
            label: "Freigaben",
            count: context.pendingApprovals,
          },
        ]
      : []),
    ...(context?.canFulfill
      ? [
          {
            key: "work" as ShopView,
            label: "Bearbeiten",
            count: context.openOrders,
          },
        ]
      : []),
  ];

  const openOrder = (orderId: string) =>
    router.push({
      pathname: "/shop/order/[id]",
      params: { id: orderId },
    } as never);

  return (
    <ScreenContainer className="px-5">
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            onRefresh={() => void load(true)}
            refreshing={refreshing}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.eyebrow}>SELBSTBEDIENUNG</Text>
          <Text style={styles.title}>Shop</Text>
          <Text style={styles.subtitle}>
            Zubehör bestellen oder Geräte ausleihen – ohne Ticket.
            {context?.managerName
              ? ` Freigaben gehen an ${context.managerName}.`
              : ""}
          </Text>
        </View>

        <View style={styles.segments}>
          {segments.map((segment) => {
            const active = segment.key === view;
            return (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                key={segment.key}
                onPress={() => {
                  setView(segment.key);
                  void load(false, segment.key);
                }}
                style={[styles.segment, active && styles.segmentActive]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    active && styles.segmentTextActive,
                  ]}
                >
                  {segment.label}
                  {segment.count ? ` (${segment.count})` : ""}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? <ActivityIndicator color={colors.primary} /> : null}

        {view === "catalog" ? (
          <>
            <TextInput
              accessibilityLabel="Artikel suchen"
              onChangeText={setQuery}
              placeholder="Artikel suchen, z. B. Ladekabel"
              placeholderTextColor={colors.subtle}
              style={styles.search}
              value={query}
            />
            {!loading && visibleItems.length === 0 ? (
              <Text style={styles.empty}>
                {items.length === 0
                  ? "Im Shop sind noch keine Artikel verfügbar."
                  : "Keine Artikel gefunden."}
              </Text>
            ) : null}
            {visibleItems.map((item) => (
              <View key={item.id} style={styles.card}>
                <View style={styles.cardRow}>
                  <View style={styles.image}>
                    {item.imageUrl ? (
                      <Image
                        accessibilityIgnoresInvertColors
                        resizeMode="contain"
                        source={{ uri: item.imageUrl }}
                        style={styles.imageFill}
                      />
                    ) : (
                      <Ionicons
                        color={colors.muted}
                        name="cube-outline"
                        size={28}
                      />
                    )}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.category}>{item.category}</Text>
                    <Text style={styles.cardTitle}>{item.name}</Text>
                    {item.description ? (
                      <Text numberOfLines={2} style={styles.cardMeta}>
                        {item.description}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View style={styles.badges}>
                  <Text
                    style={[
                      styles.badge,
                      item.stockLevel === "in_stock"
                        ? styles.badgeGood
                        : item.stockLevel === "low"
                          ? styles.badgeWarn
                          : item.stockLevel === "out_of_stock"
                            ? styles.badgeBad
                            : null,
                    ]}
                  >
                    {STOCK_LABEL[item.stockLevel]}
                    {item.availableQuantity !== null
                      ? ` (${item.availableQuantity})`
                      : ""}
                  </Text>
                  {item.kind === "loan" ? (
                    <Text style={[styles.badge, styles.badgeInfo]}>
                      Ausleihe
                      {item.maxLoanDays
                        ? ` · max. ${item.maxLoanDays} Tage`
                        : ""}
                    </Text>
                  ) : null}
                  {item.requiresApproval ? (
                    <Text style={[styles.badge, styles.badgeWarn]}>
                      Mit Freigabe
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={!context?.canOrder || !tenantId}
                  onPress={() => tenantId && shopCart.add(tenantId, item)}
                  style={({ pressed }) => [
                    styles.secondary,
                    pressed && styles.pressed,
                    !context?.canOrder && styles.disabled,
                  ]}
                >
                  <Text style={styles.secondaryText}>
                    {item.kind === "loan" ? "Ausleihen" : "In den Warenkorb"}
                  </Text>
                </Pressable>
              </View>
            ))}
          </>
        ) : (
          <>
            {!loading && orders.length === 0 ? (
              <Text style={styles.empty}>
                {view === "approvals"
                  ? "Keine Bestellungen warten auf deine Freigabe."
                  : "Keine Bestellungen."}
              </Text>
            ) : null}
            {orders.map((order) => (
              <Pressable
                accessibilityRole="button"
                key={order.id}
                onPress={() => openOrder(order.id)}
                style={({ pressed }) => [
                  styles.card,
                  pressed && styles.pressed,
                ]}
              >
                <View
                  style={[styles.cardRow, { justifyContent: "space-between" }]}
                >
                  <Text style={styles.cardTitle}>{order.orderNumber}</Text>
                  <Text
                    style={[
                      styles.badge,
                      order.overdue || order.status === "rejected"
                        ? styles.badgeBad
                        : order.status === "pending_approval"
                          ? styles.badgeWarn
                          : order.status === "issued" ||
                              order.status === "returned"
                            ? styles.badgeGood
                            : styles.badgeInfo,
                    ]}
                  >
                    {order.overdue
                      ? "Überfällig"
                      : ORDER_STATUS_LABEL[order.status]}
                  </Text>
                </View>
                <Text numberOfLines={2} style={styles.cardMeta}>
                  {order.itemsLabel}
                </Text>
                <Text style={styles.cardMeta}>
                  {view !== "mine" && order.requesterName
                    ? `${order.requesterName} · `
                    : ""}
                  {formatDate(order.createdAt)}
                  {order.loanUntil
                    ? ` · Rückgabe bis ${formatDate(order.loanUntil)}`
                    : ""}
                </Text>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>

      {view === "catalog" && cartCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/shop/cart" as never)}
          style={({ pressed }) => [styles.cartBar, pressed && styles.pressed]}
        >
          <Text style={styles.cartBarText}>Warenkorb ({cartCount})</Text>
          <Ionicons color={colors.onPrimary} name="arrow-forward" size={20} />
        </Pressable>
      ) : null}
    </ScreenContainer>
  );
}
