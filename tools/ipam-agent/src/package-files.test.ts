import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("install-service.ps1 hat eine UTF-8-Kennung (BOM)", () => {
  // Windows PowerShell 5.1 liest eine Datei ohne BOM als ANSI: Umlaute in den
  // Meldungen und im Dienstnamen würden verstümmelt.
  const bytes = readFileSync(
    new URL("../windows/install-service.ps1", import.meta.url),
  );
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});
