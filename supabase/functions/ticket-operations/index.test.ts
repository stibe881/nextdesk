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

Deno.test(
  "Lösungen ähnlicher Tickets stammen nur von Personen mit Ticketarbeit",
  async () => {
    const operations = await Deno.readTextFile(
      new URL("./index.ts", import.meta.url),
    );
    for (const required of [
      "async function staffUserIds(",
      '"ticket.read.department"',
      '"ticket.read.assigned"',
      '"ticket.update"',
      'role.scope === "tenant" || role.scope === "department"',
      "if (!staff.has(comment.author_id)) continue;",
      'type: "incidentOverview"',
      '"can_work_tickets_in_tenant"',
      "problemDepartmentId",
    ]) {
      if (!operations.includes(required)) {
        throw new Error(`Lern-Vertrag verlor die Sicherung: ${required}`);
      }
    }
  },
);
