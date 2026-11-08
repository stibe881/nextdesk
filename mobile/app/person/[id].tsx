import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { useMobileNetworkStatus } from "@/components/offline-status";
import { ScreenContainer } from "@/components/screen-container";
import { invokeNextDesk, loadCurrentTenant } from "@/lib/nextdesk-client";
import {
  formatDuration,
  loadMobilePersonOverview,
  orderStatusLabel,
  personInitials,
  personRefFromRouteId,
  personTimeline,
  satisfactionLabel,
  type PersonDevice,
  type PersonOverview,
  type PersonTicket,
} from "@/lib/person-overview";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

type Tab = "tickets" | "devices" | "licenses" | "orders" | "history";
type TicketFilter = "all" | "open" | "closed";

const dateFormat = new Intl.DateTimeFormat("de-CH", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function formatDate(value: string | null): string {
  if (!value) return "–";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "–" : dateFormat.format(date);
}

function relativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";
  const hours = Math.round((Date.now() - date.getTime()) / 3_600_000);
  if (hours < 1) return "gerade eben";
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  if (days === 1) return "gestern";
  if (days < 7) return `vor ${days} Tagen`;
  return dateFormat.format(date);
}

function deviceIcon(device: PersonDevice): keyof typeof Ionicons.glyphMap {
  const text =
    `${device.operatingSystem ?? ""} ${device.model ?? ""} ${device.name}`.toLowerCase();
  if (/iphone|android|phone/.test(text)) return "phone-portrait-outline";
  if (/ipad|tablet/.test(text)) return "tablet-portrait-outline";
  if (/monitor|display|bildschirm/.test(text)) return "desktop-outline";
  return "laptop-outline";
}

function complianceLabel(state: string | null): string | null {
  if (!state) return null;
  if (state === "compliant") return "Intune konform";
  if (state === "noncompliant") return "Intune nicht konform";
  return `Intune: ${state}`;
}

