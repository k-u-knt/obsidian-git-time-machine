import { boxInRegion, containsPoint, type HitMode, type Point, type Region } from "./geometry";
import type { SpatialAdapter } from "./types";

/** Adds everything the selected items bring along, until nothing new is added. */
export function expandSelection(adapter: SpatialAdapter, ids: Iterable<string>): string[] {
  const out = new Set<string>();
  const queue = [...ids];
  while (queue.length) {
    const id = queue.pop()!;
    if (out.has(id) || !adapter.has(id)) continue;
    out.add(id);
    queue.push(...adapter.brings(id));
  }
  return [...out];
}

/** Items inside (or touching) a region, before expansion. */
export function itemsInRegion(adapter: SpatialAdapter, region: Region, mode: HitMode): string[] {
  return adapter
    .items()
    .filter((it) => boxInRegion(it.bounds, region, mode))
    .map((it) => it.id);
}

/** The topmost item under a point, or null. */
export function itemAt(adapter: SpatialAdapter, p: Point): string | null {
  let best: { id: string; z: number } | null = null;
  for (const it of adapter.items()) if (containsPoint(it.bounds, p) && (!best || it.z > best.z)) best = { id: it.id, z: it.z };
  return best?.id ?? null;
}
