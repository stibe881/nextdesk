import { useMemo, useState } from "react";

import type { SecurityCaseDetail } from "./lib/security-cases";
import { sandboxedMailDocument } from "./lib/mail-sandbox";

type OriginalMail = NonNullable<SecurityCaseDetail["originalMail"]>;
type View = "rendered" | "text" | "headers";

/**
 * The reported mail as the recipient received it: rendered in a sandboxed
 * frame (no scripts, no external content, links disabled), as plain text, or
 * with all header lines for the technical assessment.
 */
export function SecurityOriginalMail({ mail }: { mail: OriginalMail }) {
  const [view, setView] = useState<View>(mail.html ? "rendered" : "text");
  const document = useMemo(
    () =>
      view === "rendered" ? sandboxedMailDocument(mail.html, mail.text) : "",
    [mail.html, mail.text, view],
  );
  const views: { key: View; label: string }[] = [
    { key: "rendered", label: "Darstellung" },
    { key: "text", label: "Text" },
    { key: "headers", label: `Kopfzeilen (${mail.headers.length})` },
  ];
  return (
    <div className="security-original">
      <dl className="security-mail-head">
        {mail.subject ? (
          <>
            <dt>Betreff</dt>
            <dd>{mail.subject}</dd>
          </>
        ) : null}
        {mail.to ? (
          <>
            <dt>An</dt>
            <dd>{mail.to}</dd>
          </>
        ) : null}
        {mail.cc ? (
          <>
            <dt>Cc</dt>
            <dd>{mail.cc}</dd>
          </>
        ) : null}
      </dl>
      <div
        aria-label="Ansicht der gemeldeten E-Mail"
        className="security-original__tabs"
        role="tablist"
      >
        {views.map((entry) => (
          <button
            aria-selected={view === entry.key}
            className={view === entry.key ? "is-active" : undefined}
            key={entry.key}
            onClick={() => setView(entry.key)}
            role="tab"
            type="button"
          >
            {entry.label}
          </button>
        ))}
      </div>
      {view === "rendered" ? (
        <iframe
          className="security-original__frame"
          referrerPolicy="no-referrer"
          sandbox=""
          srcDoc={document}
          title="Gemeldete E-Mail (abgeschottete Darstellung)"
        />
      ) : view === "text" ? (
        <pre className="security-mail-body">
          {mail.text || "Keine Textfassung vorhanden."}
        </pre>
      ) : (
        <pre className="security-mail-body security-original__headers">
          {mail.headers
            .map((header) => `${header.name}: ${header.value}`)
            .join("\n")}
        </pre>
      )}
    </div>
  );
}
