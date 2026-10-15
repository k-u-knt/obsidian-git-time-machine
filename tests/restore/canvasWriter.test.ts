import { describe, expect, it } from "vitest";
import { parseCanvas, type CanvasData } from "../../src/diff/canvasDiff";
import { ALL_ASPECTS, type RestorePlan } from "../../src/region/restorePlan";
import { applyCanvasPlan, formatCanvas, useCardText } from "../../src/restore/canvasWriter";

const n = (id: string, x = 0, extra: Record<string, unknown> = {}) => ({ id, type: "text", x, y: 0, width: 100, height: 50, text: id, ...extra });
const plan = (p: Partial<RestorePlan>): RestorePlan => ({ replace: [], add: [], remove: [], skip: [], fixups: [], extraFiles: [], warnings: [], ...p });

const past: CanvasData = {
  nodes: [n("bg"), n("a"), n("gone", 10), n("b", 0, { text: "old b" })],
  edges: [{ id: "a-gone", fromNode: "a", toNode: "gone" }],
};
const current: CanvasData = {
  nodes: [n("bg"), n("a"), n("b", 500, { text: "new b", color: "4" }), n("new")],
  edges: [{ id: "b-new", fromNode: "b", toNode: "new" }],
};

describe("formatCanvas", () => {
  it("writes Obsidian's layout and round-trips", () => {
    const data = { nodes: [n("a")], edges: [], extra: { v: 1 } };
    expect(formatCanvas(data)).toBe('{\n\t"nodes":[\n\t\t{"id":"a","type":"text","x":0,"y":0,"width":100,"height":50,"text":"a"}\n\t],\n\t"edges":[],\n\t"extra":{"v":1}\n}');
    expect(parseCanvas(formatCanvas(data))).toEqual(data);
  });
});

describe("applyCanvasPlan", () => {
  it("brings a card back in its old layer, with its connection", () => {
    const out = applyCanvasPlan(current, past, plan({ add: ["gone", "a-gone"] }), {});
    expect(out.nodes.map((x) => x.id)).toEqual(["bg", "a", "gone", "b", "new"]);
    expect(out.edges.map((x) => x.id)).toEqual(["a-gone", "b-new"]);
  });

  it("replaces a card with its past version", () => {
    expect(applyCanvasPlan(current, past, plan({ replace: ["b"] }), {}).nodes[2]).toEqual(n("b", 0, { text: "old b" }));
  });

  it("restores only the chosen aspects of a card", () => {
    const only = (a: Partial<typeof ALL_ASPECTS>) =>
      applyCanvasPlan(current, past, plan({ replace: ["b"] }), { aspects: { ...ALL_ASPECTS, text: false, position: false, size: false, colour: false, ...a } }).nodes[2];
    expect(only({ text: true })).toEqual(n("b", 500, { text: "old b", color: "4" }));
    expect(only({ position: true })).toEqual(n("b", 0, { text: "new b", color: "4" }));
    expect(only({ colour: true })).toEqual(n("b", 500, { text: "new b" }));
  });

  it("puts restored cards back relative to the anchor when the canvas has shifted since", () => {
    const out = applyCanvasPlan(current, past, plan({ replace: ["b"], add: ["gone"] }), { offset: { dx: 30, dy: -20 } });
    expect(out.nodes.find((x) => x.id === "b")).toMatchObject({ x: 30, y: -20, text: "old b" });
    expect(out.nodes.find((x) => x.id === "gone")).toMatchObject({ x: 40, y: -20 });
  });

  it("removes cards and their connections", () => {
    const out = applyCanvasPlan(current, past, plan({ remove: ["new"] }), {});
    expect(out.nodes.map((x) => x.id)).toEqual(["bg", "a", "b"]);
    expect(out.edges).toEqual([]);
  });
});

describe("useCardText", () => {
  it("restores only the text", () => {
    expect(useCardText(current, past.nodes[3]).nodes[2]).toEqual(n("b", 500, { text: "old b", color: "4" }));
  });
});
