import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useShopStyles } from "@/components/shop-styles";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import {
  EVENT_LABEL,
  ORDER_STATUS_LABEL,
  formatDate,
  shopApi,
  type OrderAction,
  type OrderDetail,
} from "@/lib/shop";
import { useAppColors } from "@/lib/themed-styles";

export default function ShopOrderScreen() {
  const router = useRouter();
  const styles = useShopStyles();
  const colors = useAppColors();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState("");
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState<OrderAction | null>(null);

  const load = useCallback(async () => {
    if (typeof id !== "string") return;
    try {
      const tenant = await loadCurrentTenant();
      setTenantId(tenant.id);
      setOrder(await shopApi.order(tenant.id, id));
      setError("");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Bestellung konnte nicht geladen werden.",
      );
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function run(action: OrderAction, extra: Record<string, unknown> = {}) {
    if (!tenantId || !order) return;
    setPending(true);
    setError("");
    try {
      await shopApi.update(tenantId, order.id, action, extra);
      setNote("");
      setReason("");
      setRejecting(null);
      await load();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Aktion ist fehlgeschlagen.",
      );
    } finally {
      setPending(false);
    }
  }

  function issue() {
    if (!order) return;
    const missingSerial = order.lines.find(
      (line) =>
        line.stock?.trackingMode === "serial" &&
        line.status !== "issued" &&
        !serials[line.id],
    );
    if (missingSerial) {
      setError(
        `Bitte für «${missingSerial.itemName}» eine Seriennummer wählen.`,
      );
      return;
    }
    Alert.alert(
      "Ausgeben?",
      "Die Artikel werden übergeben und aus dem Lager gebucht.",
      [
        { style: "cancel", text: "Abbrechen" },
        {
          text: "Ausgeben",
          onPress: () =>
            void run("issue", {
              lines: order.lines.map((line) => {
                const serialUnitId = serials[line.id];
                const location =
                  line.stock?.trackingMode === "serial"
                    ? (line.stock.locations.find(
                        (candidate) => candidate.available > 0,
                      ) ?? line.stock.locations[0])
                    : undefined;
                return {
                  lineId: line.id,
                  ...(serialUnitId ? { serialUnitId } : {}),
                  ...(location ? { locationId: location.id } : {}),
                };
              }),
            }),
        },
      ],
    );
  }

  const status = order?.status;
  const process = order?.permissions.canProcess ?? false;
  const canHandOut =
    process &&
    (status === "submitted" || status === "in_progress" || status === "ready");

  return (
    <ScreenContainer className="px-5">
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.back}
        >
          <Text style={styles.backText}>‹ Zurück</Text>
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!order ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <View style={styles.header}>
              <Text style={styles.eyebrow}>BESTELLUNG</Text>
              <Text style={styles.title}>{order.orderNumber}</Text>
              <View style={styles.badges}>
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
            </View>

            <View style={styles.card}>
              <Text style={styles.cardMeta}>
                Bestellt von {order.requesterName ?? "–"} am{" "}
                {formatDate(order.createdAt)}
              </Text>
              <Text style={styles.cardMeta}>
                {order.deliveryMethod === "desk"
                  ? `Lieferung an: ${order.deliveryLocation ?? "–"}`
                  : "Abholung beim Support"}
              </Text>
              {order.loanFrom ? (
                <Text style={styles.cardMeta}>
                  Ausleihe {formatDate(order.loanFrom)} –{" "}
                  {formatDate(order.loanUntil)}
                </Text>
              ) : null}
              {order.approverName || order.approvedByName ? (
                <Text style={styles.cardMeta}>
                  {order.approvedByName
                    ? `Freigegeben von ${order.approvedByName}`
                    : `Freigabe bei ${order.approverName}`}
                </Text>
              ) : null}
              {order.decisionReason ? (
                <Text style={styles.cardMeta}>
                  Begründung: {order.decisionReason}
                </Text>
              ) : null}
              {order.comment ? (
                <Text style={styles.cardMeta}>Bemerkung: {order.comment}</Text>
              ) : null}
            </View>

            <Text style={styles.label}>Artikel</Text>
            {order.lines.map((line) => (
              <View key={line.id} style={styles.card}>
                <Text style={styles.cardTitle}>
                  {line.quantity}× {line.itemName}
                </Text>
                <Text style={styles.cardMeta}>
                  {line.kind === "loan" ? "Ausleihe" : "Bestellung"}
                  {line.status === "reserved"
                    ? " · reserviert"
                    : line.status === "backorder"
                      ? " · nicht an Lager"
                      : line.status === "issued"
                        ? " · ausgegeben"
                        : line.status === "returned"
                          ? " · zurück"
                          : ""}
                </Text>
                {canHandOut &&
                line.stock?.trackingMode === "serial" &&
                line.status !== "issued" ? (
                  <View style={styles.segments}>
                    {line.stock.serialUnits.map((serial) => (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{
                          selected: serials[line.id] === serial.id,
                        }}
                        key={serial.id}
                        onPress={() =>
                          setSerials((current) => ({
                            ...current,
                            [line.id]: serial.id,
                          }))
                        }
                        style={[
                          styles.choice,
                          serials[line.id] === serial.id && styles.choiceActive,
                        ]}
                      >
                        <Text style={styles.choiceText}>
                          {serial.serialNumber}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            ))}

            {rejecting ? (
              <View style={{ gap: 8 }}>
                <Text style={styles.label}>Grund für die Ablehnung</Text>
                <TextInput
                  accessibilityLabel="Grund"
                  maxLength={1000}
                  multiline
                  onChangeText={setReason}
                  style={[styles.input, { minHeight: 70, paddingTop: 10 }]}
                  value={reason}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={pending || !reason.trim()}
                  onPress={() => void run(rejecting, { reason })}
                  style={[
                    styles.danger,
                    (pending || !reason.trim()) && styles.disabled,
                  ]}
                >
                  <Text style={styles.dangerText}>Ablehnen</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setRejecting(null)}
                  style={styles.back}
                >
                  <Text style={styles.backText}>Abbrechen</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {order.permissions.canApprove ? (
                  <>
                    <ActionButton
                      disabled={pending}
                      label="Freigeben"
                      onPress={() => void run("approve")}
                      primary
                    />
                    <ActionButton
                      danger
                      disabled={pending}
                      label="Ablehnen"
                      onPress={() => setRejecting("reject_approval")}
                    />
                  </>
                ) : null}
                {process && status === "submitted" ? (
                  <ActionButton
                    disabled={pending}
                    label="In Bearbeitung nehmen"
                    onPress={() => void run("accept")}
                  />
                ) : null}
                {process &&
                (status === "submitted" || status === "in_progress") ? (
                  <ActionButton
                    disabled={pending}
                    label="Bereit zur Abholung"
                    onPress={() => void run("ready")}
                  />
                ) : null}
                {canHandOut ? (
                  <ActionButton
                    disabled={pending}
                    label="Ausgeben & aus Lager buchen"
                    onPress={issue}
                    primary
                  />
                ) : null}
                {process && status === "loaned" ? (
                  <ActionButton
                    disabled={pending}
                    label="Rückgabe erfassen"
                    onPress={() => void run("return")}
                    primary
                  />
                ) : null}
                {process &&
                status &&
                ["submitted", "in_progress", "ready"].includes(status) ? (
                  <ActionButton
                    danger
                    disabled={pending}
                    label="Bestellung ablehnen"
                    onPress={() => setRejecting("reject")}
                  />
                ) : null}
                {order.permissions.canCancel &&
                order.permissions.isRequester ? (
                  <ActionButton
                    danger
                    disabled={pending}
                    label="Stornieren"
                    onPress={() =>
                      Alert.alert("Bestellung stornieren?", undefined, [
                        { style: "cancel", text: "Nein" },
                        {
                          style: "destructive",
                          text: "Stornieren",
                          onPress: () => void run("cancel"),
                        },
                      ])
                    }
                  />
                ) : null}
              </View>
            )}

            <Text style={styles.label}>Verlauf</Text>
            {order.events.map((event) => (
              <View key={event.id} style={{ gap: 2 }}>
                <Text style={styles.cardTitle}>
                  {EVENT_LABEL[event.type] ?? event.type}
                  {event.internal ? " (intern)" : ""}
                </Text>
                <Text style={styles.cardMeta}>
                  {event.actorName ?? "System"} · {formatDate(event.createdAt)}
                </Text>
                {event.note ? (
                  <Text style={styles.cardMeta}>{event.note}</Text>
                ) : null}
              </View>
            ))}

            {process || order.permissions.isRequester ? (
              <View style={{ gap: 8 }}>
                <Text style={styles.label}>
                  {process && !order.permissions.isRequester
                    ? "Interne Notiz"
                    : "Nachricht an den Support"}
                </Text>
                <TextInput
                  accessibilityLabel="Notiz"
                  maxLength={2000}
                  multiline
                  onChangeText={setNote}
                  style={[styles.input, { minHeight: 70, paddingTop: 10 }]}
                  value={note}
                />
                <ActionButton
                  disabled={pending || !note.trim()}
                  label="Hinzufügen"
                  onPress={() =>
                    void run("note", {
                      note,
                      internal: process && !order.permissions.isRequester,
                    })
                  }
                />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  primary,
  danger,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  const styles = useShopStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        primary ? styles.primary : danger ? styles.danger : styles.secondary,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={
          primary
            ? styles.primaryText
            : danger
              ? styles.dangerText
              : styles.secondaryText
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}
