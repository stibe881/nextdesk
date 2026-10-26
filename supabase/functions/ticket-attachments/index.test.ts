Deno.test(
  "Ticketanhänge geben Inlinebilder nur nach Ticketprüfung und mit privater Storage-Zuordnung frei",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./index.ts", import.meta.url),
    );

    for (const required of [
      'type: "createInlineImageUrls"',
      "const access = await resolveReadableTicket(",
      'if (action.type === "createInlineImageUrls")',
      '.eq("ticket_id", ticket.id)',
      '.eq("malware_status", "clean")',
      '.not("inline_content_id", "is", null)',
      '"image/png", "image/jpeg", "image/webp"',
      "isTicketStoragePath(",
      "ticket.tenant_id",
      "DOWNLOAD_URL_TTL_SECONDS",
      ".createSignedUrl(",
    ]) {
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
