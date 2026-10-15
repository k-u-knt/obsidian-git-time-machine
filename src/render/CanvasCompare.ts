import { Component, MarkdownRenderer, setIcon, TFile, type App } from "obsidian";
import { describeCanvasChanges, nodeTitle, sameForAspects, sameItem, shiftNode, type CanvasData, type CanvasDiff, type CanvasEdge, type CanvasNode, type ItemState } from "../diff/canvasDiff";
import { canvasAdapter } from "../region/canvasAdapter";
import { RegionTool, type RegionState, type Tool } from "../region/RegionTool";
import { shiftRegion } from "../region/geometry";
import type { RestoreAspects, RestorePlan } from "../region/restorePlan";
import { markWords } from "./markdownBlocks";
import type { CompareRenderer } from "./types";

/** Zoom, scroll and toggles that survive a re-render. Owned by the Time Machine tab. */
export interface CanvasViewState {
  zoom: number | null;
  scrollLeft: number;
  scrollTop: number;
  region: RegionState;
}

export interface CanvasCompareOptions {
  app: App;
  parent: Component;
  sourcePath: string;
  diff: CanvasDiff;
  leftLabel: string;
  state: CanvasViewState;
  /** Opens a focused comparison of one card's text. */
  onCompareText(nodeId: string): void;
  onRestorePlan(plan: RestorePlan, aspects: RestoreAspects): void;
}

const PAD = 80;
/** Below this zoom, cards show a readable title instead of their (unreadably small) content. */
const OVERVIEW_BELOW = 0.5;
/** Jumping to a change zooms in at least this far, so the change can be read. */
const READ_ZOOM = 0.6;
const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

interface Side {
  data: CanvasData;
  scroll: HTMLElement;
  world: HTMLElement;
  stage: HTMLElement;
  overlay: SVGSVGElement;
  nodeEls: Map<string, HTMLElement>;
  /** The position we last set programmatically (see syncScroll). */
  expected: { left: number; top: number } | null;
}

/** Both canvases drawn in one coordinate system, with cards marked by what changed in their content. */
export class CanvasCompare implements CompareRenderer {
  private readonly component = new Component();
  private root!: HTMLElement;
  private left!: Side;
  private right!: Side;
  private minX = 0;
  private minY = 0;
  private width = 1;
  private height = 1;
  private tool: RegionTool | null = null;
  private toolButtons = new Map<Tool, HTMLElement>();
  private destroyed = false;
  /** True once the finished drawing has replaced the host's content. */
  private mounted = false;

  constructor(private readonly o: CanvasCompareOptions) {
    o.parent.addChild(this.component);
  }

