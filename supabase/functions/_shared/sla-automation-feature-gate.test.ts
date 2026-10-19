import { filterSlaAutomationCandidates } from "./sla-automation-feature-gate.ts";

type Candidate = {
  ticket: { tenant_id: string; id: string };
  kind: "response" | "resolution";
};

Deno.test(
  "SLA scheduler filters inactive and unverifiable tenants before mutation",
  async () => {
    const calls: string[] = [];
    const candidates: Candidate[] = [
      {
        ticket: {
          id: "10000000-0000-4000-8000-000000000001",
          tenant_id: "10000000-0000-4000-8000-000000000011",
        },
        kind: "response",
      },
      {
        ticket: {
          id: "10000000-0000-4000-8000-000000000002",
          tenant_id: "10000000-0000-4000-8000-000000000011",
        },
        kind: "resolution",
      },
      {
        ticket: {
          id: "10000000-0000-4000-8000-000000000003",
          tenant_id: "10000000-0000-4000-8000-000000000022",
        },
        kind: "response",
      },
      {
        ticket: {
          id: "10000000-0000-4000-8000-000000000004",
          tenant_id: "10000000-0000-4000-8000-000000000033",
        },
        kind: "resolution",
      },
    ];

    const result = await filterSlaAutomationCandidates(
      candidates,
      async (tenantId) => {
        calls.push(tenantId);
        if (tenantId.endsWith("0011")) return true;
        if (tenantId.endsWith("0022")) return false;
        throw new Error("feature lookup unavailable");
      },
    );

    if (result.candidates.length !== 2) {
      throw new Error(
        "Only candidates of explicitly enabled tenants may remain",
      );
    }
    if (
      !result.candidates.every((candidate) =>
        candidate.ticket.tenant_id.endsWith("0011"),
      )
    ) {
      throw new Error(
        "An inactive or unverifiable tenant reached the scheduler",
      );
    }
    if (result.skippedInactiveTenants !== 2) {
      throw new Error(
        "Each inactive or unverifiable tenant must be counted once",
      );
    }
    if (calls.filter((tenantId) => tenantId.endsWith("0011")).length !== 1) {
      throw new Error("Each tenant feature must be resolved once per batch");
    }
  },
);
