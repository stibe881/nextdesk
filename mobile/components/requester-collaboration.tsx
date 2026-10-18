import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useMobileFeatures } from "@/components/mobile-feature-gate";
import {
  listDepartmentTickets,
  type DepartmentTicket,
} from "@/lib/nextdesk-portal";

type LoadState = "hidden" | "loading" | "ready";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Zeitpunkt nicht verfügbar";

  return new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/**
 * Optionaler, serverseitig freigegebener Einblick in die eigene Abteilung.
 * Jede Unsicherheit beim Feature-Gate oder beim Edge-Function-Aufruf blendet
 * den Bereich vorsorglich aus.
 */
export function RequesterCollaboration() {
  const { isEnabled, loading: checkingFeatures } = useMobileFeatures();
  const departmentViewEnabled = isEnabled("requester.department-view");
  const requesterPortalEnabled = isEnabled("requester.portal");
  const [loadState, setLoadState] = useState<LoadState>("hidden");
  const [tickets, setTickets] = useState<DepartmentTicket[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      if (
        checkingFeatures ||
        !requesterPortalEnabled ||
        !departmentViewEnabled
      ) {
        setLoadState("hidden");
        return () => {
          active = false;
        };
      }

      setLoadState("loading");
      void listDepartmentTickets()
        .then(({ tickets: nextTickets }) => {
          if (!active) return;
          setTickets(nextTickets);
          setLoadState("ready");
        })
        .catch(() => {
          // Fehler, fehlende Berechtigung und Netzwerkprobleme bleiben still.
          // Damit werden Daten nie ohne eine bestätigte Mandantengrenze gezeigt.
          if (active) setLoadState("hidden");
        });

      return () => {
        active = false;
      };
    }, [checkingFeatures, departmentViewEnabled, requesterPortalEnabled]),
  );

  if (loadState === "hidden") return null;

  if (loadState === "loading") {
    return (
      <View
        accessibilityLabel="Abteilungstickets werden geladen"
        accessibilityRole="progressbar"
        style={styles.loading}
      >
        <ActivityIndicator color="#4438CA" size="small" />
        <Text style={styles.loadingText}>Abteilung wird geladen …</Text>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <View style={styles.headingIcon}>
          <Ionicons color="#087A95" name="people-outline" size={20} />
        </View>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>ABTEILUNG</Text>
          <Text style={styles.title}>Aktuelle Serviceanfragen</Text>
          <Text style={styles.subtitle}>
            Status und Titel der Tickets in deiner Abteilung.
          </Text>
        </View>
      </View>

      {tickets.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons color="#087A95" name="checkmark-circle-outline" size={21} />
          <Text style={styles.emptyText}>
            Für deine Abteilung liegen aktuell keine Tickets vor.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {tickets.map((ticket) => (
            <View key={ticket.ticketNumber} style={styles.ticket}>
              <View style={styles.ticketHeader}>
                <Text style={styles.ticketNumber}>{ticket.ticketNumber}</Text>
                <Text style={styles.status}>Status: {ticket.statusLabel}</Text>
              </View>
              <Text numberOfLines={2} style={styles.ticketTitle}>
                {ticket.title}
              </Text>
              <Text style={styles.ticketMeta}>
                Erstellt {formatDate(ticket.createdAt)} · Aktualisiert{" "}
                {formatDate(ticket.updatedAt)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: "flex-start",
    backgroundColor: "#EAF8FB",
    borderRadius: 16,
    flexDirection: "row",
    gap: 9,
    padding: 14,
  },
  emptyText: { color: "#276D7C", flex: 1, fontSize: 12, lineHeight: 18 },
  eyebrow: {
    color: "#087A95",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.9,
  },
  heading: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  headingCopy: { flex: 1 },
  headingIcon: {
    alignItems: "center",
    backgroundColor: "#E5F7FA",
    borderRadius: 12,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  list: { gap: 9 },
  loading: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E7E6EF",
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    padding: 14,
  },
  loadingText: { color: "#747486", fontSize: 12, fontWeight: "700" },
  section: { gap: 12 },
  status: {
    color: "#087A95",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "right",
  },
  subtitle: { color: "#747486", fontSize: 12, lineHeight: 17, marginTop: 3 },
  ticket: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E7E6EF",
    borderRadius: 16,
    borderWidth: 1,
    gap: 5,
    padding: 14,
  },
  ticketHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  ticketMeta: { color: "#77758C", fontSize: 10, lineHeight: 15 },
  ticketNumber: { color: "#514AA1", fontSize: 11, fontWeight: "900" },
  ticketTitle: {
    color: "#303145",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 19,
  },
  title: { color: "#292A3E", fontSize: 17, fontWeight: "900", marginTop: 1 },
});
