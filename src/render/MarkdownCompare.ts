import { Component, MarkdownRenderer, setIcon, type App } from "obsidian";
import type { RestoreMode } from "../diff/partialRestore";
import type { Chunk, TextDiff } from "../diff/textDiff";
import { markWords, segmentChunk, segmentRows, type Segment } from "./markdownBlocks";
import type { CompareRenderer } from "./types";

export interface MarkdownCompareOptions {
  app: App;
  /** The view; owns the render component so embeds and post-processors are cleaned up. */
  parent: Component;
  sourcePath: string;
  diff: TextDiff;
  layout: "split" | "inline";
  leftLabel: string;
  /** `mode`: restore both halves, only bring back deleted text, or only remove added text. */
  onRestore(chunk: Chunk, mode: RestoreMode): void;
}

/** Rendered mode: each Markdown block rendered natively on both sides, aligned block by block. */
export class MarkdownCompare implements CompareRenderer {
  private readonly component = new Component();
  private segments: Segment[] = [];
  private segmentEls: HTMLElement[] = [];

  constructor(private readonly o: MarkdownCompareOptions) {
    o.parent.addChild(this.component);
  }

  async render(host: HTMLElement): Promise<void> {
    const { diff, layout } = this.o;
    this.segments = segmentRows(diff);
    const root = host.createDiv({ cls: `gtm-md-compare is-${layout}` });
    if (layout === "split") {
      const head = root.createDiv({ cls: "gtm-md-row gtm-colhead" });
      const l = head.createDiv({ cls: "gtm-cell" });
      setIcon(l.createSpan({ cls: "gtm-colhead-icon" }), "lock");
      l.createSpan({ cls: "gtm-colhead-time", text: this.o.leftLabel });
      l.createSpan({ cls: "gtm-colhead-note", text: "read-only" });
      head.createDiv({ cls: "gtm-gutter" });
      const r = head.createDiv({ cls: "gtm-cell" });
      setIcon(r.createSpan({ cls: "gtm-colhead-icon" }), "pencil");
      r.createSpan({ cls: "gtm-colhead-time", text: "Now" });
      r.createSpan({ cls: "gtm-colhead-note", text: "your note" });
    }
    for (const [index, seg] of this.segments.entries()) {
      const leftText = diff.leftLines.slice(seg.leftStart, seg.leftEnd).join("\n");
      const rightText = diff.rightLines.slice(seg.rightStart, seg.rightEnd).join("\n");
      const row = root.createDiv({ cls: "gtm-md-row" + (seg.changed ? " is-changed" : "") });
      this.segmentEls.push(row);
      if (!seg.changed) {
        if (layout === "split") {
          await this.cell(row, leftText, "");
          row.createDiv({ cls: "gtm-gutter" });
        }
        await this.cell(row, rightText, "");
        continue;
      }
      const marked = markWords(leftText, rightText);
      const hasLeft = seg.leftEnd > seg.leftStart;
      const hasRight = seg.rightEnd > seg.rightStart;
      if (layout === "split") {
        await this.cell(row, hasLeft ? marked.left : null, "is-removed");
        this.restoreButtons(row.createDiv({ cls: "gtm-gutter" }), segmentChunk(diff, seg, index), false);
        await this.cell(row, hasRight ? marked.right : null, "is-added");
      } else {
        if (hasLeft) await this.cell(row, marked.left, "is-removed");
        if (hasRight) await this.cell(row, marked.right, "is-added");
        this.restoreButtons(row.createDiv({ cls: "gtm-inline-actions" }), segmentChunk(diff, seg, index), true);
      }
    }
  }

  scrollToChange(index: number): void {
    const chunk = this.o.diff.chunks[index];
    if (!chunk) return;
    const rowIndex = this.o.diff.rows.findIndex((r) => r.chunkId === chunk.id);
    const i = this.segments.findIndex((s) => s.rowStart <= rowIndex && rowIndex < s.rowEnd);
    const el = this.segmentEls[i];
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.addClass("is-flash");
    window.setTimeout(() => el.removeClass("is-flash"), 1200);
  }

  destroy(): void {
    this.o.parent.removeChild(this.component);
  }

  /** `markdown === null` draws the striped gap used where one side has no lines. */
  private async cell(row: HTMLElement, markdown: string | null, cls: string): Promise<void> {
    if (markdown === null) {
      row.createDiv({ cls: `gtm-cell is-gap ${cls}` });
      return;
    }
    const el = row.createDiv({ cls: `gtm-cell markdown-rendered ${cls}` });
    if (markdown.trim()) await MarkdownRenderer.render(this.o.app, markdown, el, this.o.sourcePath, this.component);
  }

  /**
   * The restore choices that apply to a changed block: all three for an edit, "Bring back deleted" for a
   * deletion, "Remove added" for an addition.
   */
  private restoreButtons(parent: HTMLElement, chunk: Chunk, withText: boolean): void {
    const hasOld = chunk.leftLines.length > 0;
    const hasNew = chunk.rightLines.length > 0;
    const choices: Array<[RestoreMode, string, string, string]> = [];
    if (hasOld && hasNew) choices.push(["both", "arrow-right", "Restore this block", "Restore"]);
    if (hasOld) choices.push(["deleted", "undo-2", "Bring back the deleted text", "Bring back deleted"]);
    if (hasNew) choices.push(["added", "eraser", "Remove the added text", "Remove added"]);
    const group = parent.createDiv({ cls: "gtm-restore-group" });
    for (const [mode, icon, label, short] of choices) {
      const b = group.createEl("button", { cls: `gtm-restore is-${mode}`, attr: { "aria-label": label } });
      setIcon(b, icon);
      if (withText) b.createSpan({ text: short });
      b.addEventListener("click", () => this.o.onRestore(chunk, mode));
    }
  }
}
