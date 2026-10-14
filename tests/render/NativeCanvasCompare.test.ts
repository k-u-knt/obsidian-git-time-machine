// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "../helpers/obsidianDom";

vi.mock("obsidian", () => ({
  setIcon: () => {},
  TFile: class {},
  Component: class {
    addChild<T>(c: T) {
      return c;
    }
    removeChild() {}
    load() {}
    unload() {}
  },
  // Keeps the marked-up HTML so tests can see the word highlights.
  MarkdownRenderer: {
    render: async (_app: unknown, md: string, el: HTMLElement) => {
      el.innerHTML = md;
    },
  },
}));
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
  posFromEvt(ev: MouseEvent) { return { x: ev.clientX, y: ev.clientY }; }
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
      parent: { addChild: (c: unknown) => c, removeChild: () => {} } as never,
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
    for (const o of host.querySelectorAll(".gtm-native-overlay")) expect(o.getAttribute("preserveAspectRatio")).toBe("none");
    expect(host.querySelectorAll(".gtm-canvas-pane.is-left .gtm-marks, .gtm-canvas-pane.is-left .gtm-region")).toHaveLength(2);
    expect(host.querySelectorAll(".gtm-canvas-pane.is-right .gtm-marks")).toHaveLength(1);
  });

  it("shows Moved/Resized tags only on the past side", async () => {
    made.length = 0;
    const { cmp } = await drawSimple();
    expect([...made[0].wrapperEl.querySelectorAll(".gtm-n-tag")].map((t) => t.textContent)).toEqual(["Moved", "Edited"]);
    expect([...made[1].wrapperEl.querySelectorAll(".gtm-n-tag")].map((t) => t.textContent)).toEqual(["Edited"]);
    cmp.destroy();
  });

  it("picking on the past side dims the rest there; the current side shows a red ghost where it was and a red→green arrow to now", async () => {
    made.length = 0;
    const { host, cmp } = await drawSimple();
    click(host, "left", 310, 10);
    await frame();
    expect(dimmed(made[0])).toEqual(["a", "e"]);
    expect(dimmed(made[1])).toEqual([]);
    const ghost = host.querySelector(".gtm-canvas-pane.is-right .gtm-marks .gtm-ghost")!;
    expect(ghost.classList.contains("gtm-ghost-past")).toBe(true);
    expect([ghost.getAttribute("x"), ghost.getAttribute("y")]).toEqual(["300", "0"]);
    expectPastToNowArrow(host, "right");
    expect(host.querySelectorAll(".gtm-native-links")).toHaveLength(0);
    cmp.destroy();
  });

  it("picking on the current side dims the rest there; the past side shows a green ghost where it is now and a red→green arrow to it", async () => {
    made.length = 0;
    const { host, cmp } = await drawSimple();
    click(host, "right", 310, 410);
    await frame();
    expect(dimmed(made[1])).toEqual(["a", "e"]);
    expect(dimmed(made[0])).toEqual([]);
    const ghost = host.querySelector(".gtm-canvas-pane.is-left .gtm-marks .gtm-ghost")!;
    expect(ghost.classList.contains("gtm-ghost-now")).toBe(true);
    expect([ghost.getAttribute("x"), ghost.getAttribute("y")]).toEqual(["300", "400"]);
    expectPastToNowArrow(host, "left");
    expect(host.querySelector(".gtm-region-title")?.textContent).toContain("1 replaces");
    cmp.destroy();
  });

  it("shows the old text in a past ghost and the new text in a current ghost, with changed words highlighted", async () => {
    made.length = 0;
    const { host, cmp } = await drawSimple();
    click(host, "left", 910, 10);
    await frame();
    const old = host.querySelector(".gtm-canvas-pane.is-right .gtm-marks .gtm-ghost-content")!;
    expect(old.textContent).toBe("Hi-C on twelve samples");
    expect(old.querySelectorAll(".gtm-word-del, .gtm-word-add")).toHaveLength(0);
    click(host, "right", 910, 610);
    await frame();
    const now = host.querySelector(".gtm-canvas-pane.is-left .gtm-marks .gtm-ghost-content")!;
    expect(now.textContent).toBe("Hi-C and imaging on twelve samples");
    expect([...now.querySelectorAll(".gtm-word-add")].map((w) => w.textContent)).toEqual(["and imaging"]);
    expect(host.querySelectorAll(".gtm-canvas-pane.is-right .gtm-marks .gtm-ghost-content")).toHaveLength(0);
    cmp.destroy();
  });
});

const dimmed = (e: FakeEngine) => [...e.nodes].filter(([, n]) => n.nodeEl.classList.contains("gtm-n-dim")).map(([id]) => id);

/** Card m moved from y=0 to y=400: the arrow runs from its past centre to its current centre, red fading to green. */
function expectPastToNowArrow(host: HTMLElement, side: "left" | "right") {
  const arrow = host.querySelector(`.gtm-canvas-pane.is-${side} .gtm-marks .gtm-goback`)!;
  expect(arrow.getAttribute("d")).toBe("M400,50 L400,450");
  const gradientId = /url\(#(.+)\)/.exec(arrow.getAttribute("stroke") ?? "")?.[1];
  const stops = [...host.querySelectorAll(`#${gradientId} stop`)].map((st) => st.getAttribute("class"));
  expect(stops).toEqual(["gtm-stop-past", "gtm-stop-now"]);
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

/** A plain click at scene point (x, y) on one side (the fake engine maps clientX/Y straight to the scene). */
function click(host: HTMLElement, side: "left" | "right", x: number, y: number) {
  const body = host.querySelector(`.gtm-canvas-pane.is-${side} .gtm-native-body`)!;
  for (const type of ["pointerdown", "pointerup"]) body.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
}

async function drawSimple() {
  const past = { nodes: [card("a", 0, "anchor"), card("m", 300, "moved me"), card("e", 900, "Hi-C on twelve samples")], edges: [] };
  const current = {
    nodes: [card("a", 0, "anchor"), { ...card("m", 300, "moved me"), y: 400 }, { ...card("e", 900, "Hi-C and imaging on twelve samples"), y: 600 }],
    edges: [],
  };
  const host = document.body.createDiv();
  const cmp = new NativeCanvasCompare({
    app: { vault: { getAbstractFileByPath: () => null } } as never,
    kit: { Engine: FakeEngine as never, plugin: {} },
    file: { path: "map.canvas" } as never,
    parent: { addChild: (c: unknown) => c, removeChild: () => {} } as never,
    diff: diffCanvas(past, current),
    leftLabel: "Today, 10:53",
    state: { zoom: null, scrollLeft: 0, scrollTop: 0, region: defaultRegionState() },
    onUseText: () => {},
    onRestorePlan: () => {},
  });
  await cmp.render(host);
  return { host, cmp };
}
