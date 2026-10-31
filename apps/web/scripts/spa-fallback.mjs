// Der Webspace kennt keine Umleitung auf index.html. Damit der Autorisierungs-
// pfad des OAuth-Servers (/oauth/consent) die App lädt, wird die gebaute
// index.html zusätzlich dort abgelegt. Die App erkennt den Pfad selbst.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const target = join(dist, "oauth", "consent");
mkdirSync(target, { recursive: true });
copyFileSync(join(dist, "index.html"), join(target, "index.html"));
console.log("oauth/consent/index.html erstellt");
