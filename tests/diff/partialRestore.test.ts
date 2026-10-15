import { describe, expect, it } from "vitest";
import { applyChunkToText, diffText } from "../../src/diff/textDiff";
import { chunkWithMode, mergeChange } from "../../src/diff/partialRestore";

describe("mergeChange", () => {
  const before = "Hi-C on twelve samples";
  const after = "Hi-C and imaging on ten samples";

  it("'both' restores the old text", () => {
    expect(mergeChange(before, after, "both")).toBe(before);
  });

  it("'deleted' brings back deleted words and keeps the added ones", () => {
    expect(mergeChange(before, after, "deleted")).toBe("Hi-C and imaging on twelve ten samples");
  });

  it("'added' removes added words and keeps deleted ones deleted", () => {
    expect(mergeChange(before, after, "added")).toBe("Hi-C on samples");
  });

  it("works with whole lines", () => {
    expect(mergeChange("a\nold line\nb\n", "a\nb\nnew line\n", "deleted")).toBe("a\nold line\nb\nnew line\n");
    expect(mergeChange("a\nold line\nb\n", "a\nb\nnew line\n", "added")).toBe("a\nb\n");
  });

  it("keeps links whole", () => {
    expect(mergeChange("See [[Research map]] now", "See [[Research plan]] now", "deleted")).toBe("See [[Research map]] [[Research plan]] now");
  });
});

describe("chunkWithMode", () => {
  it("turns a diff chunk into one that applies only the chosen half", () => {
    const left = "# Plan\n- review results from last week\n";
    const right = "# Plan\n- review results and QC metrics\n";
    const chunk = diffText(left, right).chunks[0];
    expect(applyChunkToText(right, chunkWithMode(chunk, "deleted"))).toBe("# Plan\n- review results from last week and QC metrics\n");
    expect(applyChunkToText(right, chunkWithMode(chunk, "added"))).toBe("# Plan\n- review results\n");
    expect(applyChunkToText(right, chunkWithMode(chunk, "both"))).toBe(left);
  });
});
