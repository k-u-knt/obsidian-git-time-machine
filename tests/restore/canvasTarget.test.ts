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
  it("doesn't save an open canvas just to read it (opening Time Machine never rewrites the file)", async () => {
    const { target, view, vault } = setup({ reloads: true, onScreen: '{"nodes":[{"id":"x"}],"edges":[]}' });
    expect(await target.read()).toBe('{"nodes":[],"edges":[]}');
    expect(view.saves).toBe(0);
    expect(vault.writes).toBe(0);
  });

  it("saves an open canvas with unsaved changes when asked to flush before a write", async () => {
    const { target, view } = setup({ reloads: true, onScreen: '{"nodes":[{"id":"x"}],"edges":[]}' });
    await target.flush!();
    expect(view.saves).toBe(1);
    expect(await target.read()).toBe('{"nodes":[{"id":"x"}],"edges":[]}');
    await target.flush!();
    expect(view.saves).toBe(1);
  });

  it("compares canvases as data, not as text", () => {
    const { target } = setup({ reloads: true });
    expect(target.same!('{"nodes":[{"id":"a","x":1}]}', '{\n\t"nodes":[\n\t\t{"x":1,"id":"a"}\n\t]\n}')).toBe(true);
    expect(target.same!('{"nodes":[]}', '{"nodes":[{"id":"a"}]}')).toBe(false);
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
