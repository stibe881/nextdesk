import { router } from "expo-router";
import { useEffect, useState } from "react";

import {
  Choice,
  CreateScreen,
  Field,
  FormCard,
  FormMessage,
  LoadingBlock,
  SubmitButton,
} from "@/components/create-form";
import { hapticError, hapticSuccess } from "@/lib/mobile-haptics";
import { getMobileUserId, loadCurrentTenant } from "@/lib/nextdesk-client";
import {
  createMobileServiceTask,
  loadServiceTaskSetup,
  type ServiceTaskRepeat,
  type ServiceTaskSetup,
} from "@/lib/quick-create";

type Start = "today" | "tomorrow" | "nextWeek";

function startDate(today: string, start: Start): string {
  const date = new Date(`${today}T12:00:00Z`);
  if (start === "tomorrow") date.setUTCDate(date.getUTCDate() + 1);
  if (start === "nextWeek") date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString().slice(0, 10);
}

export default function NewServiceTaskScreen() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [setup, setSetup] = useState<ServiceTaskSetup | null>(null);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [repeat, setRepeat] = useState<ServiceTaskRepeat>("monthly");
  const [start, setStart] = useState<Start>("today");
  const [dueTime, setDueTime] = useState("16:00");
  const [assignToMe, setAssignToMe] = useState<"me" | "nobody">("me");
  const [departmentId, setDepartmentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [tenant, user] = await Promise.all([
          loadCurrentTenant(),
          getMobileUserId(),
        ]);
        const nextSetup = await loadServiceTaskSetup(tenant.id);
        if (!active) return;
        setTenantId(tenant.id);
        setUserId(user ?? null);
        setSetup(nextSetup);
        setDepartmentId(nextSetup.departments[0]?.id ?? "");
      } catch {
        if (active) {
          setError("Die Serviceaufgaben konnten nicht geladen werden.");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    if (!tenantId || !setup) return;
    if (!title.trim()) {
      setError("Bitte gib einen Titel ein.");
      return;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(dueTime)) {
      setError("Bitte gib die Uhrzeit als HH:MM ein, z. B. 16:00.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createMobileServiceTask({
        tenantId,
        title: title.trim(),
        instructions,
        repeat,
        startsOn: startDate(setup.today, start),
        dueTime,
        assigneeId: assignToMe === "me" ? userId : null,
        departmentId: departmentId || null,
      });
      hapticSuccess();
      router.replace("/");
    } catch (nextError) {
      hapticError();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Serviceaufgabe konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <CreateScreen
      heading="Neue Serviceaufgabe"
      intro="Wiederkehrende Wartung oder Kontrolle – nextDesk erzeugt die fälligen Aufgaben automatisch."
      title="Serviceaufgabe erfassen"
    >
      {!setup && !error ? (
        <LoadingBlock text="Formular wird geladen …" />
      ) : setup && !setup.canManage ? (
        <FormCard>
          <FormMessage
            text="Für das Erfassen von Serviceaufgaben fehlt dir die Berechtigung."
            tone="info"
          />
        </FormCard>
      ) : (
        <FormCard>
          <Field
            autoFocus
            label="Titel"
            maxLength={160}
            onChangeText={setTitle}
            placeholder="Zum Beispiel: Notstromaggregat prüfen"
            value={title}
          />
          <Field
            label="Anleitung (optional)"
            maxLength={4000}
            multiline
            onChangeText={setInstructions}
            placeholder="Was ist jeweils zu tun?"
            value={instructions}
          />
          <Choice
            label="Wiederholung"
            onChange={setRepeat}
            options={[
              { value: "daily", label: "Täglich (Werktage)" },
              { value: "weekly", label: "Wöchentlich" },
              { value: "monthly", label: "Monatlich" },
              { value: "yearly", label: "Jährlich" },
            ]}
            value={repeat}
          />
          <Choice
            label="Erstes Mal fällig"
            onChange={setStart}
            options={[
              { value: "today", label: "Heute" },
              { value: "tomorrow", label: "Morgen" },
              { value: "nextWeek", label: "In einer Woche" },
            ]}
            value={start}
          />
          <Field
            keyboardType="numbers-and-punctuation"
            label="Fällig um"
            maxLength={5}
            onChangeText={setDueTime}
            placeholder="16:00"
            value={dueTime}
          />
          <Choice
            label="Zuständig"
            onChange={setAssignToMe}
            options={[
              { value: "me", label: "Ich" },
              { value: "nobody", label: "Noch niemand" },
            ]}
            value={assignToMe}
          />
          {setup && setup.departments.length > 1 ? (
            <Choice
              label="Abteilung"
              onChange={setDepartmentId}
              options={setup.departments.map((department) => ({
                value: department.id,
                label: department.name,
              }))}
              value={departmentId}
            />
          ) : null}
          <FormMessage text={error} tone="error" />
          <SubmitButton
            busy={saving}
            busyLabel="Wird gespeichert …"
            disabled={!setup}
            label="Serviceaufgabe speichern"
            onPress={() => void save()}
          />
        </FormCard>
      )}
      {!setup && error ? (
        <FormCard>
          <FormMessage text={error} tone="error" />
        </FormCard>
      ) : null}
    </CreateScreen>
  );
}
