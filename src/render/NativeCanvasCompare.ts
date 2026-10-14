import { setIcon, TFile, type App } from "obsidian";
import { describeCanvasChanges, GEOMETRY_FIELDS, nodeTitle, sameItem, shiftNode, type CanvasDiff, type ItemState } from "../diff/canvasDiff";
import { canvasAdapter } from "../region/canvasAdapter";
import { shiftRegion } from "../region/geometry";
import { expandSelection, itemAt } from "../region/selection";
import { RegionTool, type Tool } from "../region/RegionTool";
import type { RestorePlan } from "../region/restorePlan";
import type { CanvasViewState } from "./CanvasCompare";
import { createReadonlyCanvas, type NativeCanvas, type NativeCanvasKit } from "./nativeCanvas";
import type { CompareRenderer } from "./types";

export interface NativeCanvasCompareOptions {
  app: App;
  kit: NativeCanvasKit;
  file: TFile;
  diff: CanvasDiff;
  leftLabel: string;
  state: CanvasViewState;
  onUseText(nodeId: string): void;
  onRestorePlan(plan: RestorePlan, keepPositions: boolean): void;
}

interface Side {
  canvas: NativeCanvas;
  pane: HTMLElement;
  /** Ghosts and moving lines for a selection made on the other side. */
  marks: SVGSVGElement;
  which: "left" | "right";
}

/**
 * Both versions drawn by Obsidian's own canvas engine (read-only, saving disabled), side by side.
 * Change marks are added to Obsidian's card and connection elements; pan and zoom stay linked.
 */
export class NativeCanvasCompare implements CompareRenderer {
  private left!: Side;
  private right!: Side;
  private tool: RegionTool | null = null;
  private toolButtons = new Map<Tool, HTMLElement>();
  private frame = 0;
  private lastLeft = "";
  private lastRight = "";
  private destroyed = false;
  /** What the user picked, and on which side: drives dimming there and ghosts on the other side. */
  private visual: { side: "left" | "right"; ids: Set<string> } = { side: "left", ids: new Set() };
  private plan: RestorePlan | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private regionOverlay!: SVGSVGElement;
  private fromRight = false;
  private marksKey = "";
  private gradients = 0;

  constructor(private readonly o: NativeCanvasCompareOptions) {}

