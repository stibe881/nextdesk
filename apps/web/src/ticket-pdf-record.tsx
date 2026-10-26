import { useState } from "react";
import { FileDown, LoaderCircle } from "lucide-react";
import { supabase } from "./lib/supabase";

type PdfAction = { type: "recordExport"; tenantId: string; ticketId: string };
type StatusTone = "new" | "progress" | "waiting" | "resolved" | "neutral";
type PriorityTone = "low" | "normal" | "high" | "urgent";

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

function statusTone(label: string): StatusTone {
  const normalized = label.toLocaleLowerCase("de-CH");
  if (normalized.includes("gelöst") || normalized.includes("geschlossen")) {
    return "resolved";
  }
  if (
    normalized.includes("wart") ||
    normalized.includes("kunde") ||
    normalized.includes("dritt")
  ) {
    return "waiting";
  }
  if (normalized.includes("bearbeitung") || normalized.includes("arbeit")) {
    return "progress";
  }
  if (normalized.includes("neu")) return "new";
  return "neutral";
}

function priorityTone(label: string): PriorityTone {
  const normalized = label.toLocaleLowerCase("de-CH");
  if (normalized.includes("kritisch") || normalized.includes("dringend")) {
    return "urgent";
  }
  if (normalized.includes("hoch")) return "high";
  if (normalized.includes("niedrig")) return "low";
  return "normal";
}

function initials(value: unknown) {
  const name = text(value, "");
  if (!name) return "–";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("de-CH") ?? "")
    .join("");
}

async function loadRecord(tenantId: string, ticketId: string) {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data: recordEnvelope, error: recordError } =
    await supabase.functions.invoke("ticket-operations", {
      body: { type: "recordExport", tenantId, ticketId } satisfies PdfAction,
    });
  if (recordError) throw recordError;
  if (
    !isRecord(recordEnvelope) ||
    isRecord(recordEnvelope.error) ||
    !isRecord(recordEnvelope.data) ||
    typeof recordEnvelope.data.occurredAt !== "string"
  ) {
    throw new Error("Der PDF-Export wurde nicht freigegeben.");
  }

  const { data: detailEnvelope, error: detailError } =
    await supabase.functions.invoke("ticket-operations", {
      body: { type: "getTicket", tenantId, ticketId },
    });
  if (detailError) throw detailError;
  if (
    !isRecord(detailEnvelope) ||
    isRecord(detailEnvelope.error) ||
    !isRecord(detailEnvelope.data)
  ) {
    throw new Error("Die Ticketakte konnte nicht geladen werden.");
  }
  return {
    data: detailEnvelope.data,
    exportedAt: recordEnvelope.data.occurredAt,
  };
}

