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
  /** The engine's own lock state (its lock button can change it). */
  readonly?: boolean;
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

/** The engine never changes while Obsidian runs, so it is found once per app. */
const found = new WeakMap<App, NativeCanvasKit>();

/**
 * Finds the canvas engine: from an open canvas tab, or by creating (never opening) a canvas view object
 * from Obsidian's view registry. Returns null if neither works.
 */
export function findCanvasEngine(app: App): NativeCanvasKit | null {
  const known = found.get(app);
  if (known) return known;
  let kit: NativeCanvasKit | null = null;
  for (const leaf of app.workspace.getLeavesOfType("canvas")) {
    kit = kitFrom(leaf.view);
    if (kit) break;
  }
  if (!kit) {
    try {
      const registry = (app as unknown as { viewRegistry?: { getViewCreatorByType?(t: string): ((leaf: unknown) => View) | undefined } }).viewRegistry;
      const create = registry?.getViewCreatorByType?.("canvas");
      // What a view's constructor reads from its leaf; nothing here is ever attached to the workspace.
      const fakeLeaf = { app, containerEl: createDiv(), getRoot: () => null, on: () => ({}), view: null, history: { backHistory: [], forwardHistory: [] } };
      if (create) kit = kitFrom(create(fakeLeaf));
    } catch {
      kit = null;
    }
  }
  if (kit) found.set(app, kit);
  return kit;
}

/**
 * A read-only Obsidian canvas showing `data`, drawn inside `container`. Its save hooks do nothing, so it can
 * never write the canvas file. Dropping files in (which would import them into the vault) and modifier drags
 * (Alt duplicates, Mod drags out) are stopped before they reach the engine. The caller positions the view.
 */
export function createReadonlyCanvas(kit: NativeCanvasKit, app: App, file: TFile, container: HTMLElement, data: unknown): NativeCanvas {
  for (const type of ["dragenter", "dragover", "drop"]) {
    container.addEventListener(
      type,
      (ev) => {
        ev.stopPropagation();
        if (type === "drop") ev.preventDefault();
        const dt = (ev as DragEvent).dataTransfer;
        if (dt) dt.dropEffect = "none";
      },
      true,
    );
  }
  container.addEventListener("pointerdown", (ev) => (ev.altKey || ev.metaKey || ev.ctrlKey) && ev.stopPropagation(), true);
  const host = {
    app,
    file,
    plugin: kit.plugin,
    contentEl: container,
    requestSave: () => {},
    save: async () => {},
    saveLocalData: () => {},
  };
  const canvas = new kit.Engine(host);
  canvas.load();
  canvas.setData(data);
  canvas.setReadonly(true);
  return canvas;
}
