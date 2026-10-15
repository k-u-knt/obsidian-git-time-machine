import { describe, expect, it } from "vitest";
import { EditorSync } from "../../src/restore/EditorSync";
import { StaleWriteError, type TextTarget } from "../../src/restore/Restorer";

function memTarget(path: string, initial: string): TextTarget & { text: string } {
  const t = {
    path,
    text: initial,
    async read() {
      return t.text;
    },
    async write(edit: { from: number; to: number; text: string }, before: string) {
      if (t.text !== before) throw new StaleWriteError();
      t.text = t.text.slice(0, edit.from) + edit.text + t.text.slice(edit.to);
    },
  };
  return t;
}

describe("EditorSync", () => {
  it("writes what the user typed", async () => {
    const t = memTarget("a.md", "one\n");
    const sync = new EditorSync(t, "one\n");
    sync.edited("one!\n");
    expect(await sync.flush()).toBe("written");
    expect(t.text).toBe("one!\n");
    expect(sync.syncedText).toBe("one!\n");
  });

  it("never overwrites a change made elsewhere since the editor last synced", async () => {
    const t = memTarget("a.md", "one\n");
    const sync = new EditorSync(t, "one\n");
    t.text = "one\ntyped in the other pane\n";
    sync.edited("ONE\n");
    expect(await sync.flush()).toBe("stale");
    expect(t.text).toBe("one\ntyped in the other pane\n");
  });

  it("continues from an outside change once the editor has been updated", async () => {
    const t = memTarget("a.md", "one\n");
    const sync = new EditorSync(t, "one\n");
    t.text = "two\n";
    sync.external("two\n");
    sync.edited("two!\n");
    expect(await sync.flush()).toBe("written");
    expect(t.text).toBe("two!\n");
  });

  it("drops typing that an outside change replaced", async () => {
    const t = memTarget("a.md", "one\n");
    const sync = new EditorSync(t, "one\n");
    sync.edited("one!\n");
    sync.external("one\n");
    expect(await sync.flush()).toBe("none");
    expect(t.text).toBe("one\n");
  });

  it("holds back text that isn't valid yet and writes once it is", async () => {
    const t = memTarget("a.canvas", '{"nodes":[]}');
    const sync = new EditorSync(t, '{"nodes":[]}', (text) => (text.trim().endsWith("}") ? null : "not valid JSON yet"));
    sync.edited('{"nodes":[');
    expect(await sync.flush()).toBe("invalid");
    expect(t.text).toBe('{"nodes":[]}');
    expect(sync.hasPending()).toBe(true);
    sync.edited('{"nodes":[{"id":"a"}]}');
    expect(await sync.flush()).toBe("written");
    expect(t.text).toBe('{"nodes":[{"id":"a"}]}');
  });

  it("asks the target to flush before writing", async () => {
    const t = Object.assign(memTarget("a.md", "x"), { flushes: 0, async flush() { t.flushes++; } });
    const sync = new EditorSync(t, "x");
    sync.edited("y");
    await sync.flush();
    expect(t.flushes).toBe(1);
  });

  it("keeps a pending edit bound to its own file", async () => {
    const a = memTarget("a.md", "A\n");
    const b = memTarget("b.md", "B\n");
    const syncA = new EditorSync(a, "A\n");
    syncA.edited("A edited\n");
    new EditorSync(b, "B\n");
    await syncA.flush();
    expect(a.text).toBe("A edited\n");
    expect(b.text).toBe("B\n");
  });
});
