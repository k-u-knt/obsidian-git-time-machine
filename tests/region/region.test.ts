import { describe, expect, it } from "vitest";
import { diffCanvas, type CanvasData } from "../../src/diff/canvasDiff";
import { canvasAdapter } from "../../src/region/canvasAdapter";
import { boxInRegion, rectFromPoints } from "../../src/region/geometry";
import { ALL_ASPECTS, describePlan, planRestore } from "../../src/region/restorePlan";
import { expandSelection, itemAt, itemsInRegion } from "../../src/region/selection";

describe("geometry", () => {
  const card = { x: 10, y: 10, w: 20, h: 10 };

  it("rectangle: inside needs the whole box, touching any overlap", () => {
    const region = { kind: "rect" as const, box: rectFromPoints({ x: 0, y: 0 }, { x: 25, y: 30 }) };
    expect(boxInRegion(card, region, "inside")).toBe(false);
    expect(boxInRegion(card, region, "touching")).toBe(true);
    expect(boxInRegion(card, { kind: "rect", box: { x: 0, y: 0, w: 100, h: 100 } }, "inside")).toBe(true);
  });

  it("lasso: a concave loop that misses a corner does not contain the box", () => {
    const uShape = [
      { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 25, y: 40 }, { x: 25, y: 15 }, { x: 15, y: 15 }, { x: 15, y: 40 }, { x: 0, y: 40 },
    ];
    expect(boxInRegion({ x: 2, y: 2, w: 10, h: 5 }, { kind: "lasso", points: uShape }, "inside")).toBe(true);
    expect(boxInRegion({ x: 10, y: 10, w: 20, h: 20 }, { kind: "lasso", points: uShape }, "inside")).toBe(false);
    expect(boxInRegion({ x: 10, y: 10, w: 20, h: 20 }, { kind: "lasso", points: uShape }, "touching")).toBe(true);
  });

  it("rotated boxes use their real corners", () => {
    const thin = { x: 0, y: 45, w: 100, h: 10, angle: Math.PI / 2 };
    expect(boxInRegion(thin, { kind: "rect", box: { x: 40, y: -10, w: 20, h: 120 } }, "inside")).toBe(true);
  });
});

const n = (id: string, x: number, y: number, w = 100, h = 60, extra: Record<string, unknown> = {}) => ({ id, type: "text", x, y, width: w, height: h, text: id, ...extra });
const past: CanvasData = {
  nodes: [
    n("group", 0, 0, 500, 300, { type: "group", label: "G" }),
    n("a", 20, 20),
    n("b", 200, 20, 100, 60, { text: "old b" }),
    n("gone", 20, 150),
    n("far", 900, 900),
    n("doc", 300, 150, 100, 60, { type: "file", file: "Notes/Deleted.md" }),
  ],
  edges: [
    { id: "ab", fromNode: "a", toNode: "b" },
    { id: "a-far", fromNode: "a", toNode: "far" },
    { id: "gone-x", fromNode: "gone", toNode: "lost" },
  ],
};
const current: CanvasData = {
  nodes: [n("group", 0, 0, 500, 300, { type: "group", label: "G" }), n("a", 20, 20), n("b", 200, 20, 100, 60, { text: "new b" }), n("new", 350, 30)],
  edges: [{ id: "ab", fromNode: "a", toNode: "b" }, { id: "b-new", fromNode: "b", toNode: "new" }],
};

describe("selection", () => {
  const pa = canvasAdapter(past);

  it("selecting a group brings the cards inside it", () => {
    expect(expandSelection(pa, ["group"]).sort()).toEqual(["a", "b", "doc", "gone", "group"]);
  });

  it("finds cards in a rectangle and the topmost card under a point", () => {
    expect(itemsInRegion(pa, { kind: "rect", box: { x: 0, y: 0, w: 320, h: 100 } }, "inside").sort()).toEqual(["a", "b"]);
    expect(itemAt(pa, { x: 30, y: 30 })).toBe("a");
    expect(itemAt(pa, { x: 450, y: 250 })).toBe("group");
  });
});

describe("planRestore", () => {
  const d = diffCanvas(past, current);
  const unchanged = (id: string) => (d.nodes.get(id) ?? d.edges.get(id)) === "same";
  const base = {
    past: canvasAdapter(past),
    current: canvasAdapter(current),
    unchanged,
    currentInRegion: [] as string[],
    removeAdded: false,
    fileExists: (p: string) => p !== "Notes/Deleted.md",
    title: (id: string) => id,
  };

  it("replaces changed cards, brings back deleted ones and skips unchanged", () => {
    const plan = planRestore({ ...base, selected: ["a", "b", "gone"] });
    expect(plan.replace).toEqual(["b"]);
    expect(plan.add).toEqual(["gone"]);
    expect(plan.skip).toEqual(["a", "ab"]);
    expect(plan.remove).toEqual([]);
  });

  it("keeps connections only when both ends will exist", () => {
    const plan = planRestore({ ...base, selected: ["a"] });
    expect(plan.add).not.toContain("a-far");
    expect(plan.fixups.map((f) => f.id)).toEqual(["a-far"]);
    expect(planRestore({ ...base, selected: ["a", "far"] }).add).toEqual(["far", "a-far"]);
  });

  it("removes cards added since then inside the region only when asked, with their connections", () => {
    expect(planRestore({ ...base, selected: ["b"], currentInRegion: ["b", "new"] }).remove).toEqual([]);
    expect(planRestore({ ...base, selected: ["b"], currentInRegion: ["b", "new"], removeAdded: true }).remove.sort()).toEqual(["b-new", "new"]);
  });

  it("leaves connections out when Connections is unticked", () => {
    const plan = planRestore({ ...base, selected: ["a", "far"], aspects: { ...ALL_ASPECTS, connections: false } });
    expect(plan.add).toEqual(["far"]);
  });

  it("leaves deleted cards out when 'Bring back deleted cards' is unticked", () => {
    const plan = planRestore({ ...base, selected: ["a", "b", "gone"], aspects: { ...ALL_ASPECTS, bringBack: false } });
    expect(plan.add).toEqual([]);
    expect(plan.replace).toEqual(["b"]);
  });

  it("lists deleted files a restored card needs", () => {
    const plan = planRestore({ ...base, selected: ["doc"] });
    expect(plan.extraFiles).toEqual(["Notes/Deleted.md"]);
  });

  it("summarises the plan", () => {
    expect(describePlan(planRestore({ ...base, selected: ["a", "b", "gone"] }))).toBe("Restore 4 items: 1 replaces the current version · 1 comes back · 2 unchanged");
    expect(describePlan(planRestore({ ...base, selected: ["a"] }))).toBe("Nothing to restore here: the selection is unchanged.");
    expect(describePlan(planRestore({ ...base, selected: [] }))).toBe("Nothing selected.");
  });
});
