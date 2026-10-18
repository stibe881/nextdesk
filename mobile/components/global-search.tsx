import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { listMobileAssets, type MobileAsset } from "@/lib/asset-registry";
import type { MobileTenant } from "@/lib/nextdesk-client";
import type { MobileTicket } from "@/lib/nextdesk-tickets";

type GlobalSearchProps = {
  tenant: MobileTenant | null;
  tickets: MobileTicket[];
};

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("de-CH");
}

function assetSubtitle(asset: MobileAsset): string {
  return (
    [
      asset.manufacturer,
      asset.model,
      asset.serialNumber ?? asset.inventoryNumber,
    ]
      .filter(Boolean)
      .join(" · ") || "Asset"
  );
}

export function GlobalSearch({ tenant, tickets }: GlobalSearchProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [assets, setAssets] = useState<MobileAsset[]>([]);
  const [searchingAssets, setSearchingAssets] = useState(false);
  const [assetSearchUnavailable, setAssetSearchUnavailable] = useState(false);

  const needle = normalized(query);
  const queryLength = Array.from(needle).length;
  const ticketResults = useMemo(() => {
    if (queryLength < 2) return [];
    return tickets.filter((ticket) =>
      [
        ticket.ticketNumber,
        ticket.subject,
        ticket.description,
        ticket.status,
        ticket.priority,
      ].some((value) => normalized(value).includes(needle)),
    );
  }, [needle, queryLength, tickets]);

  useEffect(() => {
    if (!open || !tenant || queryLength < 2) return;

    let cancelled = false;
    const timeout = setTimeout(() => {
      void (async () => {
        setSearchingAssets(true);
        setAssetSearchUnavailable(false);
        try {
          const matches = await listMobileAssets(tenant.id, query);
          if (!cancelled) setAssets(matches);
        } catch {
          // Asset results are optional for the global search. A user without
          // asset read permission can still search every ticket they may see.
          if (!cancelled) {
            setAssets([]);
            setAssetSearchUnavailable(true);
          }
        } finally {
          if (!cancelled) setSearchingAssets(false);
        }
      })();
    }, 240);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [open, query, queryLength, tenant]);

  function close() {
    setOpen(false);
  }

  function openSearch() {
    setQuery("");
    setAssets([]);
    setSearchingAssets(false);
    setAssetSearchUnavailable(false);
    setOpen(true);
  }

  function changeQuery(value: string) {
    setQuery(value);
    if (Array.from(value.trim()).length < 2) {
      setAssets([]);
      setSearchingAssets(false);
      setAssetSearchUnavailable(false);
    }
  }

  function openTicket(ticket: MobileTicket) {
    close();
    router.push({ pathname: "/ticket/[id]", params: { id: ticket.id } });
  }

  function openAsset(asset: MobileAsset) {
    close();
    router.push({
      pathname: "/assets/[id]",
      params: { id: asset.id },
    } as never);
  }

  return (
    <>
      <Pressable
        accessibilityHint="Durchsucht Tickets und Assets in Ihrem aktuellen Mandanten."
        accessibilityLabel="Globale Suche öffnen"
        accessibilityRole="button"
        onPress={openSearch}
        style={styles.trigger}
      >
        <Ionicons color="#77758C" name="search-outline" size={20} />
        <Text style={styles.triggerText}>nextDesk durchsuchen</Text>
        <Ionicons color="#8C84E8" name="arrow-forward" size={18} />
      </Pressable>

      <Modal
        animationType="slide"
        onRequestClose={close}
        transparent
        visible={open}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.overlay}
        >
          <Pressable
            accessibilityLabel="Globale Suche schliessen"
            accessibilityRole="button"
            onPress={close}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.sheet}>
            <View style={styles.header}>
              <View>
                <Text style={styles.eyebrow}>GLOBALE SUCHE</Text>
                <Text style={styles.title}>In nextDesk suchen</Text>
              </View>
              <Pressable
                accessibilityLabel="Globale Suche schliessen"
                accessibilityRole="button"
                hitSlop={10}
                onPress={close}
                style={styles.close}
              >
                <Ionicons color="#4438CA" name="close" size={23} />
              </Pressable>
            </View>

            <View style={styles.inputWrap}>
              <Ionicons color="#77758C" name="search-outline" size={21} />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                onChangeText={changeQuery}
                placeholder="Ticket, Betreff, Asset oder Seriennummer"
                placeholderTextColor="#9A99AA"
                returnKeyType="search"
                style={styles.input}
                value={query}
              />
              {searchingAssets ? (
                <ActivityIndicator color="#4438CA" size="small" />
              ) : null}
            </View>

            <ScrollView
              contentContainerStyle={styles.results}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {queryLength < 2 ? (
                <Text style={styles.note}>
                  Suche nach Ticketnummer, Betreff, Beschreibung, Status,
                  Priorität, Assetname oder Seriennummer.
                </Text>
              ) : (
                <>
                  {ticketResults.length > 0 ? (
                    <ResultGroup label={`TICKETS · ${ticketResults.length}`}>
                      {ticketResults.map((ticket) => (
                        <Pressable
                          accessibilityRole="button"
                          key={ticket.id}
                          onPress={() => openTicket(ticket)}
                          style={styles.result}
                        >
                          <View style={[styles.resultIcon, styles.ticketIcon]}>
                            <Ionicons
                              color="#4438CA"
                              name="ticket-outline"
                              size={18}
                            />
                          </View>
                          <View style={styles.resultCopy}>
                            <Text style={styles.resultTitle}>
                              {ticket.subject}
                            </Text>
                            <Text numberOfLines={1} style={styles.resultMeta}>
                              {ticket.ticketNumber} · {ticket.status} ·{" "}
                              {ticket.priority}
                            </Text>
                          </View>
                          <Ionicons
                            color="#9A99AA"
                            name="chevron-forward"
                            size={18}
                          />
                        </Pressable>
                      ))}
                    </ResultGroup>
                  ) : null}

                  {assets.length > 0 ? (
                    <ResultGroup label={`ASSETS · ${assets.length}`}>
                      {assets.map((asset) => (
                        <Pressable
                          accessibilityRole="button"
                          key={asset.id}
                          onPress={() => openAsset(asset)}
                          style={styles.result}
                        >
                          <View style={[styles.resultIcon, styles.assetIcon]}>
                            <Ionicons
                              color="#087A95"
                              name="cube-outline"
                              size={18}
                            />
                          </View>
                          <View style={styles.resultCopy}>
                            <Text style={styles.resultTitle}>{asset.name}</Text>
                            <Text numberOfLines={1} style={styles.resultMeta}>
                              {assetSubtitle(asset)}
                            </Text>
                          </View>
                          <Ionicons
                            color="#9A99AA"
                            name="chevron-forward"
                            size={18}
                          />
                        </Pressable>
                      ))}
                    </ResultGroup>
                  ) : null}

                  {!searchingAssets &&
                  ticketResults.length === 0 &&
                  assets.length === 0 ? (
                    <Text style={styles.note}>
                      {assetSearchUnavailable
                        ? "Keine passenden Tickets gefunden. Assetergebnisse stehen für Ihre Rolle nicht zur Verfügung."
                        : "Keine passenden Tickets oder Assets gefunden."}
                    </Text>
                  ) : null}
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function ResultGroup({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E9E8F1",
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 15,
  },
  triggerText: { color: "#707083", flex: 1, fontSize: 14, fontWeight: "700" },
  overlay: {
    backgroundColor: "rgba(25, 25, 42, 0.42)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#F6F7FB",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    gap: 16,
    maxHeight: "84%",
    minHeight: "62%",
    padding: 20,
    paddingBottom: 28,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: "#77758C",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  title: { color: "#202136", fontSize: 22, fontWeight: "900", marginTop: 3 },
  close: {
    alignItems: "center",
    backgroundColor: "#EEECFF",
    borderRadius: 17,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  inputWrap: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#DCD9EC",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: 54,
    paddingHorizontal: 14,
  },
  input: { color: "#202136", flex: 1, fontSize: 15, minHeight: 50 },
  results: { gap: 16, paddingBottom: 12 },
  note: { color: "#77758C", fontSize: 14, lineHeight: 21, paddingVertical: 7 },
  group: { gap: 8 },
  groupLabel: {
    color: "#77758C",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  result: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E8E7F0",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 11,
    minHeight: 62,
    paddingHorizontal: 12,
  },
  resultIcon: {
    alignItems: "center",
    borderRadius: 12,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  ticketIcon: { backgroundColor: "#EEEAFE" },
  assetIcon: { backgroundColor: "#E5F7FA" },
  resultCopy: { flex: 1, gap: 3 },
  resultTitle: { color: "#28293D", fontSize: 14, fontWeight: "800" },
  resultMeta: { color: "#747486", fontSize: 12 },
});
