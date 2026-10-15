import type { CanvasData, CanvasNode } from "../diff/canvasDiff";
import { ALL_ASPECTS, type RestoreAspects, type RestorePlan } from "../region/restorePlan";

/** Obsidian's own canvas layout: tab-indented, one node or edge per line, no trailing newline. */
export function formatCanvas(data: CanvasData): string {
  const { nodes, edges, ...rest } = data;
  const list = (name: string, items: unknown[]) =>
    items.length ? `\t"${name}":[\n${items.map((i) => `\t\t${JSON.stringify(i)}`).join(",\n")}\n\t]` : `\t"${name}":[]`;
  const parts = [list("nodes", nodes), list("edges", edges), ...Object.entries(rest).map(([k, v]) => `\t${JSON.stringify(k)}:${JSON.stringify(v)}`)];
  return `{\n${parts.join(",\n")}\n}`;
}

/**
 * Applies a region restore. Replaced cards take the chosen `aspects` of their past version (position shifted
 * by the anchor `offset`);
 * added items are inserted after their nearest surviving predecessor in the past order, so layering is kept;
 * removed cards take their connections with them.
 */
export function applyCanvasPlan(
  current: CanvasData,
  past: CanvasData,
  plan: RestorePlan,
  opts: { aspects?: RestoreAspects; offset?: { dx: number; dy: number } },
): CanvasData {
  const aspects = opts.aspects ?? ALL_ASPECTS;
  const dx = opts.offset?.dx ?? 0;
  const dy = opts.offset?.dy ?? 0;
  const remove = new Set(plan.remove);
  const replace = new Set(plan.replace);
  const add = new Set(plan.add);
  const pastNodes = new Map(past.nodes.map((n) => [n.id, n]));
  const pastEdges = new Map(past.edges.map((e) => [e.id, e]));

  let nodes = current.nodes
    .filter((n) => !remove.has(n.id))
    .map((n) => {
      const p = pastNodes.get(n.id);
      if (!replace.has(n.id) || !p) return n;
      return restoreAspects(n, p, aspects, dx, dy);
    });
  // Cards that come back land where they were relative to the anchor (the canvas may have shifted since).
  nodes = insertInPastOrder(nodes, past.nodes, add).map((n) => (add.has(n.id) && !current.nodes.some((c) => c.id === n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n));
  const nodeIds = new Set(nodes.map((n) => n.id));

  let edges = current.edges
    .filter((e) => !remove.has(e.id) && nodeIds.has(e.fromNode) && nodeIds.has(e.toNode))
    .map((e) => {
      const p = pastEdges.get(e.id);
      return replace.has(e.id) && p ? { ...p } : e;
    });
  edges = insertInPastOrder(edges, past.edges, add).filter((e) => nodeIds.has(e.fromNode) && nodeIds.has(e.toNode));
  return { ...current, nodes, edges };
}

const GEOMETRY = ["x", "y", "width", "height"];

/**
 * Today's card with the chosen aspects taken from its past version: text (all content fields), colour,
 * position (shifted by the anchor's offset) and size. Everything not chosen stays as it is now.
 */
function restoreAspects(now: CanvasNode, then: CanvasNode, a: RestoreAspects, dx: number, dy: number): CanvasNode {
  const out: CanvasNode = { ...now };
  if (a.text) {
    for (const k of Object.keys(out)) if (!GEOMETRY.includes(k) && k !== "color" && k !== "id" && !(k in then)) delete out[k];
    for (const [k, v] of Object.entries(then)) if (!GEOMETRY.includes(k) && k !== "color") out[k] = v;
  }
  if (a.colour) {
    if ("color" in then) out.color = then.color;
    else delete out.color;
  }
  if (a.position) {
    out.x = then.x + dx;
    out.y = then.y + dy;
  }
  if (a.size) {
    out.width = then.width;
    out.height = then.height;
  }
  return out;
}

function insertInPastOrder<T extends { id: string }>(list: T[], pastList: T[], add: Set<string>): T[] {
  const out = [...list];
  for (let i = 0; i < pastList.length; i++) {
    const item = pastList[i];
    if (!add.has(item.id) || out.some((o) => o.id === item.id)) continue;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((o) => o.id === pastList[j].id);
      if (k !== -1) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, { ...item });
  }
  return out;
}
