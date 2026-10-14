import { describe, expect, it } from "vitest";
import { canvasTextTarget } from "../../src/restore/canvasTarget";
import { StaleWriteError } from "../../src/restore/Restorer";

/** A fake Canvas view: `reloads` says whether it picks up file changes by itself. */
function setup(opts: { reloads: boolean; unsaved?: string }) {
  const vault = {
    disk: '{"nodes":[],"edges":[]}',
    read: async () => vault.disk,
    process: async (_f: unknown, fn: (d: string) => string) => {
      vault.disk = fn(vault.disk);
      if (opts.reloads) view.data = vault.disk;
    },
  };
  const view = {
    file: { path: "map.canvas" },
    data: vault.disk,
    saves: 0,
    async save() {
      view.saves++;
      if (opts.unsaved !== undefined) vault.disk = opts.unsaved;
    },
    getViewData: () => view.data,
  };
  const leaf = { view, reopened: 0, getViewState: () => ({ type: "canvas" }), setViewState: async () => void leaf.reopened++ };
  const app = { workspace: { getLeavesOfType: (t: string) => (t === "canvas" ? [leaf] : []) }, vault };
  return { target: canvasTextTarget(app as never, { path: "map.canvas" } as never), vault, view, leaf };
}

describe("canvasTextTarget", () => {
  it("asks an open canvas to save before reading", async () => {
    const { target, view } = setup({ reloads: true, unsaved: '{"nodes":[{"id":"x"}],"edges":[]}' });
    expect(await target.read()).toBe('{"nodes":[{"id":"x"}],"edges":[]}');
    expect(view.saves).toBe(1);
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
