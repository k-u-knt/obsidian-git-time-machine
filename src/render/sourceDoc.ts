import { EditorState, type Extension } from "@codemirror/state";
import { minimalEdit } from "../diff/textDiff";

/** Keep the file's own line endings: CodeMirror would otherwise turn CRLF into LF on the first edit. */
export const lineSeparatorFor = (text: string): Extension => EditorState.lineSeparator.of(text.includes("\r\n") ? "\r\n" : "\n");

/** The editor's text with the file's own line endings (`doc.toString()` always joins with "\n"). */
export const docText = (state: EditorState): string => state.sliceDoc();

/**
 * The smallest change that turns the editor's document into `text` (the file's new content).
 * Positions are CodeMirror positions, where a line break counts as one character whatever the separator.
 */
export function externalChange(state: EditorState, text: string): { from: number; to: number; insert: string } | null {
  const crlf = state.lineBreak === "\r\n";
  const current = state.doc.toString();
  const target = crlf ? text.replace(/\r\n/g, "\n") : text;
  if (current === target) return null;
  const e = minimalEdit(current, target);
  return { from: e.from, to: e.to, insert: crlf ? e.text.replace(/\n/g, "\r\n") : e.text };
}
