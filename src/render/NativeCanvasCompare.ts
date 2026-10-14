import { setIcon, TFile, type App } from "obsidian";
import { describeCanvasChanges, GEOMETRY_FIELDS, nodeTitle, sameItem, shiftNode, type CanvasDiff, type ItemState } from "../diff/canvasDiff";
import { canvasAdapter } from "../region/canvasAdapter";
import { shiftRegion } from "../region/geometry";
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
  overlay: SVGSVGElement;
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
  private selected = new Set<string>();
  private plan: RestorePlan | null = null;
  private resizeObserver: ResizeObserver | null = null;

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
      overlay: this.left.overlay,
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
        this.selected = new Set(selected);
        this.plan = plan;
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
    const overlay = body.createSvg("svg", { cls: "gtm-native-overlay" });
    return { canvas, pane: body, overlay, which };
  }

  /** Adds change marks to Obsidian's own card and connection elements (they exist once a card is drawn). */
  private mark(side: Side): void {
    const { diff } = this.o;
    for (const [id, node] of side.canvas.nodes) {
      const el = node.nodeEl;
      if (!el || el.dataset.gtmMarked) continue;
      el.dataset.gtmMarked = "1";
      const state = diff.nodes.get(id) ?? "same";
      if (state === "same") continue;
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
      s.overlay.setAttr("viewBox", `${bb.minX} ${bb.minY} ${bb.maxX - bb.minX} ${bb.maxY - bb.minY}`);
      s.pane.style.setProperty("--gtm-zoom", String(s.canvas.scale || 1));
      this.mark(s);
    }
    this.highlight();
    this.frame = window.requestAnimationFrame(() => this.loop());
  }

  /** Selection on the left; ghosts where restored cards will land and cards to be removed on the right. */
  private highlight(): void {
    for (const [id, node] of this.left.canvas.nodes) node.nodeEl?.toggleClass("gtm-n-selected", this.selected.has(id));
    const remove = new Set(this.plan?.remove ?? []);
    for (const [id, node] of this.right.canvas.nodes) node.nodeEl?.toggleClass("gtm-n-doomed", remove.has(id));
    const key = JSON.stringify([this.plan?.add, this.plan?.replace, this.o.state.region.keepPositions]);
    if (this.right.overlay.dataset.key === key) return;
    this.right.overlay.dataset.key = key;
    this.right.overlay.empty();
    if (!this.plan) return;
    const past = new Map(this.o.diff.past.nodes.map((n) => [n.id, n]));
    const current = new Map(this.o.diff.current.nodes.map((n) => [n.id, n]));
    for (const id of [...this.plan.add, ...this.plan.replace]) {
      const p = past.get(id);
      if (!p) continue;
      const c = current.get(id);
      const box = this.o.state.region.keepPositions && c ? c : shiftNode(p, this.o.diff.anchor);
      this.right.overlay.createSvg("rect", { cls: "gtm-ghost", attr: { x: box.x, y: box.y, width: box.width, height: box.height, rx: 8 } });
    }
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
