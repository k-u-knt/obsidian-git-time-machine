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
const past = {
  nodes: [card("a", 0, "## Aims\nold"), card("b", 2400, "Methods"), card("c", 4800, "Datasets"), { ...card("e", 0, "Colour only"), y: 600 }],
  edges: [{ id: "ab", fromNode: "a", toNode: "b" }, { id: "bc", fromNode: "b", toNode: "c", label: "uses" }],
};
const current = {
  nodes: [card("a", 0, "## Aims\nnew"), card("b", 2400, "Methods"), card("d", 4800, "Collaborators"), { ...card("e", 0, "Colour only"), y: 600, color: "4" }],
  edges: [{ id: "ab", fromNode: "a", toNode: "b" }, { id: "bd", fromNode: "b", toNode: "d" }],
};

function make(restored: unknown[] = []) {
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
    onRestorePlan: (plan: unknown) => void restored.push(plan),
  });
  return { host, cc, state };
}

async function draw(restored: unknown[] = []) {
  const made = make(restored);
  await made.cc.render(made.host);
  return made;
}

describe("CanvasCompare", () => {
  it("draws every card of both versions and the selection hint", async () => {
    const { host } = await draw();
    expect(host.querySelectorAll(".gtm-canvas-pane.is-left .gtm-cnode")).toHaveLength(4);
    expect(host.querySelectorAll(".gtm-canvas-pane.is-right .gtm-cnode")).toHaveLength(4);
    expect(host.querySelector(".gtm-region-bar")?.textContent).toContain("Click a card");
  });

  it("draws connections with their change state (same, added, removed)", async () => {
    const { host } = await draw();
    const left = [...host.querySelectorAll(".gtm-canvas-pane.is-left .gtm-cedge")].map((g) => g.getAttribute("class"));
    const right = [...host.querySelectorAll(".gtm-canvas-pane.is-right .gtm-cedge")].map((g) => g.getAttribute("class"));
    expect(left).toEqual(["gtm-cedge is-same", "gtm-cedge is-removed"]);
    expect(right).toEqual(["gtm-cedge is-same", "gtm-cedge is-added"]);
  });

  it("stays readable when zoomed out to fit a large canvas", async () => {
    const { host, state } = await draw();
    expect(state.zoom).toBeLessThan(0.5);
    const root = host.querySelector<HTMLElement>(".gtm-canvas-compare")!;
    expect(root.classList.contains("is-overview")).toBe(true);
    expect(root.style.getPropertyValue("--gtm-zoom")).toBe(String(state.zoom));
    const titles = [...host.querySelectorAll(".gtm-canvas-pane.is-left .gtm-cnode-title")].map((t) => t.textContent);
    expect(titles).toEqual(["Aims", "Methods", "Datasets", "Colour only"]);
  });

  it("zooms in far enough to read a change when jumping to it", async () => {
    const { host, cc, state } = await draw();
    cc.scrollToChange(0);
    expect(state.zoom).toBeGreaterThanOrEqual(0.6);
    expect(host.querySelector(".gtm-canvas-compare")!.classList.contains("is-overview")).toBe(false);
  });

  it("previews a removed card's restore instead of restoring it straight away", async () => {
    const restored: unknown[] = [];
    const { host } = await draw(restored);
    const button = [...host.querySelectorAll<HTMLButtonElement>(".gtm-canvas-pane.is-left .gtm-cnode-action")].find((b) => b.textContent?.startsWith("Restore card"));
    button!.click();
    expect(restored).toHaveLength(0);
    expect(host.querySelector(".gtm-region-title")?.textContent).toBe("Restore 2 items: 2 come back");
  });

  it("offers 'Use this text' only when the text itself changed", async () => {
    const { host } = await draw();
    const labels = [...host.querySelectorAll(".gtm-canvas-pane.is-left .gtm-cnode-action")].map((b) => b.textContent);
    expect(labels.filter((l) => l === "Use this text")).toHaveLength(1);
  });

  it("leaves the screen and the saved scroll position alone when a redraw is replaced before it finishes", async () => {
    const { host, cc, state } = make();
    state.scrollLeft = 120;
    host.createDiv({ cls: "previous-screen" });
    const drawing = cc.render(host);
    cc.destroy();
    await drawing;
    expect(state.scrollLeft).toBe(120);
    expect(host.querySelector(".previous-screen")).not.toBeNull();
    expect(host.querySelector(".gtm-canvas-compare")).toBeNull();
  });
});
