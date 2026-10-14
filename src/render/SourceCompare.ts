import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { Annotation, EditorState, Transaction, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import type { Chunk } from "../diff/textDiff";
import { docText, externalChange, lineSeparatorFor } from "./sourceDoc";
import type { CompareRenderer } from "./types";

export interface SourceCompareOptions {
  left: string;
  right: string;
  layout: "split" | "inline";
  /** Called (undebounced) when the user edits the right side or clicks a revert arrow. */
  onEdit(text: string): void;
  /** The current diff chunks, for "jump to change". */
  chunks(): Chunk[];
}

/** Marks transactions that mirror changes made outside this editor, so they are not written back. */
const fromOutside = Annotation.define<boolean>();

const COLLAPSE = { margin: 3, minSize: 6 };

/** Source mode: CodeMirror's merge view. Left read-only, right editable and bound to the file. */
export class SourceCompare implements CompareRenderer {
  private merge: MergeView | null = null;
  private single: EditorView | null = null;

  constructor(private readonly o: SourceCompareOptions) {}

  private get editor(): EditorView {
    return this.merge ? this.merge.b : this.single!;
  }

  async render(host: HTMLElement): Promise<void> {
    const wrap = host.createDiv({ cls: `gtm-source-compare is-${this.o.layout}` });
    const editable: Extension[] = [
      lineSeparatorFor(this.o.right),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      lineNumbers(),
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !u.transactions.some((t) => t.annotation(fromOutside))) this.o.onEdit(docText(u.state));
      }),
    ];
    if (this.o.layout === "split") {
      this.merge = new MergeView({
        a: {
          doc: this.o.left,
          extensions: [lineSeparatorFor(this.o.left), EditorState.readOnly.of(true), EditorView.editable.of(false), lineNumbers(), EditorView.lineWrapping],
        },
        b: { doc: this.o.right, extensions: editable },
        parent: wrap,
        revertControls: "a-to-b",
        highlightChanges: true,
        gutter: true,
        collapseUnchanged: COLLAPSE,
      });
    } else {
      this.single = new EditorView({
        parent: wrap,
        state: EditorState.create({
          doc: this.o.right,
          extensions: [...editable, unifiedMergeView({ original: this.o.left, mergeControls: true, highlightChanges: true, gutter: true, collapseUnchanged: COLLAPSE })],
        }),
      });
    }
  }

  /**
   * Mirrors an outside change (another pane, a restore, a sync) as a minimal edit, even while the user is
   * typing here, so the editor never keeps a stale copy. Kept out of this editor's undo history.
   */
  updateRight(text: string): void {
    const ed = this.editor;
    const change = externalChange(ed.state, text);
    if (!change) return;
    ed.dispatch({ changes: change, annotations: [fromOutside.of(true), Transaction.addToHistory.of(false)] });
  }

  scrollToChange(index: number): void {
    const chunk = this.o.chunks()[index];
    if (!chunk) return;
    const ed = this.editor;
    const line = ed.state.doc.line(Math.min(chunk.rightStart + 1, ed.state.doc.lines));
    ed.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
  }

  destroy(): void {
    this.merge?.destroy();
    this.single?.destroy();
  }
}
