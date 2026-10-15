import { parseCanvas } from "../diff/canvasDiff";
import { minimalEdit } from "../diff/textDiff";
import { formatCanvas } from "./canvasWriter";
import { StaleWriteError, type TextTarget } from "./Restorer";

/**
 * One canvas card's text, seen as a small text file: the note comparison and its restores work on it
 * unchanged. Writes change only that card's text, and refuse if the card's text changed since.
 */
export function cardTextTarget(canvas: TextTarget, nodeId: string): TextTarget {
  const textOf = (canvasText: string) => parseCanvas(canvasText).nodes.find((n) => n.id === nodeId)?.text;
  return {
    path: `${canvas.path}::card:${nodeId}`,
    async read() {
      return textOf(await canvas.read()) ?? "";
    },
    flush: canvas.flush ? () => canvas.flush!() : undefined,
    async write(edit, before) {
      const canvasText = await canvas.read();
      const data = parseCanvas(canvasText);
      const node = data.nodes.find((n) => n.id === nodeId);
      if (!node || (node.text ?? "") !== before) throw new StaleWriteError();
      const text = before.slice(0, edit.from) + edit.text + before.slice(edit.to);
      const next = formatCanvas({ ...data, nodes: data.nodes.map((n) => (n.id === nodeId ? { ...n, text } : n)) });
      await canvas.write(minimalEdit(canvasText, next), canvasText);
    },
  };
}

/** Splits a card target's path back into the canvas file path and the card id. */
export function parseCardPath(path: string): { file: string; card: string | null } {
  const i = path.indexOf("::card:");
  return i === -1 ? { file: path, card: null } : { file: path.slice(0, i), card: path.slice(i + "::card:".length) };
}
