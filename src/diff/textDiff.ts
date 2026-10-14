import { diffArrays, diffWordsWithSpace } from "diff";

export type RowKind = "same" | "changed" | "added" | "removed";

/** One aligned row of the side-by-side view. `left`/`right` are 0-based line indices, or null for a gap. */
export interface Row {
  kind: RowKind;
  left: number | null;
  right: number | null;
  chunkId: string | null;
}

/** A contiguous change. Ranges are [start, end) line indices. */
export interface Chunk {
  id: string;
  leftStart: number;
  leftEnd: number;
  rightStart: number;
  rightEnd: number;
  leftLines: string[];
  rightLines: string[];
}

export interface TextDiff {
  leftLines: string[];
  rightLines: string[];
  rows: Row[];
  chunks: Chunk[];
}

export interface WordSpan {
  text: string;
  kind: "same" | "added" | "removed";
}

/** Splits on "\n" only, so "\r" stays on the line and joinLines(splitLines(t)) === t for every t. */
export function splitLines(text: string): string[] {
  return text.split("\n");
}

export function joinLines(lines: string[]): string {
  return lines.join("\n");
}

export function diffText(left: string, right: string): TextDiff {
  const leftLines = splitLines(left);
  const rightLines = splitLines(right);
  const parts = diffArrays(leftLines, rightLines);
  const rows: Row[] = [];
  const chunks: Chunk[] = [];
  let l = 0;
  let r = 0;
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (!part.added && !part.removed) {
      for (let k = 0; k < part.value.length; k++) rows.push({ kind: "same", left: l++, right: r++, chunkId: null });
      i++;
      continue;
    }
    let removed = 0;
    let added = 0;
    while (i < parts.length && (parts[i].added || parts[i].removed)) {
      if (parts[i].removed) removed += parts[i].value.length;
      else added += parts[i].value.length;
      i++;
    }
    const id = `c${chunks.length}`;
    chunks.push({
      id,
      leftStart: l,
      leftEnd: l + removed,
      rightStart: r,
      rightEnd: r + added,
      leftLines: leftLines.slice(l, l + removed),
      rightLines: rightLines.slice(r, r + added),
    });
    for (let k = 0; k < Math.max(removed, added); k++) {
      const hasL = k < removed;
      const hasR = k < added;
      rows.push({
        kind: hasL && hasR ? "changed" : hasL ? "removed" : "added",
        left: hasL ? l + k : null,
        right: hasR ? r + k : null,
        chunkId: id,
      });
    }
    l += removed;
    r += added;
  }
  return { leftLines, rightLines, rows, chunks };
}

export function wordSpans(left: string, right: string): { left: WordSpan[]; right: WordSpan[] } {
  const out = { left: [] as WordSpan[], right: [] as WordSpan[] };
  for (const p of diffWordsWithSpace(left, right)) {
    if (p.added) out.right.push({ text: p.value, kind: "added" });
    else if (p.removed) out.left.push({ text: p.value, kind: "removed" });
    else {
      out.left.push({ text: p.value, kind: "same" });
      out.right.push({ text: p.value, kind: "same" });
    }
  }
  return { left: coalesce(out.left), right: coalesce(out.right) };
}

/** Merges "changed, whitespace, changed" into one changed span so "from last week" is highlighted as one run. */
function coalesce(spans: WordSpan[]): WordSpan[] {
  const out: WordSpan[] = [];
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    const prev = out[out.length - 1];
    const next = spans[i + 1];
    if (s.kind === "same" && /^[ \t]+$/.test(s.text) && prev && prev.kind !== "same" && next && next.kind === prev.kind) {
      prev.text += s.text + next.text;
      i++;
      continue;
    }
    if (prev && prev.kind === s.kind) prev.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

/** Replaces the chunk's right-side lines with its left-side lines. Returns null if `current` no longer has the expected lines there. */
export function applyChunkToText(current: string, chunk: Chunk): string | null {
  const lines = splitLines(current);
  if (chunk.rightEnd > lines.length) return null;
  for (let k = 0; k < chunk.rightLines.length; k++) {
    if (lines[chunk.rightStart + k] !== chunk.rightLines[k]) return null;
  }
  lines.splice(chunk.rightStart, chunk.rightEnd - chunk.rightStart, ...chunk.leftLines);
  return joinLines(lines);
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** Smallest single replacement turning oldText into newText (never splits a surrogate pair). */
export function minimalEdit(oldText: string, newText: string): { from: number; to: number; text: string } {
  let start = 0;
  const max = Math.min(oldText.length, newText.length);
  while (start < max && oldText.charCodeAt(start) === newText.charCodeAt(start)) start++;
  if (start > 0 && isHigh(oldText.charCodeAt(start - 1))) start--;
  let endOld = oldText.length;
  let endNew = newText.length;
  while (endOld > start && endNew > start && oldText.charCodeAt(endOld - 1) === newText.charCodeAt(endNew - 1)) {
    endOld--;
    endNew--;
  }
  if (endOld < oldText.length && isLow(oldText.charCodeAt(endOld))) {
    endOld++;
    endNew++;
  }
  return { from: start, to: endOld, text: newText.slice(start, endNew) };
}
