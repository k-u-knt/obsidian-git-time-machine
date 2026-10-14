import { describe, expect, it } from "vitest";
import type { Version } from "../../src/history/types";
import { buildTimeline, dayLabel, mergeVersions, timeLabel } from "../../src/ui/timelineModel";

const v = (hash: string, iso: string, added = 1, removed = 0): Version => ({ hash, time: new Date(iso), path: "n.md", added, removed });
const now = new Date(2026, 9, 14, 11, 30); // Wed 14 Oct 2026, local time

describe("labels", () => {
  it("says Today, Yesterday, then weekday + date", () => {
    expect(dayLabel(new Date(2026, 9, 14, 9, 0), now, "en-GB")).toBe("Today");
    expect(dayLabel(new Date(2026, 9, 13, 23, 59), now, "en-GB")).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 9, 12, 8, 0), now, "en-GB")).toBe("Mon 12 Oct");
    expect(dayLabel(new Date(2025, 9, 12, 8, 0), now, "en-GB")).toBe("Sun 12 Oct 2025");
    expect(timeLabel(new Date(2026, 9, 14, 9, 5), "en-GB")).toBe("09:05");
  });
});

describe("buildTimeline", () => {
  const versions = [
    v("c", new Date(2026, 9, 14, 11, 23).toISOString(), 5, 2),
    v("b", new Date(2026, 9, 14, 10, 43).toISOString()),
    v("a", new Date(2026, 9, 13, 17, 40).toISOString(), 10, 10),
  ];

  it("adds a separate Now entry when the live file has unsaved-to-git edits", () => {
    const m = buildTimeline(versions, { now, liveDiffersFromLatest: true, locale: "en-GB" });
    expect(m.entries.map((e) => e.key)).toEqual(["now", "c", "b", "a"]);
    expect(m.groups.map((g) => [g.label, g.entries.length])).toEqual([["Today", 3], ["Yesterday", 1]]);
    expect(m.maxSize).toBe(20);
  });

  it("shows the newest commit as Now when nothing changed since", () => {
    const m = buildTimeline(versions, { now, liveDiffersFromLatest: false, locale: "en-GB" });
    expect(m.entries.map((e) => [e.key, e.isNow])).toEqual([["c", true], ["b", false], ["a", false]]);
  });
});

describe("mergeVersions", () => {
  it("prepends new commits after an auto-commit without duplicates", () => {
    const loaded = [v("b", "2026-10-14T02:43:00Z"), v("a", "2026-10-14T01:00:00Z")];
    const fresh = [v("c", "2026-10-14T03:23:00Z"), v("b", "2026-10-14T02:43:00Z")];
    expect(mergeVersions(loaded, fresh).map((x) => x.hash)).toEqual(["c", "b", "a"]);
  });
});
