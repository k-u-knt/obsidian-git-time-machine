import { rectFromPoints, type HitMode, type Point, type Region } from "./geometry";
import { describePlan, planRestore, type RestorePlan } from "./restorePlan";
import { expandSelection, itemAt, itemsInRegion } from "./selection";
import type { SpatialAdapter } from "./types";

export type Tool = "select" | "rect" | "lasso";

/** Kept by the Time Machine tab so a re-render (after a save or sync) doesn't lose the user's choices. */
export interface RegionState {
  tool: Tool;
  keepPositions: boolean;
  removeAdded: boolean;
  selected: string[];
  region: Region | null;
  mode: HitMode;
}

export const defaultRegionState = (): RegionState => ({ tool: "select", keepPositions: false, removeAdded: false, selected: [], region: null, mode: "inside" });

export interface RegionToolOptions {
  past: SpatialAdapter;
  current: SpatialAdapter;
  /** Receives pointer events on the past side. */
  stage: HTMLElement;
  /** Drawn in scene coordinates (viewBox matches the scene). */
  overlay: SVGSVGElement;
  toScene(ev: PointerEvent): Point;
  state: RegionState;
  bar: HTMLElement;
  /** True when the item needs no restore; `ignoreGeometry` when "Keep current positions" is on. */
  unchanged(id: string, ignoreGeometry: boolean): boolean;
  fileExists(path: string): boolean;
  title(id: string): string;
  /** Called whenever the selection or plan changes, so the sides can highlight items and draw ghosts. */
  onChange(selected: string[], plan: RestorePlan | null): void;
  onRestore(plan: RestorePlan, keepPositions: boolean): void;
  /** Maps a region drawn on the past side into today's coordinates (the canvas may have shifted). */
  regionToCurrent?(r: Region): Region;
}

/** Click / rectangle / lasso selection on the past side, the summary bar, and the restore button. */
export class RegionTool {
  private plan: RestorePlan | null = null;
  private drawing: Point[] | null = null;
  private start: Point | null = null;

  constructor(private readonly o: RegionToolOptions) {
    const { stage } = o;
    stage.addEventListener("pointerdown", (ev) => this.down(ev));
    stage.addEventListener("pointermove", (ev) => this.move(ev));
    stage.addEventListener("pointerup", (ev) => this.up(ev));
    this.setTool(o.state.tool);
    this.recompute();
  }

  setTool(tool: Tool): void {
    this.o.state.tool = tool;
    this.o.stage.toggleClass("is-drawing-tool", tool !== "select");
  }

  clear(): void {
    this.o.state.selected = [];
    this.o.state.region = null;
    this.recompute();
  }

  /** Selects these items (and what they bring) — e.g. cards picked on the other side. Unknown ids are ignored. */
  selectIds(ids: string[]): void {
    this.o.state.selected = expandSelection(this.o.past, ids);
    this.o.state.region = null;
    this.recompute();
  }

  /** Selects one item and everything it brings (used by a card's "Restore card" button). */
  selectOnly(id: string): RestorePlan | null {
    this.o.state.selected = expandSelection(this.o.past, [id]);
    this.o.state.region = null;
    this.recompute();
    return this.plan;
  }

  private down(ev: PointerEvent): void {
    if (ev.button !== 0 || (ev.target as HTMLElement).closest("button, a, input")) return;
    const p = this.o.toScene(ev);
    if (this.o.state.tool === "select") {
      const id = itemAt(this.o.past, p);
      const picked = id ? expandSelection(this.o.past, [id]) : [];
      const sel = new Set(this.o.state.selected);
      if (ev.shiftKey && id) {
        if (sel.has(id)) for (const x of picked) sel.delete(x);
        else for (const x of picked) sel.add(x);
        this.o.state.selected = [...sel];
      } else this.o.state.selected = picked;
      this.o.state.region = null;
      this.recompute();
      return;
    }
    ev.preventDefault();
    this.o.stage.setPointerCapture(ev.pointerId);
    this.start = p;
    this.drawing = [p];
    this.drawShape();
  }

  private move(ev: PointerEvent): void {
    if (!this.drawing || !this.start) return;
    const p = this.o.toScene(ev);
    if (this.o.state.tool === "rect") this.drawing = [this.start, p];
    else this.drawing.push(p);
    this.drawShape();
  }

