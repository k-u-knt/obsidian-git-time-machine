import { describe, expect, it } from "vitest";
import { parseCanvas, type CanvasData } from "../../src/diff/canvasDiff";
import type { RestorePlan } from "../../src/region/restorePlan";
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
    const out = applyCanvasPlan(current, past, plan({ add: ["gone", "a-gone"] }), { keepPositions: false });
    expect(out.nodes.map((x) => x.id)).toEqual(["bg", "a", "gone", "b", "new"]);
    expect(out.edges.map((x) => x.id)).toEqual(["a-gone", "b-new"]);
  });

  it("replaces a card with its past version, optionally keeping today's position", () => {
    expect(applyCanvasPlan(current, past, plan({ replace: ["b"] }), { keepPositions: false }).nodes[2]).toEqual(n("b", 0, { text: "old b" }));
    expect(applyCanvasPlan(current, past, plan({ replace: ["b"] }), { keepPositions: true }).nodes[2]).toEqual(n("b", 500, { text: "old b" }));
  });

  it("removes cards and their connections", () => {
    const out = applyCanvasPlan(current, past, plan({ remove: ["new"] }), { keepPositions: false });
    expect(out.nodes.map((x) => x.id)).toEqual(["bg", "a", "b"]);
    expect(out.edges).toEqual([]);
  });
});

describe("useCardText", () => {
  it("restores only the text", () => {
    expect(useCardText(current, past.nodes[3]).nodes[2]).toEqual(n("b", 500, { text: "old b", color: "4" }));
  });
});
