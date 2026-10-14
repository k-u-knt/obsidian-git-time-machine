import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({ MarkdownView: class {} }));
const { textTargetFor } = await import("../../src/restore/targets");

describe("textTargetFor", () => {
  const app = { workspace: { getLeavesOfType: () => [] }, vault: {} } as never;

  it("uses the canvas target (data comparison, save-before-write) for .canvas files", () => {
    const t = textTargetFor(app, { path: "Maps/a.canvas" } as never);
    expect(typeof t.same).toBe("function");
    expect(typeof t.flush).toBe("function");
  });

  it("uses the editor-aware text target for notes", () => {
    const t = textTargetFor(app, { path: "a.md" } as never);
    expect(t.same).toBeUndefined();
  });
});
