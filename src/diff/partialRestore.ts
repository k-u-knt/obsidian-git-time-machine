import { diffWordsWithSpace } from "diff";
import { markdownProtector } from "./markdownTokens";
import { diffText, splitLines, type Chunk } from "./textDiff";

/**
 * How much of a change to undo:
 * - "both": restore the old text (deleted words come back, added words go);
 * - "deleted": bring back what was deleted, keep what was added;
 * - "added": remove what was added, keep deleted text deleted.
 */
export type RestoreMode = "both" | "deleted" | "added";

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
    out.push({ kind: "change", deleted, added });
  }
  return out;
}

/** Applies `mode` to the change from `oldText` to `newText`, returning the text to write. */
export function mergeChange(oldText: string, newText: string, mode: RestoreMode): string {
  if (mode === "both") return oldText;
  if (oldText === "" || newText === "") return mode === "deleted" ? oldText + newText : "";
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
  // Removing a pure addition removes its lines (not "replace them with one empty line").
  const leftLines = merged === "" && chunk.leftLines.length === 0 ? [] : splitLines(merged);
  return { ...chunk, id: `${chunk.id}:${mode}`, leftLines };
}

const FIXED_ONLY = /[\uf000-\uf7ff]/g;

/**
 * Word-level merge of one changed block. Line prefixes (list markers, checkboxes, headings) are never removed
 * or duplicated: today's stay. Removing text never joins two words or leaves a double/trailing space.
 */
function mergeWords(oldText: string, newText: string, mode: "deleted" | "added"): string {
  const { protect, restore } = markdownProtector();
  let out = "";
  /** After dropping text: what separates the words around the gap, if they would otherwise touch. */
  let sep: string | null = null;
  for (const region of wordRegions(protect(oldText), protect(newText))) {
    if (region.kind === "same") {
      let t = region.text;
      if (sep !== null) {
        if (out === "" || /[\n\uf000-\uf7ff]$/.test(out)) t = t.replace(/^[ \t]+/, "");
        else if (/[ \t]$/.test(out) && /^[ \t\n]/.test(t)) out = out.replace(/[ \t]+$/, "");
        else if (/\S$/.test(out) && /^\S/.test(t)) out += sep;
        sep = null;
      }
      out += t;
      continue;
    }
    const deleted = region.deleted.replace(FIXED_ONLY, "");
    const added = region.added;
    const lead = /^[\uf000-\uf7ff]*/.exec(added)![0];
    if (mode === "deleted") {
      const rest = added.slice(lead.length);
      if (!deleted.trim() && !rest.trim()) out += lead + (deleted || rest);
      else if (/\s$/.test(deleted)) out += lead + deleted + rest.replace(/^[ \t]+/, "");
      else out += lead + deleted + (deleted.trim() && /^\S/.test(rest) ? " " : "") + rest;
    } else {
      const dropped = added.replace(FIXED_ONLY, "");
      out += (added.match(FIXED_ONLY) ?? []).join("");
      if (dropped || deleted) sep = deleted && !deleted.trim() ? deleted : " ";
    }
  }
  if (sep !== null) out = out.replace(/[ \t]+$/, "");
  return restore(out);
}
