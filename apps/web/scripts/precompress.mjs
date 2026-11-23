// Legt für JS/CSS/SVG/JSON vorkomprimierte Fassungen (.br, .gz) neben die
// Dateien. Die .htaccess liefert sie aus, wenn der Browser sie unterstützt.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const pattern = /\.(js|css|svg|json|html)$/;
let files = 0;
let before = 0;
let after = 0;

function walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!pattern.test(name) || name === "index.html") continue;
    const content = readFileSync(path);
    if (content.byteLength < 1024) continue;
    const brotli = brotliCompressSync(content, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    });
    writeFileSync(`${path}.br`, brotli);
    writeFileSync(`${path}.gz`, gzipSync(content, { level: 9 }));
    files += 1;
    before += content.byteLength;
    after += brotli.byteLength;
  }
}

walk(dist);
console.log(
  `${files} Dateien vorkomprimiert: ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(1)} MB (Brotli)`,
);
