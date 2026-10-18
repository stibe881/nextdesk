// Fails when screens or components use fixed colour values instead of the
// nextDesk colour roles from theme.config.js. The sign-in screens intentionally
// keep their fixed Gross-ICT light design and are excluded.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const allowed = new Set([
  "app/auth.tsx",
  "app/auth/callback.tsx",
  "app/dev/theme-lab.tsx",
]);
const pattern = /#[0-9a-fA-F]{3,8}\b|rgba?\(/g;

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx|ts)$/.test(name) ? [path] : [];
  });
}

const findings: string[] = [];
for (const path of [
  ...files(join(root, "app")),
  ...files(join(root, "components")),
]) {
  const file = relative(root, path);
  if (allowed.has(file)) continue;
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, index) => {
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*"))
        return;
      if (pattern.test(line))
        findings.push(`${file}:${index + 1}: ${line.trim()}`);
      pattern.lastIndex = 0;
    });
}
if (findings.length > 0) {
  console.error(findings.join("\n"));
  console.error(
    `\n${findings.length} feste Farbwerte gefunden. Bitte Farbrollen aus theme.config.js verwenden.`,
  );
  process.exit(1);
}
console.log("Keine festen Farbwerte in Bildschirmen und Komponenten.");
