import type { CanvasData } from "../diff/canvasDiff";
import { boxInRegion } from "./geometry";
import type { Connector, SpatialAdapter, SpatialItem } from "./types";

/** A canvas version as selectable cards. A group card brings every card fully inside it; edges are connectors. */
export function canvasAdapter(data: CanvasData): SpatialAdapter {
  const items: SpatialItem[] = data.nodes.map((n, z) => ({ id: n.id, bounds: { x: n.x, y: n.y, w: n.width, h: n.height }, z }));
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const itemById = new Map(items.map((it) => [it.id, it]));
  const connectors: Connector[] = data.edges.map((e) => ({ id: e.id, from: e.fromNode, to: e.toNode }));
  return {
    items: () => items,
    has: (id) => byId.has(id) || connectors.some((c) => c.id === id),
    brings: (id) => {
      const n = byId.get(id);
      const it = itemById.get(id);
      if (!n || !it || n.type !== "group") return [];
      return items.filter((o) => o.id !== id && boxInRegion(o.bounds, { kind: "rect", box: it.bounds }, "inside")).map((o) => o.id);
    },
    connectors: () => connectors,
    filesNeeded: (id) => {
      const n = byId.get(id);
      return n?.type === "file" && typeof n.file === "string" ? [n.file] : [];
    },
  };
}
