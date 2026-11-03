import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
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
  const [gallery, setGallery] = useState<{
    name: string;
    urls: string[];
  } | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [detail, setDetail] = useState<CatalogItem | null>(null);
  const { width: screenWidth } = useWindowDimensions();
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  const photosOf = (item: CatalogItem): string[] =>
    item.imageUrls?.length
      ? item.imageUrls
      : item.imageUrl
        ? [item.imageUrl]
        : [];

  const renderBadges = (item: CatalogItem) => (
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
        {item.availableQuantity !== null ? ` (${item.availableQuantity})` : ""}
      </Text>
      {item.kind === "loan" ? (
        <Text style={[styles.badge, styles.badgeInfo]}>
          Ausleihe
          {item.maxLoanDays ? ` · max. ${item.maxLoanDays} Tage` : ""}
        </Text>
      ) : null}
      {item.requiresApproval ? (
        <Text style={[styles.badge, styles.badgeWarn]}>Mit Freigabe</Text>
      ) : null}
    </View>
  );

  const renderAddButton = (item: CatalogItem, onAdded?: () => void) => (
    <Pressable
      accessibilityRole="button"
      disabled={!context?.canOrder || !tenantId}
      onPress={() => {
        if (!tenantId) return;
        shopCart.add(tenantId, item);
        onAdded?.();
      }}
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
  );

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
                  <Pressable
                    accessibilityLabel={`Details zu ${item.name} anzeigen`}
                    accessibilityRole="button"
                    onPress={() => setDetail(item)}
                    style={styles.image}
                  >
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
                    {(item.imageUrls?.length ?? 0) > 1 ? (
                      <View
                        style={{
                          position: "absolute",
                          right: 4,
                          bottom: 4,
                          borderRadius: 999,
                          paddingHorizontal: 6,
                          paddingVertical: 1,
                          backgroundColor: "rgba(15,23,42,0.7)",
                        }}
                      >
                        <Text
                          style={{
                            color: "#fff",
                            fontSize: 10,
                            fontWeight: "700",
                          }}
                        >
                          {item.imageUrls?.length}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>
                  <Pressable
                    accessibilityHint="Öffnet die Artikeldetails"
                    accessibilityRole="button"
                    onPress={() => setDetail(item)}
                    style={({ pressed }) => [
                      { flex: 1, gap: 2 },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.category}>{item.category}</Text>
                    <Text style={styles.cardTitle}>{item.name}</Text>
                    {item.description ? (
                      <Text numberOfLines={2} style={styles.cardMeta}>
                        {item.description}
                      </Text>
                    ) : null}
                    <Text style={[styles.cardMeta, { color: colors.primaryText }]}>
                      Details ansehen
                    </Text>
                  </Pressable>
                </View>
                {renderBadges(item)}
                {renderAddButton(item)}
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
      <Modal
        animationType="slide"
        onRequestClose={() => setDetail(null)}
        presentationStyle="pageSheet"
        visible={detail !== null}
      >
        {detail ? (
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 20,
                paddingTop: 16,
                paddingBottom: 8,
              }}
            >
              <Text style={styles.category}>{detail.category}</Text>
              <Pressable
                accessibilityLabel="Details schliessen"
                accessibilityRole="button"
                hitSlop={12}
                onPress={() => setDetail(null)}
              >
                <Ionicons color={colors.text} name="close" size={26} />
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={{
                paddingHorizontal: 20,
                paddingBottom: 40,
                gap: 14,
              }}
            >
              {photosOf(detail).length ? (
                <ScrollView
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  style={{ marginHorizontal: -20 }}
                >
                  {photosOf(detail).map((url, index) => (
                    <Pressable
                      accessibilityLabel={`${detail.name}, Foto ${index + 1} gross anzeigen`}
                      accessibilityRole="imagebutton"
                      key={url}
                      onPress={() => {
                        const urls = photosOf(detail);
                        setGalleryIndex(index);
                        setDetail(null);
                        setGallery({ name: detail.name, urls });
                      }}
                      style={{
                        width: screenWidth,
                        height: Math.min(screenWidth * 0.8, 340),
                        paddingHorizontal: 20,
                      }}
                    >
                      <Image
                        accessibilityIgnoresInvertColors
                        resizeMode="contain"
                        source={{ uri: url }}
                        style={{ flex: 1, borderRadius: 12 }}
                      />
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}
              {photosOf(detail).length > 1 ? (
                <Text style={[styles.cardMeta, { textAlign: "center" }]}>
                  {photosOf(detail).length} Fotos · zum Blättern wischen
                </Text>
              ) : null}
              <Text style={[styles.cardTitle, { fontSize: 22 }]}>
                {detail.name}
              </Text>
              {renderBadges(detail)}
              {detail.description ? (
                <Text style={[styles.cardMeta, { fontSize: 16, lineHeight: 23 }]}>
                  {detail.description}
                </Text>
              ) : (
                <Text style={styles.cardMeta}>Keine Beschreibung vorhanden.</Text>
              )}
              {detail.kind === "order" && detail.maxQuantity > 1 ? (
                <Text style={styles.cardMeta}>
                  Höchstens {detail.maxQuantity} Stück pro Bestellung.
                </Text>
              ) : null}
              {renderAddButton(detail, () => setDetail(null))}
            </ScrollView>
          </View>
        ) : null}
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={() => setGallery(null)}
        transparent
        visible={gallery !== null}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.92)",
            justifyContent: "center",
          }}
        >
          <Pressable
            accessibilityLabel="Fotos schliessen"
            accessibilityRole="button"
            onPress={() => setGallery(null)}
            style={{
              position: "absolute",
              top: 56,
              right: 20,
              zIndex: 2,
              padding: 6,
            }}
          >
            <Ionicons color="#fff" name="close" size={28} />
          </Pressable>
          {gallery ? (
            <>
              <ScrollView
                horizontal
                onMomentumScrollEnd={(event) =>
                  setGalleryIndex(
                    Math.round(event.nativeEvent.contentOffset.x / screenWidth),
                  )
                }
                pagingEnabled
                showsHorizontalScrollIndicator={false}
              >
                {gallery.urls.map((url, index) => (
                  <Image
                    accessibilityIgnoresInvertColors
                    accessibilityLabel={`${gallery.name}, Foto ${index + 1}`}
                    key={url}
                    resizeMode="contain"
                    source={{ uri: url }}
                    style={{ width: screenWidth, height: screenWidth }}
                  />
                ))}
              </ScrollView>
              {gallery.urls.length > 1 ? (
                <Text
                  style={{
                    color: "#fff",
                    textAlign: "center",
                    marginTop: 16,
                    fontWeight: "600",
                  }}
                >
                  {galleryIndex + 1} / {gallery.urls.length}
                </Text>
              ) : null}
            </>
          ) : null}
        </View>
      </Modal>
    </ScreenContainer>
  );
}
