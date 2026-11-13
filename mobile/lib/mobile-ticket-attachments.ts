import * as ImageManipulator from "expo-image-manipulator";

import { invokeNextDesk, requireNextDesk } from "@/lib/nextdesk-client";
import {
  MAX_MESSAGE_ATTACHMENT_BYTES,
  parseMessageAttachment,
  type MessageAttachment,
} from "@/lib/ticket-message-attachments-model";

const ATTACHMENT_BUCKET = "ticket-attachments";
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export type MobileTicketAttachment = MessageAttachment;

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

const attachment = parseMessageAttachment;

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

/**
 * Uploads a file to the ticket. With «visibility» the file is prepared for a
 * message (it is linked when the message is sent); without it, it is a ticket
 * attachment.
 */
export async function uploadMobileTicketFile(input: {
  tenantId: string;
  ticketId: string;
  filename: string;
  contentType: string;
  bytes: ArrayBuffer;
  visibility?: "internal" | "external";
}): Promise<MobileTicketAttachment> {
  if (
    input.bytes.byteLength < 1 ||
    input.bytes.byteLength > MAX_MESSAGE_ATTACHMENT_BYTES
  ) {
    throw new Error("Die Datei darf höchstens 25 MB gross sein.");
  }
  const filename = input.filename
    .replace(/[\\/\u0000-\u001f\u007f]/g, "-")
    .trim()
    .slice(0, 180);
  if (!filename) throw new Error("Der Dateiname ist ungültig.");
  const visibility = input.visibility ? { visibility: input.visibility } : {};

  const uploadData = envelopeData(
    await invokeNextDesk<unknown>("ticket-attachments", {
      type: "createUpload",
      tenantId: input.tenantId,
      ticketId: input.ticketId,
      filename,
      contentType: input.contentType,
      byteSize: input.bytes.byteLength,
      ...visibility,
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
        contentType: input.contentType,
        upsert: false,
      },
    );
  if (uploadError) {
    throw new Error(`«${filename}» konnte nicht sicher hochgeladen werden.`);
  }

  const completed = envelopeData(
    await invokeNextDesk<unknown>("ticket-attachments", {
      type: "completeUpload",
      tenantId: input.tenantId,
      ticketId: input.ticketId,
      storageObjectPath: uploadData.storageObjectPath,
      originalFilename: filename,
      contentType: input.contentType,
      byteSize: input.bytes.byteLength,
      ...visibility,
    }),
  );
  const result = attachment(completed.attachment);
  if (!result)
    throw new Error(`«${filename}» konnte nicht registriert werden.`);
  return result;
}

export async function uploadMobileTicketPhoto(input: {
  tenantId: string;
  ticketId: string;
  filename: string;
  bytes: ArrayBuffer;
}): Promise<MobileTicketAttachment> {
  if (input.bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new Error("Das Foto darf maximal 10 MiB gross sein.");
  }
  return uploadMobileTicketFile({ ...input, contentType: "image/jpeg" });
}

/** Prepares a picked photo (no metadata, max. 2560 px, JPEG) as bytes. */
export async function preparePickedPhoto(input: {
  uri: string;
  width?: number;
  height?: number;
}): Promise<ArrayBuffer> {
  const width = input.width ?? 0;
  const height = input.height ?? 0;
  const actions: ImageManipulator.Action[] =
    width <= MAX_PHOTO_EDGE && height <= MAX_PHOTO_EDGE
      ? []
      : width >= height
        ? [{ resize: { width: MAX_PHOTO_EDGE } }]
        : [{ resize: { height: MAX_PHOTO_EDGE } }];
  const image = await ImageManipulator.manipulateAsync(input.uri, actions, {
    compress: 0.84,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  const response = await fetch(image.uri);
  if (!response.ok) throw new Error("Das Foto konnte nicht gelesen werden.");
  return response.arrayBuffer();
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

const MAX_PHOTO_EDGE = 2560;

/**
 * Bereitet ein ausgewähltes Foto auf (entfernt Metadaten, verkleinert, JPEG)
 * und lädt es zu einem bestehenden Ticket hoch.
 */
export async function uploadPickedPhoto(input: {
  height?: number;
  index: number;
  tenantId: string;
  ticketId: string;
  uri: string;
  width?: number;
}): Promise<void> {
  const width = input.width ?? 0;
  const height = input.height ?? 0;
  const actions: ImageManipulator.Action[] =
    width <= MAX_PHOTO_EDGE && height <= MAX_PHOTO_EDGE
      ? []
      : width >= height
        ? [{ resize: { width: MAX_PHOTO_EDGE } }]
        : [{ resize: { height: MAX_PHOTO_EDGE } }];
  const image = await ImageManipulator.manipulateAsync(input.uri, actions, {
    compress: 0.84,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  const response = await fetch(image.uri);
  if (!response.ok) throw new Error("Das Foto konnte nicht gelesen werden.");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  await uploadMobileTicketPhoto({
    tenantId: input.tenantId,
    ticketId: input.ticketId,
    filename: `nextdesk-foto-${stamp}${input.index > 0 ? `-${input.index + 1}` : ""}.jpg`,
    bytes: await response.arrayBuffer(),
  });
}
