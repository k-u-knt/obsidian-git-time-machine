import { MarkdownView, type App, type TFile } from "obsidian";
import { StaleWriteError, type TextTarget } from "./Restorer";

/**
 * Reads and writes a vault file. When the file is open in a Markdown editor, both go through that editor,
 * so what we compare is what the user sees and a restore lands in the editor's undo history (⌘Z).
 */
export function obsidianTextTarget(app: App, file: TFile): TextTarget {
  const openEditor = (): MarkdownView | undefined =>
    app.workspace
      .getLeavesOfType("markdown")
      .map((leaf) => leaf.view)
      .find((v): v is MarkdownView => v instanceof MarkdownView && v.file?.path === file.path);

  return {
    path: file.path,
    async read() {
      const view = openEditor();
      return view ? view.editor.getValue() : app.vault.read(file);
    },
    async write(edit, before) {
      const view = openEditor();
      if (view) {
        const editor = view.editor;
        if (editor.getValue() !== before) throw new StaleWriteError();
        editor.transaction({ changes: [{ from: editor.offsetToPos(edit.from), to: editor.offsetToPos(edit.to), text: edit.text }] });
        return;
      }
      await app.vault.process(file, (data) => {
        if (data !== before) throw new StaleWriteError();
        return data.slice(0, edit.from) + edit.text + data.slice(edit.to);
      });
    },
  };
}
