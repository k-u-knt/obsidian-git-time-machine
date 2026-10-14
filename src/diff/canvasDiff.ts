/** JSON Canvas (https://jsoncanvas.org) as Obsidian writes it. Unknown fields are kept as-is. */
export interface CanvasNode {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  subpath?: string;
  url?: string;
  label?: string;
  [key: string]: unknown;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
  fromEnd?: string;
  toEnd?: string;
  color?: string;
  label?: string;
  [key: string]: unknown;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  [key: string]: unknown;
}

/** "moved" = only position or size changed, which is not a change for the user. */
export type ItemState = "same" | "moved" | "edited" | "added" | "removed";

export interface CanvasDiff {
  past: CanvasData;
  current: CanvasData;
  nodes: Map<string, ItemState>;
  edges: Map<string, ItemState>;
}

export interface CanvasChange {
  id: string;
  kind: "node" | "edge";
  state: "edited" | "added" | "removed";
  label: string;
}

export class CanvasParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanvasParseError";
  }
}

/** An empty file is an empty canvas; anything that is not a JSON object with node/edge arrays is an error. */
export function parseCanvas(text: string): CanvasData {
  if (!text.trim()) return { nodes: [], edges: [] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new CanvasParseError(`This canvas isn't valid JSON: ${(e as Error).message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new CanvasParseError("This canvas isn't a JSON object.");
  const obj = data as Record<string, unknown>;
  const nodes = Array.isArray(obj.nodes) ? (obj.nodes as CanvasNode[]) : [];
  const edges = Array.isArray(obj.edges) ? (obj.edges as CanvasEdge[]) : [];
  return { ...obj, nodes, edges };
}

const NODE_CONTENT = ["type", "text", "file", "subpath", "url", "label", "color"] as const;
const NODE_GEOMETRY = ["x", "y", "width", "height"] as const;
const EDGE_CONTENT = ["fromNode", "toNode", "label", "color", "fromEnd", "toEnd"] as const;
const EDGE_GEOMETRY = ["fromSide", "toSide"] as const;

const differs = <T extends Record<string, unknown>>(a: T, b: T, keys: readonly string[]) => keys.some((k) => a[k] !== b[k]);

function compare<T extends { id: string } & Record<string, unknown>>(
  past: T[],
  current: T[],
  content: readonly string[],
  geometry: readonly string[],
): Map<string, ItemState> {
  const states = new Map<string, ItemState>();
  const pastById = new Map(past.map((x) => [x.id, x]));
  const currentIds = new Set(current.map((x) => x.id));
  for (const c of current) {
    const p = pastById.get(c.id);
    if (!p) states.set(c.id, "added");
    else if (differs(p, c, content)) states.set(c.id, "edited");
    else if (differs(p, c, geometry)) states.set(c.id, "moved");
    else states.set(c.id, "same");
  }
  for (const p of past) if (!currentIds.has(p.id)) states.set(p.id, "removed");
  return states;
}

export function diffCanvas(past: CanvasData, current: CanvasData): CanvasDiff {
  return {
    past,
    current,
    nodes: compare(past.nodes, current.nodes, NODE_CONTENT, NODE_GEOMETRY),
    edges: compare(past.edges, current.edges, EDGE_CONTENT, EDGE_GEOMETRY),
  };
}

export function countStates(states: Map<string, ItemState>): Record<ItemState, number> {
  const out: Record<ItemState, number> = { same: 0, moved: 0, edited: 0, added: 0, removed: 0 };
  for (const s of states.values()) out[s]++;
  return out;
}

/** A short human name for a card: its first heading or line, a file name, a link host or a group label. */
export function nodeTitle(n: CanvasNode): string {
  const clip = (s: string) => (s.length > 40 ? `${s.slice(0, 39)}…` : s);
  if (n.type === "group") return clip(n.label?.trim() || "Group");
  if (n.type === "file" && n.file) return clip(n.file.split("/").pop()!.replace(/\.md$/, ""));
  if (n.type === "link" && n.url) return clip(n.url.replace(/^https?:\/\//, "").split("/")[0]);
  const line = (n.text ?? "").split("\n").find((l) => l.trim()) ?? "";
  const plain = line.replace(/^#+\s*/, "").replace(/[*_`[\]]/g, "").trim();
  return clip(plain || "Card");
}

/** One entry per changed card or connection, cards first, in canvas order. */
export function describeCanvasChanges(d: CanvasDiff): CanvasChange[] {
  const out: CanvasChange[] = [];
  const pastNodes = new Map(d.past.nodes.map((n) => [n.id, n]));
  const currentNodes = new Map(d.current.nodes.map((n) => [n.id, n]));
  const order = [...d.current.nodes.map((n) => n.id), ...d.past.nodes.filter((n) => !currentNodes.has(n.id)).map((n) => n.id)];
  for (const id of order) {
    const state = d.nodes.get(id);
    if (state !== "edited" && state !== "added" && state !== "removed") continue;
    const node = currentNodes.get(id) ?? pastNodes.get(id)!;
    const what = node.type === "group" ? "group" : "card";
    out.push({ id, kind: "node", state, label: `${nodeTitle(node)} · ${what} ${state}` });
  }
  const titleOf = (id: string) => {
    const n = currentNodes.get(id) ?? pastNodes.get(id);
    return n ? nodeTitle(n) : "?";
  };
  const pastEdges = new Map(d.past.edges.map((e) => [e.id, e]));
  const currentEdges = new Map(d.current.edges.map((e) => [e.id, e]));
  const edgeOrder = [...d.current.edges.map((e) => e.id), ...d.past.edges.filter((e) => !currentEdges.has(e.id)).map((e) => e.id)];
  for (const id of edgeOrder) {
    const state = d.edges.get(id);
    if (state !== "edited" && state !== "added" && state !== "removed") continue;
    const e = currentEdges.get(id) ?? pastEdges.get(id)!;
    out.push({ id, kind: "edge", state, label: `${titleOf(e.fromNode)} → ${titleOf(e.toNode)} · connection ${state}` });
  }
  return out;
}

/** True when two items are identical in every field (key order ignored). Region restore skips only these. */
export function sameItem(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
  if (!a || !b) return false;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, canonical(obj[k])]));
  }
  return v;
}
