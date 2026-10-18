import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2] ?? "apps/web/dist/assets";
const limits = { ".js": 400 * 1024, ".css": 50 * 1024 };
const files = await readdir(root, { recursive: true, withFileTypes: true });
const results = await Promise.all(
  files
    .filter((entry) => entry.isFile())
    .map(async (entry) => {
      const extension = entry.name.slice(entry.name.lastIndexOf("."));
      if (!(extension in limits)) return null;
      const file = join(entry.parentPath, entry.name);
      const gzippedBytes = gzipSync(await readFile(file), {
        level: 9,
      }).byteLength;
      return { file, extension, gzippedBytes };
    }),
);
let failed = false;
for (const result of results.filter(Boolean)) {
  const limit = limits[result.extension];
  const status = result.gzippedBytes > limit ? "EXCEEDED" : "ok";
  console.log(
    `${status} ${result.file}: ${(result.gzippedBytes / 1024).toFixed(1)} KiB gzip / ${(limit / 1024).toFixed(0)} KiB`,
  );
  failed ||= result.gzippedBytes > limit;
}
if (failed) process.exitCode = 1;
