import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import { useIncidentStyles } from "@/components/incident-styles";
import { ScreenContainer } from "@/components/screen-container";
import { currentUserId } from "@/lib/incidents";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import {
  askReportersClicked,
  assignSecurityCase,
  AUTH_LABELS,
  authTone,
  closeSecurityCase,
  listCaseAgents,
  loadSecurityCase,
  RISK_LABELS,
  setSecurityVerdict,
  STATE_LABELS,
  toggleSecurityAction,
  VERDICT_LABELS,
  VERDICTS,
  type SecurityCaseDetail,
  type SecurityVerdict,
  INDICATOR_LABELS,
} from "@/lib/security-cases";
import { useAppColors } from "@/lib/themed-styles";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";
import { tn } from "@/lib/formality";

const DATE_TIME = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Zurich",
});
const when = (value: string | null) =>
  value ? DATE_TIME.format(new Date(value)) : "–";

const CHANNEL_LABELS: Record<string, string> = {
  email: "Outlook / E-Mail",
  portal: "Portal",
  mobile: "App",
};

export default function PhishingCaseScreen() {
  const router = useRouter();
  const styles = useIncidentStyles();
  const colors = useAppColors();
  const checkingSession = useMobileSessionGuard();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ticketId = typeof id === "string" ? id : "";
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SecurityCaseDetail | null>(null);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pickAgent, setPickAgent] = useState(false);

  const load = useCallback(
    async (pull = false) => {
      if (!ticketId) return;
      if (pull) setRefreshing(true);
      try {
        const tenant = await loadCurrentTenant();
        setTenantId(tenant.id);
        setUserId(await currentUserId());
        const [result, caseAgents] = await Promise.all([
          loadSecurityCase(tenant.id, ticketId),
          listCaseAgents(tenant.id, ticketId).catch(() => []),
        ]);
        setDetail(result.detail);
        setAgents(caseAgents);
        setError("");
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Der Fall konnte nicht geladen werden.",
        );
      } finally {
        setRefreshing(false);
      }
    },
    [ticketId],
  );

  useFocusEffect(
    useCallback(() => {
      if (!checkingSession) void load();
    }, [checkingSession, load]),
  );

  async function run(
    key: string,
    action: () => Promise<{
      detail: SecurityCaseDetail;
      data: Record<string, unknown>;
    }>,
    message?: (data: Record<string, unknown>) => string,
  ) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const result = await action();
      setDetail(result.detail);
      if (message) setNotice(message(result.data));
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Aktion ist fehlgeschlagen.",
      );
    } finally {
      setBusy(null);
    }
  }

  function decide(verdict: SecurityVerdict) {
    if (!tenantId || !detail) return;
    Alert.alert(
      `Urteil: ${VERDICT_LABELS[verdict]}`,
      "Alle Melder erhalten danach automatisch eine E-Mail mit dem Ergebnis.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Bestätigen",
          onPress: () =>
            void run(
              `verdict:${verdict}`,
              () => setSecurityVerdict(tenantId, detail.ticketId, verdict),
              (data) => {
                const notified = Number(data.notified ?? 0);
                return notified
                  ? `Urteil gespeichert. Das Ergebnis geht an ${notified} ${notified === 1 ? "Person" : "Personen"}.`
                  : "Urteil gespeichert.";
              },
            ),
        },
      ],
    );
  }

  async function assign(agentId: string | null) {
    if (!tenantId || !detail) return;
    setPickAgent(false);
    setBusy("assign");
    setError("");
    try {
      await assignSecurityCase(tenantId, detail.ticketId, agentId);
      setNotice(agentId ? "Fall zugewiesen." : "Zuweisung entfernt.");
      setDetail((await loadSecurityCase(tenantId, detail.ticketId)).detail);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Der Fall konnte nicht zugewiesen werden.",
      );
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
      onPress={() => router.navigate("/phishing" as never)}
      style={styles.back}
    >
      <Ionicons color={colors.primaryText} name="arrow-back" size={18} />
      <Text style={styles.backText}>Phishing</Text>
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

  const analysis = detail.analysis;
  const open = detail.state !== "closed";
  const doneCount = detail.actions.filter((entry) => entry.doneAt).length;
  const assignedName =
    agents.find((agent) => agent.id === detail.assignedAgentId)?.name ??
    detail.assignedAgentName;

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
        {back}
        <View style={{ gap: 8 }}>
          <View style={styles.badgeRow}>
            {detail.ticketNumber ? (
              <Text style={styles.number}>{detail.ticketNumber}</Text>
            ) : null}
            <Text
              style={[
                styles.badge,
                detail.state === "triage"
                  ? styles.badgeBad
                  : detail.state === "actions"
                    ? styles.badgeWarn
                    : styles.badgeOk,
              ]}
            >
              {STATE_LABELS[detail.state]}
            </Text>
            <Text
              style={[
                styles.badge,
                analysis.level === "high"
                  ? styles.badgeBad
                  : analysis.level === "medium"
                    ? styles.badgeWarn
                    : styles.badgeOk,
              ]}
            >
              Risiko {RISK_LABELS[analysis.level]} ({analysis.score}/100)
            </Text>
            {detail.verdict ? (
              <Text style={styles.badge}>{VERDICT_LABELS[detail.verdict]}</Text>
            ) : null}
          </View>
          <Text style={styles.titleSmall}>
            {detail.subject ?? analysis.subject ?? "(ohne Betreff)"}
          </Text>
          {detail.state === "triage" && detail.decisionDueAt ? (
            <Text style={styles.muted}>
              Urteil bis {when(detail.decisionDueAt)}
            </Text>
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
        {notice ? (
          <View style={[styles.card, { gap: 4 }]}>
            <Text style={styles.kvValue}>{notice}</Text>
          </View>
        ) : null}

        {detail.clickedAt && open ? (
          <View style={styles.errorCard}>
            <Ionicons color={colors.error} name="warning-outline" size={19} />
            <Text style={styles.errorText}>
              {tn("Jemand hat geklickt. Sitzungen widerrufen, Passwort-Reset erzwingen und Gerät scannen kannst du im Web unter «Kontext und Massnahmen».", "Jemand hat geklickt. Sitzungen widerrufen, Passwort-Reset erzwingen und Gerät scannen können Sie im Web unter «Kontext und Massnahmen».")}
            </Text>
          </View>
        ) : null}
        {detail.escalatedAt && detail.state === "triage" ? (
          <View style={styles.errorCard}>
            <Ionicons color={colors.error} name="time-outline" size={19} />
            <Text style={styles.errorText}>
              Das Urteil ist seit über 24 Stunden überfällig; die Vorgesetzten
              wurden informiert.
            </Text>
          </View>
        ) : null}
        {detail.iocHits.length ? (
          <View style={[styles.card, { gap: 6 }]}>
            <Text style={styles.cardTitle}>Bekannte Indikatoren</Text>
            <Text style={styles.muted}>
              Diese Mail enthält Indikatoren aus früheren Fällen.
            </Text>
            {detail.iocHits.slice(0, 10).map((hit) => (
              <Text key={hit.id} style={styles.kvValue}>
                {INDICATOR_LABELS[hit.kind]}: {hit.value}
              </Text>
            ))}
          </View>
        ) : null}
        {detail.campaign &&
        (detail.campaign.caseCount > 1 || detail.campaign.reporters > 1) ? (
          <View style={[styles.card, { gap: 4 }]}>
            <Text style={styles.cardTitle}>Kampagne</Text>
            <Text style={styles.kvValue}>
              {detail.campaign.reports} Meldungen von{" "}
              {detail.campaign.reporters} Personen in{" "}
              {detail.campaign.caseCount}{" "}
              {detail.campaign.caseCount === 1 ? "Fall" : "Fällen"}
              {detail.campaign.senderDomain
                ? ` · Absender ${detail.campaign.senderDomain}`
                : ""}
            </Text>
          </View>
        ) : null}

        {detail.state === "triage" ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Urteil fällen</Text>
            <View style={styles.badgeRow}>
              {VERDICTS.map((entry) => (
                <Pressable
                  disabled={busy !== null}
                  key={entry}
                  onPress={() => decide(entry)}
                  style={[
                    styles.button,
                    entry === "harmless" ? styles.buttonSecondary : null,
                    busy ? styles.buttonDisabled : null,
                  ]}
                >
                  {busy === `verdict:${entry}` ? (
                    <ActivityIndicator
                      color={
                        entry === "harmless" ? colors.primary : colors.onPrimary
                      }
                    />
                  ) : null}
                  <Text
                    style={
                      entry === "harmless"
                        ? styles.buttonSecondaryText
                        : styles.buttonText
                    }
                  >
                    {VERDICT_LABELS[entry]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Zuständig</Text>
          <Text style={styles.kvValue}>
            {assignedName ?? "Nicht zugewiesen"}
          </Text>
          {open ? (
            <View style={styles.badgeRow}>
              {userId &&
              detail.assignedAgentId !== userId &&
              agents.some((agent) => agent.id === userId) ? (
                <Pressable
                  disabled={busy !== null}
                  onPress={() => void assign(userId)}
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
          {pickAgent && open ? (
            <View style={styles.list}>
              {[{ id: "", name: "Nicht zugewiesen" }, ...agents].map(
                (agent) => {
                  const selected = (detail.assignedAgentId ?? "") === agent.id;
                  return (
                    <Pressable
                      key={agent.id || "none"}
                      onPress={() => void assign(agent.id || null)}
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

        {detail.measures.length ? (
          <View style={[styles.card, { gap: 4 }]}>
            <Text style={styles.cardTitle}>Ausgeführte Massnahmen</Text>
            {detail.measures.slice(0, 10).map((entry) => (
              <Text key={entry.id} style={styles.muted}>
                <Ionicons
                  accessibilityLabel={
                    entry.status === "succeeded" ? "Erfolgreich" : "Fehlgeschlagen"
                  }
                  color={
                    entry.status === "succeeded" ? colors.success : colors.error
                  }
                  name={
                    entry.status === "succeeded"
                      ? "checkmark-circle-outline"
                      : "close-circle-outline"
                  }
                  size={14}
                />{" "}
                {entry.label}
                {entry.target ? ` · ${entry.target}` : ""} ·{" "}
                {when(entry.createdAt)}
              </Text>
            ))}
          </View>
        ) : null}

        {detail.actions.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Massnahmen ({doneCount}/{detail.actions.length})
            </Text>
            {detail.actions.map((entry) => {
              const done = Boolean(entry.doneAt);
              return (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: done }}
                  disabled={busy !== null || !open}
                  key={entry.id}
                  onPress={() =>
                    void run(`action:${entry.id}`, () =>
                      toggleSecurityAction(
                        tenantId,
                        detail.ticketId,
                        entry.id,
                        !done,
                      ),
                    )
                  }
                  style={styles.kv}
                >
                  <Ionicons
                    color={done ? colors.success : colors.subtle}
                    name={done ? "checkbox" : "square-outline"}
                    size={20}
                  />
                  <Text style={styles.kvValue}>
                    {entry.label}
                    {done && entry.doneBy ? ` · ${entry.doneBy}` : ""}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Melder ({detail.reporters.length})
          </Text>
          {detail.reporters.map((reporter, index) => (
            <View key={`${reporter.email ?? reporter.name}-${index}`}>
              <Text style={styles.kvValue}>
                <Text style={{ fontWeight: "800" }}>{reporter.name}</Text>
                {reporter.channel
                  ? ` · ${CHANNEL_LABELS[reporter.channel] ?? reporter.channel}`
                  : ""}
                {reporter.reportedAt ? ` · ${when(reporter.reportedAt)}` : ""}
              </Text>
              {reporter.answer ? (
                <Text
                  style={[
                    styles.badge,
                    reporter.answer === "yes"
                      ? styles.badgeBad
                      : styles.badgeOk,
                    { alignSelf: "flex-start", marginTop: 4 },
                  ]}
                >
                  {reporter.answer === "yes" ? "Geklickt" : "Nicht geklickt"}
                </Text>
              ) : reporter.asked ? (
                <Text style={styles.muted}>Gefragt, noch keine Antwort</Text>
              ) : null}
            </View>
          ))}
          {open && detail.verdict && detail.verdict !== "harmless" ? (
            <Pressable
              disabled={busy !== null}
              onPress={() =>
                void run(
                  "ask",
                  () => askReportersClicked(tenantId, detail.ticketId),
                  (data) => {
                    const asked = Number(data.asked ?? 0);
                    return asked
                      ? `Rückfrage an ${asked} ${asked === 1 ? "Person" : "Personen"} gesendet.`
                      : "Alle Melder wurden bereits gefragt.";
                  },
                )
              }
              style={[styles.button, styles.buttonSecondary]}
            >
              <Text style={styles.buttonSecondaryText}>
                Melder fragen: geklickt?
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Analyse</Text>
          {[
            [
              "Absender",
              [analysis.fromName, analysis.from].filter(Boolean).join(" · "),
            ],
            ["Antwort an", analysis.replyTo],
            ["Return-Path", analysis.returnPath],
            ["Sende-IP", analysis.sendingIp],
          ]
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <View key={label} style={styles.kv}>
                <Text style={styles.kvLabel}>{label}</Text>
                <Text style={styles.kvValue}>{value}</Text>
              </View>
            ))}
          <View style={styles.badgeRow}>
            {(["spf", "dkim", "dmarc"] as const).map((key) => {
              const value = analysis.auth[key];
              const tone = authTone(value);
              return (
                <Text
                  key={key}
                  style={[
                    styles.badge,
                    tone === "ok"
                      ? styles.badgeOk
                      : tone === "bad"
                        ? styles.badgeBad
                        : styles.badgeWarn,
                  ]}
                >
                  {key.toUpperCase()} {AUTH_LABELS[value] ?? value}
                </Text>
              );
            })}
          </View>
          {analysis.findings.map((finding, index) => (
            <Text key={index} style={styles.kvValue}>
              • {finding.message}
            </Text>
          ))}
          {analysis.links.length ? (
            <Text style={styles.muted}>
              Links (entschärft, nicht anklickbar):{"\n"}
              {analysis.links.map((link) => link.href).join("\n")}
            </Text>
          ) : null}
          {analysis.attachments.length ? (
            <Text style={styles.muted}>
              Anhänge:{" "}
              {analysis.attachments.map((file) => file.filename).join(", ")}
            </Text>
          ) : null}
        </View>

        {detail.state === "actions" ? (
          <Pressable
            disabled={busy !== null}
            onPress={() =>
              void run(
                "close",
                () => closeSecurityCase(tenantId, detail.ticketId),
                () => "Fall abgeschlossen.",
              )
            }
            style={[styles.button, busy ? styles.buttonDisabled : null]}
          >
            <Ionicons
              color={colors.onPrimary}
              name="checkmark-circle"
              size={18}
            />
            <Text style={styles.buttonText}>Fall abschliessen</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}
