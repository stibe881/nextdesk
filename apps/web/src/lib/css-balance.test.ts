import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// An unclosed brace in any stylesheet swallows every later rule of the
// bundle (e.g. into an @media block), so the whole app loses its styles.
function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

describe("stylesheets", () => {
  it("have balanced braces", () => {
    const root = join(__dirname, "..");
    const unbalanced = cssFiles(root).filter((file) => {
      const text = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/"[^"\n]*"|'[^'\n]*'/g, '""');
      return (text.match(/{/g) ?? []).length !== (text.match(/}/g) ?? []).length;
    });
    expect(unbalanced).toEqual([]);
  });
});
