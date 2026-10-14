import { ItemView, Notice, debounce, setIcon, type TFile, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { describeChunks } from "../diff/describe";
import { diffText, minimalEdit, type Chunk, type TextDiff } from "../diff/textDiff";
import type { Version } from "../history/types";
import type GitTimeMachinePlugin from "../main";
import type { RepoContext } from "../main";
import { MarkdownCompare } from "../render/MarkdownCompare";
import { fileKind, looksBinary } from "../render/registry";
import { SourceCompare } from "../render/SourceCompare";
import type { CompareRenderer } from "../render/types";
import { obsidianTextTarget } from "../restore/obsidianTarget";
import { Restorer, StaleWriteError, type TextTarget } from "../restore/Restorer";
import { confirmModal } from "./ConfirmModal";
import { describeError, describeLocateError } from "./messages";
import { Timeline } from "./Timeline";
import { buildTimeline, dayLabel, mergeVersions, timeLabel, type TimelineEntry, type TimelineModel } from "./timelineModel";

export const VIEW_TYPE_TIME_MACHINE = "git-time-machine";

const LARGE_FILE_CHARS = 1024 * 1024;
const LARGE_CHANGE_LINES = 5000;

type Mode = "rendered" | "source";
type Layout = "split" | "inline";

export class TimeMachineView extends ItemView {
  private filePath: string | null = null;
  private renamedFrom: string | null = null;
  private ctx: RepoContext | null = null;
  private versions: Version[] = [];
  private hasMore = false;
  private loadingMore = false;
  private selectedKey = "now";
  /** The note as the user sees it now (open editor, else disk). */
  private liveText = "";
  /** The note at the newest commit. */
  private latestText: string | null = null;
  /** The note at the selected version. */
  private leftText = "";
  private diff: TextDiff | null = null;
  private lastHead: string | null = null;
  private mode: Mode;
  private layout: Layout = "split";
  private allowLarge = false;
  private changeCursor = -1;
  private renderer: CompareRenderer | null = null;
  private readonly restorer = new Restorer();
  private loadToken = 0;
  private renderToken = 0;
  private headerEl!: HTMLElement;
  private compareEl!: HTMLElement;
  private timeline!: Timeline;
  private readonly scheduleRefresh = debounce(() => void this.refreshLive(), 500, true);
  private readonly writeSoon = debounce((text: string) => void this.writeFromEditor(text), 400, true);

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: GitTimeMachinePlugin,
  ) {
    super(leaf);
    this.mode = plugin.settings.defaultMode;
  }

  getViewType(): string {
    return VIEW_TYPE_TIME_MACHINE;
  }

  getDisplayText(): string {
    return "Time Machine";
  }

  getIcon(): string {
    return "history";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("gtm-view");
    this.headerEl = root.createDiv({ cls: "gtm-header" });
    const body = root.createDiv({ cls: "gtm-body" });
    this.compareEl = body.createDiv({ cls: "gtm-compare" });
    this.timeline = new Timeline(body, {
      onSelect: (key) => void this.select(key),
      onJump: (i) => this.jumpTo(i),
      onLoadMore: () => void this.loadMore(),
    });
    this.registerDomEvent(this.timeline.el, "keydown", (ev) => this.onRailKey(ev));
    this.registerEvent(this.app.vault.on("modify", (f) => f.path === this.filePath && this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on("editor-change", (_ed, info) => info.file?.path === this.filePath && this.scheduleRefresh()));
    this.registerEvent(
      this.app.vault.on("rename", (f, oldPath) => {
        if (oldPath !== this.filePath) return;
        this.renamedFrom = oldPath;
        this.filePath = f.path;
        void this.loadFile();
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (f) => {
        if (f.path === this.filePath) this.showMessage("This file was deleted", "Its history is still in Git. Browsing deleted files arrives with whole-vault mode.");
      }),
    );
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => leaf === this.leaf && void this.checkForNewCommits()));
    this.registerInterval(window.setInterval(() => void this.checkForNewCommits(), 60_000));
  }

  async onClose(): Promise<void> {
    this.scheduleRefresh.cancel();
    this.writeSoon.cancel();
    this.renderer?.destroy();
    this.renderer = null;
  }

  getState(): Record<string, unknown> {
    return { path: this.filePath };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const path = (state as { path?: unknown } | null)?.path;
    if (typeof path === "string" && path !== this.filePath) {
      this.filePath = path;
      this.renamedFrom = null;
      await this.loadFile();
    }
    await super.setState(state, result);
  }

  // ---------------------------------------------------------------- loading

  private async loadFile(): Promise<void> {
    const token = ++this.loadToken;
    this.resetForFile();
    const path = this.filePath;
    if (!path) return this.showMessage("Open a note to see its history");
    this.showMessage("Loading history…");
    const res = await this.plugin.getRepoContext();
    if (token !== this.loadToken) return;
    if (!res.ok) {
      return this.showMessage("Git Time Machine can't read history yet", describeLocateError(res), () => {
        this.plugin.resetRepoContext();
        void this.loadFile();
      });
    }
    this.ctx = res;
    if (!this.file()) return this.showMessage("File not found", path);
    if (fileKind(path) === "unsupported") {
      return this.showMessage("Time Machine can't show this file type yet", "Notes and plain-text files work now. Canvases, drawings and attachments come in later versions.");
    }
    const repoPath = res.paths.toRepo(path);
    if (!repoPath) return this.showMessage("This file is outside the Git repository", res.repoRoot);
    try {
      let versions = await res.history.fileHistory(repoPath, { limit: this.pageSize() });
      const oldRepoPath = this.renamedFrom ? res.paths.toRepo(this.renamedFrom) : null;
      if (!versions.length && oldRepoPath) versions = await res.history.fileHistory(oldRepoPath, { limit: this.pageSize() });
      this.lastHead = await res.history.headHash();
      if (token !== this.loadToken) return;
      if (!versions.length) return this.showMessage("This file hasn't been committed yet", "Obsidian Git will include it in its next commit.");
      this.versions = versions;
      this.hasMore = versions.length === this.pageSize();
      this.latestText = await this.textAt(versions[0]);
      this.liveText = await this.target().read();
      if (token !== this.loadToken) return;
      // Start on the newest version that differs from what the user sees now.
      const firstDifferent = this.liveText !== this.latestText ? versions[0] : versions[1];
      this.selectedKey = (firstDifferent ?? versions[0]).hash;
      await this.renderAll();
    } catch (e) {
      this.showMessage("Couldn't read the history", describeError(e), () => void this.loadFile());
    }
  }

  private resetForFile(): void {
    this.renderer?.destroy();
    this.renderer = null;
    this.ctx = null;
    this.versions = [];
    this.hasMore = false;
    this.diff = null;
    this.latestText = null;
    this.selectedKey = "now";
    this.allowLarge = false;
    this.changeCursor = -1;
  }

  private async loadMore(): Promise<void> {
    if (!this.ctx || this.loadingMore || !this.hasMore) return;
    this.loadingMore = true;
    this.renderTimeline();
    try {
      const oldest = this.versions[this.versions.length - 1];
      const page = await this.ctx.history.fileHistory(oldest.path, { limit: this.pageSize(), before: oldest });
      this.versions = mergeVersions(this.versions, page);
      this.hasMore = page.length === this.pageSize();
    } catch (e) {
      new Notice(describeError(e));
    } finally {
      this.loadingMore = false;
      this.renderTimeline();
    }
  }

  /** Picks up Obsidian Git's auto-commits while the tab is open. */
  private async checkForNewCommits(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.filePath || !this.versions.length) return;
    const head = await ctx.history.headHash().catch(() => null);
    if (!head || head === this.lastHead) return;
    this.lastHead = head;
    const repoPath = ctx.paths.toRepo(this.filePath);
    if (!repoPath) return;
    try {
      const fresh = await ctx.history.fileHistory(repoPath, { limit: this.pageSize() });
      if (!fresh.length || fresh[0].hash === this.versions[0].hash) return;
      if (fresh.some((v) => v.hash === this.versions[0].hash)) this.versions = mergeVersions(this.versions, fresh);
      else {
        // More new commits than one page: start over from the newest page.
        this.versions = fresh;
        this.hasMore = true;
      }
      this.latestText = await this.textAt(this.versions[0]);
      const entry = this.selectedEntry();
      if (entry) this.renderHeader(entry);
      this.renderTimeline();
    } catch {
      // Try again on the next check.
    }
  }

  // -------------------------------------------------------------- rendering

  private async select(key: string): Promise<void> {
    if (key === this.selectedKey) return;
    this.selectedKey = key;
    this.allowLarge = false;
    this.changeCursor = -1;
    await this.renderAll();
  }

  private async renderAll(): Promise<void> {
    const token = ++this.renderToken;
    const entry = this.selectedEntry() ?? this.model().entries[0];
    this.selectedKey = entry.key;
    try {
      this.leftText = entry.version ? await this.textAt(entry.version) : this.liveText;
    } catch (e) {
      return this.showMessage("Couldn't read this version", describeError(e), () => void this.renderAll());
    }
    if (token !== this.renderToken) return;
    this.diff = this.computeDiff();
    this.renderHeader(entry);
    this.renderTimeline();
    await this.renderCompare(entry);
  }

  private computeDiff(): TextDiff | null {
    if (!this.allowLarge && (this.leftText.length > LARGE_FILE_CHARS || this.liveText.length > LARGE_FILE_CHARS)) return null;
    const diff = diffText(this.leftText, this.liveText);
    const changed = diff.rows.filter((r) => r.kind !== "same").length;
    return !this.allowLarge && changed > LARGE_CHANGE_LINES ? null : diff;
  }

  private async renderCompare(entry: TimelineEntry): Promise<void> {
    this.renderer?.destroy();
    this.renderer = null;
    const scroll = this.compareEl.scrollTop;
    this.compareEl.empty();
    this.timeline.el.toggle(true);
    if (!this.diff) {
      const box = this.messageBox(this.compareEl, "This is a large change", "Drawing the full comparison may take a moment.");
      box.createEl("button", { cls: "mod-cta", text: "Show comparison" }).addEventListener("click", () => {
        this.allowLarge = true;
        void this.renderAll();
      });
      return;
    }
    if (!this.diff.chunks.length) {
      if (entry.version && !entry.isNow) this.messageBox(this.compareEl, "No differences", `Your note is the same as it was on ${this.when(entry)}.`);
      else this.messageBox(this.compareEl, "This is your note as it is now", "Pick an earlier time on the right to compare.");
      return;
    }
    const useSource = this.mode === "source" || fileKind(this.filePath ?? "") === "text";
    this.renderer = useSource
      ? new SourceCompare({
          left: this.leftText,
          right: this.liveText,
          layout: this.layout,
          onEdit: (text) => {
            this.liveText = text;
            this.writeSoon(text);
          },
        })
      : new MarkdownCompare({
          app: this.app,
          parent: this,
          sourcePath: this.filePath ?? "",
          diff: this.diff,
          layout: this.layout,
          leftLabel: this.when(entry),
          onRestore: (chunk) => void this.restoreChunk(chunk),
        });
    await this.renderer.render(this.compareEl);
    this.compareEl.scrollTop = scroll;
  }

  private renderHeader(entry: TimelineEntry): void {
    const h = this.headerEl;
    h.empty();
    const title = h.createDiv({ cls: "gtm-title" });
    title.createEl("h2", { text: this.file()?.basename ?? this.filePath ?? "" });
    const summary = title.createDiv({ cls: "gtm-summary" });
    const d = this.diff;
    if (d && entry.version && !entry.isNow && d.chunks.length) {
      const added = d.chunks.reduce((n, c) => n + c.rightLines.length, 0);
      const removed = d.chunks.reduce((n, c) => n + c.leftLines.length, 0);
      summary.appendText(`${d.chunks.length} change${d.chunks.length === 1 ? "" : "s"} since ${this.when(entry)} · `);
      summary.createSpan({ cls: "gtm-plus", text: `+${added}` });
      summary.appendText(" ");
      summary.createSpan({ cls: "gtm-minus", text: `−${removed}` });
    } else summary.setText(entry.version ? `Comparing with ${this.when(entry)}` : "Pick an earlier time to compare");

    const controls = h.createDiv({ cls: "gtm-controls" });
    if (fileKind(this.filePath ?? "") === "markdown") {
      this.segmented(controls, "View", [["rendered", "Rendered"], ["source", "Source"]], this.mode, (v) => {
        this.mode = v as Mode;
        void this.rerenderCompare();
      });
    }
    this.segmented(controls, "Layout", [["split", "Side by side"], ["inline", "Inline"]], this.layout, (v) => {
      this.layout = v as Layout;
      void this.rerenderCompare();
    });
    const hasChanges = !!d && d.chunks.length > 0;
    this.iconButton(controls, "chevron-up", "Previous change", hasChanges, () => this.jumpRelative(-1));
    this.iconButton(controls, "chevron-down", "Next change", hasChanges, () => this.jumpRelative(1));
    const restore = controls.createEl("button", { cls: "gtm-restore-all", text: "Restore whole version…" });
    restore.disabled = !entry.version || entry.isNow || !hasChanges;
    restore.addEventListener("click", () => void this.restoreWholeVersion());
  }

  private renderTimeline(): void {
    this.timeline.render({
      model: this.model(),
      selectedKey: this.selectedKey,
      changes: this.diff ? describeChunks(this.diff) : [],
      hasMore: this.hasMore,
      loadingMore: this.loadingMore,
    });
  }

  private async rerenderCompare(): Promise<void> {
    const entry = this.selectedEntry();
    if (!entry) return;
    this.renderHeader(entry);
    await this.renderCompare(entry);
  }

  /** Called 500 ms after the note changes (typing, a restore, a sync). */
  private async refreshLive(): Promise<void> {
    if (!this.filePath || !this.ctx || !this.versions.length || !this.file()) return;
    const text = await this.target().read();
    if (text === this.liveText) return;
    this.liveText = text;
    if (this.renderer instanceof SourceCompare) {
      this.renderer.updateRight(text);
      this.diff = diffText(this.leftText, text);
      const entry = this.selectedEntry();
      if (entry) this.renderHeader(entry);
      this.renderTimeline();
      return;
    }
    await this.renderAll();
  }

  // -------------------------------------------------------------- restoring

  private async restoreChunk(chunk: Chunk): Promise<void> {
    const result = await this.restorer.applyChunk(this.target(), this.liveText, chunk);
    if (result === "stale") new Notice("The note changed, so the comparison was refreshed. Try again.");
    else this.undoNotice("Change restored.");
    await this.refreshLive();
  }

  private async restoreWholeVersion(): Promise<void> {
    const entry = this.selectedEntry();
    if (!entry?.version) return;
    const unsaved = this.liveText !== this.latestText;
    const ok = await confirmModal(this.app, {
      title: "Restore this whole version?",
      body: `Your note will be replaced with the version from ${this.when(entry)}. You can undo this from the notice or with the "Undo last restore" command.`,
      warning: unsaved ? `Edits made since ${timeLabel(this.versions[0].time)} aren't in the Git history yet. After this restore, only Undo can bring them back.` : undefined,
      confirmText: "Restore",
    });
    if (!ok) return;
    const result = await this.restorer.restoreWhole(this.target(), this.leftText);
    if (result === "stale") new Notice("The note changed while restoring, so nothing was changed. Try again.");
    else this.undoNotice("Version restored.");
    await this.refreshLive();
  }

  async undoLastRestore(): Promise<void> {
    const entry = this.restorer.peekUndo();
    if (!entry) {
      new Notice("Nothing to undo.");
      return;
    }
    const file = this.app.vault.getFileByPath(entry.path);
    if (!file) {
      new Notice(`${entry.path} no longer exists.`);
      return;
    }
    try {
      const result = await this.restorer.undo(obsidianTextTarget(this.app, file), () =>
        confirmModal(this.app, {
          title: "Undo the restore?",
          body: "The note was edited after the restore. Undoing will also remove those later edits.",
          confirmText: "Undo anyway",
        }),
      );
      if (result === "undone") new Notice("Restore undone.");
    } catch (e) {
      new Notice(e instanceof StaleWriteError ? "The note changed while undoing. Try again." : describeError(e));
    }
    await this.refreshLive();
  }

  /** Source mode: the user typed in the right-hand editor or clicked a revert arrow. */
  private async writeFromEditor(text: string): Promise<void> {
    if (!this.file()) return;
    const target = this.target();
    const current = await target.read();
    if (current === text) return;
    try {
      await target.write(minimalEdit(current, text), current);
    } catch (e) {
      if (!(e instanceof StaleWriteError)) new Notice(describeError(e));
      return;
    }
    this.diff = diffText(this.leftText, text);
    const entry = this.selectedEntry();
    if (entry) this.renderHeader(entry);
    this.renderTimeline();
  }

  private undoNotice(message: string): void {
    const frag = createFragment((f) => {
      f.appendText(`${message} `);
      f.createEl("button", { text: "Undo" }).addEventListener("click", () => void this.undoLastRestore());
    });
    new Notice(frag, 8000);
  }

  // ------------------------------------------------------------- navigation

  private jumpTo(chunkIndex: number): void {
    const chunk = this.diff?.chunks[chunkIndex];
    if (!chunk || !this.renderer) return;
    this.changeCursor = chunkIndex;
    this.renderer.scrollToChunk(chunk);
  }

  private jumpRelative(delta: number): void {
    const n = this.diff?.chunks.length ?? 0;
    if (!n) return;
    this.jumpTo((((this.changeCursor + delta) % n) + n) % n);
  }

  /** ↑/→ newer, ↓/← older, while focus is in the timeline rail. */
  private onRailKey(ev: KeyboardEvent): void {
    const entries = this.model().entries;
    const i = entries.findIndex((e) => e.key === this.selectedKey);
    if (ev.key === "ArrowDown" || ev.key === "ArrowLeft") {
      ev.preventDefault();
      if (i < entries.length - 1) void this.select(entries[i + 1].key);
      else if (this.hasMore) void this.loadMore();
    } else if (ev.key === "ArrowUp" || ev.key === "ArrowRight") {
      ev.preventDefault();
      if (i > 0) void this.select(entries[i - 1].key);
    }
  }

  // ---------------------------------------------------------------- helpers

  private model(): TimelineModel {
    return buildTimeline(this.versions, { now: new Date(), liveDiffersFromLatest: this.liveText !== this.latestText });
  }

  private selectedEntry(): TimelineEntry | undefined {
    return this.model().entries.find((e) => e.key === this.selectedKey);
  }

  private file(): TFile | null {
    return this.filePath ? this.app.vault.getFileByPath(this.filePath) : null;
  }

  private target(): TextTarget {
    const file = this.file();
    if (!file) throw new Error(`${this.filePath} no longer exists.`);
    return obsidianTextTarget(this.app, file);
  }

  private async textAt(v: Version): Promise<string> {
    const bytes = await this.ctx!.history.readAt(v.hash, v.path);
    if (looksBinary(bytes)) throw new Error("This version is a binary file.");
    return bytes.toString("utf8");
  }

  private pageSize(): number {
    return this.plugin.settings.versionsPerPage;
  }

  private when(entry: TimelineEntry): string {
    return `${dayLabel(entry.time, new Date())}, ${timeLabel(entry.time)}`;
  }

  private showMessage(title: string, detail?: string, retry?: () => void): void {
    this.renderer?.destroy();
    this.renderer = null;
    this.headerEl.empty();
    this.compareEl.empty();
    this.timeline.el.toggle(false);
    const box = this.messageBox(this.compareEl, title, detail);
    if (retry) box.createEl("button", { cls: "mod-cta", text: "Try again" }).addEventListener("click", retry);
  }

  private messageBox(parent: HTMLElement, title: string, detail?: string): HTMLElement {
    const box = parent.createDiv({ cls: "gtm-message" });
    box.createEl("h3", { text: title });
    if (detail) box.createEl("p", { text: detail });
    return box;
  }

  private segmented(parent: HTMLElement, label: string, options: Array<[string, string]>, value: string, onChange: (v: string) => void): void {
    const group = parent.createDiv({ cls: "gtm-segmented", attr: { role: "group", "aria-label": label } });
    for (const [v, text] of options) {
      const b = group.createEl("button", { text, attr: { "aria-pressed": String(v === value) } });
      if (v === value) b.addClass("is-active");
      b.addEventListener("click", () => v !== value && onChange(v));
    }
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, enabled: boolean, onClick: () => void): void {
    const b = parent.createEl("button", { cls: "clickable-icon gtm-icon-button", attr: { "aria-label": label } });
    setIcon(b, icon);
    b.disabled = !enabled;
    b.addEventListener("click", onClick);
  }
}
