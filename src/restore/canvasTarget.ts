import type { App, TextFileView, TFile, WorkspaceLeaf } from "obsidian";
import { StaleWriteError, type TextTarget } from "./Restorer";

/**
 * Reads and writes a .canvas file. An open Canvas view is asked to save first, so a restore never starts
 * from older text than what's on screen; after writing, any open view that didn't pick up the change is
 * reopened so it shows the restored canvas.
 */
export function canvasTextTarget(app: App, file: TFile): TextTarget {
  const leaves = (): WorkspaceLeaf[] =>
    app.workspace.getLeavesOfType("canvas").filter((leaf) => (leaf.view as TextFileView).file?.path === file.path);

  return {
    path: file.path,
    async read() {
      for (const leaf of leaves()) await (leaf.view as TextFileView).save();
      return app.vault.read(file);
    },
    async write(edit, before) {
      let written = "";
      await app.vault.process(file, (data) => {
        if (data !== before) throw new StaleWriteError();
        written = data.slice(0, edit.from) + edit.text + data.slice(edit.to);
        return written;
      });
      for (const leaf of leaves()) {
        if (!sameJson((leaf.view as TextFileView).getViewData(), written)) await leaf.setViewState(leaf.getViewState());
      }
    },
  };
}

function sameJson(a: string, b: string): boolean {
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch {
    return false;
  }
}
