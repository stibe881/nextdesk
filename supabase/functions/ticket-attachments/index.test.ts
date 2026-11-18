Deno.test(
  "Ticketanhänge geben Inlinebilder nur nach Ticketprüfung und mit privater Storage-Zuordnung frei",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./index.ts", import.meta.url),
    );

    for (
      const required of [
        'type: "createInlineImageUrls"',
        "const access = await resolveReadableTicket(",
        'if (action.type === "createInlineImageUrls")',
        '.eq("ticket_id", ticket.id)',
        // Inline mail images must be scanned clean; images uploaded in
        // nextDesk (messages and ticket attachments) may still be pending.
        'typedAttachment.malware_status === "clean"',
        "const isUploadedImage",
        '"image/png", "image/jpeg", "image/webp"',
        "canReadInternalTicketAttachment",
        "canWriteExternalTicketAttachment",
        '"ticket.comment.external.own"',
        'attachmentQuery = attachmentQuery.eq("visibility", "external")',
        'typedAttachment.visibility === "internal"',
        "canWriteInternalTicketAttachment",
        "canWriteCommentAttachment",
        "action.visibility !== undefined",
        "hasValidCommentImageSignature(",
        'code: "invalid_comment_image_content"',
        '"comment_attachment_write_denied"',
        "isTicketStoragePath(",
        "ticket.tenant_id",
        "DOWNLOAD_URL_TTL_SECONDS",
        ".createSignedUrl(",
      ]
    ) {
      if (!source.includes(required)) {
        throw new Error(
          `Inlinebildvertrag verlor die Schutzvorgabe: ${required}`,
        );
      }
    }

    const accessPosition = source.indexOf(
      "const access = await resolveReadableTicket(",
    );
    const inlineActionPosition = source.indexOf(
      'if (action.type === "createInlineImageUrls")',
    );
    if (accessPosition < 0 || inlineActionPosition < accessPosition) {
      throw new Error(
        "Inlinebild-URLs dürfen erst nach der serverseitigen Ticketberechtigungsprüfung erstellt werden.",
      );
    }
  },
);

Deno.test(
  "messages may carry every allowed file type; only images need an image signature",
  async () => {
    const [source, migration] = await Promise.all([
      Deno.readTextFile(new URL("./index.ts", import.meta.url)),
      Deno.readTextFile(
        new URL(
          "../../migrations/0326_comment_attachments_all_file_types.sql",
          import.meta.url,
        ),
      ),
    ]);
    for (const required of [
      "TICKET_COMMENT_IMAGE_CONTENT_TYPES.has(action.contentType)",
      'inline: typeof inline_content_id === "string"',
    ]) {
      if (!source.includes(required)) throw new Error(`missing: ${required}`);
    }
    for (const required of [
      "'application/pdf'",
      "'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'",
      "attachment.uploaded_by = p_author_id",
      "attachment.comment_id is null",
      "attachment.visibility = p_visibility",
      "auth.role() <> 'service_role'",
    ]) {
      if (!migration.includes(required)) throw new Error(`missing: ${required}`);
    }
  },
);
