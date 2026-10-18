import { invokeNextDesk, requireNextDesk } from "@/lib/nextdesk-client";

const ATTACHMENT_BUCKET = "ticket-attachments";
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export type MobileTicketAttachment = {
  byteSize: number;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  createdAt: string;
  id: string;
  originalFilename: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function envelopeData(value: unknown): Record<string, unknown> {
  const envelope = record(value);
  const data = record(envelope?.data);
  if (!data) throw new Error("Die Anhangsantwort ist unvollständig.");
  return data;
}

function attachment(value: unknown): MobileTicketAttachment | null {
  const item = record(value);
  const contentType = item?.content_type ?? item?.contentType;
  const byteSize = item?.byte_size ?? item?.byteSize;
  const createdAt = item?.created_at ?? item?.createdAt;
  const filename = item?.original_filename ?? item?.originalFilename;
  if (
    !item ||
    typeof item.id !== "string" ||
    typeof filename !== "string" ||
    typeof createdAt !== "string" ||
    typeof byteSize !== "number" ||
    !Number.isSafeInteger(byteSize) ||
    (contentType !== "image/jpeg" &&
      contentType !== "image/png" &&
      contentType !== "image/webp")
  ) {
    return null;
  }
  return {
    id: item.id,
    originalFilename: filename,
    contentType,
    byteSize,
    createdAt,
  };
}

export async function listMobileTicketAttachments(input: {
  tenantId: string;
  ticketId: string;
}): Promise<MobileTicketAttachment[]> {
  const data = envelopeData(
    await invokeNextDesk<unknown>("ticket-attachments", {
      type: "list",
      tenantId: input.tenantId,
      ticketId: input.ticketId,
    }),
  );
  if (!Array.isArray(data.attachments)) {
    throw new Error("Die Anhangsliste ist unvollständig.");
  }
  const attachments = data.attachments.map(attachment);
  if (
    !attachments.every((item): item is MobileTicketAttachment => item !== null)
  ) {
    throw new Error("Ein Anhang hat ein ungültiges Format.");
  }
  return attachments;
}

export async function uploadMobileTicketPhoto(input: {
  tenantId: string;
  ticketId: string;
  filename: string;
  bytes: ArrayBuffer;
}): Promise<MobileTicketAttachment> {
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new Error("Das Foto darf maximal 10 MiB gross sein.");
  }
  const filename = input.filename
    .replace(/[\\/\u0000-\u001f\u007f]/g, "-")
    .trim()
    .slice(0, 180);
  if (!filename) throw new Error("Der Dateiname des Fotos ist ungültig.");

  const uploadData = envelopeData(
    await invokeNextDesk<unknown>("ticket-attachments", {
      type: "createUpload",
      tenantId: input.tenantId,
      ticketId: input.ticketId,
      filename,
      contentType: "image/jpeg",
      byteSize: input.bytes.byteLength,
    }),
  );
  if (
    typeof uploadData.storageObjectPath !== "string" ||
    typeof uploadData.uploadToken !== "string"
  ) {
    throw new Error("Die sichere Uploadfreigabe ist ungültig.");
  }

  const { error: uploadError } = await requireNextDesk()
    .storage.from(ATTACHMENT_BUCKET)
    .uploadToSignedUrl(
      uploadData.storageObjectPath,
      uploadData.uploadToken,
      input.bytes,
      {
        contentType: "image/jpeg",
        upsert: false,
      },
    );
  if (uploadError) {
    throw new Error("Das Foto konnte nicht sicher hochgeladen werden.");
  }

  const completed = envelopeData(
    await invokeNextDesk<unknown>("ticket-attachments", {
      type: "completeUpload",
      tenantId: input.tenantId,
      ticketId: input.ticketId,
      storageObjectPath: uploadData.storageObjectPath,
      originalFilename: filename,
      contentType: "image/jpeg",
      byteSize: input.bytes.byteLength,
    }),
  );
  const result = attachment(completed.attachment);
  if (!result)
    throw new Error("Der Fotoanhang konnte nicht registriert werden.");
  return result;
}

export async function openMobileTicketAttachment(input: {
  tenantId: string;
  ticketId: string;
  attachmentId: string;
}): Promise<string> {
  const data = envelopeData(
    await invokeNextDesk<unknown>("ticket-attachments", {
      type: "createDownloadUrl",
      tenantId: input.tenantId,
      ticketId: input.ticketId,
      attachmentId: input.attachmentId,
    }),
  );
  if (
    typeof data.signedUrl !== "string" ||
    !data.signedUrl.startsWith("https://")
  ) {
    throw new Error("Der sichere Download-Link ist ungültig.");
  }
  return data.signedUrl;
}
