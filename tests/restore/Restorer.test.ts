import { describe, expect, it } from "vitest";
import { diffText } from "../../src/diff/textDiff";
import { Restorer, StaleWriteError, type TextTarget } from "../../src/restore/Restorer";

/** In-memory file. `editBeforeWrite` simulates the user typing between read and write. */
function memTarget(initial: string, opts: { editBeforeWrite?: string } = {}): TextTarget & { text: string; writes: number } {
  const t = {
    path: "n.md",
    text: initial,
    writes: 0,
    async read() {
      return t.text;
    },
    async write(edit: { from: number; to: number; text: string }, before: string) {
      if (opts.editBeforeWrite !== undefined) {
        t.text = opts.editBeforeWrite;
        opts.editBeforeWrite = undefined;
      }
      if (t.text !== before) throw new StaleWriteError();
      t.text = t.text.slice(0, edit.from) + edit.text + t.text.slice(edit.to);
      t.writes++;
    },
  };
  return t;
}

describe("Restorer", () => {
  const left = "# Agenda\n- abstract deadline\n- review\n";
  const right = "# Agenda\n- review\n";
  const chunk = diffText(left, right).chunks[0];

  it("applies a chunk and can undo it", async () => {
    const r = new Restorer();
    const t = memTarget(right);
    expect(await r.applyChunk(t, right, chunk)).toBe("applied");
    expect(t.text).toBe(left);
    expect(await r.undo(t, async () => true)).toBe("undone");
    expect(t.text).toBe(right);
    expect(await r.undo(t, async () => true)).toBe("empty");
  });

  it("refuses when the note changed after the comparison was drawn", async () => {
    const r = new Restorer();
    const t = memTarget(right + "typed\n");
    expect(await r.applyChunk(t, right, chunk)).toBe("stale");
    expect(t.writes).toBe(0);
    expect(r.peekUndo()).toBeUndefined();
  });

  it("refuses when the note changes between read and write", async () => {
    const r = new Restorer();
    const t = memTarget(right, { editBeforeWrite: right + "typed\n" });
    expect(await r.applyChunk(t, right, chunk)).toBe("stale");
    expect(t.text).toBe(right + "typed\n");
    expect(r.peekUndo()).toBeUndefined();
  });

  it("asks before undoing over newer edits", async () => {
    const r = new Restorer();
    const t = memTarget(right);
    await r.restoreWhole(t, left);
    t.text = left + "more\n";
    expect(await r.undo(t, async () => false)).toBe("cancelled");
    expect(t.text).toBe(left + "more\n");
    expect(await r.undo(t, async () => true)).toBe("undone");
    expect(t.text).toBe(right);
  });

  it("replaces the whole text only if the file is unchanged, and can undo it", async () => {
    const r = new Restorer();
    const t = memTarget("{}");
    expect(await r.replaceText(t, "{ }", '{"nodes":[]}')).toBe("stale");
    expect(t.text).toBe("{}");
    expect(await r.replaceText(t, "{}", '{"nodes":[]}')).toBe("applied");
    expect(t.text).toBe('{"nodes":[]}');
    await r.undo(t, async () => true);
    expect(t.text).toBe("{}");
  });

  it("keeps at most `limit` undo entries", async () => {
    const r = new Restorer(2);
    const t = memTarget("0");
    await r.restoreWhole(t, "1");
    await r.restoreWhole(t, "2");
    await r.restoreWhole(t, "3");
    await r.undo(t, async () => true);
    await r.undo(t, async () => true);
    expect(t.text).toBe("1");
    expect(await r.undo(t, async () => true)).toBe("empty");
  });
});
