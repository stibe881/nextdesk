import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { useMobileNetworkStatus } from "@/components/offline-status";
import {
  ProjectAccessDenied,
  ProjectBadges,
  ProjectErrorCard,
  ProjectOffline,
  ProjectProgress,
  useProjectStyles,
} from "@/components/project-parts";
import { ScreenContainer } from "@/components/screen-container";
import { tn } from "@/lib/formality";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import {
  filterProjects,
  isProjectAccessDenied,
  isProjectOpen,
  loadProjects,
  projectDateLabel,
  projectHref,
  projectProgressLabel,
  projectRangeLabel,
  projectRoleLabel,
  sortProjects,
  type MobileProject,
} from "@/lib/projects";
import { useAppColors } from "@/lib/themed-styles";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * «Projekte»: alle Projekte, an denen die Person beteiligt ist oder die sie
 * sehen darf, mit Status, Ampel und Fortschritt. Rechte prüft der Server
 * (Modul projects.management); ohne Zugriff erscheint ein Hinweis.
 */
export default function ProjectsScreen() {
  const router = useRouter();
  const styles = useProjectStyles();
  const colors = useAppColors();
  const checkingSession = useMobileSessionGuard();
  const { isOffline, recoveryEpoch } = useMobileNetworkStatus();
  const [projects, setProjects] = useState<MobileProject[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [query, setQuery] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);

  const load = useCallback(async (pull = false) => {
    setError("");
    if (pull) setRefreshing(true);
    try {
      const tenant = await loadCurrentTenant();
      setProjects(await loadProjects(tenant.id));
      setDenied(false);
    } catch (nextError) {
      if (isProjectAccessDenied(nextError)) {
        setDenied(true);
        setProjects(null);
      } else {
        setError(
          errorText(nextError, "Die Projekte konnten nicht geladen werden."),
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      if (!checkingSession) void load();
    }, [checkingSession, load, recoveryEpoch]),
  );

  const openCount = useMemo(
    () => (projects ?? []).filter(isProjectOpen).length,
    [projects],
  );
  const completedCount = (projects?.length ?? 0) - openCount;
  const visible = useMemo(
    () =>
      sortProjects(
        filterProjects(
          (projects ?? []).filter(
            (project) => isProjectOpen(project) !== showCompleted,
          ),
          query,
        ),
      ),
    [projects, query, showCompleted],
  );

  if (checkingSession || (loading && !projects && !denied)) {
    return (
      <ScreenContainer className="px-5">
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </ScreenContainer>
    );
  }

  const renderProject = (project: MobileProject) => {
    const range = projectRangeLabel(project.startsOn, project.endsOn);
    const meta = [
      project.managerName ? `Leitung: ${project.managerName}` : null,
      range,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <Pressable
        accessibilityRole="button"
        key={project.id}
        onPress={() => {
          const href = projectHref(project.id);
          if (href) router.push(href as never);
        }}
        style={styles.card}
      >
        <View style={styles.cardHead}>
          <Text numberOfLines={2} style={styles.cardTitle}>
            {project.title}
          </Text>
          <Ionicons color={colors.subtle} name="chevron-forward" size={18} />
        </View>
        <ProjectBadges health={project.health} status={project.status} />
        <ProjectProgress
          label={projectProgressLabel(project)}
          percent={project.progressPercent}
        />
        <Text numberOfLines={2} style={styles.cardMeta}>
          {[project.number, projectRoleLabel(project.role), meta]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        {project.overdueTasks > 0 ? (
          <Text style={[styles.cardMeta, styles.overdue]}>
            {project.overdueTasks === 1
              ? "1 Aufgabe überfällig"
              : `${project.overdueTasks} Aufgaben überfällig`}
          </Text>
        ) : project.nextMilestone ? (
          <Text numberOfLines={1} style={styles.cardMeta}>
            {`Nächster Meilenstein: ${project.nextMilestone.title} (${projectDateLabel(project.nextMilestone.on)})`}
          </Text>
        ) : null}
      </Pressable>
    );
  };

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
        <Pressable
          accessibilityLabel="Zurück"
          accessibilityRole="button"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/")
          }
          style={styles.back}
        >
          <Ionicons color={colors.primaryText} name="chevron-back" size={20} />
          <Text style={styles.backText}>Zurück</Text>
        </Pressable>
        <View>
          <Text style={styles.eyebrow}>PLANUNG</Text>
          <Text style={styles.title}>Projekte</Text>
          {projects ? (
            <Text style={styles.subtitle}>
              {`${openCount} laufend · ${completedCount} abgeschlossen`}
            </Text>
          ) : null}
        </View>

        {denied ? (
          <ProjectAccessDenied />
        ) : !projects && isOffline ? (
          <ProjectOffline />
        ) : (
          <>
            {error ? <ProjectErrorCard message={error} /> : null}
            {projects ? (
              <>
                <View style={styles.searchRow}>
                  <Ionicons
                    color={colors.subtle}
                    name="search-outline"
                    size={19}
                  />
                  <TextInput
                    accessibilityLabel="Projekte durchsuchen"
                    autoCapitalize="none"
                    autoCorrect={false}
                    clearButtonMode="while-editing"
                    maxLength={100}
                    onChangeText={setQuery}
                    placeholder="Titel, Nummer oder Projektleitung"
                    placeholderTextColor={colors.subtle}
                    returnKeyType="search"
                    style={styles.searchInput}
                    value={query}
                  />
                </View>
                <View style={styles.chipRow}>
                  {(
                    [
                      [false, "Laufend"],
                      [true, "Abgeschlossen"],
                    ] as const
                  ).map(([value, label]) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: showCompleted === value }}
                      key={label}
                      onPress={() => setShowCompleted(value)}
                      style={[
                        styles.chip,
                        showCompleted === value ? styles.chipActive : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          showCompleted === value
                            ? styles.chipTextActive
                            : null,
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {visible.length ? (
                  <View style={styles.group}>{visible.map(renderProject)}</View>
                ) : (
                  <View style={styles.stateCard}>
                    <Ionicons
                      color={colors.primaryText}
                      name="albums-outline"
                      size={28}
                    />
                    <Text style={styles.stateTitle}>
                      {query.trim()
                        ? "Keine Treffer"
                        : showCompleted
                          ? "Keine abgeschlossenen Projekte"
                          : "Keine laufenden Projekte"}
                    </Text>
                    <Text style={styles.stateText}>
                      {query.trim()
                        ? tn(
                            "Prüfe die Schreibweise oder suche nach einem Teil des Titels.",
                            "Prüfen Sie die Schreibweise oder suchen Sie nach einem Teil des Titels.",
                          )
                        : tn(
                            "Projekte legst du in der Web-App unter «Projekte» an. Hier siehst du alle, an denen du beteiligt bist.",
                            "Projekte legen Sie in der Web-App unter «Projekte» an. Hier sehen Sie alle, an denen Sie beteiligt sind.",
                          )}
                    </Text>
                  </View>
                )}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
