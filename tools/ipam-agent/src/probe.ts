/** Ping sweep, local neighbour tables (ARP/NDP) and reverse DNS. */

import { execFile } from "node:child_process";
import { reverse } from "node:dns/promises";

import { log } from "./log.ts";
import {
  type Neighbor,
  parseNeighborOutput,
  parsePingOutput,
  pingArgs,
  type Platform,
} from "./parsers.ts";

function run(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (_error, stdout) => {
        // Non-zero exit (no reply) is a normal result; parse whatever came back.
        resolve(String(stdout ?? ""));
      },
    );
  });
}

/** Runs `worker` for all items with limited concurrency. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await worker(items[index]!);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

export async function pingSweep(
  platform: Platform,
  addresses: readonly string[],
  timeoutMs: number,
  concurrency: number,
): Promise<string[]> {
  const command = platform === "win32" ? "ping.exe" : "ping";
  const alive: string[] = [];
  await mapLimit(addresses, concurrency, async (address) => {
    const output = await run(
      command,
      pingArgs(platform, address, timeoutMs),
      timeoutMs + 3000,
    );
    if (parsePingOutput(output).alive) alive.push(address);
  });
  return alive;
}

/** Local neighbour cache (after the sweep, so it is fresh). */
export async function localNeighbors(platform: Platform): Promise<Neighbor[]> {
  if (platform === "win32") {
    const [arp, ndp] = await Promise.all([
      run("arp.exe", ["-a"], 15000),
      run("netsh.exe", ["interface", "ipv6", "show", "neighbors"], 15000),
    ]);
    return parseNeighborOutput(`${arp}\n${ndp}`);
  }
  if (platform === "linux") {
    const output = await run("ip", ["neigh", "show"], 15000);
    if (output.trim()) return parseNeighborOutput(output);
  }
  return parseNeighborOutput(await run("arp", ["-an"], 15000));
}

/** PTR lookups via the system resolver (for hostnames of unknown devices). */
export async function reverseLookup(
  addresses: readonly string[],
  concurrency = 32,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  await mapLimit(addresses, concurrency, async (address) => {
    try {
      const result = await Promise.race([
        reverse(address),
        new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 3000)),
      ]);
      const name = result[0]?.replace(/\.$/, "").toLowerCase();
      if (name && /^[a-z0-9_.-]{1,253}$/.test(name)) names.set(address, name);
    } catch {
      // no PTR record
    }
  });
  log.debug(
    `Reverse-DNS: ${names.size} von ${addresses.length} Adressen mit Namen`,
  );
  return names;
}
