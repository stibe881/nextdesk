import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import {
  ProjectAccessDenied,
  ProjectBadges,
  ProjectComments,
  ProjectErrorCard,
  ProjectOffline,
  ProjectProgress,
  ProjectTaskStatusIcon,
  useProjectStyles,
} from "@/components/project-parts";
import { ScreenContainer } from "@/components/screen-container";
import { tn } from "@/lib/formality";
import {
  addProjectComment,
  isProjectTaskOverdue,
  myProjectTasks,
  projectDateLabel,
  projectProgressLabel,
  projectRangeLabel,
  projectRoleLabel,
  projectTaskHref,
  projectTaskMeta,
  projectTaskRows,
  projectToday,
  type MobileProjectTask,
} from "@/lib/projects";
import { useAppColors } from "@/lib/themed-styles";
import { routeUuid, useProjectDetail } from "@/lib/use-project-detail";

/**
 * Ein Projekt in der App: Eckdaten, eigene Aufgaben, ganzer Plan, Team und
 * Kommentare. Aufgaben öffnen ihre eigene Seite; Planung, Zeiten und
 * Dokumente bleiben in der Web-App.
 */
export default function ProjectScreen() {
  const { id: rawId } = useLocalSearchParams<{ id?: string }>();
  const projectId = routeUuid(rawId);
  const router = useRouter();
  const styles = useProjectStyles();
  const colors = useAppColors();
  const {
    checkingSession,
    data,
    denied,
    error,
    isOffline,
    load,
    loading,
    refreshing,
    tenantId,
    userId,
  } = useProjectDetail(projectId);
  const [scope, setScope] = useState<"mine" | "all">("mine");

  const today = projectToday();
  const mine = useMemo(
    () => myProjectTasks(data?.tasks ?? [], userId),
    [data, userId],
  );
  const rows = useMemo(() => projectTaskRows(data?.tasks ?? []), [data]);
  // Without own tasks the plan is the useful view.
  const activeScope = mine.length ? scope : "all";

  if (checkingSession || (loading && !data && !denied)) {
    return (
      <ScreenContainer className="px-5">
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </ScreenContainer>
    );
  }

  const openTask = (task: MobileProjectTask) => {
    const href = projectId ? projectTaskHref(projectId, task.id) : null;
    if (href) router.push(href as never);
  };

  const renderTask = (task: MobileProjectTask, depth: number) => {
    const overdue = isProjectTaskOverdue(task, today);
    const meta = projectTaskMeta(task, today);
    return (
      <Pressable
        accessibilityRole="button"
        key={task.id}
        onPress={() => openTask(task)}
        style={[
          styles.row,
          task.kind === "phase" ? styles.rowPhase : null,
          { paddingLeft: 14 + Math.min(depth, 3) * 16 },
        ]}
      >
        {task.kind === "phase" ? (
          <Ionicons color={colors.muted} name="folder-outline" size={19} />
        ) : task.kind === "milestone" ? (
          <Ionicons
            color={task.status === "done" ? colors.success : colors.warning}
            name="flag"
            size={19}
          />
        ) : (
          <ProjectTaskStatusIcon status={task.status} />
        )}
        <View style={styles.rowCopy}>
          <Text
            numberOfLines={2}
            style={[
              styles.rowTitle,
              task.status === "done" && task.kind !== "phase"
                ? styles.rowTitleDone
                : null,
            ]}
          >
            {task.title}
          </Text>
          {meta ? (
            <Text
              numberOfLines={1}
              style={[styles.rowMeta, overdue ? styles.overdue : null]}
            >
              {meta}
            </Text>
          ) : null}
        </View>
        <Ionicons color={colors.subtle} name="chevron-forward" size={17} />
      </Pressable>
    );
  };

  const project = data?.project ?? null;
  const range = project
    ? projectRangeLabel(project.startsOn, project.endsOn)
    : null;
  const info: [string, string | null][] = project
    ? [
        ["Projektleitung", project.managerName],
        ["Zeitraum", range],
        [
          "Nächster Meilenstein",
          project.nextMilestone
            ? `${project.nextMilestone.title} (${projectDateLabel(project.nextMilestone.on)})`
            : null,
        ],
        [tn("Deine Rolle", "Ihre Rolle"), projectRoleLabel(project.role)],
      ]
    : [];

  return (
    <ScreenContainer className="px-5">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
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
            accessibilityLabel="Zurück zu Projekte"
            accessibilityRole="button"
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace("/projects")
            }
            style={styles.back}
          >
            <Ionicons
              color={colors.primaryText}
              name="chevron-back"
              size={20}
            />
            <Text style={styles.backText}>Projekte</Text>
          </Pressable>

          {denied ? (
            <ProjectAccessDenied />
          ) : !data && isOffline ? (
            <ProjectOffline />
          ) : (
            <>
              {error ? <ProjectErrorCard message={error} /> : null}
              {project && data ? (
                <>
                  <View>
                    <Text style={styles.eyebrow}>
                      {project.number ? `PROJEKT ${project.number}` : "PROJEKT"}
                    </Text>
                    <Text selectable style={styles.title}>
                      {project.title}
                    </Text>
                  </View>

                  <View style={styles.card}>
                    <ProjectBadges
                      health={project.health}
                      status={project.status}
                    />
                    {project.healthNote && project.status !== "completed" ? (
                      <Text style={styles.cardMeta}>{project.healthNote}</Text>
                    ) : null}
                    <ProjectProgress
                      label={projectProgressLabel(project)}
                      percent={project.progressPercent}
                    />
                    {project.overdueTasks > 0 ? (
                      <Text style={[styles.cardMeta, styles.overdue]}>
                        {project.overdueTasks === 1
                          ? "1 Aufgabe überfällig"
                          : `${project.overdueTasks} Aufgaben überfällig`}
                      </Text>
                    ) : null}
                    {info.map(([label, value]) =>
                      value ? (
                        <View key={label} style={styles.infoRow}>
                          <Text style={styles.infoLabel}>{label}</Text>
                          <Text style={styles.infoValue}>{value}</Text>
                        </View>
                      ) : null,
                    )}
                  </View>

                  {project.description ? (
                    <View style={styles.group}>
                      <Text style={styles.eyebrow}>BESCHREIBUNG</Text>
                      <Text selectable style={styles.description}>
                        {project.description}
                      </Text>
                    </View>
                  ) : null}

                  <View style={styles.group}>
                    <Text style={styles.eyebrow}>AUFGABEN</Text>
                    {mine.length ? (
                      <View style={styles.chipRow}>
                        {(
                          [
                            ["mine", `Meine (${mine.length})`],
                            ["all", "Ganzer Plan"],
                          ] as const
                        ).map(([value, label]) => (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityState={{
                              selected: activeScope === value,
                            }}
                            key={value}
                            onPress={() => setScope(value)}
                            style={[
                              styles.chip,
                              activeScope === value ? styles.chipActive : null,
                            ]}
                          >
                            <Text
                              style={[
                                styles.chipText,
                                activeScope === value
                                  ? styles.chipTextActive
                                  : null,
                              ]}
                            >
                              {label}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    {activeScope === "mine" ? (
                      <View style={styles.list}>
                        {mine.map((task) => renderTask(task, 0))}
                      </View>
                    ) : rows.length ? (
                      <View style={styles.list}>
                        {rows.map((row) => renderTask(row.task, row.depth))}
                      </View>
                    ) : (
                      <Text style={styles.cardMeta}>
                        {tn(
                          "Der Plan ist noch leer. Phasen und Aufgaben legst du in der Web-App an.",
                          "Der Plan ist noch leer. Phasen und Aufgaben legen Sie in der Web-App an.",
                        )}
                      </Text>
                    )}
                  </View>

                  {data.members.length ? (
                    <View style={styles.group}>
                      <Text style={styles.eyebrow}>TEAM</Text>
                      <View style={styles.list}>
                        {data.members.map((member) => (
                          <View key={member.userId} style={styles.row}>
                            <Ionicons
                              color={colors.muted}
                              name="person-outline"
                              size={18}
                            />
                            <View style={styles.rowCopy}>
                              <Text numberOfLines={1} style={styles.rowTitle}>
                                {member.name ?? "Unbekannte Person"}
                              </Text>
                              <Text style={styles.rowMeta}>
                                {projectRoleLabel(member.role)}
                              </Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}

                  <ProjectComments
                    canComment={data.access.canComment}
                    comments={data.comments.filter(
                      (comment) => !comment.taskId,
                    )}
                    onSend={async (body) => {
                      if (!tenantId || !projectId) return;
                      await addProjectComment(tenantId, projectId, null, body);
                      await load();
                    }}
                  />
                </>
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
