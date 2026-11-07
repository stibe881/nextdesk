import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { captureOAuthAuthorizationId } from "./oauth-consent";
import { isReminderActionHash } from "./lib/requester-reminder-action";
import { RequesterReminderActionPage } from "./requester-reminder-action";
import "./styles.css";
import "./status-tokens.css";

// Muss vor dem Start der App laufen, bevor die Anmeldung die Adresse ändert.
captureOAuthAuthorizationId();

// One-click links from reminder e-mails work without signing in.
const reminderAction = isReminderActionHash(window.location.hash);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {reminderAction ? <RequesterReminderActionPage /> : <App />}
  </StrictMode>,
);
