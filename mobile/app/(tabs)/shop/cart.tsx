import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
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
  formatDate,
  newRequestId,
  shopApi,
  shopCart,
  useShopCart,
} from "@/lib/shop";
import { useAppColors } from "@/lib/themed-styles";

function isoDate(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function addDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

export default function ShopCartScreen() {
  const router = useRouter();
  const styles = useShopStyles();
  const colors = useAppColors();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const cart = useShopCart(tenantId);
  const [deliveryMethod, setDeliveryMethod] = useState<"pickup" | "desk">(
    "pickup",
  );
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [loanDays, setLoanDays] = useState(1);
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState(newRequestId);

  useEffect(() => {
    void loadCurrentTenant()
      .then((tenant) => setTenantId(tenant.id))
      .catch(() => setError("Der Arbeitsbereich konnte nicht geladen werden."));
  }, []);

  const loanItems = cart.filter((line) => line.item.kind === "loan");
  const hasLoan = loanItems.length > 0;
  const maxLoanDays = loanItems.reduce(
    (max, line) => Math.min(max, line.item.maxLoanDays ?? 365),
    365,
  );
  const durationOptions = [1, 3, 7, 14, 30].filter(
    (days) => days <= maxLoanDays,
  );
  const needsApproval = cart.some((line) => line.item.requiresApproval);

  async function submit() {
    if (!tenantId || cart.length === 0) return;
    if (deliveryMethod === "desk" && deliveryLocation.trim().length < 2) {
      setError("Bitte Arbeitsplatz oder Raum angeben.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = await shopApi.submit(tenantId, {
        clientRequestId: requestId,
        lines: cart.map((line) => ({
          catalogItemId: line.item.id,
          quantity: line.quantity,
        })),
        deliveryMethod,
        deliveryLocation:
          deliveryMethod === "desk" ? deliveryLocation.trim() : null,
        loanFrom: hasLoan ? addDays(0) : null,
        loanUntil: hasLoan ? addDays(Math.max(0, loanDays - 1)) : null,
        comment: comment.trim() || null,
      });
      shopCart.clear();
      setRequestId(newRequestId());
      router.replace({
        pathname: "/shop/order/[id]",
        params: { id: result.orderId },
      } as never);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Bestellung ist fehlgeschlagen.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
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
            <Text style={styles.backText}>‹ Zurück zum Shop</Text>
          </Pressable>
          <Text style={styles.title}>Warenkorb</Text>

          {cart.length === 0 ? (
            <Text style={styles.empty}>Der Warenkorb ist leer.</Text>
          ) : (
            cart.map((line) => (
              <View
                key={line.item.id}
                style={[
                  styles.card,
                  styles.cardRow,
                  { justifyContent: "space-between" },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{line.item.name}</Text>
                  <Text style={styles.cardMeta}>
                    {line.item.kind === "loan" ? "Ausleihe" : "Bestellung"}
                    {line.item.requiresApproval ? " · mit Freigabe" : ""}
                  </Text>
                </View>
                <View style={styles.qty}>
                  <Pressable
                    accessibilityLabel={`${line.item.name}: eins weniger`}
                    accessibilityRole="button"
                    onPress={() =>
                      shopCart.setQuantity(line.item.id, line.quantity - 1)
                    }
                    style={styles.qtyButton}
                  >
                    <Ionicons
                      color={colors.primaryText}
                      name={line.quantity <= 1 ? "trash-outline" : "remove"}
                      size={18}
                    />
                  </Pressable>
                  <Text style={styles.qtyText}>{line.quantity}</Text>
                  <Pressable
                    accessibilityLabel={`${line.item.name}: eins mehr`}
                    accessibilityRole="button"
                    disabled={line.quantity >= line.item.maxQuantity}
                    onPress={() =>
                      shopCart.setQuantity(line.item.id, line.quantity + 1)
                    }
                    style={[
                      styles.qtyButton,
                      line.quantity >= line.item.maxQuantity && styles.disabled,
                    ]}
                  >
                    <Ionicons color={colors.primaryText} name="add" size={18} />
                  </Pressable>
                </View>
              </View>
            ))
          )}

          {cart.length > 0 ? (
            <>
              {hasLoan ? (
                <View style={{ gap: 8 }}>
                  <Text style={styles.label}>Ausleihdauer ab heute</Text>
                  <View style={styles.segments}>
                    {durationOptions.map((days) => (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: loanDays === days }}
                        key={days}
                        onPress={() => setLoanDays(days)}
                        style={[
                          styles.choice,
                          loanDays === days && styles.choiceActive,
                        ]}
                      >
                        <Text style={styles.choiceText}>
                          {days === 1 ? "1 Tag" : `${days} Tage`}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.cardMeta}>
                    Rückgabe bis{" "}
                    {formatDate(addDays(Math.max(0, loanDays - 1)))}
                  </Text>
                </View>
              ) : null}

              <View style={{ gap: 8 }}>
                <Text style={styles.label}>Übergabe</Text>
                {(
                  [
                    ["pickup", "Abholung beim Support"],
                    ["desk", "An meinen Arbeitsplatz"],
                  ] as const
                ).map(([value, label]) => (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: deliveryMethod === value }}
                    key={value}
                    onPress={() => setDeliveryMethod(value)}
                    style={[
                      styles.choice,
                      deliveryMethod === value && styles.choiceActive,
                    ]}
                  >
                    <Text style={styles.choiceText}>{label}</Text>
                  </Pressable>
                ))}
                {deliveryMethod === "desk" ? (
                  <TextInput
                    accessibilityLabel="Arbeitsplatz oder Raum"
                    maxLength={200}
                    onChangeText={setDeliveryLocation}
                    placeholder="z. B. Büro 2.14"
                    placeholderTextColor={colors.subtle}
                    style={styles.input}
                    value={deliveryLocation}
                  />
                ) : null}
              </View>

              <View style={{ gap: 8 }}>
                <Text style={styles.label}>Bemerkung (optional)</Text>
                <TextInput
                  accessibilityLabel="Bemerkung"
                  maxLength={2000}
                  multiline
                  onChangeText={setComment}
                  placeholderTextColor={colors.subtle}
                  style={[styles.input, { minHeight: 80, paddingTop: 10 }]}
                  value={comment}
                />
              </View>

              {needsApproval ? (
                <Text style={styles.hint}>
                  Mindestens ein Artikel braucht die Freigabe deiner
                  vorgesetzten Person.
                </Text>
              ) : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ busy: pending, disabled: pending }}
                disabled={pending}
                onPress={() => void submit()}
                style={({ pressed }) => [
                  styles.primary,
                  pressed && styles.pressed,
                  pending && styles.disabled,
                ]}
              >
                <Text style={styles.primaryText}>
                  {pending
                    ? "Wird bestellt …"
                    : needsApproval
                      ? "Zur Freigabe senden"
                      : "Jetzt bestellen"}
                </Text>
              </Pressable>
            </>
          ) : null}
        </ScrollView>
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}
