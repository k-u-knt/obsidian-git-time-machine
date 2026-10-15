import { describe, expect, it } from "vitest";
import { CanvasParseError, countStates, describeCanvasChanges, diffCanvas, nodeTitle, parseCanvas, sameForAspects, sameItem, GEOMETRY_FIELDS, type CanvasData } from "../../src/diff/canvasDiff";

const node = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "text", x: 0, y: 0, width: 200, height: 100, text: id, ...extra });
const edge = (id: string, fromNode: string, toNode: string, extra: Record<string, unknown> = {}) => ({ id, fromNode, toNode, ...extra });

const past: CanvasData = {
  nodes: [node("aims", { text: "## Aims\nAim 1" }), node("methods", { text: "Hi-C on 12 samples" }), node("data", { x: 0, y: 300 }), node("questions")],
  edges: [edge("e1", "aims", "methods"), edge("e2", "methods", "questions")],
};
const current: CanvasData = {
  nodes: [node("aims", { text: "## Aims\nAim 1" }), node("methods", { text: "Hi-C and imaging on 12 samples" }), node("data", { x: 50, y: 900, width: 400 }), node("collab", { text: "Collaborators" })],
  edges: [edge("e1", "aims", "methods", { fromSide: "right" }), edge("e3", "methods", "collab")],
};

describe("parseCanvas", () => {
  it("treats an empty file as an empty canvas and keeps unknown keys", () => {
    expect(parseCanvas("")).toEqual({ nodes: [], edges: [] });
    expect(parseCanvas('{"nodes":[],"edges":[],"x-meta":1}')["x-meta"]).toBe(1);
  });

  it("rejects invalid JSON with a readable error", () => {
    expect(() => parseCanvas("{nope")).toThrow(CanvasParseError);
  });
});

describe("diffCanvas", () => {
  const d = diffCanvas(past, current);

  it("classifies cards by content, and by position relative to the anchor", () => {
    expect(Object.fromEntries(d.nodes)).toEqual({ aims: "same", methods: "edited", data: "moved", collab: "added", questions: "removed" });
    expect(d.geometry.get("data")).toEqual({ moved: true, resized: true });
    expect(d.anchor).toEqual({ id: "aims", dx: 0, dy: 0 });
  });

  it("treats a connection that only changed sides as unchanged", () => {
    expect(Object.fromEntries(d.edges)).toEqual({ e1: "moved", e3: "added", e2: "removed" });
  });

  it("doesn't call it a move when the whole canvas shifted together", () => {
    const shift = (c: CanvasData, dx: number, dy: number): CanvasData => ({ ...c, nodes: c.nodes.map((x) => ({ ...x, x: x.x + dx, y: x.y + dy })) });
    const before: CanvasData = { nodes: [node("a"), node("b", { x: 400 }), node("c", { y: 300 })], edges: [] };
    const moved = diffCanvas(before, shift(before, 120, -40));
    expect([...moved.nodes.values()]).toEqual(["same", "same", "same"]);
    expect(moved.anchor).toEqual({ id: "a", dx: 120, dy: -40 });
  });

  it("anchors on the shift most unchanged cards share, so a lone moved card is the one marked", () => {
    const before: CanvasData = { nodes: [node("a"), node("b", { x: 400 }), node("c", { y: 300 }), node("d", { x: 800 })], edges: [] };
    const after: CanvasData = {
      nodes: [node("a", { x: 100 }), node("b", { x: 500 }), node("c", { x: 100, y: 300 }), node("d", { x: 1200, y: 40 })],
      edges: [],
    };
    const r = diffCanvas(before, after);
    expect(Object.fromEntries(r.nodes)).toEqual({ a: "same", b: "same", c: "same", d: "moved" });
    expect(r.geometry.get("d")).toEqual({ moved: true, resized: false });
    expect(r.anchor).toEqual({ id: "a", dx: 100, dy: 0 });
  });

  it("counts a resize as a change, and an edit wins over a move", () => {
    const before: CanvasData = { nodes: [node("a"), node("b", { x: 400 }), node("c", { x: 800 })], edges: [] };
    const after: CanvasData = { nodes: [node("a"), node("b", { x: 400, width: 300 }), node("c", { x: 900, text: "changed" })], edges: [] };
    const r = diffCanvas(before, after);
    expect(Object.fromEntries(r.nodes)).toEqual({ a: "same", b: "moved", c: "edited" });
    expect(r.geometry.get("b")).toEqual({ moved: false, resized: true });
    expect(describeCanvasChanges(r).map((c) => c.label)).toEqual(["b · card resized", "changed · card edited"]);
  });

  it("uses no anchor shift when no card is unchanged", () => {
    const r = diffCanvas({ nodes: [node("a")], edges: [] }, { nodes: [node("a", { x: 50, text: "new" })], edges: [] });
    expect(r.anchor).toEqual({ id: null, dx: 0, dy: 0 });
  });

  it("counts states", () => {
    expect(countStates(d.nodes)).toMatchObject({ edited: 1, added: 1, removed: 1, moved: 1, same: 1 });
  });

  it("describes changes cards first, then connections", () => {
    expect(describeCanvasChanges(d).map((c) => c.label)).toEqual([
      "Hi-C and imaging on 12 samples · card edited",
      "data · card moved and resized",
      "Collaborators · card added",
      "questions · card removed",
      "Hi-C and imaging on 12 samples → Collaborators · connection added",
      "Hi-C and imaging on 12 samples → questions · connection removed",
    ]);
  });
});

