import { describe, expect, it } from "vitest";
import {
  knowledgeEditorDialogTabIndex,
  shouldCloseKnowledgeEditor,
} from "./knowledge-editor-dialog";

describe("Wissenseditor-Dialog", () => {
  it("schliesst mit Escape, solange keine Speicherung läuft", () => {
    expect(shouldCloseKnowledgeEditor("Escape", false)).toBe(true);
  });

  it("bleibt während einer Speicherung offen und reagiert nicht auf andere Tasten", () => {
    expect(shouldCloseKnowledgeEditor("Escape", true)).toBe(false);
    expect(shouldCloseKnowledgeEditor("Enter", false)).toBe(false);
  });

  it("behält während des Speicherns einen sequenziell fokussierbaren Dialoganker", () => {
    expect(knowledgeEditorDialogTabIndex(false)).toBe(-1);
    expect(knowledgeEditorDialogTabIndex(true)).toBe(0);
  });
});
