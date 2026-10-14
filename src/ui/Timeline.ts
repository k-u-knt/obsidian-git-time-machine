import type { ChangeSummary } from "../diff/describe";
import { dayLabel, timeLabel, type TimelineEntry, type TimelineModel } from "./timelineModel";

export interface TimelineProps {
  model: TimelineModel;
  selectedKey: string;
  changes: ChangeSummary[];
  hasMore: boolean;
  loadingMore: boolean;
}

export interface TimelineCallbacks {
  onSelect(key: string): void;
  onJump(chunkIndex: number): void;
  onLoadMore(): void;
}

/** The right-hand rail: scrubber, "Changes in this version", and versions grouped by day. */
export class Timeline {
  readonly el: HTMLElement;

  constructor(parent: HTMLElement, private readonly cb: TimelineCallbacks) {
    // Focusable so ↑/↓ keep working after each re-render (which replaces the clicked button).
    this.el = parent.createDiv({ cls: "gtm-rail", attr: { tabindex: "0", "aria-label": "Timeline: use the arrow keys to step through versions" } });
  }

  render(p: TimelineProps): void {
    const el = this.el;
    const hadFocus = el.contains(el.ownerDocument.activeElement);
    el.empty();
    const head = el.createDiv({ cls: "gtm-rail-head" });
    head.createDiv({ cls: "gtm-rail-title", text: "Timeline" });
    head.createDiv({ cls: "gtm-rail-sub", text: "Only versions that changed this note" });
    this.renderScrubber(el.createDiv({ cls: "gtm-scrubber" }), p);

    if (p.changes.length) {
      el.createDiv({ cls: "gtm-rail-label", text: "Changes in this version" });
      const list = el.createDiv({ cls: "gtm-change-list" });
      for (const c of p.changes) {
        const b = list.createEl("button", { cls: `gtm-change is-${c.kind}` });
        b.createSpan({ cls: "gtm-change-sign", text: c.kind === "added" ? "+" : c.kind === "removed" ? "−" : "~" });
        b.createSpan({ text: c.label });
        b.addEventListener("click", () => this.cb.onJump(c.chunkIndex));
      }
    }

    const days = el.createDiv({ cls: "gtm-days" });
    for (const g of p.model.groups) {
      days.createDiv({ cls: "gtm-day", text: g.label });
      for (const e of g.entries) {
        const selected = e.key === p.selectedKey;
        const b = days.createEl("button", { cls: "gtm-tick" + (selected ? " is-selected" : ""), attr: { "aria-current": String(selected) } });
        b.createSpan({ cls: "gtm-dot" });
        b.createSpan({ cls: "gtm-tick-time", text: e.isNow ? "Now" : timeLabel(e.time) });
        if (selected) b.createSpan({ cls: "gtm-tick-note", text: "comparing" });
        else if (e.isNow && e.version) b.createSpan({ cls: "gtm-tick-note", text: timeLabel(e.time) });
        else if (!e.isNow) b.createSpan({ cls: "gtm-tick-bar" }).style.width = `${Math.round(6 + (48 * e.size) / p.model.maxSize)}px`;
        b.addEventListener("click", () => this.cb.onSelect(e.key));
      }
    }
    if (p.hasMore) {
      const more = days.createEl("button", { cls: "gtm-tick gtm-more", text: p.loadingMore ? "Loading…" : "Load earlier versions…" });
      more.disabled = p.loadingMore;
      more.addEventListener("click", () => this.cb.onLoadMore());
    }
    if (hadFocus) {
      const selected = days.querySelector<HTMLElement>(".gtm-tick.is-selected");
      (selected ?? el).focus({ preventScroll: true });
      selected?.scrollIntoView({ block: "nearest" });
    }
  }

  /** Ticks positioned by time; height = size of change. Dragging previews; releasing selects. */
  private renderScrubber(box: HTMLElement, p: TimelineProps): void {
    const entries = p.model.entries;
    if (!entries.length) return;
    const now = new Date();
    const oldest = entries[entries.length - 1].time.getTime();
    const span = Math.max(1, entries[0].time.getTime() - oldest);
    const xOf = (e: TimelineEntry) => (100 * (e.time.getTime() - oldest)) / span;
    const caption = (e: TimelineEntry) => (e.isNow && !e.version ? "Now" : `${dayLabel(e.time, now)}, ${timeLabel(e.time)}`);

    const ends = box.createDiv({ cls: "gtm-scrub-ends" });
    ends.createSpan({ text: dayLabel(entries[entries.length - 1].time, now) });
    ends.createSpan({ text: "Now" });
    const track = box.createDiv({ cls: "gtm-scrub-track", attr: { "aria-hidden": "true" } });
    for (const e of entries) {
      const t = track.createDiv({ cls: "gtm-scrub-tick" + (e.key === p.selectedKey ? " is-selected" : "") });
      t.style.left = `${xOf(e)}%`;
      t.style.height = `${4 + Math.round((22 * e.size) / p.model.maxSize)}px`;
    }
    const selected = entries.find((e) => e.key === p.selectedKey) ?? entries[0];
    const knob = track.createDiv({ cls: "gtm-scrub-knob" });
    knob.style.left = `${xOf(selected)}%`;
    const label = box.createDiv({ cls: "gtm-scrub-caption", text: caption(selected) });
    box.createDiv({ cls: "gtm-scrub-hint", text: "Drag to scrub · ↑ ↓ to step · tall ticks = big changes" });

    const nearest = (clientX: number): TimelineEntry => {
      const r = track.getBoundingClientRect();
      const pct = (100 * (clientX - r.left)) / Math.max(1, r.width);
      return entries.reduce((best, e) => (Math.abs(xOf(e) - pct) < Math.abs(xOf(best) - pct) ? e : best), entries[0]);
    };
    let pending: TimelineEntry | null = null;
    const preview = (ev: PointerEvent) => {
      pending = nearest(ev.clientX);
      knob.style.left = `${xOf(pending)}%`;
      label.setText(caption(pending));
    };
    track.addEventListener("pointerdown", (ev) => {
      this.el.focus({ preventScroll: true });
      track.setPointerCapture(ev.pointerId);
      preview(ev);
    });
    track.addEventListener("pointermove", (ev) => {
      if (track.hasPointerCapture(ev.pointerId)) preview(ev);
    });
    track.addEventListener("pointerup", () => {
      if (pending) this.cb.onSelect(pending.key);
      pending = null;
    });
  }
}
