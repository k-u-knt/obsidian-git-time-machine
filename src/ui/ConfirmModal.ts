import { Modal, Setting, requireApiVersion, type App, type ButtonComponent } from "obsidian";

/** Mark a button as destructive: setDestructive() from Obsidian 1.13, the older setWarning() before that. */
function markDestructive(b: ButtonComponent): ButtonComponent {
  if (requireApiVersion("1.13.0")) return b.setDestructive();
  (b as unknown as { setWarning(): void }).setWarning();
  return b;
}

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
        markDestructive(b.setButtonText(opts.confirmText))
          .onClick(() => {
            confirmed = true;
            modal.close();
          }),
      );
    modal.onClose = () => resolve(confirmed);
    modal.open();
  });
}
