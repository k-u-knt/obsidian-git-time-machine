import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { docText, externalChange, lineSeparatorFor } from "../../src/render/sourceDoc";

describe("docText", () => {
  it("keeps CRLF line endings through an edit", () => {
    const original = "a\r\nb\r\nc";
    let state = EditorState.create({ doc: original, extensions: [lineSeparatorFor(original)] });
    expect(docText(state)).toBe(original);
    state = state.update({ changes: { from: 1, insert: "X" } }).state;
    expect(docText(state)).toBe("aX\r\nb\r\nc");
  });

  it("keeps LF text unchanged", () => {
    const original = "a\nb\n";
    const state = EditorState.create({ doc: original, extensions: [lineSeparatorFor(original)] });
    expect(docText(state)).toBe(original);
  });
});

describe("externalChange", () => {
  const apply = (doc: string, next: string) => {
    let state = EditorState.create({ doc, extensions: [lineSeparatorFor(doc)] });
    const change = externalChange(state, next);
    if (change) state = state.update({ changes: change }).state;
    return { text: docText(state), change };
  };

  it("brings the editor to the file's new text with a minimal change", () => {
    const r = apply("alpha\nbeta\ngamma\n", "alpha\nBETA\ngamma\n");
    expect(r.text).toBe("alpha\nBETA\ngamma\n");
    expect(r.change).toEqual({ from: 6, to: 10, insert: "BETA" });
  });

  it("works for CRLF files", () => {
    expect(apply("a\r\nb\r\nc", "a\r\nb2\r\nc\r\nd").text).toBe("a\r\nb2\r\nc\r\nd");
  });

  it("returns null when nothing changed", () => {
    expect(apply("same\n", "same\n").change).toBeNull();
  });
});
