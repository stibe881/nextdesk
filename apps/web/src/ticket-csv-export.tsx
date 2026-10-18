import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { supabase } from "./lib/supabase";

type ExportRow = {
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string;
  department: string;
  createdAt: string;
  updatedAt: string;
};

function csvValue(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
function isRow(value: unknown): value is ExportRow {
  return (
    typeof value === "object" &&
    value !== null &&
    [
      "ticketNumber",
      "subject",
      "status",
      "priority",
      "department",
      "createdAt",
      "updatedAt",
    ].every(
      (key) => typeof (value as Record<string, unknown>)[key] === "string",
    )
  );
}

export function TicketCsvExport({ tenantId }: { tenantId: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function exportCsv() {
    if (!supabase) {
      setMessage("Der Export ist derzeit nicht verfügbar.");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const { data, error } = await supabase.functions.invoke(
        "ticket-csv-export",
        {
          body: { type: "exportCsv", tenantId },
        },
      );
      if (error) throw error;
      const tickets =
        typeof data === "object" &&
        data !== null &&
        typeof (data as { data?: unknown }).data === "object"
          ? (data as { data: { tickets?: unknown } }).data.tickets
          : null;
      if (!Array.isArray(tickets) || !tickets.every(isRow))
        throw new Error("Die Exportdaten sind unvollständig.");
      const csv = [
        [
          "Ticketnummer",
          "Betreff",
          "Status",
          "Priorität",
          "Abteilung",
          "Erstellt am",
          "Aktualisiert am",
        ],
        ...tickets.map((ticket) => [
          ticket.ticketNumber,
          ticket.subject,
          ticket.status,
          ticket.priority,
          ticket.department,
          ticket.createdAt,
          ticket.updatedAt,
        ]),
      ]
        .map((row) => row.map(csvValue).join(";"))
        .join("\r\n");
      const url = URL.createObjectURL(
        new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `nextdesk-tickets-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage(`${tickets.length} Tickets wurden exportiert.`);
    } catch (nextError) {
      setMessage(
        nextError instanceof Error
          ? nextError.message
          : "Der Ticketexport konnte nicht erstellt werden.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="ticket-csv-export">
      <button
        className="secondary-button"
        disabled={pending}
        onClick={() => void exportCsv()}
        type="button"
      >
        {pending ? (
          <LoaderCircle
            aria-hidden="true"
            className="ticket-detail-spinner"
            size={16}
          />
        ) : (
          <Download aria-hidden="true" size={16} />
        )}{" "}
        CSV exportieren
      </button>
      {message && (
        <span aria-live="polite" className="data-caption">
          {message}
        </span>
      )}
    </div>
  );
}
