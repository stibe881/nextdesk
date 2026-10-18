#!/usr/bin/env node

import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distIndex = join(rootDir, "apps/web/dist/index.html");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    ...options,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} ist fehlgeschlagen.`);
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Freier lokaler Port konnte nicht ermittelt werden."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForPreview(url, child) {
  const deadline = Date.now() + 30_000;
  let lastError = "keine Antwort";

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Vite-Vorschau wurde unerwartet mit Code ${child.exitCode} beendet.`,
      );
    }

    try {
      const response = await fetch(url, { redirect: "error" });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "nicht erreichbar";
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Vite-Vorschau nicht erreichbar: ${lastError}`);
}

function runPlaywright(url) {
  const python = String.raw`import asyncio
import sys
from playwright.async_api import async_playwright

URL = sys.argv[1]
FORBIDDEN_WORKSPACE_LABELS = (
    "Übersicht",
    "Arbeitsplatz",
    "Erwähnungen",
    "Mein Portal",
    "Aktive Tickets",
    "Mandant auswählen",
    "Mandant wechseln",
)

async def main():
    console_errors = []
    page_errors = []

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=1,
        )
        page = await context.new_page()
        page.on(
            "console",
            lambda message: console_errors.append(message.text)
            if message.type == "error"
            else None,
        )
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        response = await page.goto(URL, wait_until="domcontentloaded", timeout=30_000)
        if response is None or not response.ok:
            raise AssertionError("Die lokale Startseite wurde nicht erfolgreich geladen.")

        await page.get_by_role(
            "button", name="MIT SSO ANMELDEN", exact=True
        ).wait_for(state="visible", timeout=10_000)

        visible_text = await page.locator("body").inner_text()
        visible_workspace_labels = [
            label for label in FORBIDDEN_WORKSPACE_LABELS if label in visible_text
        ]
        if visible_workspace_labels:
            raise AssertionError(
                "Vor der Anmeldung sichtbare Arbeitsbereichsinhalte: "
                + ", ".join(visible_workspace_labels)
            )

        dimensions = await page.evaluate(
            """() => ({
                body: document.body.scrollWidth,
                document: document.documentElement.scrollWidth,
                viewport: window.innerWidth,
            })"""
        )
        if dimensions["body"] > dimensions["viewport"] or dimensions["document"] > dimensions["viewport"]:
            raise AssertionError(
                "Horizontales Scrollen bei 390 px erkannt: " + str(dimensions)
            )

        await page.wait_for_timeout(750)
        if console_errors or page_errors:
            raise AssertionError(
                "Konsolenfehler: "
                + " | ".join(console_errors + page_errors)
            )

        await context.close()
        await browser.close()

asyncio.run(main())
print("Unauthentifizierter Browser-Test erfolgreich (390 px, keine Konsolenfehler).")
`;

  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", python, url], {
      cwd: rootDir,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `Playwright-Prüfung fehlgeschlagen (${signal ?? `Code ${code}`}).`,
          ),
        );
      }
    });
  });
}

async function stopPreview(child) {
  if (child.exitCode !== null) return;

  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

let preview;
try {
  if (!existsSync(distIndex)) {
    console.log(
      "Kein vorhandenes Web-Bundle gefunden; baue einmal im Hetzner-Modus.",
    );
    run(pnpmCommand, ["--filter", "@nextdesk/web", "build:hetzner"]);
  } else {
    console.log("Vorhandenes apps/web/dist wird ohne Neubau geprüft.");
  }

  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}/`;
  preview = spawn(
    pnpmCommand,
    [
      "--filter",
      "@nextdesk/web",
      "exec",
      "vite",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: rootDir, stdio: "inherit" },
  );
  preview.once("error", (error) => {
    console.error(
      `Vite-Vorschau konnte nicht gestartet werden: ${error.message}`,
    );
  });

  await waitForPreview(url, preview);
  await runPlaywright(url);
} catch (error) {
  console.error(
    `Unauthentifizierter E2E-Test fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  if (preview) await stopPreview(preview);
}
