import { describe, expect, it } from "vitest";
import { describeChunks } from "../../src/diff/describe";
import { diffText } from "../../src/diff/textDiff";

describe("describeChunks", () => {
  it("names each change after the heading above it", () => {
    const left = "# Lab sync\n## Agenda\n- review\n- abstract deadline\n## Decisions\n- v2 pipeline\n";
    const right = "# Lab sync\n## Agenda\n- review and QC\n## Decisions\n- v2 pipeline\n- archive monthly\n- Thursday\n";
    expect(describeChunks(diffText(left, right)).map((s) => s.label)).toEqual(["Agenda · 2 lines edited", "Decisions · 2 lines added"]);
  });

  it("works without headings", () => {
    expect(describeChunks(diffText("a\nb\n", "a\n")).map((s) => [s.kind, s.label])).toEqual([["removed", "1 line removed"]]);
  });
});
