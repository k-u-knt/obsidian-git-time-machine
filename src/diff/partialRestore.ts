import { diffWordsWithSpace } from "diff";
import { diffText, splitLines, type Chunk } from "./textDiff";

/**
 * How much of a change to undo:
 * - "both": restore the old text (deleted words come back, added words go);
 * - "deleted": bring back what was deleted, keep what was added;
 * - "added": remove what was added, keep deleted text deleted.
 */
export type RestoreMode = "both" | "deleted" | "added";

/** Links, embeds, footnote references, inline code and math are kept whole. */
const ATOMIC = /!?\[\[[^\]\n]*\]\]|!?\[[^\]\n]*\]\([^)\n]*\)|\[\^[^\]\n]*\]|`[^`\n]+`|\$[^$\n]+\$/g;

/** A run of word changes (with the spaces between them), or unchanged text. */
export type WordRegion = { kind: "same"; text: string } | { kind: "change"; deleted: string; added: string };

/**
 * Word diff grouped into regions: neighbouring changes separated only by spaces form one region, so
 * "from last week" → "and QC metrics" is one change, not three interleaved ones.
 */
export function wordRegions(oldText: string, newText: string): WordRegion[] {
  const parts = diffWordsWithSpace(oldText, newText);
  const out: WordRegion[] = [];
  const isSpace = (t: string) => /^[ \t]+$/.test(t);
  for (let i = 0; i < parts.length; ) {
    const p = parts[i];
    if (!p.added && !p.removed) {
      out.push({ kind: "same", text: p.value });
      i++;
      continue;
    }
    let deleted = "";
    let added = "";
    for (; i < parts.length; i++) {
      const q = parts[i];
      if (q.added) added += q.value;
      else if (q.removed) deleted += q.value;
      else if (isSpace(q.value) && i + 1 < parts.length && (parts[i + 1].added || parts[i + 1].removed)) {
        deleted += q.value;
        added += q.value;
      } else break;
    }
    out.push({ kind: "change", deleted: deleted.trim() ? deleted : "", added: added.trim() ? added : "" });
  }
  return out;
}

/** Applies `mode` to the change from `oldText` to `newText`, returning the text to write. */
export function mergeChange(oldText: string, newText: string, mode: RestoreMode): string {
  if (mode === "both") return oldText;
  const d = diffText(oldText, newText);
  const out: string[] = [];
  let r = 0;
  for (const c of d.chunks) {
    out.push(...d.rightLines.slice(r, c.rightStart));
    if (!c.leftLines.length) {
      if (mode === "deleted") out.push(...c.rightLines);
    } else if (!c.rightLines.length) {
      if (mode === "deleted") out.push(...c.leftLines);
    } else {
      out.push(...splitLines(mergeWords(c.leftLines.join("\n"), c.rightLines.join("\n"), mode)));
    }
    r = c.rightEnd;
  }
  out.push(...d.rightLines.slice(r));
  return out.join("\n");
}

/** A chunk whose "old side" is the result of applying `mode`, so the usual chunk restore applies only that half. */
export function chunkWithMode(chunk: Chunk, mode: RestoreMode): Chunk {
  if (mode === "both") return chunk;
  const merged = mergeChange(chunk.leftLines.join("\n"), chunk.rightLines.join("\n"), mode);
  return { ...chunk, id: `${chunk.id}:${mode}`, leftLines: splitLines(merged) };
}

function mergeWords(oldText: string, newText: string, mode: "deleted" | "added"): string {
  const tokens: string[] = [];
  const protect = (s: string) =>
    s.replace(ATOMIC, (m) => {
      let i = tokens.indexOf(m);
      if (i === -1) i = tokens.push(m) - 1;
      return String.fromCharCode(0xe000 + i);
    });
  const restore = (s: string) => s.replace(/[-]/g, (c) => tokens[c.charCodeAt(0) - 0xe000] ?? c);
  let out = "";
  let dropped = false;
  for (const region of wordRegions(protect(oldText), protect(newText))) {
    if (region.kind === "same") {
      // After removing words, don't leave a double space or a trailing space behind.
      if (dropped && / $/.test(out) && /^[ \n]/.test(region.text)) out = out.replace(/ +$/, "");
      out += region.text;
      dropped = false;
    } else if (mode === "deleted") {
      const gap = region.deleted && region.added && /\S$/.test(region.deleted) && /^\S/.test(region.added) ? " " : "";
      out += region.deleted + gap + region.added;
    } else {
      dropped = true;
    }
  }
  if (dropped) out = out.replace(/ +$/, "");
  return restore(out);
}
