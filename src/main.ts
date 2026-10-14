import { FileSystemAdapter, Notice, Plugin, TFile, normalizePath, type App } from "obsidian";
import { locateRepo, type LocateResult, type ObsidianGitSettings } from "./git/locateRepo";
import { parseObsidianGitSettings } from "./git/obsidianGitSettings";
import { HistoryService } from "./history/HistoryService";
import { fileKind } from "./render/registry";
import { DEFAULT_SETTINGS, GtmSettingTab, type GtmSettings } from "./settings";
import { TimeMachineView, VIEW_TYPE_TIME_MACHINE } from "./ui/TimeMachineView";

export type RepoContext = Extract<LocateResult, { ok: true }> & { history: HistoryService };
export type RepoContextResult = RepoContext | Extract<LocateResult, { ok: false }>;

export default class GitTimeMachinePlugin extends Plugin {
  settings: GtmSettings = { ...DEFAULT_SETTINGS };
  private context: Promise<RepoContextResult> | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.registerView(VIEW_TYPE_TIME_MACHINE, (leaf) => new TimeMachineView(leaf, this));

    this.addRibbonIcon("history", "Open Time Machine", () => void this.openForFile(this.app.workspace.getActiveFile()));

    this.addCommand({
      id: "open-for-current-file",
      name: "Open Time Machine for current file",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || fileKind(file.path) === "unsupported") return false;
        if (!checking) void this.openForFile(file);
        return true;
      },
    });

    this.addCommand({
      id: "undo-last-restore",
      name: "Undo last restore",
      callback: () => {
        const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIME_MACHINE)[0]?.view;
        if (view instanceof TimeMachineView) void view.undoLastRestore();
        else new Notice("Nothing to undo.");
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || fileKind(file.path) === "unsupported") return;
        menu.addItem((item) =>
          item
            .setTitle("Show in Time Machine")
            .setIcon("history")
            .onClick(() => void this.openForFile(file)),
        );
      }),
    );

    this.addSettingTab(new GtmSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<GtmSettings> | null) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.resetRepoContext();
  }

  resetRepoContext(): void {
    this.context = null;
  }

  /** Finds git and the repository once and caches a success; failures are retried on the next call. */
  getRepoContext(): Promise<RepoContextResult> {
    this.context ??= this.buildContext().then((r) => {
      if (!r.ok) this.context = null;
      return r;
    });
    return this.context;
  }

  async openForFile(file: TFile | null): Promise<void> {
    if (!file) {
      new Notice("Open a note first, then open Time Machine.");
      return;
    }
    if (fileKind(file.path) === "unsupported") {
      new Notice("Time Machine can't show this file type yet.");
      return;
    }
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIME_MACHINE)[0] ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_TIME_MACHINE, active: true, state: { path: file.path } });
    await this.app.workspace.revealLeaf(leaf);
  }

  private async buildContext(): Promise<RepoContextResult> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return { ok: false, reason: "no-repo", searched: "(this vault is not stored on disk)" };
    const result = await locateRepo({
      vaultBasePath: adapter.getBasePath(),
      repoPathSetting: this.settings.repoPath,
      gitPathSetting: this.settings.gitPath,
      obsidianGit: await readObsidianGitSettings(this.app),
    });
    return result.ok ? { ...result, history: new HistoryService(result.git) } : result;
  }
}

async function readObsidianGitSettings(app: App): Promise<ObsidianGitSettings | null> {
  const path = normalizePath(`${app.vault.configDir}/plugins/obsidian-git/data.json`);
  try {
    if (!(await app.vault.adapter.exists(path))) return null;
    return parseObsidianGitSettings(await app.vault.adapter.read(path));
  } catch {
    return null;
  }
}
