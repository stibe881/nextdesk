import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { severityStyle, useIncidentStyles } from "@/components/incident-styles";
import { SensorStatusBadge } from "@/components/sensor-status-badge";
import { ScreenContainer } from "@/components/screen-container";
import {
  acknowledgeIncident,
  addIncidentNote,
  assignIncident,
  CAUSE_LABELS,
  CAUSES,
  closeIncident,
  currentUserId,
  EVENT_LABELS,
  formatDuration,
  liveMinutes,
  loadIncident,
  STATE_LABELS,
  TICKET_SOURCE_LABELS,
  type IncidentCause,
  type IncidentDetail,
  type IncidentNeighbour,
} from "@/lib/incidents";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import { useAppColors } from "@/lib/themed-styles";
import { useAppActiveInterval } from "@/lib/use-app-active-interval";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";
import { tn } from "@/lib/formality";

const TIME = new Intl.DateTimeFormat("de-CH", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Zurich",
});
const DATE_TIME = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Zurich",
});

function eventTone(
  kind: string,
  status: string | null,
): "bad" | "warn" | "ok" | "info" {
  if (kind === "prtg") {
    const value = (status ?? "").toLowerCase();
    if (/(jetzt|now):\s*(ok|up)|^(ok|up)/.test(value)) return "ok";
    if (/(jetzt|now):\s*(warn)|^warn/.test(value)) return "warn";
    return "bad";
  }
  if (kind === "resolved" || kind === "closed") return "ok";
  if (kind === "realert") return "warn";
  return "info";
}

