import type { CanvasData, CanvasNode } from "../diff/canvasDiff";
import type { RestorePlan } from "../region/restorePlan";

/** Obsidian's own canvas layout: tab-indented, one node or edge per line, no trailing newline. */
export function formatCanvas(data: CanvasData): string {
  const { nodes, edges, ...rest } = data;
  const list = (name: string, items: unknown[]) =>
    items.length ? `\t"${name}":[\n${items.map((i) => `\t\t${JSON.stringify(i)}`).join(",\n")}\n\t]` : `\t"${name}":[]`;
  const parts = [list("nodes", nodes), list("edges", edges), ...Object.entries(rest).map(([k, v]) => `\t${JSON.stringify(k)}:${JSON.stringify(v)}`)];
  return `{\n${parts.join(",\n")}\n}`;
}

/**
 * Applies a region restore. Replaced cards take their past content (and past position unless `keepPositions`);
 * added items are inserted after their nearest surviving predecessor in the past order, so layering is kept;
 * removed cards take their connections with them.
 */
export function applyCanvasPlan(current: CanvasData, past: CanvasData, plan: RestorePlan, opts: { keepPositions: boolean }): CanvasData {
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
      return opts.keepPositions ? { ...p, x: n.x, y: n.y, width: n.width, height: n.height } : { ...p };
    });
  nodes = insertInPastOrder(nodes, past.nodes, add);
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

/** "Use this text": only the card's text goes back; position, size and colour stay as they are now. */
export function useCardText(current: CanvasData, pastNode: CanvasNode): CanvasData {
  return { ...current, nodes: current.nodes.map((n) => (n.id === pastNode.id ? { ...n, text: pastNode.text } : n)) };
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
