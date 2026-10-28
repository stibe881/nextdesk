import { readFile, readdir } from "node:fs/promises";

const catalogPath = new URL(
  "../packages/permissions/src/catalog.ts",
  import.meta.url,
);
const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const catalog = await readFile(catalogPath, "utf8");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => /^\d+_[a-z0-9_]+\.sql$/i.test(file))
  .sort();
const migrations = await Promise.all(
  migrationFiles.map((file) => readFile(new URL(file, migrationsDirectory), "utf8")),
);
const migration = migrations.join("\n");

const catalogSection = catalog.match(
  /export const permissionCodes = \[(?<items>[\s\S]*?)\] as const;/,
)?.groups?.items;
if (!catalogSection) {
  throw new Error("Cannot find the TypeScript permission catalogue.");
}

const sourceCodes = [...catalogSection.matchAll(/"(?<code>[^"]+)"/g)].map(
  (match) => match.groups.code,
);
const seededCodes = [
  ...migration.matchAll(/\('(?<code>[^']+)', '[^']+', (?:true|false)\)/g),
].map((match) => match.groups.code);

const missingInSeed = sourceCodes.filter((code) => !seededCodes.includes(code));
const staleSeed = seededCodes.filter((code) => !sourceCodes.includes(code));
if (missingInSeed.length || staleSeed.length) {
  throw new Error(
    `Permission catalogue mismatch. Missing in SQL: ${missingInSeed.join(", ") || "none"}; stale in SQL: ${staleSeed.join(", ") || "none"}.`,
  );
}

console.log(
  `Validated ${sourceCodes.length} permission codes against the database seed migration.`,
);
