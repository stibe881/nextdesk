Deno.test(
  "Kommentarbildanhänge werden atomar verknüpft und bleiben entsprechend ihrer Sichtbarkeit geschützt",
  async () => {
    const [operations, migration] = await Promise.all([
      Deno.readTextFile(new URL("./index.ts", import.meta.url)),
      Deno.readTextFile(
        new URL(
          "../../migrations/0112_ticket_attachment_comment_visibility.sql",
          import.meta.url,
        ),
      ),
    ]);

    for (const required of [
      "attachmentIds: string[]",
      "create_ticket_comment_with_attachments",
      "p_attachment_ids",
      "ticket.internal_notes.write",
    ]) {
      if (!operations.includes(required)) {
        throw new Error(
          `Kommentarbildanhang-Vertrag verlor die Operations-Sicherung: ${required}`,
        );
      }
    }

    for (const required of [
      "add column if not exists visibility public.comment_visibility",
      "visibility = 'external'",
      "or public.can_read_internal_note(ticket_id)",
      "auth.role() <> 'service_role'",
      "attachment.uploaded_by = p_author_id",
      "attachment.comment_id is null",
      "attachment.visibility = p_visibility",
      "attachment.content_type in ('image/png', 'image/jpeg', 'image/webp')",
      "for update",
      "get diagnostics v_updated_attachment_count = row_count",
      "Ticket comment attachments could not be linked atomically",
      "Ticket comment attachment IDs must be unique",
    ]) {
      if (!migration.includes(required)) {
        throw new Error(
          `Kommentarbildanhang-Vertrag verlor die Migrationssicherung: ${required}`,
        );
      }
    }
  },
);
