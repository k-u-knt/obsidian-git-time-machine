/**
 * Shared rules for working with Markdown word by word without breaking it (used by highlighting and by
 * partial restore). Some constructs are swapped for single placeholder characters before diffing:
 * - ATOMIC (kept whole, may change as a unit): links, embeds, footnote refs, inline code, math, HTML tags,
 *   #tags, and **bold** / __bold__ / ~~strike~~ / ==highlight== runs;
 * - FIXED (never wrapped or removed): a line's prefix (quote, heading, list marker, checkbox, callout) and a
 *   trailing block id.
 */
export const ATOMIC =
  /!?\[\[[^\]\n]*\]\]|!?\[[^\]\n]*\]\([^)\n]*\)|\[\^[^\]\n]*\]|`[^`\n]+`|\$[^$\n]+\$|<[^>\n]+>|(?<![\w#])#[A-Za-z][\w/-]*|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|==[^=\n]+==/g;
export const LINE_PREFIX = /^(?:[ \t]*(?:>[ \t]?|#{1,6}[ \t]+|[-*+][ \t]+(?:\[.\][ \t]+)?|\d+[.)][ \t]+(?:\[.\][ \t]+)?|\[![^\]\n]*\][+-]?[ \t]*))+/;
export const BLOCK_ID = /[ \t]\^[A-Za-z0-9-]+[ \t]*$/;
export const ATOMIC_BASE = 0xe000;
export const FIXED_BASE = 0xf000;
/** Matches one FIXED placeholder character. */
export const FIXED = /[\uf000-\uf7ff]/g;

export function markdownProtector(): { protect(s: string): string; restore(s: string): string } {
  const atomic: string[] = [];
  const fixed: string[] = [];
  const token = (list: string[], base: number, m: string) => {
    let i = list.indexOf(m);
    if (i === -1) i = list.push(m) - 1;
    return String.fromCharCode(base + i);
  };
  return {
    protect: (s) =>
      s
        .split("\n")
        .map((line) => {
          const prefix = LINE_PREFIX.exec(line)?.[0] ?? "";
          let body = line.slice(prefix.length);
          const id = BLOCK_ID.exec(body)?.[0] ?? "";
          body = body.slice(0, body.length - id.length).replace(ATOMIC, (m) => token(atomic, ATOMIC_BASE, m));
          return (prefix ? token(fixed, FIXED_BASE, prefix) : "") + body + (id ? token(fixed, FIXED_BASE, id) : "");
        })
        .join("\n"),
    restore: (s) =>
      s
        .replace(/[\ue000-\uefff]/g, (c) => atomic[c.charCodeAt(0) - ATOMIC_BASE] ?? c)
        .replace(/[\uf000-\uf7ff]/g, (c) => fixed[c.charCodeAt(0) - FIXED_BASE] ?? c),
  };
}
