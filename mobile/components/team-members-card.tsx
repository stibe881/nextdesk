import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  inviteTeamMember,
  isPersonalWorkspace,
  loadTeam,
  removeTeamMember,
  revokeTeamInvitation,
  type Team,
} from "@/lib/account";
import { getMobileUserId } from "@/lib/nextdesk-client";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

/**
 * Team management for personal workspaces: the owner invites colleagues by
 * e-mail. Organisation workspaces manage their people in the web app.
 */
export function TeamMembersCard({ tenantId }: { tenantId: string | null }) {
  const styles = useStyles();
  const colors = useAppColors();
  const [visible, setVisible] = useState(false);
  const [team, setTeam] = useState<Team | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [canWorkTickets, setCanWorkTickets] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!tenantId) {
      setVisible(false);
      return;
    }
    setLoading(true);
    try {
      if (!(await isPersonalWorkspace(tenantId))) {
        setVisible(false);
        return;
      }
      const [nextTeam, currentUserId] = await Promise.all([
        loadTeam(tenantId),
        getMobileUserId(),
      ]);
      setTeam(nextTeam);
      setUserId(currentUserId);
      setVisible(true);
    } catch {
      // Only workspace administrators can load the team.
      setVisible(false);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    // Deferred like the workspace gate: no synchronous state update in the
    // effect body.
    const timer = setTimeout(() => void reload(), 0);
    return () => clearTimeout(timer);
  }, [reload]);

  async function invite() {
    if (!tenantId || !team) return;
    const address = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      setError("Bitte gib eine gültige E-Mail-Adresse ein.");
      return;
    }
    const displayName = name.trim().replace(/\s+/g, " ");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await inviteTeamMember({
        tenantId,
        email: address,
        displayName: displayName.length >= 2 ? displayName : null,
        canWorkTickets,
        departmentId: team.defaultDepartmentId,
      });
      setEmail("");
      setName("");
      setMessage(`Einladung an ${address} wurde versendet.`);
      await reload();
    } catch (nextError) {
      setError(
        nextError instanceof Error && nextError.message
          ? nextError.message
          : "Die Einladung konnte nicht versendet werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  function confirmRemoval(memberId: string, label: string) {
    if (!tenantId) return;
    Alert.alert(
      "Teammitglied entfernen?",
      `${label} verliert den Zugriff auf diesen Arbeitsbereich.`,
      [
        { style: "cancel", text: "Abbrechen" },
        {
          style: "destructive",
          text: "Entfernen",
          onPress: () =>
            void (async () => {
              setBusy(true);
              setError("");
              try {
                await removeTeamMember(tenantId, memberId);
                await reload();
              } catch {
                setError("Das Teammitglied konnte nicht entfernt werden.");
              } finally {
                setBusy(false);
              }
            })(),
        },
      ],
    );
  }

  async function revoke(invitationId: string) {
    if (!tenantId) return;
    setBusy(true);
    setError("");
    try {
      await revokeTeamInvitation(tenantId, invitationId);
      await reload();
    } catch {
      setError("Die Einladung konnte nicht zurückgezogen werden.");
    } finally {
      setBusy(false);
    }
  }

  if (!visible) {
    return loading ? (
      <View style={styles.card}>
        <ActivityIndicator color={colors.primary} />
      </View>
    ) : null;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Team</Text>
      <Text style={styles.copy}>
        Lade Personen per E-Mail in deinen Arbeitsbereich ein, um gemeinsam an
        Tickets zu arbeiten.
      </Text>

      {team?.members.map((member) => {
        const label = member.displayName ?? member.email;
        const isSelf = member.id === userId;
        return (
          <View key={member.id} style={styles.row}>
            <Ionicons
              color={colors.primaryText}
              name="person-circle-outline"
              size={22}
            />
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>
                {label}
                {isSelf ? " (du)" : ""}
              </Text>
              <Text style={styles.rowMeta}>
                {member.isTenantAdmin
                  ? "Inhaber/in"
                  : member.isAgent
                    ? "Bearbeitet Tickets"
                    : "Erfasst Tickets"}
              </Text>
            </View>
            {!isSelf && !member.isTenantAdmin ? (
              <Pressable
                accessibilityLabel={`${label} entfernen`}
                accessibilityRole="button"
                disabled={busy}
                hitSlop={8}
                onPress={() => confirmRemoval(member.id, label)}
              >
                <Ionicons color={colors.error} name="close-circle" size={22} />
              </Pressable>
            ) : null}
          </View>
        );
      })}

      {team?.invitations.map((invitation) => (
        <View key={invitation.id} style={styles.row}>
          <Ionicons color={colors.subtle} name="mail-outline" size={20} />
          <View style={styles.rowCopy}>
            <Text style={styles.rowTitle}>{invitation.email}</Text>
            <Text style={styles.rowMeta}>Einladung offen</Text>
          </View>
          <Pressable
            accessibilityLabel={`Einladung an ${invitation.email} zurückziehen`}
            accessibilityRole="button"
            disabled={busy}
            hitSlop={8}
            onPress={() => void revoke(invitation.id)}
          >
            <Text style={styles.revoke}>Zurückziehen</Text>
          </Pressable>
        </View>
      ))}

      <View style={styles.form}>
        <TextInput
          accessibilityLabel="E-Mail-Adresse des Teammitglieds"
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          editable={!busy}
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="E-Mail-Adresse"
          placeholderTextColor={colors.subtle}
          style={styles.input}
          value={email}
        />
        <TextInput
          accessibilityLabel="Name des Teammitglieds (optional)"
          autoCapitalize="words"
          editable={!busy}
          onChangeText={setName}
          placeholder="Name (optional)"
          placeholderTextColor={colors.subtle}
          style={styles.input}
          value={name}
        />
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Darf Tickets bearbeiten</Text>
          <Switch
            accessibilityLabel="Darf Tickets bearbeiten"
            disabled={busy || !team?.defaultDepartmentId}
            onValueChange={setCanWorkTickets}
            value={canWorkTickets && Boolean(team?.defaultDepartmentId)}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={() => void invite()}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.pressed,
            busy && styles.disabled,
          ]}
        >
          <Text style={styles.buttonText}>
            {busy ? "Bitte warten …" : "Einladung senden"}
          </Text>
        </Pressable>
        {message ? <Text style={styles.success}>{message}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  card: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  title: { color: c.foreground, fontSize: 16, fontWeight: "900" },
  copy: { color: c.muted, fontSize: 13, lineHeight: 19 },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 44,
  },
  rowCopy: { flex: 1 },
  rowTitle: { color: c.foreground, fontSize: 14, fontWeight: "700" },
  rowMeta: { color: c.muted, fontSize: 12 },
  revoke: { color: c.error, fontSize: 13, fontWeight: "800" },
  form: { gap: 10, marginTop: 6 },
  input: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 12,
    borderWidth: 1,
    color: c.foreground,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  switchRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  switchLabel: { color: c.foreground, fontSize: 14 },
  button: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 13,
    justifyContent: "center",
    minHeight: 46,
  },
  buttonText: { color: c.onPrimary, fontSize: 14, fontWeight: "800" },
  success: { color: c.success, fontSize: 13 },
  error: { color: c.error, fontSize: 13 },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.55 },
}));
