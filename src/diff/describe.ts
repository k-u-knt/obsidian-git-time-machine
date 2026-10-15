import type { TextDiff } from "./textDiff";

export interface ChangeSummary {
  chunkIndex: number;
  kind: "edited" | "added" | "removed" | "moved";
  label: string;
}

/** One line per chunk for the "Changes in this version" list, e.g. "Agenda · 1 line edited". */
export function describeChunks(diff: TextDiff): ChangeSummary[] {
  return diff.chunks.map((c, i) => {
    const kind = c.leftLines.length && c.rightLines.length ? "edited" : c.leftLines.length ? "removed" : "added";
    const lines = Math.max(c.leftLines.length, c.rightLines.length);
    const heading = nearestHeading(diff.rightLines, c.rightStart) ?? nearestHeading(diff.leftLines, c.leftStart);
    const what = `${lines} line${lines === 1 ? "" : "s"} ${kind}`;
    return { chunkIndex: i, kind, label: heading ? `${heading} · ${what}` : what };
  });
}

function nearestHeading(lines: string[], before: number): string | null {
  for (let i = Math.min(before, lines.length) - 1; i >= 0; i--) {
    const m = /^#{1,6}\s+(.*)$/.exec(lines[i]);
    if (m) return m[1].trim();
  }
  return null;
}