function createPrintDocument(
  data: Record<string, unknown>,
  exportedAt: string,
) {
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
  const currentStatus = statusLabel(data.statuses, ticket.status_id);
  const currentPriority = statusLabel(data.priorities, ticket.priority_id);
  const currentStatusTone = statusTone(currentStatus);
  const currentPriorityTone = priorityTone(currentPriority);
  const visibleComments = comments
    .map((comment) => {
      const internal = comment.visibility === "internal";
      const requesterName = text(requester.displayName, "").toLocaleLowerCase(
        "de-CH",
      );
      const authorName = text(comment.authorName, "");
      const authorIsRequester =
        comment.authorKind === "requester" ||
        comment.authorKind === "customer" ||
        (comment.authorKind === undefined &&
          Boolean(requesterName) &&
          authorName.toLocaleLowerCase("de-CH") === requesterName);
      const direction = internal
        ? "internal"
        : authorIsRequester
          ? "incoming"
          : "outgoing";
      const visibilityLabel =
        direction === "incoming"
          ? "Kundenanfrage"
          : direction === "outgoing"
            ? "Antwort an Kunden"
            : "Interne Notiz";
      const inboundEmail =
        direction === "incoming" && comment.channel === "email";
      const emailDelivery =
        direction === "outgoing" ? comment.emailDelivery : null;
      const deliveryLabel =
        emailDelivery === "pending"
          ? "E-Mail wird gesendet"
          : emailDelivery === "sent"
            ? "per E-Mail gesendet"
            : emailDelivery === "failed"
              ? "E-Mail-Versand fehlgeschlagen"
              : null;
      return `
        <article class="comment comment--${direction}">
          <div class="comment__rail" aria-hidden="true"><span>${escapeHtml(initials(comment.authorName))}</span></div>
          <div class="comment__card">
            <header class="comment__header">
              <div><strong>${escapeHtml(comment.authorName)}</strong><span class="comment__visibility">${visibilityLabel}</span>${inboundEmail ? '<span class="comment__channel">per E-Mail</span>' : ""}${deliveryLabel ? `<span class="comment__delivery${emailDelivery === "failed" ? " is-warning" : ""}">${deliveryLabel}</span>` : ""}</div>
              <time>${escapeHtml(formatDateTime(comment.created_at))}</time>
            </header>
            <p>${escapeHtml(comment.body).replace(/\n/g, "<br>")}</p>
          </div>
        </article>`;
    })
    .join("");
  const checklistRows = checklist.length
    ? checklist
        .map((item) => {
          const completed = Boolean(item.completed_at);
          return `<li class="checklist__item${completed ? " is-complete" : ""}"><span class="checklist__mark" aria-hidden="true">${completed ? "✓" : ""}</span><span>${escapeHtml(item.description)}</span></li>`;
        })
        .join("")
    : '<li class="checklist__empty">Keine Checkliste hinterlegt.</li>';

  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>Ticketakte ${escapeHtml(ticket.ticket_number)}</title>
  <style>
    @page { size: A4; margin: 14mm 13mm 17mm; }
    :root { color-scheme: light; --ink:#17243d; --muted:#657187; --line:#dde4ee; --soft:#f5f7fb; --blue:#2563eb; --blue-soft:#eaf1ff; --violet:#5b4bc4; --violet-soft:#f0eeff; --green:#087f5b; --green-soft:#e8f7f0; --amber:#a85f00; --amber-soft:#fff5df; --red:#b42318; --red-soft:#fef0ee; }
    * { box-sizing: border-box; }
    html { background: #fff; }
    body { color:var(--ink); font-family:Inter,"Segoe UI",Arial,sans-serif; font-size:10pt; line-height:1.5; margin:0; text-rendering:optimizeLegibility; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .record { margin:0 auto; max-width:184mm; }
    .record__header { align-items:flex-start; border-bottom:1px solid var(--line); display:grid; gap:12px; grid-template-columns:minmax(0,1fr) auto; padding:0 0 16px; }
    .brand-line { align-items:center; color:var(--violet); display:flex; font-size:7.5pt; font-weight:800; gap:7px; letter-spacing:.12em; margin:0 0 8px; text-transform:uppercase; }
    .brand-line::before { background:var(--violet); border-radius:99px; content:""; display:inline-block; height:7px; width:7px; }
    h1 { font-size:23pt; letter-spacing:-.045em; line-height:1.08; margin:0; overflow-wrap:anywhere; }
    .record__identifier { min-width:34mm; text-align:right; }
    .record__identifier-label { color:var(--muted); display:block; font-size:7.5pt; font-weight:750; letter-spacing:.09em; margin:1px 0 3px; text-transform:uppercase; }
    .record__identifier strong { color:var(--violet); display:block; font-size:12pt; letter-spacing:-.02em; overflow-wrap:anywhere; }
    .status-pill,.priority-pill,.comment__visibility { border-radius:999px; display:inline-flex; font-size:7.7pt; font-weight:750; line-height:1; padding:5px 8px; }
    .status-pill { margin-top:9px; }
    .status-pill--new { background:var(--blue-soft); color:#174ea6; } .status-pill--progress { background:var(--violet-soft); color:#4c3bb0; } .status-pill--waiting { background:var(--amber-soft); color:var(--amber); } .status-pill--resolved { background:var(--green-soft); color:var(--green); } .status-pill--neutral { background:var(--soft); color:var(--muted); }
    .record__overview { break-inside:avoid; margin:17px 0 0; }
    .section-kicker { color:var(--muted); font-size:7.5pt; font-weight:800; letter-spacing:.11em; margin:0 0 8px; text-transform:uppercase; }
    .facts { display:grid; gap:8px; grid-template-columns:repeat(3,minmax(0,1fr)); }
    .fact { background:var(--soft); border:1px solid var(--line); border-radius:10px; min-height:50px; padding:8px 10px; }
    .fact > span { color:var(--muted); display:block; font-size:7.4pt; font-weight:750; letter-spacing:.03em; margin-bottom:2px; }
    .fact strong { display:block; font-size:9.2pt; font-weight:700; line-height:1.32; overflow-wrap:anywhere; }
    .priority-pill { padding:3px 6px; } .priority-pill--low { background:#eef2ff; color:#485569; } .priority-pill--normal { background:var(--blue-soft); color:#2055aa; } .priority-pill--high { background:var(--amber-soft); color:var(--amber); } .priority-pill--urgent { background:var(--red-soft); color:var(--red); }
    .record-section { margin-top:21px; }
    .record-section__heading { align-items:baseline; display:flex; gap:9px; margin-bottom:8px; }
    .record-section__heading::before { background:var(--blue); border-radius:99px; content:""; display:block; height:17px; width:3px; }
    h2 { font-size:12pt; letter-spacing:-.015em; line-height:1.2; margin:0; }
    .description { border-left:3px solid #cddcff; color:#25334b; padding:2px 0 2px 12px; white-space:pre-wrap; }
    .description.is-empty { color:var(--muted); font-style:italic; }
    .checklist { list-style:none; margin:0; padding:0; }
    .checklist__item { align-items:flex-start; border-bottom:1px solid var(--line); display:flex; gap:8px; padding:7px 1px; }
    .checklist__item:last-child { border-bottom:0; } .checklist__item.is-complete { color:var(--muted); text-decoration:line-through; }
    .checklist__mark { align-items:center; border:1.4px solid #aeb8c8; border-radius:4px; color:#fff; display:inline-flex; flex:0 0 14px; font-size:8pt; font-weight:900; height:14px; justify-content:center; line-height:1; margin-top:2px; width:14px; }
    .checklist__item.is-complete .checklist__mark { background:var(--green); border-color:var(--green); } .checklist__empty { color:var(--muted); font-style:italic; }
    .record-communication { break-before:auto; } .communication-count { color:var(--muted); font-size:8pt; font-weight:650; margin-left:auto; }
    .timeline { position:relative; } .timeline::before { background:var(--line); bottom:12px; content:""; left:10px; position:absolute; top:12px; width:1px; }
    .comment { break-inside:avoid; display:grid; gap:9px; grid-template-columns:21px minmax(0,1fr); margin:0 0 10px; position:relative; }
    .comment__rail { align-items:center; background:#fff; display:flex; justify-content:center; position:relative; z-index:1; }
    .comment__rail span { align-items:center; background:var(--blue-soft); border:2px solid #fff; border-radius:50%; color:#2454aa; display:inline-flex; font-size:6.2pt; font-weight:850; height:21px; justify-content:center; letter-spacing:-.04em; width:21px; }
    .comment--outgoing .comment__rail span { background:var(--violet-soft); color:#4c3bb0; } .comment--internal .comment__rail span { background:var(--amber-soft); color:var(--amber); }
    .comment__card { background:#fff; border:1px solid var(--line); border-radius:10px; padding:10px 11px; }
    .comment--incoming .comment__card { border-left:3px solid #8eafff; } .comment--outgoing .comment__card { background:#fcfbff; border-left:3px solid #ad9ff5; } .comment--internal .comment__card { background:#fffdf8; border-left:3px solid #f3c56b; }
    .comment__header { align-items:flex-start; display:flex; gap:8px; justify-content:space-between; } .comment__header > div { align-items:center; display:flex; flex-wrap:wrap; gap:6px; }
    .comment__header strong { font-size:9pt; } .comment__visibility { background:var(--blue-soft); color:#2454aa; padding:3px 6px; } .comment--outgoing .comment__visibility { background:var(--violet-soft); color:#4c3bb0; } .comment--internal .comment__visibility { background:var(--amber-soft); color:var(--amber); }
    .comment__channel,.comment__delivery { color:var(--muted); font-size:7pt; font-weight:650; } .comment__delivery.is-warning { color:var(--red); }
    .comment time { color:var(--muted); font-size:7.4pt; padding-top:1px; text-align:right; white-space:nowrap; } .comment p { color:#283750; margin:8px 0 0; overflow-wrap:anywhere; }
    .empty-communication { color:var(--muted); font-style:italic; margin:0; }
    .record__footer { border-top:1px solid var(--line); color:var(--muted); display:flex; font-size:7.4pt; gap:10px; justify-content:space-between; margin-top:24px; padding-top:10px; }
    .record__footer span:last-child { text-align:right; }
    @media print { .record__header,.record__overview { break-inside:avoid; } .record-section__heading { break-after:avoid; } }
  </style>
</head>
<body>
  <main class="record">
    <header class="record__header">
      <div><p class="brand-line">nextDesk · Ticketakte</p><h1>${escapeHtml(ticket.subject)}</h1></div>
      <div class="record__identifier"><span class="record__identifier-label">Ticket</span><strong>${escapeHtml(ticket.ticket_number)}</strong><span class="status-pill status-pill--${currentStatusTone}">${escapeHtml(currentStatus)}</span></div>
    </header>
    <section class="record__overview" aria-label="Ticketübersicht">
      <p class="section-kicker">Auf einen Blick</p>
      <div class="facts">
        <div class="fact"><span>Status</span><strong>${escapeHtml(currentStatus)}</strong></div>
        <div class="fact"><span>Priorität</span><strong><span class="priority-pill priority-pill--${currentPriorityTone}">${escapeHtml(currentPriority)}</span></strong></div>
        <div class="fact"><span>Abteilung</span><strong>${escapeHtml(department.name)}</strong></div>
        <div class="fact"><span>Anfragende Person</span><strong>${escapeHtml(requester.displayName)}</strong></div>
        <div class="fact"><span>Bearbeitung</span><strong>${escapeHtml(agent.displayName)}</strong></div>
        <div class="fact"><span>Erstellt</span><strong>${escapeHtml(formatDateTime(ticket.created_at))}</strong></div>
      </div>
    </section>
    <section class="record-section"><div class="record-section__heading"><h2>Beschreibung</h2></div><div class="description${text(ticket.description, "") ? "" : " is-empty"}">${escapeHtml(ticket.description) || "Keine Beschreibung hinterlegt."}</div></section>
    <section class="record-section"><div class="record-section__heading"><h2>Checkliste</h2></div><ul class="checklist">${checklistRows}</ul></section>
    <section class="record-section record-communication"><div class="record-section__heading"><h2>Kommunikation</h2><span class="communication-count">${comments.length} ${comments.length === 1 ? "Beitrag" : "Beiträge"}</span></div><div class="timeline">${visibleComments || '<p class="empty-communication">Keine sichtbaren Beiträge vorhanden.</p>'}</div></section>
    <footer class="record__footer"><span>Exportiert am ${escapeHtml(formatDateTime(exportedAt))}</span><span>Umfang: Stammdaten, Beschreibung, Checkliste und berechtigte Kommunikation.</span></footer>
  </main>
  <script>window.onload=()=>window.print();</script>
</body>
</html>`;
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
      const { data, exportedAt } = await loadRecord(tenantId, ticketId);
      report.document.open();
      report.document.write(createPrintDocument(data, exportedAt));
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
        title={
          pending
            ? "Ticketakte wird als PDF erstellt"
            : "Ticketakte als PDF öffnen und drucken"
        }
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