export default function IncidentDetailScreen() {
  const router = useRouter();
  const styles = useIncidentStyles();
  const colors = useAppColors();
  const checkingSession = useMobileSessionGuard();
  const { id } = useLocalSearchParams<{ id: string }>();
  const incidentId = typeof id === "string" ? id : "";
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState("");
  const [cause, setCause] = useState<IncidentCause | null>(null);
  const [closingNote, setClosingNote] = useState("");
  const [pickAgent, setPickAgent] = useState(false);
  // «Netzwerk» is long (all neighbours); collapsed by default.
  const [networkOpen, setNetworkOpen] = useState(false);
  const [notifyTickets, setNotifyTickets] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [focused, setFocused] = useState(false);

  const load = useCallback(
    async (pull = false) => {
      if (!incidentId) return;
      if (pull) setRefreshing(true);
      try {
        const tenant = await loadCurrentTenant();
        setTenantId(tenant.id);
        setUserId(await currentUserId());
        setDetail(await loadIncident(tenant.id, incidentId));
        setError("");
        setNow(Date.now());
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Die Störung konnte nicht geladen werden.",
        );
      } finally {
        setRefreshing(false);
      }
    },
    [incidentId],
  );

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      if (!checkingSession) void load();
      return () => setFocused(false);
    }, [checkingSession, load]),
  );

  // Live while the screen is open and the app in the foreground.
  useAppActiveInterval(() => void load(), 30_000, focused && !checkingSession);
  useAppActiveInterval(() => setNow(Date.now()), 30_000, focused);

  async function run(key: string, action: () => Promise<IncidentDetail>) {
    setBusy(key);
    setError("");
    try {
      setDetail(await action());
      return true;
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Aktion ist fehlgeschlagen.",
      );
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (checkingSession || (!detail && !error)) {
    return (
      <ScreenContainer className="px-5">
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </ScreenContainer>
    );
  }

  const back = (
    <Pressable
      accessibilityRole="button"
      // Always back to the list of this tab: router.back() would return to the
      // tab visited before (e.g. Tickets after a push or the home screen).
      onPress={() => router.navigate("/incidents" as never)}
      style={styles.back}
    >
      <Ionicons color={colors.primaryText} name="arrow-back" size={18} />
      <Text style={styles.backText}>Störungen</Text>
    </Pressable>
  );

  if (!detail || !tenantId) {
    return (
      <ScreenContainer className="px-5">
        <View style={styles.content}>
          {back}
          <View style={styles.errorCard}>
            <Ionicons
              color={colors.error}
              name="alert-circle-outline"
              size={19}
            />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        </View>
      </ScreenContainer>
    );
  }

  const minutes = liveMinutes(detail.openedAt, detail.resolvedAt, now);
  const canChange = detail.state !== "closed";
  const showCauseForm = detail.state !== "closed" || !detail.cause;
  // Provider issue (Microsoft 365, GitHub, …): nothing to confirm or assign.
  const external = detail.source === "external";
  const provider = detail.externalProvider ?? "der Anbieter";
  const assigned = detail.agents.find((a) => a.id === detail.assignedAgentId);
  const openTickets = detail.tickets.filter((ticket) => !ticket.closed);
  const neighbourDot = (entry: IncidentNeighbour) =>
    entry.state === "down"
      ? styles.sevBad
      : entry.state === "warning"
        ? styles.sevWarn
        : entry.state === "ok"
          ? styles.sevOk
          : { backgroundColor: colors.subtle };

  return (
    <ScreenContainer className="px-5">
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            onRefresh={() => void load(true)}
            refreshing={refreshing}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {back}
        <View style={{ gap: 8 }}>
          <View style={styles.badgeRow}>
            <Text style={styles.number}>{detail.number}</Text>
            {detail.state === "active" ? (
              <Text
                style={[
                  styles.badge,
                  detail.severity === "warning"
                    ? styles.badgeWarn
                    : styles.badgeBad,
                ]}
              >
                {detail.severity === "warning" ? "Warnung" : "Ausfall"} ·{" "}
                {formatDuration(minutes)}
              </Text>
            ) : (
              <Text style={[styles.badge, styles.badgeOk]}>
                {STATE_LABELS[detail.state]} · Dauer {formatDuration(minutes)}
              </Text>
            )}
            {detail.maintenance ? (
              <Text style={styles.badge}>Wartung</Text>
            ) : null}
            {detail.source === "external" ? (
              <Text style={styles.badge}>
                Extern
                {detail.externalProvider ? ` · ${detail.externalProvider}` : ""}
              </Text>
            ) : null}
          </View>
          <Text style={styles.titleSmall}>{detail.title}</Text>
          {detail.source === "external" ? (
            <View style={{ gap: 4 }}>
              <Text style={styles.muted}>
                {tn(`Gemeldet von ${detail.externalProvider ?? "einem Anbieter"}: Die Ursache liegt beim Anbieter, nicht in deinem Netz. Die Störung schliesst sich automatisch, sobald der Anbieter sie als behoben meldet.`, `Gemeldet von ${detail.externalProvider ?? "einem Anbieter"}: Die Ursache liegt beim Anbieter, nicht in Ihrem Netz. Die Störung schliesst sich automatisch, sobald der Anbieter sie als behoben meldet.`)}
              </Text>
              {detail.externalUrl ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => void Linking.openURL(detail.externalUrl!)}
                >
                  <Text style={styles.backText}>
                    Statusseite des Anbieters öffnen
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {detail.parent ? (
            <Pressable
              onPress={() =>
                router.push(`/incidents/${detail.parent!.id}` as never)
              }
            >
              <Text style={styles.backText}>
                Folgestörung von {detail.parent.number}
              </Text>
            </Pressable>
          ) : null}
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

        {canChange && !external && !detail.acknowledgedAt ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy !== null}
            onPress={() =>
              void run("ack", () => acknowledgeIncident(tenantId, detail.id))
            }
            style={[styles.button, busy ? styles.buttonDisabled : null]}
          >
            {busy === "ack" ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Ionicons
                color={colors.onPrimary}
                name="checkmark-circle"
                size={18}
              />
            )}
            <Text style={styles.buttonText}>Bestätigen: ich kümmere mich</Text>
          </Pressable>
        ) : null}

        {!external ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Zuständig</Text>
            <Text style={styles.kvValue}>
              {assigned?.name ?? "Nicht zugewiesen"}
            </Text>
            {detail.acknowledgedAt ? (
              <Text style={styles.muted}>
                Bestätigt von {detail.acknowledgedBy ?? "–"},{" "}
                {DATE_TIME.format(new Date(detail.acknowledgedAt))}
              </Text>
            ) : null}
            {canChange ? (
              <View style={styles.badgeRow}>
                {userId &&
                detail.assignedAgentId !== userId &&
                detail.agents.some((a) => a.id === userId) ? (
                  <Pressable
                    disabled={busy !== null}
                    onPress={() =>
                      void run("assign", () =>
                        assignIncident(tenantId, detail.id, userId),
                      )
                    }
                    style={[styles.button, styles.buttonSecondary]}
                  >
                    <Text style={styles.buttonSecondaryText}>Mir zuweisen</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  disabled={busy !== null}
                  onPress={() => setPickAgent((value) => !value)}
                  style={[styles.button, styles.buttonSecondary]}
                >
                  <Text style={styles.buttonSecondaryText}>Ändern</Text>
                </Pressable>
              </View>
            ) : null}
            {pickAgent && canChange ? (
              <View style={styles.list}>
                {[{ id: "", name: "Nicht zugewiesen" }, ...detail.agents].map(
                  (agent) => {
                    const selected =
                      (detail.assignedAgentId ?? "") === agent.id;
                    return (
                      <Pressable
                        key={agent.id || "none"}
                        onPress={() => {
                          setPickAgent(false);
                          void run("assign", () =>
                            assignIncident(
                              tenantId,
                              detail.id,
                              agent.id || null,
                            ),
                          );
                        }}
                        style={[
                          styles.option,
                          selected ? styles.optionActive : null,
                        ]}
                      >
                        <Text style={styles.optionText}>{agent.name}</Text>
                        {selected ? (
                          <Ionicons
                            color={colors.primaryText}
                            name="checkmark"
                            size={18}
                          />
                        ) : null}
                      </Pressable>
                    );
                  },
                )}
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Verlauf</Text>
          {detail.events.map((event) => {
            const tone = eventTone(event.kind, event.status);
            return (
              <View key={event.id} style={styles.event}>
                <Text style={styles.eventTime}>
                  {TIME.format(new Date(event.at))}
                </Text>
                <View
                  style={[
                    styles.eventDot,
                    tone === "bad"
                      ? styles.sevBad
                      : tone === "warn"
                        ? styles.sevWarn
                        : tone === "ok"
                          ? styles.sevOk
                          : { backgroundColor: colors.primary },
                  ]}
                />
                <Text style={styles.eventBody}>
                  <Text style={{ fontWeight: "800" }}>
                    {event.kind === "prtg"
                      ? `${event.sensor ?? "PRTG"}: ${event.status ?? ""}`
                      : (EVENT_LABELS[event.kind] ?? event.kind)}
                  </Text>
                  {event.message ? ` · ${event.message}` : ""}
                  {event.actor ? ` · ${event.actor}` : ""}
                </Text>
              </View>
            );
          })}
          {canChange ? (
            <View style={{ gap: 8 }}>
              <TextInput
                accessibilityLabel="Notiz"
                maxLength={4000}
                multiline
                onChangeText={setNote}
                placeholder="Notiz zum Verlauf hinzufügen …"
                placeholderTextColor={colors.subtle}
                style={styles.input}
                value={note}
              />
              <Pressable
                disabled={busy !== null || !note.trim()}
                onPress={async () => {
                  const ok = await run("note", () =>
                    addIncidentNote(tenantId, detail.id, note.trim()),
                  );
                  if (ok) setNote("");
                }}
                style={[
                  styles.button,
                  styles.buttonSecondary,
                  !note.trim() ? styles.buttonDisabled : null,
                ]}
              >
                <Text style={styles.buttonSecondaryText}>Notiz hinzufügen</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {detail.sensors.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sensoren</Text>
            {detail.sensors.map((sensor, index) => (
              <View key={`${sensor.name}-${index}`} style={{ gap: 4 }}>
                <SensorStatusBadge sensor={sensor} />
                <Text style={styles.kvValue}>
                  <Text style={{ fontWeight: "800" }}>{sensor.name}</Text>
                  {sensor.message ? ` · ${sensor.message}` : ""}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {detail.device ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Gerät</Text>
            {[
              ["Name", detail.device.name ?? detail.deviceName],
              [
                "Typ",
                [
                  detail.device.category,
                  [detail.device.manufacturer, detail.device.model]
                    .filter(Boolean)
                    .join(" "),
                ]
                  .filter(Boolean)
                  .join(" · "),
              ],
              ["Ort", detail.device.location],
              [
                "Adresse",
                [detail.device.hostname, detail.device.ipAddress]
                  .filter(Boolean)
                  .join(" · "),
              ],
            ]
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <View key={label} style={styles.kv}>
                  <Text style={styles.kvLabel}>{label}</Text>
                  <Text style={styles.kvValue}>{value}</Text>
                </View>
              ))}
          </View>
        ) : null}

        {detail.tickets.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Tickets</Text>
            {detail.tickets.map((ticket) => (
              <View key={ticket.id} style={styles.kv}>
                <View
                  style={[
                    styles.eventDot,
                    ticket.closed ? styles.sevOk : styles.sevWarn,
                  ]}
                />
                <Text style={styles.kvValue}>
                  <Text style={{ fontWeight: "800" }}>{ticket.number}</Text>
                  {` · ${ticket.subject}`}
                  {` · ${ticket.status || "–"} · ${TICKET_SOURCE_LABELS[ticket.source]}`}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {detail.network &&
        (detail.network.addresses.length ||
          detail.network.subnetNeighbours.length ||
          detail.network.switchNeighbours.length) ? (
          <View style={styles.card}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: networkOpen }}
              onPress={() => setNetworkOpen((value) => !value)}
              style={{
                alignItems: "center",
                flexDirection: "row",
                gap: 8,
                justifyContent: "space-between",
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.cardTitle}>Netzwerk</Text>
                {!networkOpen ? (
                  <Text numberOfLines={1} style={styles.muted}>
                    {[
                      detail.network.addresses
                        .map((address) => address.address)
                        .filter(Boolean)
                        .join(", "),
                      detail.network.subnetNeighbours.length +
                      detail.network.switchNeighbours.length
                        ? `${detail.network.subnetNeighbours.length + detail.network.switchNeighbours.length} Nachbarn`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                ) : null}
              </View>
              <Ionicons
                color={colors.subtle}
                name={networkOpen ? "chevron-up" : "chevron-down"}
                size={20}
              />
            </Pressable>
            {networkOpen ? (
              <>
                {detail.network.addresses.map((address, index) =>
                  [
                    ["IP", address.address],
                    [
                      "Subnetz",
                      address.prefix
                        ? `${address.prefix}${address.gateway ? ` · GW ${address.gateway}` : ""}`
                        : null,
                    ],
                    [
                      "VLAN",
                      address.vlanNumber !== null
                        ? `${address.vlanNumber}${address.vlanName ? ` · ${address.vlanName}` : ""}`
                        : null,
                    ],
                    ["Standort", address.site],
                    [
                      "Switch-Port",
                      address.switchName
                        ? `${address.switchName}${address.switchPort ? ` · ${address.switchPort}` : ""}`
                        : null,
                    ],
                  ]
                    .filter(([, value]) => value)
                    .map(([label, value]) => (
                      <View key={`${index}-${label}`} style={styles.kv}>
                        <Text style={styles.kvLabel}>{label}</Text>
                        <Text style={styles.kvValue}>{value}</Text>
                      </View>
                    )),
                )}
                {[
                  ["Im selben Subnetz", detail.network.subnetNeighbours],
                  ["Am selben Switch", detail.network.switchNeighbours],
                ].map(([label, entries]) =>
                  (entries as IncidentNeighbour[]).length ? (
                    <View key={label as string} style={{ gap: 6 }}>
                      <Text style={styles.muted}>{label as string}</Text>
                      {(entries as IncidentNeighbour[]).map((entry, index) => (
                        <Pressable
                          disabled={!entry.incidentId}
                          key={`${entry.assetId ?? entry.name}-${index}`}
                          onPress={() =>
                            entry.incidentId
                              ? router.push(
                                  `/incidents/${entry.incidentId}` as never,
                                )
                              : undefined
                          }
                          style={styles.kv}
                        >
                          <View
                            style={[styles.eventDot, neighbourDot(entry)]}
                          />
                          <Text style={styles.kvValue}>
                            {entry.name}
                            {entry.port ? ` · ${entry.port}` : ""}
                            {entry.address ? ` · ${entry.address}` : ""}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null,
                )}
              </>
            ) : null}
          </View>
        ) : null}

        {detail.dependencies.upstream.length || detail.children.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Abhängigkeiten</Text>
            {detail.dependencies.upstream.map((node) => (
              <View key={node.assetId} style={styles.kv}>
                <View
                  style={[
                    styles.eventDot,
                    node.failing ? styles.sevBad : styles.sevOk,
                  ]}
                />
                <Text style={styles.kvValue}>{node.name} (vorgelagert)</Text>
              </View>
            ))}
            {detail.children.map((child) => (
              <Pressable
                key={child.id}
                onPress={() => router.push(`/incidents/${child.id}` as never)}
                style={styles.kv}
              >
                <View style={[styles.eventDot, severityStyle(styles, child)]} />
                <Text style={styles.kvValue}>
                  {child.deviceName ?? child.title} (Folgestörung)
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {detail.services.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Betroffene Dienste</Text>
            <View style={styles.badgeRow}>
              {detail.services.map((service) => (
                <Text
                  key={service.id}
                  style={[
                    styles.badge,
                    service.status === "operational"
                      ? styles.badgeOk
                      : styles.badgeWarn,
                  ]}
                >
                  {service.name}
                </Text>
              ))}
            </View>
          </View>
        ) : null}

        {detail.state === "closed" ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Abgeschlossen</Text>
            <View style={styles.kv}>
              <Text style={styles.kvLabel}>Von</Text>
              <Text style={styles.kvValue}>
                {detail.closedBy ?? "automatisch (PRTG meldet OK)"}
                {detail.closedAt
                  ? `, ${DATE_TIME.format(new Date(detail.closedAt))}`
                  : ""}
              </Text>
            </View>
            {detail.cause ? (
              <View style={styles.kv}>
                <Text style={styles.kvLabel}>Ursache</Text>
                <Text style={styles.kvValue}>{CAUSE_LABELS[detail.cause]}</Text>
              </View>
            ) : null}
            {detail.closingNote ? (
              <Text style={styles.muted}>{detail.closingNote}</Text>
            ) : null}
          </View>
        ) : null}

        {showCauseForm ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {detail.state === "closed"
                ? "Ursache nachtragen (optional)"
                : external
                  ? "Von Hand abschliessen (optional)"
                  : "Abschliessen"}
            </Text>
            {detail.state === "active" && external ? (
              <Text style={styles.muted}>
                Schliesst sich automatisch, sobald {provider} die Störung als
                behoben meldet. Von Hand abschliessen ist nur nötig, wenn die
                Meldung beim Anbieter hängen bleibt.
              </Text>
            ) : detail.state === "active" ? (
              <Text style={styles.muted}>
                Meldet PRTG wieder OK, schliesst sich die Störung automatisch.
                Abschliessen beendet sie auch ohne OK-Meldung.
              </Text>
            ) : detail.state === "resolved" ? (
              <Text style={styles.muted}>
                {tn("PRTG meldet wieder OK. Trage die Ursache bei Bedarf nach.", "PRTG meldet wieder OK. Tragen Sie die Ursache bei Bedarf nach.")}
              </Text>
            ) : null}
            <View style={styles.badgeRow}>
              {CAUSES.map((entry) => {
                const selected = cause === entry;
                return (
                  <Pressable
                    key={entry}
                    onPress={() => setCause(entry)}
                    style={[styles.chip, selected ? styles.chipActive : null]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        selected ? styles.chipTextActive : null,
                      ]}
                    >
                      {CAUSE_LABELS[entry]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              accessibilityLabel="Notiz zum Abschluss"
              maxLength={4000}
              multiline
              onChangeText={setClosingNote}
              placeholder="Lösung / Notiz (optional)"
              placeholderTextColor={colors.subtle}
              style={styles.input}
              value={closingNote}
            />
            {openTickets.length ? (
              <View style={styles.kv}>
                <Switch
                  accessibilityLabel="Tickets informieren"
                  onValueChange={setNotifyTickets}
                  value={notifyTickets}
                />
                <Text style={styles.kvValue}>
                  {openTickets.length === 1
                    ? "Offenes Ticket informieren (Antwort mit Ursache) und auf «Gelöst» setzen"
                    : `${openTickets.length} offene Tickets informieren (Antwort mit Ursache) und auf «Gelöst» setzen`}
                </Text>
              </View>
            ) : null}
            <Pressable
              disabled={busy !== null || !cause}
              onPress={() =>
                cause
                  ? void run("close", () =>
                      closeIncident(
                        tenantId,
                        detail.id,
                        cause,
                        closingNote.trim() || null,
                        notifyTickets && openTickets.length > 0,
                      ),
                    )
                  : undefined
              }
              style={[styles.button, !cause ? styles.buttonDisabled : null]}
            >
              <Text style={styles.buttonText}>
                {detail.state === "closed"
                  ? "Ursache speichern"
                  : "Störung abschliessen"}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}