export default function PersonScreen() {
  const router = useRouter();
  const { recoveryEpoch } = useMobileNetworkStatus();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const person = useMemo(() => personRefFromRouteId(id), [id]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [data, setData] = useState<PersonOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("tickets");
  const [ticketFilter, setTicketFilter] = useState<TicketFilter>("all");
  const [creating, setCreating] = useState(false);
  const styles = useStyles();
  const colors = useAppColors();

  const load = useCallback(async () => {
    if (!person) {
      setError("Diese Person gibt es nicht.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setError("");
      const tenant = await loadCurrentTenant();
      setTenantId(tenant.id);
      setData(await loadMobilePersonOverview(tenant.id, person));
    } catch (loadError) {
      setError(
        loadError instanceof Error && loadError.message
          ? loadError.message
          : "Die Personenübersicht konnte nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }, [person]);

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      const timer = setTimeout(() => void load(), 0);
      return () => clearTimeout(timer);
    }, [load, recoveryEpoch]),
  );

  const tickets = useMemo(() => {
    const all = data?.tickets ?? [];
    if (ticketFilter === "open") return all.filter((item) => !item.isClosed);
    if (ticketFilter === "closed") return all.filter((item) => item.isClosed);
    return all;
  }, [data, ticketFilter]);
  const timeline = useMemo(() => (data ? personTimeline(data) : []), [data]);

  async function createTicket() {
    if (!data || !tenantId || creating) return;
    const info = data.person;
    let requesterId = info.requesterContactId;
    if (!requesterId) {
      setCreating(true);
      try {
        const response = await invokeNextDesk<{
          data?: { id?: unknown; requester?: { id?: unknown } };
        }>("ticket-requesters", {
          type: "create",
          tenantId,
          displayName: info.displayName,
          ...(info.email ? { email: info.email } : {}),
        });
        const created = response?.data?.requester ?? response?.data;
        requesterId = typeof created?.id === "string" ? created.id : null;
      } catch (createError) {
        setError(
          createError instanceof Error && createError.message
            ? createError.message
            : "Die Person konnte nicht übernommen werden.",
        );
      } finally {
        setCreating(false);
      }
    }
    if (!requesterId) return;
    router.push({
      pathname: "/ticket/new",
      params: { requesterId, requesterName: info.displayName },
    } as never);
  }

  function openTicket(ticketId: string) {
    router.push({ pathname: "/ticket/[id]", params: { id: ticketId } });
  }

  const name = data?.person.displayName ?? "Person";
  const firstName = name.split(/\s+/u)[0] ?? name;
  const average = data?.satisfaction.average ?? null;
  const openCount = data?.tickets.filter((item) => !item.isClosed).length ?? 0;
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "tickets", label: "Tickets", count: data?.tickets.length ?? 0 },
  ];
  if (data?.devices) {
    tabs.push({ key: "devices", label: "Geräte", count: data.devices.length });
  }
  if (data?.licenses) {
    tabs.push({
      key: "licenses",
      label: "Lizenzen",
      count: data.licenses.length,
    });
  }
  if (data?.orders) {
    tabs.push({
      key: "orders",
      label: "Bestellungen",
      count: data.orders.length,
    });
  }
  tabs.push({ key: "history", label: "Verlauf" });

  const renderTicket = (ticket: PersonTicket) => (
    <Pressable
      accessibilityRole="button"
      key={ticket.id}
      onPress={() => openTicket(ticket.id)}
      style={styles.row}
    >
      <View style={styles.rowCopy}>
        <Text style={styles.ticketNumber}>{ticket.ticketNumber}</Text>
        <Text numberOfLines={2} style={styles.rowTitle}>
          {ticket.subject}
        </Text>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {[
            ticket.categoryName,
            ticket.assignedAgentName ?? "Nicht zugewiesen",
            relativeDate(ticket.updatedAt),
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
      <View
        style={[
          styles.chip,
          ticket.isClosed
            ? ticket.statusKey === "resolved"
              ? styles.chipOk
              : null
            : ticket.statusKey.startsWith("waiting")
              ? styles.chipWarn
              : styles.chipPrimary,
        ]}
      >
        <Text
          style={[
            styles.chipText,
            ticket.isClosed
              ? ticket.statusKey === "resolved"
                ? styles.chipOkText
                : null
              : ticket.statusKey.startsWith("waiting")
                ? styles.chipWarnText
                : styles.chipPrimaryText,
          ]}
        >
          {ticket.statusLabel}
        </Text>
      </View>
    </Pressable>
  );

  return (
    <ScreenContainer className="px-5">
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityLabel="Zurück"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.back}
        >
          <Ionicons color={colors.primaryText} name="arrow-back" size={20} />
          <Text style={styles.backText}>Zurück</Text>
        </Pressable>

        {loading && !data ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.muted}>Personenübersicht wird geladen …</Text>
          </View>
        ) : error && !data ? (
          <View style={styles.errorBox}>
            <Ionicons
              color={colors.error}
              name="alert-circle-outline"
              size={20}
            />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void load()}
              style={styles.retry}
            >
              <Text style={styles.retryText}>Erneut versuchen</Text>
            </Pressable>
          </View>
        ) : data ? (
          <>
            <View style={styles.card}>
              <View style={styles.headRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{personInitials(name)}</Text>
                </View>
                <View style={styles.headCopy}>
                  <Text accessibilityRole="header" style={styles.name}>
                    {name}
                  </Text>
                  {data.person.jobTitle || data.person.department ? (
                    <Text style={styles.muted}>
                      {[data.person.jobTitle, data.person.department]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  ) : null}
                </View>
              </View>
              <View style={styles.chips}>
                {data.person.source === "entra" ? (
                  data.person.accountEnabled === false ? (
                    <View style={[styles.chip, styles.chipBad]}>
                      <Text style={[styles.chipText, styles.chipBadText]}>
                        {data.person.removedFromDirectory
                          ? "Nicht mehr im Verzeichnis"
                          : "Konto deaktiviert"}
                      </Text>
                    </View>
                  ) : (
                    <View style={[styles.chip, styles.chipOk]}>
                      <Text style={[styles.chipText, styles.chipOkText]}>
                        Konto aktiv
                      </Text>
                    </View>
                  )
                ) : null}
                <View style={styles.chip}>
                  <Text style={styles.chipText}>
                    {data.person.source === "entra" ? "Entra" : "Kontakt"}
                  </Text>
                </View>
              </View>
              <View style={styles.facts}>
                {data.person.email ? (
                  <Text style={styles.fact}>{data.person.email}</Text>
                ) : null}
                {data.person.managerName ? (
                  <Text style={styles.fact}>
                    Vorgesetzt: {data.person.managerName}
                  </Text>
                ) : null}
                {data.person.lastSignInAt ? (
                  <Text style={styles.fact}>
                    Letzte Anmeldung: {formatDate(data.person.lastSignInAt)}
                  </Text>
                ) : null}
              </View>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={creating}
                  onPress={() => void createTicket()}
                  style={[styles.primaryButton, creating && styles.disabled]}
                >
                  <Ionicons color={colors.onPrimary} name="add" size={18} />
                  <Text style={styles.primaryButtonText}>
                    Ticket für {firstName}
                  </Text>
                </Pressable>
                {data.person.email ? (
                  <Pressable
                    accessibilityLabel={`${name} eine E-Mail schreiben`}
                    accessibilityRole="button"
                    onPress={() =>
                      void Linking.openURL(`mailto:${data.person.email}`)
                    }
                    style={styles.secondaryButton}
                  >
                    <Ionicons
                      color={colors.primaryText}
                      name="mail-outline"
                      size={18}
                    />
                    <Text style={styles.secondaryButtonText}>E-Mail</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <View style={styles.kpis}>
              <View style={styles.kpi}>
                <Text style={styles.kpiLabel}>Offene Tickets</Text>
                <Text style={styles.kpiValue}>{data.stats.openTickets}</Text>
                <Text style={styles.kpiHint}>
                  {data.stats.waitingOnPerson > 0
                    ? `${data.stats.waitingOnPerson} wartet auf ${firstName}`
                    : `${data.stats.totalTickets} insgesamt`}
                </Text>
              </View>
              <View style={styles.kpi}>
                <Text style={styles.kpiLabel}>12 Monate</Text>
                <Text style={styles.kpiValue}>
                  {data.stats.ticketsLast12Months}
                </Text>
                <Text style={styles.kpiHint}>
                  Vorjahr {data.stats.ticketsPrevious12Months}
                </Text>
              </View>
              <View style={styles.kpi}>
                <Text style={styles.kpiLabel}>Ø Lösungszeit</Text>
                <Text style={styles.kpiValue}>
                  {formatDuration(data.stats.avgResolutionHours)}
                </Text>
                <Text style={styles.kpiHint}>
                  Mandant {formatDuration(data.stats.tenantAvgResolutionHours)}
                </Text>
              </View>
              <View style={styles.kpi}>
                <Text style={styles.kpiLabel}>Zufriedenheit</Text>
                <Text style={styles.kpiValue}>
                  {average !== null ? average.toFixed(1) : "–"}
                </Text>
                <Text style={styles.kpiHint}>
                  {average !== null
                    ? `aus ${data.satisfaction.ratingCount} Bewertungen`
                    : data.satisfaction.ratingCount
                      ? `erst ${data.satisfaction.ratingCount} von ${data.satisfaction.minimumRatings}`
                      : "noch keine"}
                </Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Zufriedenheit</Text>
              {average !== null ? (
                <>
                  <View style={styles.satRow}>
                    <Text style={styles.satValue}>{average.toFixed(1)}</Text>
                    <View style={styles.stars}>
                      {[1, 2, 3, 4, 5].map((index) => (
                        <Ionicons
                          color={
                            average >= index - 0.75
                              ? "#F5A524"
                              : colors.borderStrong
                          }
                          key={index}
                          name={
                            average >= index - 0.25
                              ? "star"
                              : average >= index - 0.75
                                ? "star-half"
                                : "star-outline"
                          }
                          size={18}
                        />
                      ))}
                    </View>
                  </View>
                  <Text style={styles.satLabel}>
                    {satisfactionLabel(average)}
                  </Text>
                  <View style={styles.bar}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${(average / 5) * 100}%` },
                      ]}
                    />
                  </View>
                  {data.satisfaction.positiveShare !== null ? (
                    <View style={styles.factRow}>
                      <Text style={styles.text}>Zufrieden (4–5 Sterne)</Text>
                      <Text style={styles.bold}>
                        {data.satisfaction.positiveShare} %
                      </Text>
                    </View>
                  ) : null}
                  {data.satisfaction.tenantAverage !== null ? (
                    <View style={styles.factRow}>
                      <Text style={styles.text}>Mandant (12 Monate)</Text>
                      <Text style={styles.bold}>
                        {data.satisfaction.tenantAverage.toFixed(1)}
                      </Text>
                    </View>
                  ) : null}
                  {data.satisfaction.trend ? (
                    <View style={styles.factRow}>
                      <Text style={styles.text}>Tendenz (6 Monate)</Text>
                      <Text style={styles.bold}>
                        {data.satisfaction.trend === "up"
                          ? "steigend"
                          : data.satisfaction.trend === "down"
                            ? "sinkend"
                            : "stabil"}
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : (
                <Text style={styles.muted}>
                  {data.satisfaction.ratingCount
                    ? `Noch zu wenige Bewertungen (${data.satisfaction.ratingCount} von ${data.satisfaction.minimumRatings}).`
                    : "Noch keine Bewertungen."}
                </Text>
              )}
              <View style={styles.note}>
                <Ionicons
                  color={colors.muted}
                  name="lock-closed-outline"
                  size={13}
                />
                <Text style={styles.noteText}>
                  Einzelne Bewertungen und Kommentare sind nicht sichtbar.
                  nextDesk zeigt nur den Durchschnitt, erst ab{" "}
                  {data.satisfaction.minimumRatings} Bewertungen.
                </Text>
              </View>
            </View>

            <ScrollView
              contentContainerStyle={styles.tabs}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {tabs.map((item) => (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === item.key }}
                  key={item.key}
                  onPress={() => setTab(item.key)}
                  style={[styles.tab, tab === item.key && styles.tabActive]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      tab === item.key && styles.tabTextActive,
                    ]}
                  >
                    {item.label}
                    {item.count !== undefined ? ` ${item.count}` : ""}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.card}>
              {tab === "tickets" ? (
                <>
                  <View style={styles.segmented}>
                    {(
                      [
                        ["all", `Alle ${data.tickets.length}`],
                        ["open", `Offen ${openCount}`],
                        [
                          "closed",
                          `Geschlossen ${data.tickets.length - openCount}`,
                        ],
                      ] as const
                    ).map(([key, label]) => (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: ticketFilter === key }}
                        key={key}
                        onPress={() => setTicketFilter(key)}
                        style={[
                          styles.segment,
                          ticketFilter === key && styles.segmentActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.segmentText,
                            ticketFilter === key && styles.segmentTextActive,
                          ]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {tickets.length === 0 ? (
                    <Text style={styles.muted}>
                      {data.tickets.length === 0
                        ? `${firstName} hat noch keine Tickets, die du sehen darfst.`
                        : "Keine Tickets in dieser Auswahl."}
                    </Text>
                  ) : (
                    tickets.map(renderTicket)
                  )}
                </>
              ) : null}

              {tab === "devices" && data.devices ? (
                data.devices.length === 0 ? (
                  <Text style={styles.muted}>Keine Geräte zugeordnet.</Text>
                ) : (
                  data.devices.map((device) => (
                    <Pressable
                      accessibilityRole="button"
                      key={device.id}
                      onPress={() =>
                        router.push({
                          pathname: "/assets/[id]",
                          params: { id: device.id },
                        } as never)
                      }
                      style={styles.row}
                    >
                      <View style={styles.icon}>
                        <Ionicons
                          color={colors.primaryText}
                          name={deviceIcon(device)}
                          size={18}
                        />
                      </View>
                      <View style={styles.rowCopy}>
                        <Text style={styles.rowTitle}>{device.name}</Text>
                        <Text numberOfLines={2} style={styles.rowMeta}>
                          {[
                            [device.manufacturer, device.model]
                              .filter(Boolean)
                              .join(" "),
                            complianceLabel(device.complianceState),
                            device.source === "intune" ? "Intune" : "Assets",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      </View>
                      <Ionicons
                        color={colors.subtle}
                        name="chevron-forward"
                        size={18}
                      />
                    </Pressable>
                  ))
                )
              ) : null}

              {tab === "licenses" && data.licenses ? (
                data.licenses.length === 0 ? (
                  <Text style={styles.muted}>Keine Lizenzen zugewiesen.</Text>
                ) : (
                  data.licenses.map((license) => (
                    <View key={license.id} style={styles.row}>
                      <View style={styles.icon}>
                        <Ionicons
                          color={colors.primaryText}
                          name="key-outline"
                          size={18}
                        />
                      </View>
                      <View style={styles.rowCopy}>
                        <Text style={styles.rowTitle}>{license.title}</Text>
                        <Text style={styles.rowMeta}>
                          {[
                            license.vendorName,
                            license.assignedAt
                              ? `seit ${formatDate(license.assignedAt)}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      </View>
                    </View>
                  ))
                )
              ) : null}

              {tab === "orders" && data.orders ? (
                data.orders.length === 0 ? (
                  <Text style={styles.muted}>Keine Bestellungen.</Text>
                ) : (
                  data.orders.map((order) => (
                    <View key={order.id} style={styles.row}>
                      <View style={styles.icon}>
                        <Ionicons
                          color={colors.primaryText}
                          name="bag-handle-outline"
                          size={18}
                        />
                      </View>
                      <View style={styles.rowCopy}>
                        <Text style={styles.rowTitle}>
                          {order.orderNumber}
                          {order.items ? ` · ${order.items}` : ""}
                        </Text>
                        <Text style={styles.rowMeta}>
                          {formatDate(order.createdAt)} ·{" "}
                          {orderStatusLabel(order.status)}
                        </Text>
                      </View>
                    </View>
                  ))
                )
              ) : null}

              {tab === "history" ? (
                timeline.length === 0 ? (
                  <Text style={styles.muted}>Noch keine Ereignisse.</Text>
                ) : (
                  timeline.map((entry, index) => (
                    <Pressable
                      accessibilityRole={entry.ticketId ? "button" : undefined}
                      disabled={!entry.ticketId}
                      key={`${entry.kind}:${entry.at}:${index}`}
                      onPress={() =>
                        entry.ticketId && openTicket(entry.ticketId)
                      }
                      style={styles.timelineRow}
                    >
                      <View
                        style={[
                          styles.dot,
                          entry.kind === "ticket_closed" && styles.dotClosed,
                          (entry.kind === "device" ||
                            entry.kind === "license") &&
                            styles.dotInfo,
                          entry.kind === "order" && styles.dotOrder,
                        ]}
                      />
                      <View style={styles.rowCopy}>
                        <Text style={styles.rowTitle}>{entry.title}</Text>
                        <Text style={styles.rowMeta}>
                          {formatDate(entry.at)}
                          {entry.detail ? ` · ${entry.detail}` : ""}
                        </Text>
                      </View>
                    </Pressable>
                  ))
                )
              ) : null}
            </View>

            {data.topics.length > 0 ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Häufige Themen</Text>
                {data.topics.map((topic) => (
                  <View key={topic.name}>
                    <View style={styles.factRow}>
                      <Text style={styles.text}>{topic.name}</Text>
                      <Text style={styles.bold}>{topic.count}</Text>
                    </View>
                    <View style={styles.bar}>
                      <View
                        style={[
                          styles.barFill,
                          styles.barPrimary,
                          {
                            width: `${Math.max(8, (topic.count / (data.topics[0]?.count || 1)) * 100)}%`,
                          },
                        ]}
                      />
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const useStyles = makeThemedStyles((c) => ({
  content: { gap: 14, paddingBottom: 40, paddingTop: 18 },
  back: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 6,
    minHeight: 34,
  },
  backText: { color: c.primaryText, fontSize: 14, fontWeight: "800" },
  centered: {
    alignItems: "center",
    gap: 12,
    justifyContent: "center",
    minHeight: 280,
  },
  muted: { color: c.muted, fontSize: 13, lineHeight: 19 },
  text: { color: c.text, fontSize: 13 },
  bold: { color: c.foreground, fontSize: 13, fontWeight: "800" },
  errorBox: {
    backgroundColor: c.errorSoft,
    borderRadius: 18,
    gap: 10,
    padding: 17,
  },
  errorText: { color: c.error, fontSize: 13, lineHeight: 19 },
  retry: { alignSelf: "flex-start", paddingVertical: 4 },
  retryText: { color: c.error, fontSize: 13, fontWeight: "900" },
  card: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  cardTitle: { color: c.foreground, fontSize: 15, fontWeight: "800" },
  headRow: { alignItems: "center", flexDirection: "row", gap: 14 },
  headCopy: { flex: 1, gap: 3 },
  avatar: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 30,
    height: 60,
    justifyContent: "center",
    width: 60,
  },
  avatarText: { color: c.primaryText, fontSize: 21, fontWeight: "800" },
  name: { color: c.foreground, fontSize: 22, fontWeight: "800" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    alignSelf: "flex-start",
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  chipText: { color: c.muted, fontSize: 12, fontWeight: "700" },
  chipOk: { backgroundColor: c.successSoft, borderColor: c.successBorder },
  chipOkText: { color: c.success },
  chipWarn: { backgroundColor: c.warningSoft, borderColor: c.warningBorder },
  chipWarnText: { color: c.warning },
  chipBad: { backgroundColor: c.errorSoft, borderColor: c.errorBorder },
  chipBadText: { color: c.error },
  chipPrimary: {
    backgroundColor: c.primarySoft,
    borderColor: c.primarySoftBorder,
  },
  chipPrimaryText: { color: c.primaryText },
  facts: { gap: 3 },
  fact: { color: c.text, fontSize: 13 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  primaryButton: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 14,
    flexDirection: "row",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 14,
  },
  primaryButtonText: { color: c.onPrimary, fontSize: 14, fontWeight: "800" },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.borderStrong,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: c.primaryText,
    fontSize: 14,
    fontWeight: "800",
  },
  disabled: { opacity: 0.6 },
  kpis: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  kpi: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 18,
    borderWidth: 1,
    flexBasis: "47%",
    flexGrow: 1,
    gap: 2,
    padding: 14,
  },
  kpiLabel: { color: c.muted, fontSize: 12, fontWeight: "700" },
  kpiValue: { color: c.foreground, fontSize: 24, fontWeight: "800" },
  kpiHint: { color: c.muted, fontSize: 12 },
  satRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  satValue: { color: c.foreground, fontSize: 30, fontWeight: "800" },
  stars: { flexDirection: "row", gap: 1 },
  satLabel: { color: c.success, fontSize: 13, fontWeight: "800" },
  bar: {
    backgroundColor: c.surfaceSubtle,
    borderRadius: 99,
    height: 8,
    marginBottom: 4,
    overflow: "hidden",
  },
  barFill: { backgroundColor: c.success, borderRadius: 99, height: 8 },
  barPrimary: { backgroundColor: c.primary },
  factRow: { flexDirection: "row", justifyContent: "space-between" },
  note: { alignItems: "flex-start", flexDirection: "row", gap: 6 },
  noteText: { color: c.muted, flex: 1, fontSize: 12, lineHeight: 17 },
  tabs: { gap: 6 },
  tab: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: c.primarySoft,
    borderColor: c.primarySoftBorder,
  },
  tabText: { color: c.muted, fontSize: 13, fontWeight: "800" },
  tabTextActive: { color: c.primaryText },
  segmented: {
    backgroundColor: c.surfaceSubtle,
    borderRadius: 12,
    flexDirection: "row",
    gap: 2,
    padding: 3,
  },
  segment: {
    alignItems: "center",
    borderRadius: 9,
    flex: 1,
    paddingVertical: 7,
  },
  segmentActive: { backgroundColor: c.surface },
  segmentText: { color: c.muted, fontSize: 12, fontWeight: "800" },
  segmentTextActive: { color: c.primaryText },
  row: {
    alignItems: "center",
    borderTopColor: c.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingTop: 10,
  },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { color: c.foreground, fontSize: 14, fontWeight: "700" },
  rowMeta: { color: c.muted, fontSize: 12 },
  ticketNumber: {
    color: c.primaryText,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 11,
    fontWeight: "700",
  },
  icon: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 10,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  timelineRow: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  dot: {
    backgroundColor: c.primary,
    borderRadius: 6,
    height: 12,
    marginTop: 4,
    width: 12,
  },
  dotClosed: { backgroundColor: c.success },
  dotInfo: { backgroundColor: c.info },
  dotOrder: { backgroundColor: c.warning },
}));
