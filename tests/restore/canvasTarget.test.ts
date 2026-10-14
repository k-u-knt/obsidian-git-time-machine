import { describe, expect, it } from "vitest";
import { canvasTextTarget } from "../../src/restore/canvasTarget";
import { StaleWriteError } from "../../src/restore/Restorer";

/** A fake Canvas view: `data` is what's on screen; `save()` writes it to disk. `reloads`: picks up file changes by itself. */
function setup(opts: { reloads: boolean; onScreen?: string }) {
  const vault = {
    disk: '{"nodes":[],"edges":[]}',
    writes: 0,
    read: async () => vault.disk,
    process: async (_f: unknown, fn: (d: string) => string) => {
      vault.disk = fn(vault.disk);
      vault.writes++;
      if (opts.reloads) view.data = vault.disk;
    },
  };
  const view = {
    file: { path: "map.canvas" },
    data: opts.onScreen ?? vault.disk,
    saves: 0,
    async save() {
      view.saves++;
      vault.disk = view.data;
    },
    getViewData: () => view.data,
  };
  const leaf = { view, reopened: 0, getViewState: () => ({ type: "canvas" }), setViewState: async () => void leaf.reopened++ };
  const app = { workspace: { getLeavesOfType: (t: string) => (t === "canvas" ? [leaf] : []) }, vault };
  return { target: canvasTextTarget(app as never, { path: "map.canvas" } as never), vault, view, leaf };
}

describe("canvasTextTarget", () => {
  it("asks an open canvas with unsaved changes to save before reading", async () => {
    const { target, view } = setup({ reloads: true, onScreen: '{"nodes":[{"id":"x"}],"edges":[]}' });
    expect(await target.read()).toBe('{"nodes":[{"id":"x"}],"edges":[]}');
    expect(view.saves).toBe(1);
  });

  it("doesn't save an open canvas that has nothing new (no save → modify → refresh loop)", async () => {
    const { target, view } = setup({ reloads: true });
    await target.read();
    await target.read();
    expect(view.saves).toBe(0);
  });

  it("reopens a canvas view that didn't pick up the restore", async () => {
    const stays = setup({ reloads: false });
    const before = await stays.target.read();
    await stays.target.write({ from: 0, to: before.length, text: '{"nodes":[{"id":"r"}],"edges":[]}' }, before);
    expect(stays.leaf.reopened).toBe(1);

    const reloads = setup({ reloads: true });
    const b2 = await reloads.target.read();
    await reloads.target.write({ from: 0, to: b2.length, text: '{"nodes":[{"id":"r"}],"edges":[]}' }, b2);
    expect(reloads.leaf.reopened).toBe(0);
  });

  it("refuses to write over a canvas that changed", async () => {
    const { target, vault } = setup({ reloads: true });
    await expect(target.write({ from: 0, to: 1, text: "x" }, "something else")).rejects.toBeInstanceOf(StaleWriteError);
    expect(vault.disk).toBe('{"nodes":[],"edges":[]}');
  });
});
