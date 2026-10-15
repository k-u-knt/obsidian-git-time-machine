// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { installObsidianDom } from "../helpers/obsidianDom";
import { findCanvasEngine } from "../../src/render/nativeCanvas";

beforeAll(() => installObsidianDom());

class Engine {}
for (const m of ["load", "unload", "setData", "setReadonly", "onResize", "zoomToFit", "zoomToBbox", "getState", "setState", "getViewportBBox", "posFromEvt"]) {
  (Engine.prototype as unknown as Record<string, () => void>)[m] = () => {};
}

describe("findCanvasEngine", () => {
  it("creates a canvas view from the registry with a leaf that has what the view reads, once per app", () => {
    let created = 0;
    const app = {
      workspace: { getLeavesOfType: () => [] },
      viewRegistry: {
        getViewCreatorByType: () => (leaf: { history: { backHistory: unknown[] } }) => {
          created++;
          void leaf.history.backHistory.length; // Obsidian's ItemView constructor reads this
          return { canvas: new Engine(), plugin: { id: "canvas" } };
        },
      },
    };
    const kit = findCanvasEngine(app as never);
    expect(kit?.Engine).toBe(Engine);
    expect(findCanvasEngine(app as never)).toBe(kit);
    expect(created).toBe(1);
  });
});