  private up(ev: PointerEvent): void {
    if (!this.drawing || !this.start) return;
    const pts = this.drawing;
    this.drawing = null;
    this.start = null;
    this.o.overlay.empty();
    const region: Region | null =
      this.o.state.tool === "rect" ? { kind: "rect", box: rectFromPoints(pts[0], pts[pts.length - 1]) } : pts.length >= 3 ? { kind: "lasso", points: pts } : null;
    if (!region) return;
    const mode: HitMode = ev.altKey ? "touching" : "inside";
    const found = expandSelection(this.o.past, itemsInRegion(this.o.past, region, mode));
    this.o.state.selected = ev.shiftKey ? [...new Set([...this.o.state.selected, ...found])] : found;
    this.o.state.region = region;
    this.o.state.mode = mode;
    this.recompute();
  }

  private drawShape(): void {
    const svg = this.o.overlay;
    svg.empty();
    const pts = this.drawing;
    if (!pts || !pts.length) return;
    if (this.o.state.tool === "rect" && pts.length === 2) {
      const b = rectFromPoints(pts[0], pts[1]);
      svg.createSvg("rect", { cls: "gtm-region-shape", attr: { x: b.x, y: b.y, width: b.w, height: b.h } });
    } else {
      svg.createSvg("polyline", { cls: "gtm-region-shape", attr: { points: pts.map((p) => `${p.x},${p.y}`).join(" ") } });
    }
  }

  private recompute(): void {
    const s = this.o.state;
    if (!s.selected.length) this.plan = null;
    else {
      const currentRegion = s.region && this.o.regionToCurrent ? this.o.regionToCurrent(s.region) : s.region;
      const currentInRegion = currentRegion ? itemsInRegion(this.o.current, currentRegion, s.mode) : [];
      this.plan = planRestore({
        past: this.o.past,
        current: this.o.current,
        selected: s.selected,
        unchanged: (id) => this.o.unchanged(id, s.keepPositions),
        currentInRegion,
        removeAdded: s.removeAdded,
        fileExists: this.o.fileExists,
        title: this.o.title,
      });
    }
    this.renderBar();
    this.o.onChange(s.selected, this.plan);
  }

  private renderBar(): void {
    const bar = this.o.bar;
    bar.empty();
    const s = this.o.state;
    if (!this.plan) {
      bar.createSpan({
        cls: "gtm-region-hint",
        text:
          s.tool === "select"
            ? "Click a card on the left to select it (Shift adds more), or pick Rectangle / Lasso to select an area."
            : "Drag on the left to select an area. Cards fully inside are picked; hold ⌥ to pick anything it touches.",
      });
      return;
    }
    const plan = this.plan;
    const text = bar.createDiv({ cls: "gtm-region-summary" });
    text.createDiv({ cls: "gtm-region-title", text: describePlan(plan) });
    for (const w of plan.warnings) text.createDiv({ cls: "gtm-region-warning", text: w });
    const opts = bar.createDiv({ cls: "gtm-region-options" });
    this.checkbox(opts, "Keep current positions", s.keepPositions, (v) => (s.keepPositions = v));
    this.checkbox(opts, "Also remove items added here since then", s.removeAdded, (v) => (s.removeAdded = v), !s.region);
    const actions = bar.createDiv({ cls: "gtm-region-actions" });
    actions.createEl("button", { text: "Clear" }).addEventListener("click", () => this.clear());
    const go = actions.createEl("button", { cls: "mod-cta", text: "Restore selection →" });
    go.disabled = !plan.replace.length && !plan.add.length && !plan.remove.length;
    go.addEventListener("click", () => this.o.onRestore(plan, s.keepPositions));
  }

  private checkbox(parent: HTMLElement, label: string, value: boolean, set: (v: boolean) => void, disabled = false): void {
    const l = parent.createEl("label", { cls: "gtm-region-option" + (disabled ? " is-disabled" : "") });
    const box = l.createEl("input", { attr: { type: "checkbox" } });
    box.checked = value;
    box.disabled = disabled;
    l.appendText(label);
    box.addEventListener("change", () => {
      set(box.checked);
      this.recompute();
    });
  }
}
