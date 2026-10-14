import type { Box } from "./geometry";

export interface SpatialItem {
  id: string;
  bounds: Box;
  /** Stacking order: higher is drawn on top. */
  z: number;
}

/** Something that joins two items (a canvas connection, an Excalidraw arrow). */
export interface Connector {
  id: string;
  from: string;
  to: string;
}

/** One version of a drawing, seen as selectable items. One implementation per format (canvas, Excalidraw). */
export interface SpatialAdapter {
  items(): SpatialItem[];
  has(id: string): boolean;
  /** Items that always come along when `id` is selected (a group's contents, a shape's label). */
  brings(id: string): string[];
  connectors(): Connector[];
  /** Vault files an item needs to display (a file card's note, an embedded image). */
  filesNeeded(id: string): string[];
}
