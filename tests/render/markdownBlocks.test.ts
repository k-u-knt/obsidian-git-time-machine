import { describe, expect, it } from "vitest";
import { diffText, applyChunkToText } from "../../src/diff/textDiff";
import { blockIds, markWords, segmentChunk, segmentRows } from "../../src/render/markdownBlocks";

describe("blockIds", () => {
  it("separates blocks on blank lines and keeps fences whole", () => {
    const lines = ["# H", "para", "", "```js", "a", "", "b", "```", "", "- x", "- y"];
    expect(blockIds(lines)).toEqual([0, 0, -1, 1, 1, 1, 1, 1, -1, 2, 2]);
  });

  it("treats front matter as one block", () => {
    expect(blockIds(["---", "a: 1", "", "---", "text"])).toEqual([0, 0, 0, 0, 1]);
  });
});

describe("segmentRows", () => {
  it("never splits a list block, and keeps unchanged blocks separate", () => {
    const left = "# Agenda\n\n- one\n- two\n- three\n\n## Done\n";
    const right = "# Agenda\n\n- one\n- TWO\n- three\n\n## Done\n";
    const d = diffText(left, right);
    const segs = segmentRows(d);
    const changed = segs.filter((s) => s.changed);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ leftStart: 2, leftEnd: 5, rightStart: 2, rightEnd: 5 });
    expect(segs.filter((s) => !s.changed).length).toBeGreaterThanOrEqual(2);
  });

  it("produces a restorable chunk per changed segment", () => {
    const left = "a\n\n- one\n- two\n";
    const right = "a\n\n- one\n- two\n- added\n";
    const d = diffText(left, right);
    const segs = segmentRows(d);
    const i = segs.findIndex((s) => s.changed);
    expect(applyChunkToText(right, segmentChunk(d, segs[i], i))).toBe(left);
  });
});

describe("markWords", () => {
  it("highlights changed words but keeps list markers outside the span", () => {
    const m = markWords("- Review results from last week", "- Review results and QC metrics");
    expect(m.left).toBe('- Review results <span class="gtm-word-del">from last week</span>');
    expect(m.right).toBe('- Review results <span class="gtm-word-add">and QC metrics</span>');
  });

  it("keeps heading markers and whole new lines readable", () => {
    const m = markWords("## Plan", "## Plan\n- [ ] New task");
    expect(m.right).toBe('## Plan\n- [ ] <span class="gtm-word-add">New task</span>');
  });

  it("treats a wikilink as one unit", () => {
    const m = markWords("See [[Research map]] now", "See [[Research plan]] now");
    expect(m.left).toBe('See <span class="gtm-word-del">[[Research map]]</span> now');
    expect(m.right).toBe('See <span class="gtm-word-add">[[Research plan]]</span> now');
  });

  it("leaves code fences and tables unmarked", () => {
    expect(markWords("```\na\n```", "```\nb\n```").marked).toBe(false);
    expect(markWords("| a | b |", "| a | c |").marked).toBe(false);
  });
});
