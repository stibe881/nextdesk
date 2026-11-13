#!/usr/bin/env node
/**
 * Verifies the form of address and the absence of emojis in all texts.
 *
 * Rules
 *  1. The default wording is informal («du»). A formal form («Sie», «Ihr …»)
 *     may only appear as the LAST argument of `tn(du, sie)`,
 *     `tone(formality, du, sie)` or `msg(du, sie)` in code, or inside the
 *     «sie» handbooks (`docs/handbooks/sie/`).
 *  2. A text that addresses a person with «du» («dir», «dein …») needs a Sie
 *     wording: it must be an argument of `tn`/`tone`/`msg`.
 *  3. No emojis or pictographs in texts.
 *  4. In the web app `tn()` must not run at module level (it would be
 *     evaluated once at import, before the form of address is known): call it
 *     inside a function or component. Use icons (lucide in the web app,
 *     the icon set of the mobile app) or plain words instead.
 *
 * Exceptions: a line (or the line before) that contains `formality-ok` or
 * `emoji-ok` is skipped. Test files are not checked for rule 1.
 *
 *   node scripts/verify-formality.mjs          check everything
 *   node scripts/verify-formality.mjs --list   print every finding
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const listAll = process.argv.includes("--list");
// --only=apps/web/src/a.tsx,apps/web/src/b.tsx  (prefixes) limits the report.
const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
const only = onlyArg ? onlyArg.slice(7).split(",").filter(Boolean) : null;

const FORMAL = /\b(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)\b/;
const INFORMAL =
  /\b(du|Du|dich|Dich|dir|Dir|dein|Dein|deine|Deine|deinen|Deinen|deinem|Deinem|deiner|Deiner|deines|Deines)\b/;
// Pictographs and emoji; plain typographic arrows, bullets and the like stay allowed.
const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2B55}\u{231A}\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25B6}\u{25C0}\u{2705}\u{274C}\u{2753}-\u{2755}\u{2757}\u{2795}-\u{2797}\u{27B0}\u{27BF}\u{FE0F}]/u;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".expo",
  ".turbo",
  "Pods",
  "ios",
  "android",
]);
const CODE_EXT = new Set([".ts", ".tsx"]);
const TEXT_EXT = new Set([
  ".md",
  ".html",
  ".yml",
  ".yaml",
  ".txt",
  ".css",
  ".mjs",
  ".js",
  ".cjs",
  ".json",
  ".sql",
]);
// Historical migrations contain old seed texts; new texts belong to code.
const SKIP_PATHS = [
  "supabase/migrations/",
  "docs/handbooks/sie/",
  "docs/texte-anrede.md",
  "docs/handbooks/handbooks.bundle.json",
  "scripts/verify-formality.mjs",
  "supabase/functions/_shared/formality.ts",
  "pnpm-lock.yaml",
  "package-lock.json",
];
const HELPERS = new Set(["tn", "tone", "msg"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const findings = [];
function report(file, line, kind, text) {
  findings.push({ file, line, kind, text: text.trim().slice(0, 140) });
}

function lineExempt(lines, index, marker) {
  return (
    lines[index]?.includes(marker) || lines[index - 1]?.includes(marker)
  );
}

function isTestFile(path) {
  return /\.(test|spec)\.[tj]sx?$/.test(path) || path.includes("/tests/");
}

function checkCode(path, source) {
  const lines = source.split("\n");
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const testFile = isTestFile(path);

  // "last": inside the last argument (the Sie wording); "any": inside any argument.
  function insideHelperArgument(node, mode = "last") {
    for (let current = node; current.parent; current = current.parent) {
      const parent = current.parent;
      if (
        ts.isCallExpression(parent) &&
        ts.isIdentifier(parent.expression) &&
        HELPERS.has(parent.expression.text) &&
        (mode === "any" ||
          parent.arguments[parent.arguments.length - 1] === current)
      ) {
        return true;
      }
    }
    return false;
  }

  function insideFunction(node) {
    for (let current = node.parent; current; current = current.parent) {
      if (
        ts.isFunctionLike(current) ||
        ts.isClassLike(current) ||
        ts.isGetAccessor(current)
      ) {
        return true;
      }
    }
    return false;
  }

  function visit(node) {
    if (
      !testFile &&
      path.startsWith("apps/web/") &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "tn" &&
      !insideFunction(node)
    ) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
      if (!lineExempt(lines, line, "formality-ok")) {
        report(path, line + 1, "tn-Modulebene", node.getText(sourceFile).replace(/\s+/g, " "));
      }
    }
    let text = null;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      text = node.text ?? node.getText(sourceFile);
    }
    if (text !== null) {
      const start = ts.isJsxText(node) ? node.getStart(sourceFile) : node.getStart(sourceFile);
      const line = sourceFile.getLineAndCharacterOfPosition(start).line;
      if (!testFile && FORMAL.test(text) && !insideHelperArgument(node)) {
        if (!lineExempt(lines, line, "formality-ok")) {
          report(path, line + 1, "Sie", text.replace(/\s+/g, " "));
        }
      }
      if (
        !testFile &&
        INFORMAL.test(text) &&
        !/^(du|sie)$/i.test(text.trim()) &&
        !insideHelperArgument(node, "any") &&
        !lineExempt(lines, line, "formality-ok")
      ) {
        report(path, line + 1, "Du-ohne-Sie", text.replace(/\s+/g, " "));
      }
      if (EMOJI.test(text) && !lineExempt(lines, line, "emoji-ok")) {
        report(path, line + 1, "Emoji", text.replace(/\s+/g, " "));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function checkText(path, source) {
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    if (FORMAL.test(line) && !lineExempt(lines, index, "formality-ok")) {
      report(path, index + 1, "Sie", line);
    }
    if (EMOJI.test(line) && !lineExempt(lines, index, "emoji-ok")) {
      report(path, index + 1, "Emoji", line);
    }
  });
}

for (const full of walk(root)) {
  const path = relative(root, full).split(sep).join("/");
  if (only && !only.some((prefix) => path.startsWith(prefix))) continue;
  if (SKIP_PATHS.some((skip) => path.startsWith(skip) || path === skip)) {
    continue;
  }
  const ext = path.slice(path.lastIndexOf("."));
  if (CODE_EXT.has(ext)) {
    checkCode(path, readFileSync(full, "utf8"));
  } else if (TEXT_EXT.has(ext)) {
    checkText(path, readFileSync(full, "utf8"));
  }
}

const sie = findings.filter((f) => f.kind === "Sie");
const duOnly = findings.filter((f) => f.kind === "Du-ohne-Sie");
const moduleLevel = findings.filter((f) => f.kind === "tn-Modulebene");
const emoji = findings.filter((f) => f.kind === "Emoji");
const shown = listAll ? findings : findings.slice(0, 60);
for (const f of shown) console.log(`${f.file}:${f.line}: [${f.kind}] ${f.text}`);
if (!listAll && findings.length > shown.length) {
  console.log(`… und ${findings.length - shown.length} weitere (mit --list alle).`);
}
console.log(
  `\nverify-formality: ${sie.length} Stellen mit Sie-Form ausserhalb von tn()/tone()/msg(), ${duOnly.length} du-Texte ohne Sie-Fassung, ${moduleLevel.length} tn() auf Modulebene, ${emoji.length} Emojis.`,
);
process.exit(findings.length === 0 ? 0 : 1);
