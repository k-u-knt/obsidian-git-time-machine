export interface Point {
  x: number;
  y: number;
}

/** A box in scene coordinates, optionally rotated (radians) about its centre. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  angle?: number;
}

export type Region = { kind: "rect"; box: Box } | { kind: "lasso"; points: Point[] };
export type HitMode = "inside" | "touching";

/** The same region moved by (dx, dy), e.g. into today's coordinates when the canvas has shifted. */
export function shiftRegion(r: Region, by: { dx: number; dy: number }): Region {
  return r.kind === "rect"
    ? { kind: "rect", box: { ...r.box, x: r.box.x + by.dx, y: r.box.y + by.dy } }
    : { kind: "lasso", points: r.points.map((p) => ({ x: p.x + by.dx, y: p.y + by.dy })) };
}

export function rectFromPoints(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function corners(b: Box): Point[] {
  const pts = [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ];
  if (!b.angle) return pts;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const cos = Math.cos(b.angle);
  const sin = Math.sin(b.angle);
  return pts.map((p) => ({ x: cx + (p.x - cx) * cos - (p.y - cy) * sin, y: cy + (p.x - cx) * sin + (p.y - cy) * cos }));
}

export function containsPoint(b: Box, p: Point): boolean {
  return pointInPolygon(p, corners(b));
}

/** Even-odd rule; points on the boundary may land either way. */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segmentsCross(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const d = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(q1, q2, p1);
  const d2 = d(q1, q2, p2);
  const d3 = d(p1, p2, q1);
  const d4 = d(p1, p2, q2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function edgesCross(a: Point[], b: Point[]): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

/**
 * "inside": the box lies wholly within the region (every corner inside and no edges crossing, so a box
 * bridging a notch in a concave lasso doesn't count), like Excalidraw's selection. "touching": any overlap.
 */
export function boxInRegion(b: Box, region: Region, mode: HitMode): boolean {
  const poly = region.kind === "rect" ? corners(region.box) : region.points;
  if (poly.length < 3) return false;
  const pts = corners(b);
  if (mode === "inside") return pts.every((p) => pointInPolygon(p, poly)) && !edgesCross(pts, poly);
  return pts.some((p) => pointInPolygon(p, poly)) || poly.some((p) => pointInPolygon(p, pts)) || edgesCross(pts, poly);
}
