#!/usr/bin/env node
/**
 * Bundles the handbooks in docs/handbooks/*.md (plus referenced screenshots
 * in docs/handbooks/images/) into docs/handbooks/handbooks.bundle.json.
 *
 *   node scripts/build-handbooks.mjs          regenerate the bundle
 *   node scripts/build-handbooks.mjs --check  fail if the bundle is stale
 *
 * The database loads this bundle from a pinned commit
 * (public.request_handbook_sync / apply_handbook_sync, migration 0246), and
 * the handbooks Function serves it only to the roles that may read it. The
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

const handbooks = [];
const usedImages = new Set();
for (const id of ORDER) {
  const file = join(sourceDir, `${id}.md`);
  if (!existsSync(file)) fail(`docs/handbooks/${id}.md fehlt.`);
  const { meta, body } = parseFrontMatter(
    readFileSync(file, "utf8"),
    `${id}.md`,
  );
  for (const [, name] of body.matchAll(/\]\(images\/([^)]+)\)/g)) {
    if (!/^[A-Za-z0-9._-]+$/.test(name))
      fail(`${id}.md: ungültiger Bildname ${name}`);
    if (!existsSync(join(imageDir, name)))
      fail(`${id}.md: Bild images/${name} fehlt.`);
    usedImages.add(name);
  }
  handbooks.push({
    id,
    title: meta.title,
    description: meta.description,
    audienceLabel: meta.audienceLabel,
    updatedAt: meta.updated,
    markdown: body,
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
