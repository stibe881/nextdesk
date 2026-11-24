import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
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
  ProjectComments,
  ProjectErrorCard,
  ProjectOffline,
  ProjectTaskStatusIcon,
  useProjectStyles,
} from "@/components/project-parts";
import { ScreenContainer } from "@/components/screen-container";
import { tn } from "@/lib/formality";
import {
  addProjectComment,
  isProjectTaskOverdue,
  PROJECT_TASK_STATUSES,
  projectDateLabel,
  projectHref,
  projectPriorityLabel,
  projectTaskKindLabel,
  projectTaskStatusLabel,
  projectToday,
  setProjectChecklistItem,
  setProjectTaskStatus,
  type ProjectTaskStatus,
} from "@/lib/projects";
import { useAppColors } from "@/lib/themed-styles";
import { routeUuid, useProjectDetail } from "@/lib/use-project-detail";

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Eine Projektaufgabe (auch Ziel der Mitteilung «Projektaufgabe
 * zugewiesen»): Status setzen, Checkliste abhaken, kommentieren. Was die
 * Person darf, bestimmt ihre Projektrolle; der Server prüft jede Änderung.
 */
export default function ProjectTaskScreen() {
  const params = useLocalSearchParams<{ id?: string; taskId?: string }>();
  const projectId = routeUuid(params.id);
  const taskId = routeUuid(params.taskId);
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
    setData,
    setError,
    tenantId,
  } = useProjectDetail(projectId);
  const [saving, setSaving] = useState(false);

  if (checkingSession || (loading && !data && !denied)) {
    return (
      <ScreenContainer className="px-5">
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </ScreenContainer>
    );
  }

  const task = data?.tasks.find((entry) => entry.id === taskId) ?? null;
  const parent = task?.parentId
    ? (data?.tasks.find((entry) => entry.id === task.parentId) ?? null)
    : null;
  const canEdit = data?.access.canEdit === true;
  const today = projectToday();

  // Show the change at once; on failure reload the saved state.
  const changeStatus = async (status: ProjectTaskStatus) => {
    if (!tenantId || !task || !data || saving || task.status === status) return;
    setSaving(true);
    setError("");
    setData({
      ...data,
      tasks: data.tasks.map((entry) =>
        entry.id === task.id ? { ...entry, status } : entry,
      ),
    });
    try {
      await setProjectTaskStatus(tenantId, task.id, status);
      await load();
    } catch (nextError) {
      await load();
      setError(
        errorText(nextError, "Der Status konnte nicht gespeichert werden."),
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleItem = async (itemId: string, done: boolean) => {
    if (!tenantId || !task || !data) return;
    setError("");
    setData({
      ...data,
      tasks: data.tasks.map((entry) =>
        entry.id === task.id
          ? {
              ...entry,
              checklist: entry.checklist.map((item) =>
                item.id === itemId ? { ...item, done } : item,
              ),
            }
          : entry,
      ),
    });
    try {
      await setProjectChecklistItem(tenantId, itemId, done);
    } catch (nextError) {
      await load();
      setError(
        errorText(nextError, "Der Punkt konnte nicht gespeichert werden."),
      );
    }
  };

  const overdue = task ? isProjectTaskOverdue(task, today) : false;
  const info: [string, string | null][] = task
    ? [
        ["Projekt", data?.project.title ?? null],
        ["Phase", parent?.title ?? null],
        ["Zugewiesen an", task.assigneeName ?? "Niemand"],
        ["Start", task.startsOn ? projectDateLabel(task.startsOn) : null],
        [
          task.kind === "milestone" ? "Termin" : "Fällig",
          task.dueOn ? projectDateLabel(task.dueOn) : null,
        ],
        [
          "Priorität",
          task.kind === "task" ? projectPriorityLabel(task.priority) : null,
        ],
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
            accessibilityLabel="Zurück zum Projekt"
            accessibilityRole="button"
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
                return;
              }
              // Opened from a notification: the project is the way back.
              const href = projectId ? projectHref(projectId) : null;
              router.replace((href ?? "/projects") as never);
            }}
            style={styles.back}
          >
            <Ionicons
              color={colors.primaryText}
              name="chevron-back"
              size={20}
            />
            <Text style={styles.backText}>Projekt</Text>
          </Pressable>

          {denied ? (
            <ProjectAccessDenied />
          ) : !data && isOffline ? (
            <ProjectOffline />
          ) : (
            <>
              {error ? <ProjectErrorCard message={error} /> : null}
              {data && !task ? (
                <View style={styles.stateCard}>
                  <Ionicons
                    color={colors.primaryText}
                    name="help-circle-outline"
                    size={28}
                  />
                  <Text style={styles.stateTitle}>Aufgabe nicht gefunden</Text>
                  <Text style={styles.stateText}>
                    {tn(
                      "Diese Aufgabe gibt es nicht mehr. Über «Projekt» siehst du den aktuellen Plan.",
                      "Diese Aufgabe gibt es nicht mehr. Über «Projekt» sehen Sie den aktuellen Plan.",
                    )}
                  </Text>
                </View>
              ) : null}
              {data && task ? (
                <>
                  <View>
                    <Text style={styles.eyebrow}>
                      {projectTaskKindLabel(task.kind).toUpperCase()}
                    </Text>
                    <Text selectable style={styles.title}>
                      {task.title}
                    </Text>
                  </View>

                  {task.kind !== "phase" ? (
                    <View style={styles.group}>
                      <Text style={styles.eyebrow}>STATUS</Text>
                      {canEdit ? (
                        <View style={styles.chipRow}>
                          {PROJECT_TASK_STATUSES.map((status) => (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityState={{
                                disabled: saving,
                                selected: task.status === status,
                              }}
                              disabled={saving}
                              key={status}
                              onPress={() => void changeStatus(status)}
                              style={[
                                styles.chip,
                                task.status === status
                                  ? styles.chipActive
                                  : null,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.chipText,
                                  task.status === status
                                    ? styles.chipTextActive
                                    : null,
                                ]}
                              >
                                {projectTaskStatusLabel(status)}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : (
                        <View style={styles.cardHead}>
                          <ProjectTaskStatusIcon status={task.status} />
                          <Text style={styles.cardTitle}>
                            {projectTaskStatusLabel(task.status)}
                          </Text>
                        </View>
                      )}
                    </View>
                  ) : null}

                  <View style={styles.card}>
                    {info.map(([label, value]) =>
                      value ? (
                        <View key={label} style={styles.infoRow}>
                          <Text style={styles.infoLabel}>{label}</Text>
                          <Text
                            style={[
                              styles.infoValue,
                              overdue &&
                              (label === "Fällig" || label === "Termin")
                                ? styles.overdue
                                : null,
                            ]}
                          >
                            {overdue &&
                            (label === "Fällig" || label === "Termin")
                              ? `${value} (überfällig)`
                              : value}
                          </Text>
                        </View>
                      ) : null,
                    )}
                  </View>

                  {task.description ? (
                    <View style={styles.group}>
                      <Text style={styles.eyebrow}>BESCHREIBUNG</Text>
                      <Text selectable style={styles.description}>
                        {task.description}
                      </Text>
                    </View>
                  ) : null}

                  {task.checklist.length ? (
                    <View style={styles.group}>
                      <Text style={styles.eyebrow}>
                        {`CHECKLISTE · ${task.checklist.filter((item) => item.done).length}/${task.checklist.length}`}
                      </Text>
                      <View style={styles.list}>
                        {task.checklist.map((item) => (
                          <Pressable
                            accessibilityLabel={item.description}
                            accessibilityRole="checkbox"
                            accessibilityState={{
                              checked: item.done,
                              disabled: !canEdit,
                            }}
                            disabled={!canEdit}
                            key={item.id}
                            onPress={() => void toggleItem(item.id, !item.done)}
                            style={styles.check}
                          >
                            <Ionicons
                              color={item.done ? colors.success : colors.subtle}
                              name={item.done ? "checkbox" : "square-outline"}
                              size={22}
                            />
                            <Text
                              style={[
                                styles.checkText,
                                item.done ? styles.checkDone : null,
                              ]}
                            >
                              {item.description}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ) : null}

                  <ProjectComments
                    canComment={data.access.canComment}
                    comments={data.comments.filter(
                      (comment) => comment.taskId === task.id,
                    )}
                    onSend={async (body) => {
                      if (!tenantId || !projectId) return;
                      await addProjectComment(
                        tenantId,
                        projectId,
                        task.id,
                        body,
                      );
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
