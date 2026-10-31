import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { captureOAuthAuthorizationId } from "./oauth-consent";
import "./styles.css";

// Muss vor dem Start der App laufen, bevor die Anmeldung die Adresse ändert.
captureOAuthAuthorizationId();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
