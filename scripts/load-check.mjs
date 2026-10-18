#!/usr/bin/env node

const APP_URL = "https://app.nextdesk.ch/";
const FUNCTION_URL =
  "https://ewizsylzrwogsztsthbl.supabase.co/functions/v1/requester-portal";
const DEFAULT_REQUESTS = 60;
const DEFAULT_CONCURRENCY = 4;

function readBoundedInteger(name, fallback, maximum) {
  const rawValue = process.env[name];
  if (rawValue === undefined) return fallback;

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(
      `${name} muss eine ganze Zahl zwischen 1 und ${maximum} sein.`,
    );
  }
  return value;
}

function percentile(values, percentage) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * percentage) - 1];
}

function formatMilliseconds(value) {
  return value === null ? "–" : `${value.toFixed(1)} ms`;
}

async function performRequest(target) {
  const startedAt = performance.now();
  try {
    const response = await fetch(target.url, target.options);
    return {
      duration: performance.now() - startedAt,
      error: response.ok ? null : `HTTP ${response.status}`,
      name: target.name,
      status: response.status,
    };
  } catch (error) {
    return {
      duration: performance.now() - startedAt,
      error: error instanceof Error ? error.message : "Netzwerkfehler",
      name: target.name,
      status: null,
    };
  }
}

async function runWithConcurrency(targets, concurrency) {
  const results = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < targets.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await performRequest(targets[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

function summarize(name, results) {
  const durations = results.map((result) => result.duration);
  const errors = results.filter((result) => result.error !== null);
  const statuses = new Map();
  for (const result of results) {
    const label =
      result.status === null ? "Netzwerkfehler" : `HTTP ${result.status}`;
    statuses.set(label, (statuses.get(label) ?? 0) + 1);
  }

  return {
    errors,
    line: `${name}: ${results.length} Anfragen, Fehler ${errors.length}, p50 ${formatMilliseconds(percentile(durations, 0.5))}, p95 ${formatMilliseconds(percentile(durations, 0.95))}, Status ${[...statuses.entries()].map(([status, count]) => `${status} × ${count}`).join(", ")}`,
  };
}

try {
  const requestCount = readBoundedInteger(
    "NEXTDESK_LOAD_REQUESTS",
    DEFAULT_REQUESTS,
    DEFAULT_REQUESTS,
  );
  const concurrency = readBoundedInteger(
    "NEXTDESK_LOAD_CONCURRENCY",
    DEFAULT_CONCURRENCY,
    DEFAULT_CONCURRENCY,
  );
  const staticRequests = Math.ceil(requestCount / 2);
  const preflightRequests = requestCount - staticRequests;
  const targets = [
    ...Array.from({ length: staticRequests }, () => ({
      name: "Statische Startseite",
      options: { cache: "no-store", redirect: "error" },
      url: APP_URL,
    })),
    ...Array.from({ length: preflightRequests }, () => ({
      name: "CORS-Preflight requester-portal",
      options: {
        cache: "no-store",
        headers: {
          Origin: "https://app.nextdesk.ch",
          "Access-Control-Request-Headers": "authorization,apikey,content-type",
          "Access-Control-Request-Method": "POST",
        },
        method: "OPTIONS",
        redirect: "error",
      },
      url: FUNCTION_URL,
    })),
  ];

  console.log(
    `Schonender Lastcheck: ${requestCount} Anfragen, Parallelität ${concurrency}, keine Anmeldung und keine Schreibvorgänge.`,
  );
  const results = await runWithConcurrency(targets, concurrency);
  const staticSummary = summarize(
    "Statische Startseite",
    results.filter((result) => result.name === "Statische Startseite"),
  );
  const preflightSummary = summarize(
    "CORS-Preflight requester-portal",
    results.filter(
      (result) => result.name === "CORS-Preflight requester-portal",
    ),
  );

  console.log(staticSummary.line);
  console.log(preflightSummary.line);

  const errors = [...staticSummary.errors, ...preflightSummary.errors];
  if (errors.length > 0) {
    console.error("Lastcheck fehlgeschlagen:");
    for (const error of errors) {
      console.error(`- ${error.name}: ${error.error}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Lastcheck erfolgreich.");
  }
} catch (error) {
  console.error(
    `Lastcheck fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
