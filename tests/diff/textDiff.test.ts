import { describe, expect, it } from "vitest";
import { applyChunkToText, diffText, minimalEdit, wordSpans } from "../../src/diff/textDiff";

describe("diffText", () => {
  it("aligns a changed line, a removed line and an added line", () => {
    const left = "# T\nalpha\nbeta\ngamma\n";
    const right = "# T\nALPHA\ngamma\ndelta\n";
    const d = diffText(left, right);
    expect(d.rows.map((r) => r.kind)).toEqual(["same", "changed", "removed", "same", "added", "same"]);
    expect(d.chunks).toHaveLength(2);
    expect(d.chunks[0]).toMatchObject({ leftStart: 1, leftEnd: 3, rightStart: 1, rightEnd: 2, leftLines: ["alpha", "beta"], rightLines: ["ALPHA"] });
    expect(d.chunks[1]).toMatchObject({ leftStart: 4, leftEnd: 4, rightStart: 3, rightEnd: 4, leftLines: [], rightLines: ["delta"] });
    expect(d.rows[1].chunkId).toBe("c0");
    expect(d.rows[4].chunkId).toBe("c1");
  });

  it("reports no chunks for identical text", () => {
    expect(diffText("a\nb", "a\nb").chunks).toEqual([]);
  });
});

describe("wordSpans", () => {
  it("marks only the words that changed", () => {
    const s = wordSpans("Review results from last week", "Review results and QC metrics");
    expect(s.left.filter((x) => x.kind === "removed").map((x) => x.text)).toEqual(["from last week"]);
    expect(s.right.filter((x) => x.kind === "added").map((x) => x.text)).toEqual(["and QC metrics"]);
    expect(s.left.filter((x) => x.kind !== "added").map((x) => x.text).join("")).toBe("Review results from last week");
    expect(s.right.filter((x) => x.kind !== "removed").map((x) => x.text).join("")).toBe("Review results and QC metrics");
  });
});

describe("applyChunkToText", () => {
  it("brings back a removed line", () => {
    const left = "a\nb\nc\n";
    const right = "a\nc\n";
    const d = diffText(left, right);
    expect(applyChunkToText(right, d.chunks[0])).toBe(left);
  });

  it("reverts an added line", () => {
    const d = diffText("a\nc\n", "a\nb\nc\n");
    expect(applyChunkToText("a\nb\nc\n", d.chunks[0])).toBe("a\nc\n");
  });

  it("returns null when the current text no longer matches", () => {
    const d = diffText("a\nb\n", "a\nX\n");
    expect(applyChunkToText("a\nY\n", d.chunks[0])).toBeNull();
  });

  it("keeps CRLF line endings and a missing final newline intact", () => {
    const left = "one\r\ntwo\r\nthree";
    const right = "one\r\nTWO\r\nthree";
    const d = diffText(left, right);
    expect(applyChunkToText(right, d.chunks[0])).toBe(left);
  });
});

describe("minimalEdit", () => {
  it("finds the smallest replacement", () => {
    expect(minimalEdit("hello world", "hello brave world")).toEqual({ from: 6, to: 6, text: "brave " });
    expect(minimalEdit("abc", "abc")).toEqual({ from: 3, to: 3, text: "" });
  });

  it("does not split an emoji surrogate pair", () => {
    const e = minimalEdit("x🔬y", "x🔭y");
    expect(e).toEqual({ from: 1, to: 3, text: "🔭" });
  });
});
