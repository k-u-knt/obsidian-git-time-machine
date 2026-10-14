import type { App, TextFileView, TFile, WorkspaceLeaf } from "obsidian";
import { sameItem } from "../diff/canvasDiff";
import { StaleWriteError, type TextTarget } from "./Restorer";

/**
 * Reads and writes a .canvas file. Before a write (`flush`), an open Canvas view with unsaved changes is
 * saved, so a restore never starts from older text than what's on screen. Canvases compare as data
 * (`same`), since Obsidian re-serialises them. After writing, any open view that didn't pick up the change
 * is reopened.
 */
export function canvasTextTarget(app: App, file: TFile): TextTarget {
  const leaves = (): WorkspaceLeaf[] =>
    app.workspace.getLeavesOfType("canvas").filter((leaf) => (leaf.view as TextFileView).file?.path === file.path);

  return {
    path: file.path,
    // Plain reads never save an open canvas: that would rewrite the file just by opening Time Machine,
    // and each save fires "modify", which refreshes and reads again.
    read: () => app.vault.read(file),
    /** Before a write: save an open Canvas view that has changes not yet on disk. */
    async flush() {
      for (const leaf of leaves()) {
        const view = leaf.view as TextFileView;
        if (view.getViewData() !== (await app.vault.read(file))) await view.save();
      }
    },
    same: sameJson,
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

/** Same canvas content, whatever the formatting or key order. */
function sameJson(a: string, b: string): boolean {
  try {
    return sameItem(JSON.parse(a) as Record<string, unknown>, JSON.parse(b) as Record<string, unknown>);
  } catch {
    return false;
  }
}