describe("nodeTitle", () => {
  it("uses the first heading or line, a file name, a host or a group label", () => {
    expect(nodeTitle(node("a", { text: "## Project **agent**\nmore" }))).toBe("Project agent");
    expect(nodeTitle(node("b", { type: "file", file: "Notes/Lab sync.md" }))).toBe("Lab sync");
    expect(nodeTitle(node("c", { type: "link", url: "https://example.org/x" }))).toBe("example.org");
    expect(nodeTitle(node("d", { type: "group", label: "Layer 1" }))).toBe("Layer 1");
  });
});

describe("sameItem", () => {
  it("compares every field, ignoring key order", () => {
    expect(sameItem({ id: "a", x: 1, text: "t" }, { text: "t", id: "a", x: 1 })).toBe(true);
    expect(sameItem({ id: "a", styleAttributes: {} }, { id: "a", styleAttributes: { border: "dashed" } })).toBe(false);
    expect(sameItem({ id: "a" }, undefined)).toBe(false);
  });

  it("can ignore position and size (for 'Keep current positions')", () => {
    expect(sameItem({ id: "a", x: 0, text: "t" }, { id: "a", x: 500, text: "t" }, GEOMETRY_FIELDS)).toBe(true);
    expect(sameItem({ id: "a", x: 0, text: "t" }, { id: "a", x: 500, text: "u" }, GEOMETRY_FIELDS)).toBe(false);
  });
});

describe("sameForAspects", () => {
  const then = { id: "a", type: "text", x: 0, y: 0, width: 100, height: 50, text: "old", color: "1" };
  const all = { text: true, position: true, size: true, colour: true };
  it("compares only the aspects being restored", () => {
    expect(sameForAspects(then, { ...then, x: 40 }, all)).toBe(false);
    expect(sameForAspects(then, { ...then, x: 40 }, { ...all, position: false })).toBe(true);
    expect(sameForAspects(then, { ...then, text: "new" }, { ...all, text: false })).toBe(true);
    expect(sameForAspects(then, { ...then, width: 300 }, { ...all, size: false })).toBe(true);
    expect(sameForAspects(then, { ...then, color: "4" }, { ...all, colour: false })).toBe(true);
    expect(sameForAspects(then, { ...then, color: "4", text: "new" }, { ...all, colour: false })).toBe(false);
  });
});
