// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "../helpers/obsidianDom";

vi.mock("obsidian", () => ({
  Component: class {
    addChild<T>(c: T) {
      return c;
    }
    removeChild() {}
  },
  MarkdownRenderer: {
    render: async (_app: unknown, md: string, el: HTMLElement) => {
      el.textContent = md;
    },
  },
  setIcon: () => {},
  TFile: class {},
}));

const { diffCanvas } = await import("../../src/diff/canvasDiff");
const { CanvasCompare } = await import("../../src/render/CanvasCompare");
const { defaultRegionState } = await import("../../src/region/RegionTool");

beforeAll(() => installObsidianDom());

const card = (id: string, x: number, text: string) => ({ id, type: "text", x, y: 0, width: 1200, height: 300, text });
// About 6,000 units wide, like the user's project maps: "fit" lands far below 50% zoom.
const past = { nodes: [card("a", 0, "## Aims\nold"), card("b", 2400, "Methods"), card("c", 4800, "Datasets")], edges: [] };
const current = { nodes: [card("a", 0, "## Aims\nnew"), card("b", 2400, "Methods"), card("d", 4800, "Collaborators")], edges: [] };

async function draw() {
  const host = document.body.createDiv();
  const state = { zoom: null as number | null, scrollLeft: 0, scrollTop: 0, showMoved: false, region: defaultRegionState() };
  const cc = new CanvasCompare({
    app: { vault: { getAbstractFileByPath: () => null, getResourcePath: () => "" } } as never,
    parent: { addChild: (c: unknown) => c, removeChild: () => {} } as never,
    sourcePath: "map.canvas",
    diff: diffCanvas(past, current),
    leftLabel: "Today, 10:53",
    state,
    onUseText: () => {},
    onRestorePlan: () => {},
  });
  await cc.render(host);
  return { host, cc, state };
}

describe("CanvasCompare", () => {
  it("draws every card of both versions and the selection hint", async () => {
    const { host } = await draw();
    expect(host.querySelectorAll(".gtm-canvas-pane.is-left .gtm-cnode")).toHaveLength(3);
    expect(host.querySelectorAll(".gtm-canvas-pane.is-right .gtm-cnode")).toHaveLength(3);
    expect(host.querySelector(".gtm-region-bar")?.textContent).toContain("Click a card");
  });

  it("stays readable when zoomed out to fit a large canvas", async () => {
    const { host, state } = await draw();
    expect(state.zoom).toBeLessThan(0.5);
    const root = host.querySelector<HTMLElement>(".gtm-canvas-compare")!;
    expect(root.classList.contains("is-overview")).toBe(true);
    expect(root.style.getPropertyValue("--gtm-zoom")).toBe(String(state.zoom));
    const titles = [...host.querySelectorAll(".gtm-canvas-pane.is-left .gtm-cnode-title")].map((t) => t.textContent);
    expect(titles).toEqual(["Aims", "Methods", "Datasets"]);
  });

  it("zooms in far enough to read a change when jumping to it", async () => {
    const { host, cc, state } = await draw();
    cc.scrollToChange(0);
    expect(state.zoom).toBeGreaterThanOrEqual(0.6);
    expect(host.querySelector(".gtm-canvas-compare")!.classList.contains("is-overview")).toBe(false);
  });
});
