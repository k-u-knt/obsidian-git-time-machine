import { minimalEdit } from "../diff/textDiff";
import { StaleWriteError, type TextTarget } from "./Restorer";

/**
 * Keeps Source mode's editable side and one file in step. It writes only while the file still holds the
 * text the editor was last synced with, so an edit made elsewhere (another pane, iCloud sync) is never
 * silently overwritten. Bound to one target: a pending edit can only ever land in its own file.
 */
export class EditorSync {
  private synced: string;
  private pending: string | null = null;

  constructor(
    readonly target: TextTarget,
    initial: string,
  ) {
    this.synced = initial;
  }

  /** The file text the editor last matched. */
  get syncedText(): string {
    return this.synced;
  }

  /** The user changed the editor; `flush` writes it. */
  edited(text: string): void {
    this.pending = text;
  }

  /** The file changed elsewhere and the editor has been reset to `text`. Unsaved typing is dropped. */
  external(text: string): void {
    this.synced = text;
    this.pending = null;
  }

  async flush(): Promise<"written" | "stale" | "none"> {
    const next = this.pending;
    if (next === null) return "none";
    this.pending = null;
    const current = await this.target.read();
    if (current !== this.synced) return "stale";
    if (current === next) return "none";
    try {
      await this.target.write(minimalEdit(current, next), current);
    } catch (e) {
      if (e instanceof StaleWriteError) return "stale";
      throw e;
    }
    this.synced = next;
    return "written";
  }
}
