import { describe, expect, it } from "vitest";
import { CanvasParseError, countStates, describeCanvasChanges, diffCanvas, nodeTitle, parseCanvas, sameItem, type CanvasData } from "../../src/diff/canvasDiff";

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

  it("classifies cards by content, not position", () => {
    expect(Object.fromEntries(d.nodes)).toEqual({ aims: "same", methods: "edited", data: "moved", collab: "added", questions: "removed" });
  });

  it("treats a connection that only changed sides as unchanged", () => {
    expect(Object.fromEntries(d.edges)).toEqual({ e1: "moved", e3: "added", e2: "removed" });
  });

  it("counts states", () => {
    expect(countStates(d.nodes)).toMatchObject({ edited: 1, added: 1, removed: 1, moved: 1, same: 1 });
  });

  it("describes changes cards first, then connections", () => {
    expect(describeCanvasChanges(d).map((c) => c.label)).toEqual([
      "Hi-C and imaging on 12 samples · card edited",
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
});
