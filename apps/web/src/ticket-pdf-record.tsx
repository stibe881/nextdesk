import { useState } from "react";
import { FileDown, LoaderCircle } from "lucide-react";
import { supabase } from "./lib/supabase";

type PdfAction = { type: "recordExport"; tenantId: string; ticketId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, fallback = "–") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function escapeHtml(value: unknown) {
  return text(value, "").replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#039;",
        '"': "&quot;",
      })[character] ?? character,
  );
}
function formatDateTime(value: unknown) {
  if (typeof value !== "string") return "–";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "–"
    : new Intl.DateTimeFormat("de-CH", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}
function statusLabel(items: unknown, id: unknown) {
  if (!Array.isArray(items) || typeof id !== "string") return "–";
  const match = items.find((item) => isRecord(item) && item.id === id);
  return isRecord(match) ? text(match.label) : "–";
}

async function loadRecord(tenantId: string, ticketId: string) {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const [
    { data: detailEnvelope, error: detailError },
    { data: recordEnvelope, error: recordError },
  ] = await Promise.all([
    supabase.functions.invoke("ticket-operations", {
      body: { type: "getTicket", tenantId, ticketId },
    }),
    supabase.functions.invoke("ticket-operations", {
      body: { type: "recordExport", tenantId, ticketId } satisfies PdfAction,
    }),
  ]);
  if (detailError || recordError) throw detailError ?? recordError;
  if (
    !isRecord(detailEnvelope) ||
    isRecord(detailEnvelope.error) ||
    !isRecord(detailEnvelope.data)
  )
    throw new Error("Die Ticketakte konnte nicht geladen werden.");
  if (!isRecord(recordEnvelope) || isRecord(recordEnvelope.error))
    throw new Error("Der PDF-Export wurde nicht freigegeben.");
  return detailEnvelope.data;
}

function createPrintDocument(data: Record<string, unknown>) {
  const ticket = isRecord(data.ticket) ? data.ticket : {};
  const requester = isRecord(data.requesterContact)
    ? data.requesterContact
    : {};
  const agent = isRecord(data.assignedAgent) ? data.assignedAgent : {};
  const department = isRecord(data.department) ? data.department : {};
  const comments = Array.isArray(data.comments)
    ? data.comments.filter(isRecord)
    : [];
  const checklist = Array.isArray(data.checklistItems)
    ? data.checklistItems.filter(isRecord)
    : [];
  const visibleComments = comments
    .map(
      (comment) => `
    <article class="comment">
      <div class="comment-meta"><strong>${escapeHtml(comment.authorName)}</strong><span>${escapeHtml(comment.visibility === "internal" ? "Interne Notiz" : "Antwort")}</span><time>${escapeHtml(formatDateTime(comment.created_at))}</time></div>
      <p>${escapeHtml(comment.body).replace(/\n/g, "<br>")}</p>
    </article>`,
    )
    .join("");
  const checklistRows = checklist.length
    ? checklist
        .map(
          (item) =>
            `<li>${item.completed_at ? "☑" : "☐"} ${escapeHtml(item.description)}</li>`,
        )
        .join("")
    : "<li>Keine Checkliste</li>";
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Ticketakte ${escapeHtml(ticket.ticket_number)}</title><style>
    @page { size: A4; margin: 15mm; }
    *{box-sizing:border-box} body{color:#17233f;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:10pt;line-height:1.46;margin:0} h1{font-size:22pt;letter-spacing:-.03em;margin:0} h2{border-top:1px solid #dfe5ef;font-size:12pt;margin:22px 0 10px;padding-top:14px}.eyebrow{color:#5c6478;font-size:8pt;font-weight:800;letter-spacing:.11em;margin:0 0 4px}.head{align-items:start;border-bottom:3px solid #4536c8;display:flex;justify-content:space-between;padding-bottom:16px}.number{color:#4536c8;font-size:11pt;font-weight:800}.meta{display:grid;gap:9px;grid-template-columns:repeat(3,1fr);margin:15px 0}.meta div{background:#f5f7fb;border:1px solid #dfe5ef;border-radius:7px;padding:8px}.meta span{color:#59677c;display:block;font-size:8pt;font-weight:700;margin-bottom:2px}.description{white-space:pre-wrap}.comment{border:1px solid #dfe5ef;border-radius:8px;margin:9px 0;padding:10px}.comment-meta{align-items:baseline;display:flex;flex-wrap:wrap;gap:6px}.comment-meta span{background:#eef0ff;border-radius:99px;color:#4338ca;font-size:8pt;padding:2px 6px}.comment-meta time{color:#59677c;font-size:8pt}.comment p{margin:8px 0 0}.footer{border-top:1px solid #dfe5ef;color:#59677c;font-size:8pt;margin-top:24px;padding-top:10px}ul{margin:0;padding-left:18px}@media print{.no-print{display:none}}
  </style></head><body><header class="head"><div><p class="eyebrow">NEXTDESK · TICKETAKTE</p><h1>${escapeHtml(ticket.subject)}</h1></div><div class="number">${escapeHtml(ticket.ticket_number)}</div></header>
  <section class="meta"><div><span>Status</span>${escapeHtml(statusLabel(data.statuses, ticket.status_id))}</div><div><span>Priorität</span>${escapeHtml(statusLabel(data.priorities, ticket.priority_id))}</div><div><span>Abteilung</span>${escapeHtml(department.name)}</div><div><span>Anfragende Person</span>${escapeHtml(requester.displayName)}</div><div><span>Zugewiesener Agent</span>${escapeHtml(agent.displayName)}</div><div><span>Erstellt</span>${escapeHtml(formatDateTime(ticket.created_at))}</div></section>
  <section><h2>Beschreibung</h2><div class="description">${escapeHtml(ticket.description)}</div></section>
  <section><h2>Checkliste</h2><ul>${checklistRows}</ul></section>
  <section><h2>Kommunikation</h2>${visibleComments || "<p>Keine sichtbaren Beiträge vorhanden.</p>"}</section>
  <footer class="footer">Erstellt am ${escapeHtml(formatDateTime(new Date().toISOString()))} · Die Akte enthält ausschließlich Informationen, für die beim Export eine Berechtigung bestand.</footer>
  <script>window.onload=()=>window.print();</script></body></html>`;
}

export function TicketPdfRecord({
  tenantId,
  ticketId,
  canExport,
}: {
  tenantId: string;
  ticketId: string;
  canExport: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (!canExport) return null;

  async function exportRecord() {
    const report = window.open(
      "",
      "nextdesk-ticket-record",
      "popup,width=920,height=760",
    );
    if (!report) {
      setError(
        "Das Druckfenster wurde blockiert. Bitte Pop-ups für nextDesk erlauben.",
      );
      return;
    }
    setPending(true);
    setError("");
    try {
      const data = await loadRecord(tenantId, ticketId);
      report.document.open();
      report.document.write(createPrintDocument(data));
      report.document.close();
    } catch (nextError) {
      report.close();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Ticketakte konnte nicht erstellt werden.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="ticket-pdf-record">
      <button
        className="secondary-button"
        disabled={pending}
        onClick={() => void exportRecord()}
        type="button"
      >
        {pending ? (
          <LoaderCircle
            aria-hidden="true"
            className="ticket-detail-spinner"
            size={16}
          />
        ) : (
          <FileDown aria-hidden="true" size={16} />
        )}{" "}
        PDF-Ticketakte
      </button>
      {error && (
        <p className="ticket-detail-message error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
