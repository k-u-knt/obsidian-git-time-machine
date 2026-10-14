import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import type GitTimeMachinePlugin from "./main";
import { describeLocateError } from "./ui/messages";

export interface GtmSettings {
  repoPath: string;
  gitPath: string;
  defaultMode: "rendered" | "source";
  versionsPerPage: number;
}

export const DEFAULT_SETTINGS: GtmSettings = {
  repoPath: "",
  gitPath: "",
  defaultMode: "rendered",
  versionsPerPage: 50,
};

export class GtmSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: GitTimeMachinePlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName("Repository folder")
      .setDesc("Leave empty to use Obsidian Git's setting, or the repository that contains this vault. A relative path is relative to the vault folder.")
      .addText((t) =>
        t.setPlaceholder("Automatic").setValue(s.repoPath).onChange(async (v) => {
          s.repoPath = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Git program")
      .setDesc("Leave empty to find it automatically: Obsidian Git's setting, then /opt/homebrew/bin/git, /usr/local/bin/git, /usr/bin/git.")
      .addText((t) =>
        t.setPlaceholder("Automatic").setValue(s.gitPath).onChange(async (v) => {
          s.gitPath = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Default view for notes")
      .addDropdown((d) =>
        d
          .addOption("rendered", "Rendered")
          .addOption("source", "Source")
          .setValue(s.defaultMode)
          .onChange(async (v) => {
            s.defaultMode = v === "source" ? "source" : "rendered";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Versions loaded at a time")
      .addSlider((sl) =>
        sl
          .setLimits(20, 200, 10)
          .setValue(s.versionsPerPage)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.versionsPerPage = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Check connection")
      .setDesc("Find git and the repository using the settings above.")
      .addButton((b) =>
        b.setButtonText("Check").onClick(async () => {
          const r = await this.plugin.getRepoContext();
          new Notice(r.ok ? `Using ${r.git.gitPath} with the repository at ${r.repoRoot}` : describeLocateError(r), 10000);
        }),
      );
  }
}
