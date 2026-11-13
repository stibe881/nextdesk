import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { FormalityBoundary } from "./formality-boundary";
import { captureOAuthAuthorizationId } from "./oauth-consent";
import { isReminderActionHash } from "./lib/requester-reminder-action";
import { RequesterReminderActionPage } from "./requester-reminder-action";
import { isRatingLinkHash } from "./lib/ticket-rating-link";
import { TicketRatingLinkPage } from "./ticket-rating-link";
import {
  isSecurityResponseHash,
  SecurityCaseResponsePage,
} from "./security-case-response";
import "./styles.css";
import "./status-tokens.css";

// After a deploy, a tab opened earlier may ask for a lazy chunk of the
// previous build. Reload once to get the current build instead of failing
// (e.g. «Failed to fetch dynamically imported module» when printing labels).
window.addEventListener("vite:preloadError", (event) => {
  const key = "nextdesk:chunk-reload";
  try {
    const last = Number(window.sessionStorage.getItem(key) ?? "0");
    if (Date.now() - last < 60_000) return;
    window.sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // Without session storage, still reload once per page view.
  }
  event.preventDefault();
  window.location.reload();
});

// Muss vor dem Start der App laufen, bevor die Anmeldung die Adresse ändert.
captureOAuthAuthorizationId();

// One-click links from reminder e-mails work without signing in.
const reminderAction = isReminderActionHash(window.location.hash);
const securityResponse = isSecurityResponseHash(window.location.hash);
const ratingLink = isRatingLinkHash(window.location.hash);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FormalityBoundary>
      {reminderAction ? (
        <RequesterReminderActionPage />
      ) : ratingLink ? (
        <TicketRatingLinkPage />
      ) : securityResponse ? (
        <SecurityCaseResponsePage />
      ) : (
        <App />
      )}
    </FormalityBoundary>
  </StrictMode>,
);
