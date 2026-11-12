import { describe, expect, it } from "vitest";
import { markdownProtector } from "../../src/diff/markdownTokens";

describe("markdownProtector on pathological lines", () => {
  // Each of these used to make the ATOMIC regex backtrack quadratically, freezing Obsidian on a diff.
  const cases: [string, string][] = [
    ["a run of <", "<".repeat(200_000)],
    ["a run of [", "[".repeat(200_000)],
    ["a run of [[", "!".repeat(1) + "[[".repeat(100_000)],
    ["a run of [a](", "[a](".repeat(50_000)],
  ];
  for (const [name, line] of cases) {
    it(`protects ${name} (200k chars) quickly and round-trips it`, () => {
      const { protect, restore } = markdownProtector();
      const t0 = performance.now();
      const p = protect(line);
      const elapsed = performance.now() - t0;
      expect(restore(p)).toBe(line);
      expect(elapsed).toBeLessThan(500);
    });
  }

  it("still keeps HTML tags, wikilinks, links and footnotes whole", () => {
    const { protect } = markdownProtector();
    const p = protect("a <b>x</b> [[Note|alias]] [t](http://x.y) [^1] z");
    expect(p).toBe("a \ue000x\ue001 \ue002 \ue003 \ue004 z");
  });
});
