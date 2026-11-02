import {
  buildOnboardingTasks,
  parseOnboardingPdf,
  type OnboardingPdfData,
} from "./onboarding-pdf-intake.ts";
import { extractPdfTextItems } from "./onboarding-pdf-text.ts";

type Admin = any;

export type InboundPdfAttachment = Readonly<{
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}>;

type IntakeInput = Readonly<{
  attachments: readonly InboundPdfAttachment[];
  tenantId: string;
  ticketId: string;
  ticketNumber: string;
}>;

export type OnboardingIntakeOutcome =
  | "created"
  | "duplicate"
  | "failed"
  | "ignored";

const MAX_PDFS = 3;
const MAX_PDF_BYTES = 5 * 1024 * 1024;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Gleiche Person und gleiches Eintrittsdatum ergeben denselben Fingerabdruck. */
export async function onboardingFingerprint(
  data: Pick<OnboardingPdfData, "employeeName" | "startDate">,
): Promise<string> {
  return await sha256Hex(
    `${data.employeeName.normalize("NFKC").trim().toLocaleLowerCase("de-CH")}|${data.startDate}`,
  );
}

async function firstOnboardingPdf(
  attachments: readonly InboundPdfAttachment[],
): Promise<OnboardingPdfData | null> {
  const pdfs = attachments
    .filter(
      (attachment) =>
        attachment.contentType === "application/pdf" &&
        attachment.bytes.byteLength > 0 &&
        attachment.bytes.byteLength <= MAX_PDF_BYTES,
    )
    .slice(0, MAX_PDFS);
  for (const pdf of pdfs) {
    try {
      const parsed = parseOnboardingPdf(await extractPdfTextItems(pdf.bytes));
      if (parsed) return parsed;
    } catch {
      // Ein defektes oder unbekanntes PDF ist kein Eintritt.
    }
  }
  return null;
}

/** Das Mail-Ticket wird durch den Eintritt ersetzt; Anhänge werden mit entfernt. */
async function removeSourceTicket(
  admin: Admin,
  tenantId: string,
  ticketId: string,
): Promise<void> {
  try {
    const { data: attachments } = await admin
      .from("ticket_attachments")
      .select("storage_bucket, storage_object_path")
      .eq("ticket_id", ticketId);
    const byBucket = new Map<string, string[]>();
    for (const row of attachments ?? []) {
      if (
        typeof row.storage_bucket === "string" &&
        typeof row.storage_object_path === "string"
      ) {
        byBucket.set(row.storage_bucket, [
          ...(byBucket.get(row.storage_bucket) ?? []),
          row.storage_object_path,
        ]);
      }
    }
    for (const [bucket, paths] of byBucket) {
      await admin.storage.from(bucket).remove(paths);
    }
    await admin
      .from("tickets")
      .delete()
      .eq("id", ticketId)
      .eq("tenant_id", tenantId);
  } catch {
    // Das Aufräumen darf den E-Mail-Eingang nie scheitern lassen.
  }
}

/**
 * Erkennt die Eintrittsmeldung der Personal-App (PDF-Anhang) und legt daraus
 * einen Eintritt mit Checkliste an. Läuft nach dem Anlegen des Mail-Tickets und
 * wirft nie: Bei jedem Fehler bleibt das Ticket unverändert bestehen.
 */
export async function processOnboardingEmailTicketIntake(
  admin: Admin,
  input: IntakeInput,
): Promise<OnboardingIntakeOutcome> {
  try {
    if (
      !input.attachments.some(
        (entry) => entry.contentType === "application/pdf",
      )
    ) {
      return "ignored";
    }
    const data = await firstOnboardingPdf(input.attachments);
    if (!data) return "ignored";

    const { data: rows, error } = await admin.rpc(
      "create_onboarding_entry_from_email",
      {
        p_tenant_id: input.tenantId,
        p_fingerprint: await onboardingFingerprint(data),
        p_employee_name: data.employeeName,
        p_starts_on: data.startDate,
        p_organisation_unit:
          data.functions[0]?.offer || data.functions[0]?.team || null,
        p_location: data.room,
        p_supervisor_name: data.supervisor,
        p_details: data,
        p_extra_tasks: buildOnboardingTasks(data),
        p_source_ticket_number: input.ticketNumber,
      },
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (error || !row) return "failed";
    if (row.created !== true) return "duplicate";
    await removeSourceTicket(admin, input.tenantId, input.ticketId);
    return "created";
  } catch {
    return "failed";
  }
}