  async render(host: HTMLElement): Promise<void> {
    const { diff, state } = this.o;
    this.measure([...diff.past.nodes, ...diff.current.nodes]);
    // Drawn off-screen and swapped in when complete, so a redraw (after each canvas save) never flashes blank.
    const root = host.ownerDocument.createElement("div");
    root.addClass("gtm-canvas-compare");
    root.setAttr("tabindex", "-1");
    this.root = root;
    root.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") this.tool?.clear();
    });

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
    const zoom = toolbar.createDiv({ cls: "gtm-canvas-zoom" });
    this.iconButton(zoom, "zoom-out", "Zoom out", () => this.setZoom((state.zoom ?? 1) / 1.25));
    zoom.createEl("button", { text: "Fit" }).addEventListener("click", () => this.setZoom(this.fitZoom()));
    this.iconButton(zoom, "zoom-in", "Zoom in", () => this.setZoom((state.zoom ?? 1) * 1.25));

    const panes = root.createDiv({ cls: "gtm-canvas-panes" });
    this.left = this.side(panes, diff.past, "left", this.o.leftLabel, "read-only", "lock");
    this.right = this.side(panes, diff.current, "right", "Now", "your canvas", "pencil");
    const bar = root.createDiv({ cls: "gtm-region-bar" });

    await this.drawSide(this.left, "left");
    if (this.destroyed) return;
    await this.drawSide(this.right, "right");
    if (this.destroyed) return;

    host.empty();
    host.appendChild(root);
    this.mounted = true;
    if (state.zoom === null) state.zoom = this.fitZoom(host);
    this.applyZoom();
    this.scrollBoth(state.scrollLeft, state.scrollTop);
    this.syncScroll();

    const pastNodes = new Map(diff.past.nodes.map((n) => [n.id, n]));
    const pastItems = new Map<string, Record<string, unknown>>([...diff.past.nodes, ...diff.past.edges].map((x) => [x.id, x]));
    const currentItems = new Map<string, Record<string, unknown>>([...diff.current.nodes, ...diff.current.edges].map((x) => [x.id, x]));
    // A past card counts as unchanged if it matches today's card once shifted by the anchor.
    const pastShifted = (id: string) => {
      const p = pastNodes.get(id);
      return p ? shiftNode(p, diff.anchor) : pastItems.get(id);
    };
    const unchanged = (id: string, aspects: RestoreAspects) =>
      pastNodes.has(id) ? sameForAspects(pastShifted(id), currentItems.get(id), aspects) : sameItem(pastItems.get(id), currentItems.get(id), ["fromSide", "toSide"]);
    this.tool = new RegionTool({
      past: canvasAdapter(diff.past),
      current: canvasAdapter(diff.current),
      stage: this.left.stage,
      overlay: this.left.overlay,
      toScene: (ev) => {
        const r = this.left.stage.getBoundingClientRect();
        const z = state.zoom ?? 1;
        return { x: (ev.clientX - r.left) / z + this.minX, y: (ev.clientY - r.top) / z + this.minY };
      },
      state: state.region,
      bar,
      regionToCurrent: (r) => shiftRegion(r, diff.anchor),
      unchanged,
      fileExists: (p) => this.o.app.vault.getAbstractFileByPath(p) instanceof TFile,
      title: (id) => {
        const n = pastNodes.get(id);
        return n ? nodeTitle(n) : id;
      },
      onChange: (selected, plan) => this.highlight(selected, plan),
      onRestore: (plan, aspects) => this.o.onRestorePlan(plan, aspects),
    });
  }

  scrollToChange(index: number): void {
    const change = describeCanvasChanges(this.o.diff)[index];
    if (!change) return;
    if ((this.o.state.zoom ?? 1) < READ_ZOOM) this.setZoom(READ_ZOOM);
    const nodeId = change.kind === "node" ? change.id : this.edgeEnd(change.id);
    const el = this.right.nodeEls.get(nodeId ?? "") ?? this.left.nodeEls.get(nodeId ?? "");
    if (!el) return;
    const z = this.o.state.zoom ?? 1;
    const sc = this.left.scroll;
    this.scrollBoth(el.offsetLeft * z - sc.clientWidth / 2 + (el.offsetWidth * z) / 2, el.offsetTop * z - sc.clientHeight / 2 + (el.offsetHeight * z) / 2);
    for (const side of [this.left, this.right]) {
      const target = side.nodeEls.get(nodeId ?? "");
      target?.addClass("is-flash");
      window.setTimeout(() => target?.removeClass("is-flash"), 1200);
    }
  }

  destroy(): void {
    this.destroyed = true;
    // A drawing that never made it on screen has no scroll position worth keeping.
    if (this.mounted) {
      this.o.state.scrollLeft = this.left.scroll.scrollLeft;
      this.o.state.scrollTop = this.left.scroll.scrollTop;
    }
    this.o.parent.removeChild(this.component);
  }

  // ------------------------------------------------------------------ layout

  private measure(nodes: CanvasNode[]): void {
    if (!nodes.length) {
      this.minX = this.minY = 0;
      this.width = this.height = 400;
      return;
    }
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxX = Math.max(...nodes.map((n) => n.x + n.width));
    const maxY = Math.max(...nodes.map((n) => n.y + n.height));
    this.minX = minX - PAD;
    this.minY = minY - PAD;
    this.width = maxX - minX + 2 * PAD;
    this.height = maxY - minY + 2 * PAD;
  }

  private fitZoom(host?: HTMLElement): number {
    const w = this.left.scroll.clientWidth || (host ? host.clientWidth / 2 : 0) || 600;
    return Math.max(0.05, Math.min(1, (w - 16) / this.width));
  }

  private setZoom(z: number): void {
    this.o.state.zoom = Math.max(0.05, Math.min(2, z));
    this.applyZoom();
  }

  private applyZoom(): void {
    const z = this.o.state.zoom ?? 1;
    // Borders, tags and titles are sized in screen pixels via --gtm-zoom, so a huge canvas stays legible.
    this.root.style.setProperty("--gtm-zoom", String(z));
    this.root.toggleClass("is-overview", z < OVERVIEW_BELOW);
    for (const side of [this.left, this.right]) {
      side.world.style.width = `${this.width * z}px`;
      side.world.style.height = `${this.height * z}px`;
      side.stage.style.transform = `scale(${z})`;
    }
  }

  /** Puts both panes at the same position and remembers it, so their scroll events aren't echoed back. */
  private scrollBoth(left: number, top: number): void {
    for (const side of [this.left, this.right]) {
      side.scroll.scrollLeft = left;
      side.scroll.scrollTop = top;
      side.expected = { left: side.scroll.scrollLeft, top: side.scroll.scrollTop };
    }
    this.o.state.scrollLeft = left;
    this.o.state.scrollTop = top;
  }

  /**
   * Scrolling one pane scrolls the other. Each pane remembers the position we set on it, and a scroll event
   * at exactly that position is our own echo, not the user: ignoring it stops the panes fighting.
   */
  private syncScroll(): void {
    const link = (from: Side, to: Side) =>
      from.scroll.addEventListener("scroll", () => {
        const left = from.scroll.scrollLeft;
        const top = from.scroll.scrollTop;
        const echo = from.expected;
        if (echo && Math.abs(echo.left - left) < 1 && Math.abs(echo.top - top) < 1) return;
        from.expected = null;
        to.scroll.scrollLeft = left;
        to.scroll.scrollTop = top;
        to.expected = { left: to.scroll.scrollLeft, top: to.scroll.scrollTop };
        this.o.state.scrollLeft = left;
        this.o.state.scrollTop = top;
      });
    link(this.left, this.right);
    link(this.right, this.left);
  }

  private setTool(tool: Tool): void {
    this.tool?.setTool(tool);
    for (const [t, b] of this.toolButtons) {
      b.toggleClass("is-active", t === tool);
      b.setAttr("aria-pressed", String(t === tool));
    }
  }

  // ----------------------------------------------------------------- drawing

  private side(parent: HTMLElement, data: CanvasData, which: "left" | "right", time: string, note: string, icon: string): Side {
    const pane = parent.createDiv({ cls: `gtm-canvas-pane is-${which}` });
    const head = pane.createDiv({ cls: "gtm-canvas-head" });
    setIcon(head.createSpan({ cls: "gtm-colhead-icon" }), icon);
    head.createSpan({ cls: "gtm-colhead-time", text: time });
    head.createSpan({ cls: "gtm-colhead-note", text: note });
    const scroll = pane.createDiv({ cls: "gtm-canvas-scroll" });
    const world = scroll.createDiv({ cls: "gtm-canvas-world" });
    const stage = world.createDiv({ cls: "gtm-canvas-stage" });
    stage.style.width = `${this.width}px`;
    stage.style.height = `${this.height}px`;
    const overlay = stage.createSvg("svg", {
      cls: "gtm-canvas-overlay",
      attr: { width: this.width, height: this.height, viewBox: `${this.minX} ${this.minY} ${this.width} ${this.height}` },
    });
    return { data, scroll, world, stage, overlay, nodeEls: new Map(), expected: null };
  }

  private async drawSide(side: Side, which: "left" | "right"): Promise<void> {
    const { diff } = this.o;
    const otherNodes = new Map((which === "left" ? diff.current : diff.past).nodes.map((n) => [n.id, n]));
    const edges = side.stage.createSvg("svg", {
      cls: "gtm-canvas-edges",
      attr: { width: this.width, height: this.height, viewBox: `${this.minX} ${this.minY} ${this.width} ${this.height}` },
    });
    const defs = edges.createSvg("defs");
    const marker = defs.createSvg("marker", { attr: { id: `gtm-arrow-${which}`, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: "auto-start-reverse" } });
    marker.createSvg("path", { attr: { d: "M0,0 L10,5 L0,10 z", fill: "context-stroke" } });
    const byId = new Map(side.data.nodes.map((n) => [n.id, n]));
    for (const e of side.data.edges) this.drawEdge(edges, e, byId, diff.edges.get(e.id) ?? "same", which);
    // Cards go above the edges; the overlay stays on top.
    side.stage.appendChild(side.overlay);
    for (const n of side.data.nodes) {
      if (this.destroyed) return;
      const state = diff.nodes.get(n.id) ?? "same";
      const el = await this.drawNode(side.stage, n, state, which, otherNodes.get(n.id));
      side.nodeEls.set(n.id, el);
    }
    side.stage.appendChild(side.overlay);
  }

  private async drawNode(stage: HTMLElement, n: CanvasNode, state: ItemState, which: "left" | "right", other: CanvasNode | undefined): Promise<HTMLElement> {
    const el = stage.createDiv({ cls: `gtm-cnode type-${n.type} is-${state}` });
    el.style.left = `${n.x - this.minX}px`;
    el.style.top = `${n.y - this.minY}px`;
    el.style.width = `${n.width}px`;
    el.style.height = `${n.height}px`;
    if (n.color) el.style.setProperty("--gtm-node-color", /^\d$/.test(n.color) ? `rgb(var(--canvas-color-${n.color}))` : n.color);
    if (state !== "same") el.createDiv({ cls: "gtm-cnode-tag", text: this.tagFor(n.id, state) });
    if (n.type === "group") {
      el.createDiv({ cls: "gtm-cnode-label", text: n.label ?? "" });
      if (which === "left" && state === "removed") this.cardButton(el, "Restore group…", () => this.previewRestore(n.id));
      return el;
    }
    el.createDiv({ cls: "gtm-cnode-title", text: nodeTitle(n) });
    const body = el.createDiv({ cls: "gtm-cnode-body" });
    if (n.type === "text") {
      let md = n.text ?? "";
      if (state === "edited" && other?.type === "text") {
        const m = which === "left" ? markWords(n.text ?? "", other.text ?? "") : markWords(other.text ?? "", n.text ?? "");
        md = which === "left" ? m.left : m.right;
      }
      const content = body.createDiv({ cls: "markdown-rendered" });
      if (md.trim()) await MarkdownRenderer.render(this.o.app, md, content, this.o.sourcePath, this.component);
    } else if (n.type === "file" && n.file) {
      const f = this.o.app.vault.getAbstractFileByPath(n.file);
      if (f instanceof TFile && IMAGE.test(n.file)) body.createEl("img", { attr: { src: this.o.app.vault.getResourcePath(f), alt: n.file } });
      else {
        const line = body.createDiv({ cls: "gtm-cnode-file" });
        setIcon(line.createSpan(), "file-text");
        line.createSpan({ text: n.file + (n.subpath ?? "") });
        if (!f) line.createSpan({ cls: "gtm-cnode-missing", text: " (missing now)" });
      }
    } else if (n.type === "link" && n.url) {
      body.createDiv({ cls: "gtm-cnode-file", text: n.url });
    }
    if (state === "edited" && n.type === "text" && other?.type === "text" && other.text !== n.text) {
      this.cardButton(el, "Compare text…", () => this.o.onCompareText(n.id));
    }
    if (which === "left" && state === "removed") this.cardButton(el, "Restore card…", () => this.previewRestore(n.id));
    return el;
  }

  private drawEdge(svg: SVGSVGElement, e: CanvasEdge, nodes: Map<string, CanvasNode>, state: ItemState, which: "left" | "right"): void {
    const a = nodes.get(e.fromNode);
    const b = nodes.get(e.toNode);
    if (!a || !b) return;
    const pa = anchor(a, e.fromSide, b);
    const pb = anchor(b, e.toSide, a);
    const d = Math.max(40, Math.hypot(pb.x - pa.x, pb.y - pa.y) / 3);
    const path = `M${pa.x},${pa.y} C${pa.x + pa.nx * d},${pa.y + pa.ny * d} ${pb.x + pb.nx * d},${pb.y + pb.ny * d} ${pb.x},${pb.y}`;
    // createSvg adds a class string as one token, so several classes must be an array.
    const g = svg.createSvg("g", { cls: ["gtm-cedge", `is-${state}`] });
    if (e.color) g.style.setProperty("--gtm-edge-color", /^\d$/.test(e.color) ? `rgb(var(--canvas-color-${e.color}))` : e.color);
    const p = g.createSvg("path", { attr: { d: path } });
    if ((e.toEnd ?? "arrow") === "arrow") p.setAttr("marker-end", `url(#gtm-arrow-${which})`);
    if (e.fromEnd === "arrow") p.setAttr("marker-start", `url(#gtm-arrow-${which})`);
    if (e.label) {
      const t = g.createSvg("text", { attr: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 } });
      t.textContent = e.label;
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
    const b = el.createEl("button", { cls: "gtm-cnode-action", text });
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onClick();
    });
  }

  /** Selects the item (and what it brings) so the summary bar shows exactly what restoring it would do. */
  private previewRestore(id: string): void {
    this.tool?.selectOnly(id);
    this.root.querySelector(".gtm-region-bar")?.scrollIntoView({ block: "nearest" });
  }

  /** Marks the selection on the left and shows where restored items will land on the right. */
  private highlight(selected: string[], plan: RestorePlan | null): void {
    const sel = new Set(selected);
    for (const [id, el] of this.left.nodeEls) el.toggleClass("is-selected", sel.has(id));
    for (const [id, el] of this.right.nodeEls) el.toggleClass("is-doomed", !!plan?.remove.includes(id));
    const svg = this.right.overlay;
    svg.empty();
    if (!plan) return;
    const past = new Map(this.o.diff.past.nodes.map((n) => [n.id, n]));
    const current = new Map(this.o.diff.current.nodes.map((n) => [n.id, n]));
    for (const id of [...plan.add, ...plan.replace]) {
      const p = past.get(id);
      if (!p) continue;
      const c = current.get(id);
      const box = !this.o.state.region.aspects.position && c ? c : shiftNode(p, this.o.diff.anchor);
      svg.createSvg("rect", { cls: "gtm-ghost", attr: { x: box.x, y: box.y, width: box.width, height: box.height, rx: 8 } });
    }
  }

  private edgeEnd(edgeId: string): string | undefined {
    const e = this.o.diff.current.edges.find((x) => x.id === edgeId) ?? this.o.diff.past.edges.find((x) => x.id === edgeId);
    return e?.toNode;
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): void {
    const b = parent.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
    setIcon(b, icon);
    b.addEventListener("click", onClick);
  }
}

/** Where a connection meets a card: the named side, or the side facing the other card. Includes the outward normal. */
function anchor(n: CanvasNode, side: string | undefined, other: CanvasNode): { x: number; y: number; nx: number; ny: number } {
  const cx = n.x + n.width / 2;
  const cy = n.y + n.height / 2;
  let s = side;
  if (!s) {
    const dx = other.x + other.width / 2 - cx;
    const dy = other.y + other.height / 2 - cy;
    s = Math.abs(dx) * n.height > Math.abs(dy) * n.width ? (dx > 0 ? "right" : "left") : dy > 0 ? "bottom" : "top";
  }
  switch (s) {
    case "top":
      return { x: cx, y: n.y, nx: 0, ny: -1 };
    case "bottom":
      return { x: cx, y: n.y + n.height, nx: 0, ny: 1 };
    case "left":
      return { x: n.x, y: cy, nx: -1, ny: 0 };
    default:
      return { x: n.x + n.width, y: cy, nx: 1, ny: 0 };
  }
}
