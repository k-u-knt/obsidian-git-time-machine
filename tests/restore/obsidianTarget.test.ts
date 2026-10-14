import { describe, expect, it, vi } from "vitest";

// Minimal stand-in for Obsidian's MarkdownView: only what obsidianTextTarget touches.
vi.mock("obsidian", () => ({
  MarkdownView: class {
    file: { path: string } | null = null;
    mode = "source";
    editor = { value: "", transactions: 0 };
    getMode() {
      return this.mode;
    }
  },
}));

const { MarkdownView } = await import("obsidian");
const { obsidianTextTarget } = await import("../../src/restore/obsidianTarget");

function setup(mode: "source" | "preview", disk: string, editorText: string) {
  const view = new (MarkdownView as unknown as new () => {
    file: { path: string };
    mode: string;
    editor: { getValue(): string; offsetToPos(o: number): number; transaction(tx: unknown): void };
  })();
  view.file = { path: "n.md" };
  view.mode = mode;
  let text = editorText;
  const editorTx: unknown[] = [];
  view.editor = {
    getValue: () => text,
    offsetToPos: (o: number) => o,
    transaction: (tx: unknown) => {
      editorTx.push(tx);
      text = "edited-by-editor";
    },
  };
  const vault = {
    disk,
    read: async () => vault.disk,
    process: async (_f: unknown, fn: (d: string) => string) => {
      vault.disk = fn(vault.disk);
    },
  };
  const app = { workspace: { getLeavesOfType: () => [{ view }] }, vault };
  const target = obsidianTextTarget(app as never, { path: "n.md" } as never);
  return { target, vault, editorTx };
}

describe("obsidianTextTarget", () => {
  it("writes through the editor when the note is open for editing", async () => {
    const { target, vault, editorTx } = setup("source", "old", "old");
    await target.write({ from: 0, to: 3, text: "new" }, "old");
    expect(editorTx).toHaveLength(1);
    expect(vault.disk).toBe("old");
  });

  it("writes to the file when the note is open in reading view", async () => {
    const { target, vault, editorTx } = setup("preview", "old", "old");
    expect(await target.read()).toBe("old");
    await target.write({ from: 0, to: 3, text: "new" }, "old");
    expect(editorTx).toHaveLength(0);
    expect(vault.disk).toBe("new");
  });
});
