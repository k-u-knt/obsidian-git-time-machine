import type { App, TFile, View } from "obsidian";

/**
 * Obsidian's own canvas engine. NOT public API: these members were read from Obsidian 1.14.4's bundle.
 * Everything here is feature-checked; when anything is missing, callers fall back to CanvasCompare.
 */
export interface NativeCanvas {
  load(): void;
  unload(): void;
  setData(data: unknown): void;
  setReadonly(readonly: boolean): void;
  onResize(): void;
  zoomToFit(): void;
  zoomToBbox(bbox: { minX: number; minY: number; maxX: number; maxY: number }): void;
  getState(): { x: number; y: number; zoom: number };
  setState(state: { x: number; y: number; zoom: number }): void;
  getViewportBBox(): { minX: number; minY: number; maxX: number; maxY: number };
  posFromEvt(ev: MouseEvent): { x: number; y: number };
  requestFrame(): void;
  zoomToFitQueued: boolean;
  scale: number;
  wrapperEl: HTMLElement;
  nodes: Map<string, { nodeEl?: HTMLElement }>;
  edges: Map<string, { lineGroupEl?: SVGGElement }>;
}

type CanvasEngine = new (host: unknown) => NativeCanvas;

export interface NativeCanvasKit {
  Engine: CanvasEngine;
  /** The core Canvas plugin instance (its options: snapping, etc.). */
  plugin: unknown;
}

const REQUIRED = ["load", "unload", "setData", "setReadonly", "onResize", "zoomToFit", "zoomToBbox", "getState", "setState", "getViewportBBox", "posFromEvt"];

function kitFrom(view: unknown): NativeCanvasKit | null {
  const v = view as { canvas?: object; plugin?: unknown } | null;
  const proto = v?.canvas ? Object.getPrototypeOf(v.canvas) : null;
  if (!proto || !v?.plugin || !REQUIRED.every((m) => typeof proto[m] === "function")) return null;
  return { Engine: v.canvas!.constructor as CanvasEngine, plugin: v.plugin };
}

/**
 * Finds the canvas engine: from an open canvas tab, or by creating (never opening) a canvas view object
 * from Obsidian's view registry. Returns null if neither works.
 */
export function findCanvasEngine(app: App): NativeCanvasKit | null {
  for (const leaf of app.workspace.getLeavesOfType("canvas")) {
    const kit = kitFrom(leaf.view);
    if (kit) return kit;
  }
  try {
    const registry = (app as unknown as { viewRegistry?: { getViewCreatorByType?(t: string): ((leaf: unknown) => View) | undefined } }).viewRegistry;
    const create = registry?.getViewCreatorByType?.("canvas");
    if (!create) return null;
    const fakeLeaf = { app, containerEl: createDiv(), getRoot: () => null, on: () => ({}), view: null };
    return kitFrom(create(fakeLeaf));
  } catch {
    return null;
  }
}

/**
 * A read-only Obsidian canvas showing `data`, drawn inside `container`. Its save hook does nothing, so it
 * can never write a file, whatever happens inside the engine.
 */
export function createReadonlyCanvas(kit: NativeCanvasKit, app: App, file: TFile, container: HTMLElement, data: unknown): NativeCanvas {
  const host = {
    app,
    file,
    plugin: kit.plugin,
    contentEl: container,
    requestSave: () => {},
    save: async () => {},
  };
  const canvas = new kit.Engine(host);
  canvas.load();
  canvas.setData(data);
  canvas.setReadonly(true);
  canvas.zoomToFitQueued = true;
  canvas.onResize();
  return canvas;
}
