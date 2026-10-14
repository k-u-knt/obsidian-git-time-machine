import { wordSpans, type Chunk, type Row, type TextDiff, type WordSpan } from "../diff/textDiff";

/**
 * Block id per line: consecutive non-blank lines share an id; blank lines get -1.
 * Fenced code (``` / ~~~), $$ math and front matter are single blocks even across blank lines.
 */
export function blockIds(lines: string[]): number[] {
  const ids: number[] = new Array(lines.length);
  let id = 0;
  let inBlock = false;
  let fence: string | null = null;
  let inMath = false;
  let inFrontmatter = lines[0] === "---";
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (inFrontmatter) {
      ids[i] = id;
      if (i > 0 && t === "---") {
        inFrontmatter = false;
        id++;
      }
      continue;
    }
    if (fence) {
      ids[i] = id;
      if (t.startsWith(fence)) fence = null;
      continue;
    }
    if (inMath) {
      ids[i] = id;
      if (t.startsWith("$$")) inMath = false;
      continue;
    }
    if (t === "") {
      ids[i] = -1;
      if (inBlock) {
        inBlock = false;
        id++;
      }
      continue;
    }
    inBlock = true;
    ids[i] = id;
    const f = /^(`{3,}|~{3,})/.exec(t);
    if (f) fence = f[1];
    else if (t.startsWith("$$") && !(t.length > 2 && t.endsWith("$$"))) inMath = true;
  }
  return ids;
}

/** A run of rows rendered together. Line ranges are [start, end). */
export interface Segment {
  changed: boolean;
  rowStart: number;
  rowEnd: number;
  leftStart: number;
  leftEnd: number;
  rightStart: number;
  rightEnd: number;
}

/** Groups aligned rows so that no Markdown block is split across segments. */
export function segmentRows(diff: TextDiff): Segment[] {
  const { rows } = diff;
  const lb = blockIds(diff.leftLines);
  const rb = blockIds(diff.rightLines);
  const leftBefore: number[] = [0];
  const rightBefore: number[] = [0];
  rows.forEach((r, i) => {
    leftBefore[i + 1] = leftBefore[i] + (r.left !== null ? 1 : 0);
    rightBefore[i + 1] = rightBefore[i] + (r.right !== null ? 1 : 0);
  });
  const joins = (a: Row, b: Row): boolean => {
    if (a.left !== null && b.left !== null && lb[a.left] !== -1 && lb[a.left] === lb[b.left]) return true;
    if (a.right !== null && b.right !== null && rb[a.right] !== -1 && rb[a.right] === rb[b.right]) return true;
    return a.chunkId !== null && a.chunkId === b.chunkId;
  };
  const segments: Segment[] = [];
  let start = 0;
  for (let i = 1; i <= rows.length; i++) {
    if (i < rows.length && joins(rows[i - 1], rows[i])) continue;
    segments.push({
      changed: rows.slice(start, i).some((r) => r.kind !== "same"),
      rowStart: start,
      rowEnd: i,
      leftStart: leftBefore[start],
      leftEnd: leftBefore[i],
      rightStart: rightBefore[start],
      rightEnd: rightBefore[i],
    });
    start = i;
  }
  return segments;
}

/** The restore unit for a segment: put its left lines in place of its right lines. */
export function segmentChunk(diff: TextDiff, seg: Segment, index: number): Chunk {
  return {
    id: `s${index}`,
    leftStart: seg.leftStart,
    leftEnd: seg.leftEnd,
    rightStart: seg.rightStart,
    rightEnd: seg.rightEnd,
    leftLines: diff.leftLines.slice(seg.leftStart, seg.leftEnd),
    rightLines: diff.rightLines.slice(seg.rightStart, seg.rightEnd),
  };
}

const UNSAFE = /(^|\n)[ \t]*(```|~~~|\$\$|\|)/;
/** Kept whole, may be highlighted: links, embeds, footnote references, inline code, inline math, HTML tags. */
const ATOMIC = /!?\[\[[^\]\n]*\]\]|!?\[[^\]\n]*\]\([^)\n]*\)|\[\^[^\]\n]*\]|`[^`\n]+`|\$[^$\n]+\$|<[^>\n]+>/g;
/** Never highlighted, because a span would break the syntax: line prefixes (quote, heading, list, checkbox, callout header). */
const LINE_PREFIX = /^(?:[ \t]*(?:>[ \t]?|#{1,6}[ \t]+|[-*+][ \t]+(?:\[.\][ \t]+)?|\d+[.)][ \t]+(?:\[.\][ \t]+)?|\[![^\]\n]*\][+-]?[ \t]*))+/;
/** Never highlighted: a block id must stay the last thing on its line. */
const BLOCK_ID = /[ \t]\^[A-Za-z0-9-]+[ \t]*$/;
const ATOMIC_BASE = 0xe000;
const FIXED_BASE = 0xf000;
const FIXED_CHAR = /^[\uf000-\uf7ff]$/;

/**
 * Wraps changed words in <span class="gtm-word-del|gtm-word-add"> so they can be highlighted after rendering.
 * Links, footnote references, inline code, math and HTML tags are kept whole. Line prefixes (list markers,
 * checkboxes, callout headers) and block ids are never wrapped, so they still render as syntax.
 * Returns the input unchanged (marked: false) for code fences, math blocks and tables.
 */
export function markWords(leftText: string, rightText: string): { left: string; right: string; marked: boolean } {
  if (UNSAFE.test(leftText) || UNSAFE.test(rightText)) return { left: leftText, right: rightText, marked: false };
  const atomic: string[] = [];
  const fixed: string[] = [];
  const token = (list: string[], base: number, m: string) => {
    let i = list.indexOf(m);
    if (i === -1) i = list.push(m) - 1;
    return String.fromCharCode(base + i);
  };
  const protect = (s: string) =>
    s
      .split("\n")
      .map((line) => {
        const prefix = LINE_PREFIX.exec(line)?.[0] ?? "";
        let body = line.slice(prefix.length);
        const id = BLOCK_ID.exec(body)?.[0] ?? "";
        body = body.slice(0, body.length - id.length).replace(ATOMIC, (m) => token(atomic, ATOMIC_BASE, m));
        return (prefix ? token(fixed, FIXED_BASE, prefix) : "") + body + (id ? token(fixed, FIXED_BASE, id) : "");
      })
      .join("\n");
  const restore = (s: string) =>
    s
      .replace(/[\ue000-\uefff]/g, (c) => atomic[c.charCodeAt(0) - ATOMIC_BASE])
      .replace(/[\uf000-\uf7ff]/g, (c) => fixed[c.charCodeAt(0) - FIXED_BASE]);
  const spans = wordSpans(protect(leftText), protect(rightText));
  return {
    left: restore(wrap(spans.left, "gtm-word-del")),
    right: restore(wrap(spans.right, "gtm-word-add")),
    marked: true,
  };
}

/** Wraps each changed run, line by line, leaving fixed tokens (prefixes, block ids) outside the spans. */
function wrap(spans: WordSpan[], cls: string): string {
  let out = "";
  for (const s of spans) {
    if (s.kind === "same") {
      out += s.text;
      continue;
    }
    out += s.text
      .split(/(\n|[\uf000-\uf7ff])/)
      .map((part) => {
        if (part === "\n" || FIXED_CHAR.test(part)) return part;
        const lead = /^\s*/.exec(part)![0];
        const core = part.slice(lead.length).replace(/\s+$/, "");
        const trail = part.slice(lead.length + core.length);
        return core ? `${lead}<span class="${cls}">${core}</span>${trail}` : part;
      })
      .join("");
  }
  return out;
}
