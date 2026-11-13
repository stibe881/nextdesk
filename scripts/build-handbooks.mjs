#!/usr/bin/env node
/**
 * Bundles the handbooks in docs/handbooks/*.md (plus referenced screenshots
 * in docs/handbooks/images/) into docs/handbooks/handbooks.bundle.json.
 *
 * Every handbook exists in two wordings: informal «du» (docs/handbooks/*.md,
 * the default) and formal (docs/handbooks/sie/*.md). Both must have the
 * same headings and screenshots; the bundle carries the formal wording in the
 * `sie` property of each handbook (migration 0330).
 *
 *   node scripts/build-handbooks.mjs          regenerate the bundle
 *   node scripts/build-handbooks.mjs --check  fail if the bundle is stale
 *
 * The database loads this bundle from a pinned commit
 * (public.request_handbook_sync / apply_handbook_sync, migrations 0246 and
 * 0330), and the handbooks Function serves it only to the roles that may read
 * it, in the form of address of the tenant. The
 * Markdown files are the single source of truth; never edit the bundle.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(root, "docs", "handbooks");
const sieDir = join(sourceDir, "sie");
const imageDir = join(sourceDir, "images");
const target = join(sourceDir, "handbooks.bundle.json");

const ORDER = ["mitarbeitende", "agenten", "administratoren", "installation"];
const MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const MAX_IMAGE_BYTES = 400 * 1024;

function fail(message) {
  console.error(`build-handbooks: ${message}`);
  process.exit(1);
}

function parseFrontMatter(source, file) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!match) fail(`${file}: Front Matter (---) fehlt.`);
  const meta = {};
  for (const line of match[1].split("\n")) {
    const pair = /^([a-zA-Z]+):\s*(.*)$/.exec(line.trim());
    if (pair) meta[pair[1]] = pair[2].replace(/^"(.*)"$/, "$1");
  }
  for (const key of ["title", "description", "audienceLabel", "updated"]) {
    if (!meta[key]) fail(`${file}: Front-Matter-Feld «${key}» fehlt.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.updated)) {
    fail(`${file}: «updated» muss das Format JJJJ-MM-TT haben.`);
  }
  return { meta, body: source.slice(match[0].length).trim() + "\n" };
}

/** Headings outside code fences, in order. */
function headingsOf(body) {
  const headings = [];
  let fenced = false;
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (!fenced && /^#{1,6}\s/.test(line)) headings.push(line.trim());
  }
  return headings;
}

function imagesOf(label, body) {
  const names = [];
  for (const [, name] of body.matchAll(/\]\(images\/([^)]+)\)/g)) {
    if (!/^[A-Za-z0-9._-]+$/.test(name))
      fail(`${label}: ungültiger Bildname ${name}`);
    if (!existsSync(join(imageDir, name)))
      fail(`${label}: Bild images/${name} fehlt.`);
    names.push(name);
  }
  return names;
}

function readHandbook(dir, id, label) {
  const file = join(dir, `${id}.md`);
  if (!existsSync(file)) fail(`${label} fehlt.`);
  return parseFrontMatter(readFileSync(file, "utf8"), label);
}

const handbooks = [];
const usedImages = new Set();
for (const id of ORDER) {
  const du = readHandbook(sourceDir, id, `docs/handbooks/${id}.md`);
  const sie = readHandbook(sieDir, id, `docs/handbooks/sie/${id}.md`);
  const duImages = imagesOf(`${id}.md`, du.body);
  const sieImages = imagesOf(`sie/${id}.md`, sie.body);
  if (JSON.stringify(duImages) !== JSON.stringify(sieImages)) {
    fail(
      `${id}: die du- und die förmliche Fassung haben nicht dieselben Bilder.`,
    );
  }
  const duHeadings = headingsOf(du.body);
  const sieHeadings = headingsOf(sie.body);
  if (JSON.stringify(duHeadings) !== JSON.stringify(sieHeadings)) {
    const index = duHeadings.findIndex(
      (heading, position) => heading !== sieHeadings[position],
    );
    fail(
      `${id}: die du- und die förmliche Fassung haben nicht dieselben Überschriften (erste Abweichung: «${duHeadings[index] ?? "–"}» gegen «${sieHeadings[index] ?? "–"}»).`,
    );
  }
  for (const name of duImages) usedImages.add(name);
  handbooks.push({
    id,
    title: du.meta.title,
    description: du.meta.description,
    audienceLabel: du.meta.audienceLabel,
    // One date per handbook: the later of both wordings.
    updatedAt:
      du.meta.updated >= sie.meta.updated ? du.meta.updated : sie.meta.updated,
    markdown: du.body,
    sie: {
      title: sie.meta.title,
      description: sie.meta.description,
      audienceLabel: sie.meta.audienceLabel,
      markdown: sie.body,
    },
  });
}

const images = {};
for (const name of [...usedImages].sort()) {
  const mime = MIME[extname(name).toLowerCase()];
  if (!mime) fail(`images/${name}: nicht unterstütztes Format.`);
  const bytes = readFileSync(join(imageDir, name));
  if (bytes.length > MAX_IMAGE_BYTES) {
    fail(`images/${name} ist grösser als ${MAX_IMAGE_BYTES / 1024} KB.`);
  }
  images[name] = { mime, data: bytes.toString("base64") };
}

const unused = existsSync(imageDir)
  ? readdirSync(imageDir).filter(
      (name) => !usedImages.has(name) && !name.startsWith("."),
    )
  : [];
if (unused.length) {
  fail(
    `Nicht referenzierte Bilder in docs/handbooks/images: ${unused.join(", ")}`,
  );
}

const output = JSON.stringify({ handbooks, images }) + "\n";

if (process.argv.includes("--check")) {
  const current = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (current !== output) {
    fail(
      "docs/handbooks/handbooks.bundle.json ist veraltet. Bitte «node scripts/build-handbooks.mjs» ausführen.",
    );
  }
  console.log(
    `Handbücher aktuell (${handbooks.length} Handbücher, ${usedImages.size} Bilder).`,
  );
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, output);
  console.log(
    `Handbücher generiert (${handbooks.length} Handbücher, ${usedImages.size} Bilder).`,
  );
}
