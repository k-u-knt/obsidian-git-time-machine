import { Modal, Setting, type App } from "obsidian";

export interface ConfirmOptions {
  title: string;
  body: string;
  warning?: string;
  confirmText: string;
}

/** Resolves true only when the user clicks the confirm button. */
export function confirmModal(app: App, opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let confirmed = false;
    const modal = new Modal(app);
    modal.titleEl.setText(opts.title);
    modal.contentEl.createEl("p", { text: opts.body });
    if (opts.warning) modal.contentEl.createEl("p", { cls: "gtm-warning", text: opts.warning });
    new Setting(modal.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => modal.close()))
      .addButton((b) =>
        b
          .setButtonText(opts.confirmText)
          .setWarning()
          .onClick(() => {
            confirmed = true;
            modal.close();
          }),
      );
    modal.onClose = () => resolve(confirmed);
    modal.open();
  });
}
