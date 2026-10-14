// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "../helpers/obsidianDom";

vi.mock("obsidian", () => ({ setIcon: () => {}, TFile: class {} }));
const { diffCanvas } = await import("../../src/diff/canvasDiff");
const { NativeCanvasCompare } = await import("../../src/render/NativeCanvasCompare");
const { defaultRegionState } = await import("../../src/region/RegionTool");

beforeAll(() => installObsidianDom());

/** Stand-in for Obsidian's canvas engine: records how it is used and draws one element per card. */
const made: FakeEngine[] = [];
class FakeEngine {
  host: { requestSave(): void; contentEl: HTMLElement };
  readonly = false;
  loaded = false;
  scale = 0.5;
  zoomToFitQueued = false;
  wrapperEl: HTMLElement;
  nodes = new Map<string, { nodeEl: HTMLElement }>();
  edges = new Map<string, { lineGroupEl: SVGGElement }>();
  constructor(host: FakeEngine["host"]) {
    this.host = host;
    this.wrapperEl = host.contentEl.createDiv({ cls: "canvas-wrapper" });
    made.push(this);
  }
  load() { this.loaded = true; }
  unload() { this.loaded = false; }
  setData(d: { nodes: Array<{ id: string }>; edges: Array<{ id: string }> }) {
    for (const n of d.nodes) this.nodes.set(n.id, { nodeEl: this.wrapperEl.createDiv({ cls: "canvas-node" }) });
    for (const e of d.edges) this.edges.set(e.id, { lineGroupEl: document.createElementNS("http://www.w3.org/2000/svg", "g") as SVGGElement });
  }
  setReadonly(r: boolean) { this.readonly = r; }
  onResize() {}
  zoomToFit() {}
  zoomToBbox() {}
  getState() { return { x: 0, y: 0, zoom: 0 }; }
  setState() {}
  getViewportBBox() { return { minX: 0, minY: 0, maxX: 100, maxY: 100 }; }
  posFromEvt() { return { x: 0, y: 0 }; }
  requestFrame() {}
}

const card = (id: string, x: number, text: string) => ({ id, type: "text", x, y: 0, width: 200, height: 100, text });

describe("NativeCanvasCompare", () => {
  it("shows both versions in read-only canvases whose saving does nothing, with changed cards marked", async () => {
    made.length = 0;
    const past = { nodes: [card("a", 0, "old"), card("b", 300, "same"), card("gone", 600, "bye")], edges: [] };
    const current = { nodes: [card("a", 0, "new"), card("b", 300, "same"), card("c", 900, "hello")], edges: [] };
    const host = document.body.createDiv();
    const cmp = new NativeCanvasCompare({
      app: { vault: { getAbstractFileByPath: () => null } } as never,
      kit: { Engine: FakeEngine as never, plugin: {} },
      file: { path: "map.canvas" } as never,
      diff: diffCanvas(past, current),
      leftLabel: "Today, 10:53",
      state: { zoom: null, scrollLeft: 0, scrollTop: 0, region: defaultRegionState() },
      onUseText: () => {},
      onRestorePlan: () => {},
    });
    await cmp.render(host);
    expect(made).toHaveLength(2);
    expect(made.every((e) => e.readonly && e.loaded)).toBe(true);
    expect(made[0].host.requestSave()).toBeUndefined();
    const leftTags = [...made[0].wrapperEl.querySelectorAll(".gtm-n-tag")].map((t) => t.textContent);
    const rightTags = [...made[1].wrapperEl.querySelectorAll(".gtm-n-tag")].map((t) => t.textContent);
    expect(leftTags).toEqual(["Edited", "Removed"]);
    expect(rightTags).toEqual(["Edited", "Added"]);
    expect([...made[0].wrapperEl.querySelectorAll(".gtm-n-action")].map((b) => b.textContent)).toEqual(["Use this text", "Restore card…"]);
    cmp.destroy();
    expect(made.every((e) => !e.loaded)).toBe(true);
  });

  it("keeps each side's drawings inside that side and scaled exactly like its canvas", async () => {
    made.length = 0;
    const { host } = await drawSimple();
    const overlays = [...host.querySelectorAll(".gtm-native-overlay")];
    expect(overlays).toHaveLength(2);
    for (const o of overlays) expect(o.getAttribute("preserveAspectRatio")).toBe("none");
    expect(overlays[0].closest(".gtm-canvas-pane.is-left")).not.toBeNull();
    expect(overlays[1].closest(".gtm-canvas-pane.is-right")).not.toBeNull();
  });

  it("links a selected card across the two sides, and shows on the right where it would go back to", async () => {
    made.length = 0;
    const { host, cmp } = await drawSimple();
    (cmp as unknown as { tool: { selectOnly(id: string): void } }).tool.selectOnly("m");
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect([...host.querySelectorAll(".gtm-native-links .gtm-link")].map((l) => l.getAttribute("class"))).toEqual(["gtm-link gtm-link-moved"]);
    expect(host.querySelectorAll(".gtm-canvas-pane.is-right .gtm-native-overlay .gtm-goback")).toHaveLength(1);
    (cmp as unknown as { tool: { clear(): void } }).tool.clear();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(host.querySelectorAll(".gtm-native-links .gtm-link")).toHaveLength(0);
    cmp.destroy();
  });
});

async function drawSimple() {
  const past = { nodes: [card("a", 0, "anchor"), card("m", 300, "moved me")], edges: [] };
  const current = { nodes: [card("a", 0, "anchor"), { ...card("m", 300, "moved me"), y: 400 }], edges: [] };
  const host = document.body.createDiv();
  const cmp = new NativeCanvasCompare({
    app: { vault: { getAbstractFileByPath: () => null } } as never,
    kit: { Engine: FakeEngine as never, plugin: {} },
    file: { path: "map.canvas" } as never,
    diff: diffCanvas(past, current),
    leftLabel: "Today, 10:53",
    state: { zoom: null, scrollLeft: 0, scrollTop: 0, region: defaultRegionState() },
    onUseText: () => {},
    onRestorePlan: () => {},
  });
  await cmp.render(host);
  return { host, cmp };
}
