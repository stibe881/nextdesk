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
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import {
  createMobileInventoryItem,
  loadInventorySetup,
  type InventorySetup,
} from "@/lib/quick-create";
import { tn } from "@/lib/formality";

function wholeNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,6}$/u.test(trimmed)) return null;
  return Number(trimmed);
}

export default function NewInventoryItemScreen() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [setup, setSetup] = useState<InventorySetup | null>(null);
  const [articleNumber, setArticleNumber] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("Stk");
  const [minimumStock, setMinimumStock] = useState("0");
  const [targetStock, setTargetStock] = useState("0");
  const [departmentId, setDepartmentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const tenant = await loadCurrentTenant();
        const nextSetup = await loadInventorySetup(tenant.id);
        if (!active) return;
        setTenantId(tenant.id);
        setSetup(nextSetup);
        setDepartmentId(nextSetup.departments[0]?.id ?? "");
      } catch {
        if (active) setError("Das Lager konnte nicht geladen werden.");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    if (!tenantId || !setup) return;
    const minimum = wholeNumber(minimumStock);
    const target = wholeNumber(targetStock);
    if (!articleNumber.trim() || !name.trim() || !category.trim()) {
      setError("Bitte fülle Artikelnummer, Name und Kategorie aus.");
      return;
    }
    if (minimum === null || target === null) {
      setError("Mindest- und Sollbestand müssen ganze Zahlen sein.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createMobileInventoryItem({
        tenantId,
        articleNumber: articleNumber.trim(),
        name: name.trim(),
        category: category.trim(),
        unit: unit.trim() || "Stk",
        minimumStock: minimum,
        targetStock: target,
        departmentId:
          setup.departments.length > 1 ? departmentId || null : null,
      });
      hapticSuccess();
      router.replace("/inventory");
    } catch (nextError) {
      hapticError();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Der Artikel konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <CreateScreen
      heading="Neuer Lagerartikel"
      intro={tn("Der Artikel wird im Lager angelegt. Bestand buchst du danach über einen Wareneingang.", "Der Artikel wird im Lager angelegt. Bestand buchen Sie danach über einen Wareneingang.")}
      title="Lagerartikel erfassen"
    >
      {!setup && !error ? (
        <LoadingBlock text="Formular wird geladen …" />
      ) : setup && !setup.canManage ? (
        <FormCard>
          <FormMessage
            text={tn("Für das Erfassen von Lagerartikeln fehlt dir die Berechtigung.", "Für das Erfassen von Lagerartikeln fehlt Ihnen die Berechtigung.")}
            tone="info"
          />
        </FormCard>
      ) : setup ? (
        <FormCard>
          <Field
            autoCapitalize="characters"
            autoFocus
            label="Artikelnummer"
            maxLength={64}
            onChangeText={setArticleNumber}
            placeholder="Zum Beispiel: NB-USB-C-01"
            value={articleNumber}
          />
          <Field
            label="Name"
            maxLength={200}
            onChangeText={setName}
            placeholder="Zum Beispiel: USB-C-Netzteil 65 W"
            value={name}
          />
          <Field
            label="Kategorie"
            maxLength={120}
            onChangeText={setCategory}
            placeholder="Zum Beispiel: Zubehör"
            value={category}
          />
          <Field
            label="Einheit"
            maxLength={20}
            onChangeText={setUnit}
            placeholder="Stk"
            value={unit}
          />
          <Field
            keyboardType="number-pad"
            label="Mindestbestand"
            maxLength={6}
            onChangeText={setMinimumStock}
            value={minimumStock}
          />
          <Field
            keyboardType="number-pad"
            label="Sollbestand"
            maxLength={6}
            onChangeText={setTargetStock}
            value={targetStock}
          />
          {setup.departments.length > 1 ? (
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
            label="Artikel speichern"
            onPress={() => void save()}
          />
        </FormCard>
      ) : (
        <FormCard>
          <FormMessage text={error} tone="error" />
        </FormCard>
      )}
    </CreateScreen>
  );
}
