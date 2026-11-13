import { router } from "expo-router";
import { useEffect, useState } from "react";

import {
  Choice,
  CreateScreen,
  Field,
  FormCard,
  FormMessage,
  SubmitButton,
} from "@/components/create-form";
import { hapticError, hapticSuccess } from "@/lib/mobile-haptics";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import { createMobileFollowUp } from "@/lib/quick-create";
import { tn } from "@/lib/formality";

type Due = "today" | "tomorrow" | "threeDays" | "nextWeek" | "none";

const DUE_OPTIONS: { value: Due; label: string }[] = [
  { value: "today", label: "Heute 16:00" },
  { value: "tomorrow", label: "Morgen 08:00" },
  { value: "threeDays", label: "In 3 Tagen" },
  { value: "nextWeek", label: "In einer Woche" },
  { value: "none", label: "Ohne Termin" },
];

function dueAt(due: Due): string | null {
  const date = new Date();
  switch (due) {
    case "today":
      date.setHours(16, 0, 0, 0);
      break;
    case "tomorrow":
      date.setDate(date.getDate() + 1);
      date.setHours(8, 0, 0, 0);
      break;
    case "threeDays":
      date.setDate(date.getDate() + 3);
      date.setHours(8, 0, 0, 0);
      break;
    case "nextWeek":
      date.setDate(date.getDate() + 7);
      date.setHours(8, 0, 0, 0);
      break;
    case "none":
      return null;
  }
  return date.toISOString();
}

export default function NewFollowUpScreen() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [due, setDue] = useState<Due>("tomorrow");
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadCurrentTenant()
      .then((tenant) => setTenantId(tenant.id))
      .catch(() => setError("Der Arbeitsbereich konnte nicht geladen werden."));
  }, []);

  async function save() {
    if (!tenantId || !title.trim()) {
      setError("Bitte gib einen Titel ein.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createMobileFollowUp({
        tenantId,
        title: title.trim(),
        description,
        dueAt: dueAt(due),
        priority,
      });
      hapticSuccess();
      router.replace("/");
    } catch (nextError) {
      hapticError();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Wiedervorlage konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <CreateScreen
      heading={tn("Woran sollen wir dich erinnern?", "Woran sollen wir Sie erinnern?")}
      intro={tn("Die Wiedervorlage erscheint im Arbeitsplatz und erinnert dich zum gewählten Termin.", "Die Wiedervorlage erscheint im Arbeitsplatz und erinnert Sie zum gewählten Termin.")}
      title="Wiedervorlage erfassen"
    >
      <FormCard>
        <Field
          autoFocus
          label="Titel"
          maxLength={240}
          onChangeText={setTitle}
          placeholder="Zum Beispiel: Rückmeldung einholen"
          value={title}
        />
        <Field
          label="Notiz (optional)"
          maxLength={5000}
          multiline
          onChangeText={setDescription}
          placeholder="Was ist zu tun?"
          value={description}
        />
        <Choice
          label="Fällig"
          onChange={setDue}
          options={DUE_OPTIONS}
          value={due}
        />
        <Choice
          label="Priorität"
          onChange={setPriority}
          options={[
            { value: "low", label: "Tief" },
            { value: "normal", label: "Normal" },
            { value: "high", label: "Hoch" },
          ]}
          value={priority}
        />
        <FormMessage text={error} tone="error" />
        <SubmitButton
          busy={saving}
          busyLabel="Wird gespeichert …"
          disabled={!tenantId}
          label="Wiedervorlage speichern"
          onPress={() => void save()}
        />
      </FormCard>
    </CreateScreen>
  );
}