  async render(host: HTMLElement): Promise<void> {
    const { diff, state } = this.o;
    host.empty();
    const root = host.createDiv({ cls: "gtm-canvas-compare gtm-native", attr: { tabindex: "-1" } });
    root.addEventListener("keydown", (ev) => ev.key === "Escape" && this.tool?.clear());

    const toolbar = root.createDiv({ cls: "gtm-canvas-toolbar" });
    const tools = toolbar.createDiv({ cls: "gtm-segmented", attr: { role: "group", "aria-label": "Selection tool" } });
    for (const [tool, label, icon] of [
      ["select", "Select", "mouse-pointer-2"],
      ["rect", "Rectangle", "square-dashed"],
      ["lasso", "Lasso", "lasso"],
    ] as Array<[Tool, string, string]>) {
      const b = tools.createEl("button", { attr: { "aria-pressed": String(state.region.tool === tool) } });
      setIcon(b.createSpan({ cls: "gtm-btn-icon" }), icon);
      b.appendText(label);
      b.toggleClass("is-active", state.region.tool === tool);
      b.addEventListener("click", () => this.setTool(tool));
      this.toolButtons.set(tool, b);
    }
    toolbar.createEl("button", { text: "Fit" }).addEventListener("click", () => this.fit());

    const panes = root.createDiv({ cls: "gtm-canvas-panes" });
    this.left = this.side(panes, "left", this.o.leftLabel, "read-only", "lock", diff.past);
    this.right = this.side(panes, "right", "Now", "your canvas", "pencil", diff.current);
    this.regionOverlay = this.left.pane.createSvg("svg", { cls: ["gtm-native-overlay", "gtm-region"], attr: { preserveAspectRatio: "none" } });
    this.listenForRightClicks(canvasAdapter(diff.current));
    const bar = root.createDiv({ cls: "gtm-region-bar" });

    this.mark(this.left);
    this.mark(this.right);

    const pastNodes = new Map(diff.past.nodes.map((n) => [n.id, n]));
    const pastItems = new Map<string, Record<string, unknown>>([...diff.past.nodes, ...diff.past.edges].map((x) => [x.id, x]));
    const currentItems = new Map<string, Record<string, unknown>>([...diff.current.nodes, ...diff.current.edges].map((x) => [x.id, x]));
    const pastShifted = (id: string) => {
      const p = pastNodes.get(id);
      return p ? shiftNode(p, diff.anchor) : pastItems.get(id);
    };
    this.tool = new RegionTool({
      past: canvasAdapter(diff.past),
      current: canvasAdapter(diff.current),
      stage: this.left.pane,
      overlay: this.regionOverlay,
      toScene: (ev) => this.left.canvas.posFromEvt(ev),
      state: state.region,
      bar,
      regionToCurrent: (r) => shiftRegion(r, diff.anchor),
      unchanged: (id, ignoreGeometry) => sameItem(pastShifted(id), currentItems.get(id), ignoreGeometry ? GEOMETRY_FIELDS : []),
      fileExists: (p) => this.o.app.vault.getAbstractFileByPath(p) instanceof TFile,
      title: (id) => {
        const n = pastNodes.get(id);
        return n ? nodeTitle(n) : id;
      },
      onChange: (selected, plan) => {
        this.plan = plan;
        if (!this.fromRight) this.visual = { side: "left", ids: new Set(selected) };
      },
      onRestore: (plan, keep) => this.o.onRestorePlan(plan, keep),
    });
    this.setTool(state.region.tool);
    // Obsidian's canvas measures its pane on resize; keep it informed as the tab or sidebar changes size.
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.left.canvas.onResize();
        this.right.canvas.onResize();
      });
      this.resizeObserver.observe(this.left.pane);
      this.resizeObserver.observe(this.right.pane);
    }
    this.loop();
  }

  scrollToChange(index: number): void {
    const change = describeCanvasChanges(this.o.diff)[index];
    if (!change) return;
    const id =
      change.kind === "node"
        ? change.id
        : (this.o.diff.current.edges.find((e) => e.id === change.id) ?? this.o.diff.past.edges.find((e) => e.id === change.id))?.toNode;
    const node = this.o.diff.current.nodes.find((n) => n.id === id) ?? this.o.diff.past.nodes.find((n) => n.id === id);
    if (!node) return;
    const onRight = this.o.diff.current.nodes.some((n) => n.id === id);
    const side = onRight ? this.right : this.left;
    const pad = Math.max(node.width, node.height) * 0.6;
    side.canvas.zoomToBbox({ minX: node.x - pad, minY: node.y - pad, maxX: node.x + node.width + pad, maxY: node.y + node.height + pad });
    for (const s of [this.left, this.right]) {
      const el = s.canvas.nodes.get(node.id)?.nodeEl;
      el?.addClass("gtm-flash");
      window.setTimeout(() => el?.removeClass("gtm-flash"), 1400);
    }
  }

  destroy(): void {
    this.destroyed = true;
    window.cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    for (const s of [this.left, this.right]) {
      if (!s) continue;
      const st = s.canvas.getState();
      if (s.which === "left") this.o.state.zoom = st.zoom;
      s.canvas.unload();
    }
  }

  // --------------------------------------------------------------------------

  private side(parent: HTMLElement, which: "left" | "right", time: string, note: string, icon: string, data: unknown): Side {
    const pane = parent.createDiv({ cls: `gtm-canvas-pane is-${which}` });
    const head = pane.createDiv({ cls: "gtm-canvas-head" });
    setIcon(head.createSpan({ cls: "gtm-colhead-icon" }), icon);
    head.createSpan({ cls: "gtm-colhead-time", text: time });
    head.createSpan({ cls: "gtm-colhead-note", text: note });
    const body = pane.createDiv({ cls: "gtm-native-body" });
    const container = body.createDiv({ cls: "gtm-native-host" });
    const canvas = createReadonlyCanvas(this.o.kit, this.o.app, this.o.file, container, data);
    // Scaled exactly like the canvas (no letterboxing), and clipped to this side by CSS.
    const marks = body.createSvg("svg", { cls: ["gtm-native-overlay", "gtm-marks"], attr: { preserveAspectRatio: "none" } });
    addArrows(marks, `goback-${which}`);
    return { canvas, pane: body, marks, which };
  }

  /** Adds change marks to Obsidian's own card and connection elements (they exist once a card is drawn). */
  private mark(side: Side): void {
    const { diff } = this.o;
    for (const [id, node] of side.canvas.nodes) {
      const el = node.nodeEl;
      if (!el || el.dataset.gtmMarked) continue;
      el.dataset.gtmMarked = "1";
      const state = diff.nodes.get(id) ?? "same";
      // Moves and resizes are shown on the past side only (where you'd restore from).
      if (state === "same" || (state === "moved" && side.which === "right")) continue;
      el.addClass("gtm-n", `gtm-n-${state}`);
      el.createDiv({ cls: "gtm-n-tag", text: this.tagFor(id, state) });
      const pastNode = diff.past.nodes.find((n) => n.id === id);
      const now = diff.current.nodes.find((n) => n.id === id);
      if (side.which === "left" && state === "edited" && pastNode?.type === "text" && now?.type === "text" && now.text !== pastNode.text) {
        this.cardButton(el, "Use this text", () => this.o.onUseText(id));
      }
      if (side.which === "left" && state === "removed") this.cardButton(el, pastNode?.type === "group" ? "Restore group…" : "Restore card…", () => this.tool?.selectOnly(id));
    }
    for (const [id, edge] of side.canvas.edges) {
      const g = edge.lineGroupEl;
      if (!g || g.dataset.gtmMarked) continue;
      g.dataset.gtmMarked = "1";
      const state = diff.edges.get(id) ?? "same";
      if (state === "edited" || state === "added" || state === "removed") g.addClass(`gtm-e-${state}`);
    }
  }

  private tagFor(id: string, state: ItemState): string {
    if (state === "edited") return "Edited";
    if (state === "added") return "Added";
    if (state === "removed") return "Removed";
    const g = this.o.diff.geometry.get(id);
    return g?.moved && g.resized ? "Moved · resized" : g?.resized ? "Resized" : "Moved";
  }

  private cardButton(el: HTMLElement, text: string, onClick: () => void): void {
    const b = el.createEl("button", { cls: "gtm-n-action", text });
    b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onClick();
    });
  }

  /** Each frame: link pan/zoom between the sides, keep overlays aligned, mark newly drawn cards. */
  private loop(): void {
    if (this.destroyed) return;
    const l = this.left.canvas.getState();
    const r = this.right.canvas.getState();
    const lk = JSON.stringify(l);
    const rk = JSON.stringify(r);
    if (lk !== this.lastLeft && lk !== rk) {
      this.right.canvas.setState(l);
      this.lastLeft = this.lastRight = lk;
    } else if (rk !== this.lastRight && lk !== rk) {
      this.left.canvas.setState(r);
      this.lastLeft = this.lastRight = rk;
    } else {
      this.lastLeft = lk;
      this.lastRight = rk;
    }
    for (const s of [this.left, this.right]) {
      const bb = s.canvas.getViewportBBox();
      const box = `${bb.minX} ${bb.minY} ${bb.maxX - bb.minX} ${bb.maxY - bb.minY}`;
      s.marks.setAttr("viewBox", box);
      if (s.which === "left") this.regionOverlay.setAttr("viewBox", box);
      s.pane.style.setProperty("--gtm-zoom", String(s.canvas.scale || 1));
      this.mark(s);
    }
    this.highlight();
    this.frame = window.requestAnimationFrame(() => this.loop());
  }

  /**
   * The side where cards were picked dims everything else; the other side shows each picked card's "ghost"
   * (left pick: where it would go back to; right pick: where it is now) and a line showing the move.
   */
  private highlight(): void {
    const v = this.visual;
    const remove = new Set(this.plan?.remove ?? []);
    for (const s of [this.left, this.right]) {
      const picking = v.ids.size > 0 && s.which === v.side;
      for (const [id, node] of s.canvas.nodes) {
        node.nodeEl?.toggleClass("gtm-n-dim", picking && !v.ids.has(id));
        node.nodeEl?.toggleClass("gtm-n-selected", picking && v.ids.has(id));
        if (s.which === "right") node.nodeEl?.toggleClass("gtm-n-doomed", remove.has(id));
      }
    }
    const keep = this.o.state.region.keepPositions;
    const key = JSON.stringify([v.side, [...v.ids], keep]);
    if (key === this.marksKey) return;
    this.marksKey = key;
    for (const s of [this.left, this.right]) for (const el of [...s.marks.querySelectorAll(".gtm-ghost, .gtm-goback, .gtm-grad")]) el.remove();
    const { diff } = this.o;
    const past = new Map(diff.past.nodes.map((n) => [n.id, n]));
    const current = new Map(diff.current.nodes.map((n) => [n.id, n]));
    const back = { dx: -diff.anchor.dx, dy: -diff.anchor.dy };
    for (const id of v.ids) {
      if ((diff.nodes.get(id) ?? "same") === "same") continue;
      const p = past.get(id);
      const c = current.get(id);
      if (v.side === "left") {
        // Picked in the past: on the current side, where it was (red) → where it is now.
        if (!p) continue;
        const then = shiftNode(p, diff.anchor);
        this.drawGhost(this.right, then, "past");
        if (c) this.drawArrow(this.right, then, c);
      } else {
        // Picked now: on the past side, where it is now (green), reached from where it was.
        if (!c) continue;
        const now = shiftNode(c, back);
        this.drawGhost(this.left, now, "now");
        if (p) this.drawArrow(this.left, p, now);
      }
    }
  }

  /** A dashed outline: red for a past position, green for a current one. */
  private drawGhost(side: Side, box: Box, kind: "past" | "now"): void {
    side.marks.createSvg("rect", { cls: ["gtm-ghost", `gtm-ghost-${kind}`], attr: { x: box.x, y: box.y, width: box.width, height: box.height, rx: 8 } });
  }

  /** An arrow from a past position to a current one, fading red → green. */
  private drawArrow(side: Side, from: Box, to: Box): void {
    if (from.x === to.x && from.y === to.y) return;
    const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const b = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
    const id = `gtm-grad-${side.which}-${++this.gradients}`;
    const defs = side.marks.querySelector("defs") ?? side.marks.createSvg("defs");
    const grad = defs.createSvg("linearGradient", { cls: "gtm-grad", attr: { id, gradientUnits: "userSpaceOnUse", x1: a.x, y1: a.y, x2: b.x, y2: b.y } });
    grad.createSvg("stop", { cls: "gtm-stop-past", attr: { offset: "0" } });
    grad.createSvg("stop", { cls: "gtm-stop-now", attr: { offset: "1" } });
    side.marks.createSvg("path", {
      cls: "gtm-goback",
      attr: { d: `M${a.x},${a.y} L${b.x},${b.y}`, stroke: `url(#${id})`, "marker-end": `url(#goback-${side.which}-added)` },
    });
  }

  /** Select-tool clicks on the right side: pick the current card (Shift adds), and mirror it into the restore plan. */
  private listenForRightClicks(current: ReturnType<typeof canvasAdapter>): void {
    const pane = this.right.pane;
    let down: { x: number; y: number } | null = null;
    pane.addEventListener("pointerdown", (ev) => {
      if (ev.button === 0) down = { x: ev.clientX, y: ev.clientY };
    });
    pane.addEventListener("pointerup", (ev) => {
      if (!down || this.o.state.region.tool !== "select" || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4) return;
      down = null;
      if ((ev.target as HTMLElement).closest?.("button, a, input")) return;
      const id = itemAt(current, this.right.canvas.posFromEvt(ev));
      const picked = id ? expandSelection(current, [id]) : [];
      const ids = new Set(ev.shiftKey && this.visual.side === "right" ? this.visual.ids : []);
      if (ev.shiftKey && id && ids.has(id)) for (const x of picked) ids.delete(x);
      else for (const x of picked) ids.add(x);
      this.visual = { side: "right", ids };
      this.fromRight = true;
      try {
        this.tool?.selectIds([...ids]);
      } finally {
        this.fromRight = false;
      }
    });
  }

  private fit(): void {
    this.left.canvas.zoomToFit();
    this.right.canvas.setState(this.left.canvas.getState());
  }

  private setTool(tool: Tool): void {
    this.tool?.setTool(tool);
    for (const [t, b] of this.toolButtons) {
      b.toggleClass("is-active", t === tool);
      b.setAttr("aria-pressed", String(t === tool));
    }
  }
}

/** A card's box in canvas coordinates. */
type Box = { x: number; y: number; width: number; height: number };

/** Arrowheads in each change colour, ids `${prefix}-${state}`. */
function addArrows(svg: SVGSVGElement, prefix: string): void {
  const defs = svg.createSvg("defs");
  for (const state of ["same", "moved", "edited", "added", "removed"]) {
    const m = defs.createSvg("marker", {
      cls: ["gtm-arrow", `gtm-arrow-${state}`],
      attr: { id: `${prefix}-${state}`, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" },
    });
    m.createSvg("path", { attr: { d: "M0,0 L10,5 L0,10 z" } });
  }
}
