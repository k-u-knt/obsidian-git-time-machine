import { applyChunkToText, minimalEdit, type Chunk } from "../diff/textDiff";

/** Thrown by a TextTarget when the file no longer matches `before` at write time. */
export class StaleWriteError extends Error {
  constructor() {
    super("The file changed before the restore could be written.");
    this.name = "StaleWriteError";
  }
}

/** Where restores are written. The Obsidian implementation routes through an open editor when there is one. */
export interface TextTarget {
  readonly path: string;
  read(): Promise<string>;
  /** Applies one replacement to text that must still equal `before`; otherwise throws StaleWriteError. */
  write(edit: { from: number; to: number; text: string }, before: string): Promise<void>;
}

export interface UndoEntry {
  path: string;
  before: string;
  after: string;
}

export type ApplyResult = "applied" | "stale";

/** The only code path that changes vault files. Keeps an in-memory undo stack (per Time Machine tab). */
export class Restorer {
  private stack: UndoEntry[] = [];

  constructor(private readonly limit = 20) {}

  /** `expectedCurrent` is the text the comparison was computed against; anything else is stale. */
  async applyChunk(target: TextTarget, expectedCurrent: string, chunk: Chunk): Promise<ApplyResult> {
    const current = await target.read();
    if (current !== expectedCurrent) return "stale";
    const next = applyChunkToText(current, chunk);
    if (next === null) return "stale";
    return (await this.replace(target, current, next)) ? "applied" : "stale";
  }

  /** Writes `next` only if the file still equals `expectedCurrent` (the text the comparison was drawn from). */
  async replaceText(target: TextTarget, expectedCurrent: string, next: string): Promise<ApplyResult> {
    const current = await target.read();
    if (current !== expectedCurrent) return "stale";
    if (current === next) return "applied";
    return (await this.replace(target, current, next)) ? "applied" : "stale";
  }

  async restoreWhole(target: TextTarget, content: string): Promise<ApplyResult> {
    const current = await target.read();
    if (current === content) return "applied";
    return (await this.replace(target, current, content)) ? "applied" : "stale";
  }

  peekUndo(): UndoEntry | undefined {
    return this.stack[this.stack.length - 1];
  }

  /** Reverts the most recent restore. Asks `confirmOverwrite` first if the file was edited after that restore. */
  async undo(target: TextTarget, confirmOverwrite: () => Promise<boolean>): Promise<"undone" | "cancelled" | "empty"> {
    const entry = this.peekUndo();
    if (!entry) return "empty";
    const current = await target.read();
    if (current !== entry.after && !(await confirmOverwrite())) return "cancelled";
    this.stack.pop();
    await target.write(minimalEdit(current, entry.before), current);
    return "undone";
  }

  private async replace(target: TextTarget, current: string, next: string): Promise<boolean> {
    this.stack.push({ path: target.path, before: current, after: next });
    if (this.stack.length > this.limit) this.stack.shift();
    try {
      await target.write(minimalEdit(current, next), current);
      return true;
    } catch (e) {
      this.stack.pop();
      if (e instanceof StaleWriteError) return false;
      throw e;
    }
  }
}
