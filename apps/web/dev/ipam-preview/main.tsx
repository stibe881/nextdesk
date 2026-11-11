// Dev preview of the IPAM module with invented demo data (no backend).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Ipam } from "../../src/ipam";
import "../../src/styles.css";
import "../../src/status-tokens.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div
      className="app-shell app-shell--theme-system"
      style={{
        display: "block",
        minHeight: "100vh",
        background: "var(--canvas)",
        color: "var(--text)",
      }}
    >
      <main
        style={{
          padding: "clamp(12px, 3vw, 28px)",
          maxWidth: 1440,
          margin: "0 auto",
        }}
      >
        <Ipam
          onOpenTicket={(id) => window.alert(`Ticket ${id} öffnen`)}
          tenantId="00000000-0000-4000-8000-000000000001"
        />
      </main>
    </div>
  </StrictMode>,
);
