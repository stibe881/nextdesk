/**
 * nextDesk network agent. Loop: hello (heartbeat, config, jobs) → run jobs →
 * scan on schedule → send reports in chunks → wait.
 *
 * Usage: node dist/main.js [--once] [--check] [--config <path>]
 */

import { hostname } from "node:os";

import { ApiError, NextdeskClient } from "./client.ts";
import {
  ConfigError,
  type LocalConfig,
  loadLocalConfig,
  type ServerConfig,
  type Subnet,
} from "./config.ts";
import { type Job, JobRejected, planWriteJob } from "./jobs.ts";
import { log, setLogLevel } from "./log.ts";
import { currentPlatform } from "./parsers.ts";
import { runPowerShell } from "./powershell.ts";
import {
  buildReports,
  DEFAULT_LIMITS,
  newRunKey,
  type ReportLimits,
} from "./reports.ts";
import { runScan } from "./scan.ts";
import { VERSION } from "./version.ts";

type Hello = {
  ok: boolean;
  agent?: { id: string; name: string };
  config: ServerConfig;
  subnets: Subnet[];
  jobs: Job[];
  pollSeconds?: number;
  limits?: Partial<ReportLimits>;
};

const platform = currentPlatform();
let stopping = false;
let wake: (() => void) | null = null;

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function defaultConfigPath(): string {
  if (process.env.IPAM_AGENT_CONFIG) return process.env.IPAM_AGENT_CONFIG;
  return platform === "win32"
    ? "C:\\ProgramData\\nextDesk\\ipam-agent\\config.json"
    : "/etc/nextdesk-ipam-agent/config.json";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

async function hello(
  client: NextdeskClient,
  local: LocalConfig,
): Promise<Hello> {
  return await client.post<Hello>({
    action: "hello",
    agent: {
      version: VERSION,
      hostname: hostname().slice(0, 253),
      platform,
      capabilities: {
        ping: true,
        snmp: true,
        powershell: platform === "win32",
        dhcpDns: platform === "win32",
        writes: local.allowWrites,
      },
    },
  });
}

async function scanAndReport(
  client: NextdeskClient,
  local: LocalConfig,
  state: Hello,
  trigger: "schedule" | "manual" | "startup",
  jobId: string | null,
  prefixFilter: string[] = [],
): Promise<Record<string, number>> {
  const run = { key: newRunKey(), trigger, jobId };
  log.info(`Scan startet (${trigger})`);
  const outcome = await runScan({
    local,
    server: state.config,
    subnets: state.subnets,
    platform,
    prefixFilter,
  });
  const limits = { ...DEFAULT_LIMITS, ...(state.limits ?? {}) };
  const { reports } = buildReports(
    run,
    outcome.data,
    outcome.stats,
    outcome.errors,
    limits,
  );
  for (const report of reports) {
    const response = await client.post<{ findings?: { opened?: number } }>(
      report as unknown as Record<string, unknown>,
    );
    if (response.findings?.opened)
      log.info(`nextDesk: ${response.findings.opened} neue Funde`);
  }
  log.info(
    `Scan abgeschlossen: ${outcome.stats.observations ?? 0} Beobachtungen, ${reports.length} Berichte`,
  );
  return outcome.stats;
}

async function runJob(
  client: NextdeskClient,
  local: LocalConfig,
  state: Hello,
  job: Job,
): Promise<void> {
  log.info(`Auftrag ${job.kind} (${job.id})`);
  try {
    let result: unknown;
    if (job.kind === "scan_now") {
      const prefixIds = Array.isArray(job.payload?.prefixIds)
        ? job.payload.prefixIds.filter(
            (id): id is string => typeof id === "string",
          )
        : [];
      result = {
        stats: await scanAndReport(
          client,
          local,
          state,
          "manual",
          job.id,
          prefixIds,
        ),
      };
    } else {
      if (platform !== "win32")
        throw new JobRejected(
          "DHCP/DNS-Aufträge sind nur mit dem Agenten auf Windows möglich.",
        );
      if (!local.allowWrites || !state.config.allowWrites) {
        throw new JobRejected(
          "Schreiben ist in der lokalen config.json nicht erlaubt (allowWrites).",
        );
      }
      const plan = planWriteJob(job, {
        dhcp: local.dhcpServers ?? state.config.dhcpServers,
        dns: local.dnsServers ?? state.config.dnsServers,
      });
      result = await runPowerShell(
        local.powershell,
        plan.script,
        plan.params,
        120_000,
      );
    }
    await client.post({
      action: "jobResult",
      jobId: job.id,
      ok: true,
      result: { output: result ?? null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`Auftrag ${job.id} fehlgeschlagen: ${message}`);
    await client
      .post({
        action: "jobResult",
        jobId: job.id,
        ok: false,
        error: message.slice(0, 1000),
      })
      .catch((failure) =>
        log.error("Ergebnis konnte nicht gemeldet werden", failure),
      );
  }
}

async function main(): Promise<void> {
  const configPath = argument("--config") ?? defaultConfigPath();
  let local: LocalConfig;
  try {
    local = loadLocalConfig(configPath);
  } catch (error) {
    log.error(
      error instanceof ConfigError
        ? error.message
        : "Konfiguration nicht lesbar",
      error,
    );
    process.exitCode = 2;
    return;
  }
  setLogLevel(local.logLevel);
  const client = new NextdeskClient(local.nextdeskUrl, local.agentToken);
  log.info(
    `nextDesk-IPAM-Agent ${VERSION} (${platform}) startet, Konfiguration ${configPath}`,
  );

  if (process.argv.includes("--check")) {
    const state = await hello(client, local);
    log.info(
      `Verbindung OK: Agent «${state.agent?.name ?? "?"}», ${state.subnets.length} Subnetze, ${state.config.snmpTargets.length} SNMP-Ziele, ${state.jobs.length} Aufträge`,
    );
    for (const job of state.jobs) await runJob(client, local, state, job);
    return;
  }

  let nextScanAt = 0;
  let firstScan = true;
  while (!stopping) {
    let pollSeconds = 60;
    try {
      const state = await hello(client, local);
      pollSeconds = Math.min(Math.max(state.pollSeconds ?? 60, 15), 600);
      for (const job of state.jobs) {
        if (stopping) break;
        await runJob(client, local, state, job);
        if (job.kind === "scan_now")
          nextScanAt = Date.now() + state.config.scheduleMinutes * 60_000;
      }
      if (!stopping && Date.now() >= nextScanAt) {
        await scanAndReport(
          client,
          local,
          state,
          firstScan ? "startup" : "schedule",
          null,
        );
        firstScan = false;
        nextScanAt = Date.now() + state.config.scheduleMinutes * 60_000;
      }
      if (process.argv.includes("--once")) break;
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        log.error(
          `nextDesk lehnt den Agenten ab (${error.code}). Token prüfen oder Agent in nextDesk aktivieren.`,
        );
        pollSeconds = 300;
      } else {
        log.error("Durchlauf fehlgeschlagen", error);
      }
      if (process.argv.includes("--once")) {
        process.exitCode = 1;
        break;
      }
    }
    if (!stopping) await sleep(pollSeconds * 1000);
  }
  log.info("Agent beendet");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    wake?.();
  });
}

void main();
