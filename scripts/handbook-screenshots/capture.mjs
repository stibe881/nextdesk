#!/usr/bin/env node
// Captures the screenshots for the user handbooks (docs/handbooks/images).
//
//   pnpm handbooks:screenshots                     all shots
//   pnpm handbooks:screenshots -- --only ag-kanban one shot (repeatable, comma list ok)
//   pnpm handbooks:screenshots -- --url http://127.0.0.1:5174
//                                                  reuse a running dev server
//   pnpm handbooks:screenshots -- --explore        log backend calls without
//                                                  demo data and print page text
//
// The web app runs against a fake Supabase backend (mock-backend.cjs) with
// Swiss demo data (demo-data.cjs); no credentials or real data are needed.
// Without --url a Vite dev server for apps/web is started on a free port.

import { createRequire } from "node:module";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { SHOTS } from "./shots.mjs";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const webRoot = join(repoRoot, "apps/web");
const outputDir = join(repoRoot, "docs/handbooks/images");
const mock = require("./mock-backend.cjs");

const VIEWPORT = { width: 1280, height: 800 };
const JPEG_QUALITY = 72;
const MAX_BYTES = 300 * 1024;

function parseArgs(argv) {
  const options = { only: [], url: null, explore: false, headed: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--only")
      options.only.push(...String(argv[++index] ?? "").split(","));
    else if (arg.startsWith("--only="))
      options.only.push(...arg.slice(7).split(","));
    else if (arg === "--url") options.url = argv[++index];
    else if (arg.startsWith("--url=")) options.url = arg.slice(6);
    else if (arg === "--explore") options.explore = true;
    else if (arg === "--headed") options.headed = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/handbook-screenshots/capture.mjs [--only name[,name]] [--url http://host:port] [--explore] [--headed]",
      );
      console.log(`Shots: ${SHOTS.map((shot) => shot.name).join(", ")}`);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  options.only = options.only
    .map((name) => name.trim().replace(/\.jpg$/, ""))
    .filter(Boolean);
  return options;
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function startVite() {
  process.env.VITE_SUPABASE_URL = mock.SUPABASE_URL;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_demo";
  const webRequire = createRequire(join(webRoot, "package.json"));
  const { createServer } = await import(webRequire.resolve("vite"));
  const port = await freePort();
  const server = await createServer({
    root: webRoot,
    configFile: join(webRoot, "vite.config.ts"),
    logLevel: "warn",
    clearScreen: false,
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      hmr: false,
      open: false,
    },
  });
  await server.listen();
  return { server, url: `http://127.0.0.1:${port}` };
}

/** Helpers handed to every shot. */
function helpers(page, baseUrl) {
  const h = {
    page,
    baseUrl,
    async open() {
      await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
      await h.settle();
    },
    /** Waits until no request is pending and fonts/images are loaded. */
    async settle(extraMs = 400) {
      await page
        .waitForLoadState("networkidle", { timeout: 15_000 })
        .catch(() => undefined);
      await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
      await page.waitForTimeout(extraMs);
    },
    async waitText(text, options = {}) {
      await page
        .getByText(text, { exact: false })
        .first()
        .waitFor({ state: "visible", timeout: options.timeout ?? 15_000 });
    },
    /** Clicks an entry of the left navigation, expanding its group first. */
    async nav(label) {
      const rail = page.locator("aside.command-rail");
      const matcher = { hasText: new RegExp(`^\\s*${label}\\s*\\d*\\s*$`) };
      const item = rail.locator("button.nav-item").filter(matcher).first();
      if (!(await item.isVisible().catch(() => false))) {
        const cluster = rail
          .locator(".navigation-cluster")
          .filter({ has: page.locator("button.nav-item").filter(matcher) });
        await cluster.locator(".navigation-cluster__toggle").click();
      }
      await item.click();
      await h.settle();
    },
    async click(name, options = {}) {
      const role = options.role ?? "button";
      await page
        .getByRole(role, { name, exact: options.exact ?? false })
        .first()
        .click();
      await h.settle(options.wait ?? 400);
    },
    async clickText(text, options = {}) {
      await page
        .getByText(text, { exact: options.exact ?? false })
        .first()
        .click();
      await h.settle(options.wait ?? 400);
    },
    /** Scrolls the page so that the first element with this text sits near the top. */
    async scrollToText(text, offset = 16) {
      await h.scrollTo(page.getByText(text, { exact: true }).first(), offset);
    },
    /** Scrolls the nearest scroll container so that the locator sits `offset` px below its top. */
    async scrollTo(locator, offset = 16) {
      const target = locator.first();
      await target.waitFor({ state: "attached", timeout: 10_000 });
      await target.evaluate((element, gap) => {
        let node = element.parentElement;
        while (node && node !== document.body) {
          const style = getComputedStyle(node);
          if (
            /(auto|scroll)/.test(style.overflowY) &&
            node.scrollHeight > node.clientHeight + 4
          ) {
            node.scrollTop +=
              element.getBoundingClientRect().top -
              node.getBoundingClientRect().top -
              gap;
            return;
          }
          node = node.parentElement;
        }
        window.scrollBy(0, element.getBoundingClientRect().top - gap);
      }, offset);
      await page.waitForTimeout(200);
    },
    /** Scrolls every scrollable dialog/modal container back to the top. */
    async scrollModalToTop() {
      await page.evaluate(() => {
        for (const element of document.querySelectorAll(
          "[role=dialog], dialog, [aria-modal=true], [role=dialog] *",
        )) {
          if (element.scrollHeight > element.clientHeight + 4)
            element.scrollTop = 0;
        }
      });
      await page.waitForTimeout(150);
    },
    async openPersonalSettings() {
      await page
        .getByRole("button", { name: "Persönliche Einstellungen öffnen" })
        .click();
      await h.settle();
    },
  };
  return h;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const shots = options.only.length
    ? SHOTS.filter((shot) => options.only.includes(shot.name))
    : SHOTS;
  const unknown = options.only.filter(
    (name) => !SHOTS.some((shot) => shot.name === name),
  );
  if (unknown.length) {
    console.error(`Unknown shot(s): ${unknown.join(", ")}`);
    process.exit(2);
  }
  mkdirSync(outputDir, { recursive: true });

  let vite = null;
  let baseUrl = options.url?.replace(/\/$/, "");
  if (!baseUrl) {
    vite = await startVite();
    baseUrl = vite.url;
    console.log(`Vite dev server: ${baseUrl}`);
  }

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: !options.headed });
  const results = [];
  try {
    for (const shot of shots) {
      const started = Date.now();
      const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 1,
        locale: "de-CH",
        timezoneId: "Europe/Zurich",
        colorScheme: "light",
      });
      const misses = [];
      await mock.install(context, shot.persona, {
        onMiss: (line) => misses.push(line),
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const file = join(outputDir, `${shot.name}.jpg`);
      try {
        await shot.run(helpers(page, baseUrl));
        await page.mouse
          .move(VIEWPORT.width - 5, VIEWPORT.height - 5)
          .catch(() => undefined);
        await page.waitForTimeout(250);
        await page.screenshot({
          path: file,
          type: "jpeg",
          quality: JPEG_QUALITY,
          animations: "disabled",
          caret: "initial",
        });
        const bytes = statSync(file).size;
        results.push({
          name: shot.name,
          ok: bytes <= MAX_BYTES,
          bytes,
          ms: Date.now() - started,
          note: bytes > MAX_BYTES ? "larger than 300 KB" : "",
        });
      } catch (error) {
        results.push({
          name: shot.name,
          ok: false,
          bytes: 0,
          ms: Date.now() - started,
          note: String(error.message ?? error).split("\n")[0],
        });
        if (options.explore)
          await page
            .screenshot({ path: file, type: "jpeg", quality: JPEG_QUALITY })
            .catch(() => undefined);
      }
      if (options.explore) {
        console.log(`\n=== ${shot.name} (${shot.persona ?? "signed out"}) ===`);
        for (const line of [...new Set(misses)]) console.log("MISS", line);
        for (const error of errors) console.log("PAGEERROR", error);
        const text = await page.innerText("body").catch(() => "");
        console.log(text.replace(/\n{2,}/g, "\n").slice(0, 2500));
      } else if (misses.length && process.env.HANDBOOK_SCREENSHOTS_VERBOSE) {
        console.log(`${shot.name}: ${misses.length} unmocked backend calls`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    if (vite) await vite.server.close();
  }

  console.log("\nHandbook screenshots");
  for (const result of results) {
    const size = result.bytes
      ? `${Math.round(result.bytes / 1024)} KB`.padStart(7)
      : "      -";
    console.log(
      `${result.ok ? "ok  " : "FAIL"} ${result.name.padEnd(22)} ${size}  ${(result.ms / 1000).toFixed(1)} s  ${result.note}`,
    );
  }
  const failed = results.filter((result) => !result.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} saved to ${outputDir}`,
  );
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
