import type { Version } from "./types";

/** A full SHA-1 (40) or SHA-256 (64) commit id. Anything else is never passed to git as a revision. */
export const COMMIT_HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const HEADER = /^\n?\x1e([0-9a-f]{40}(?:[0-9a-f]{24})?)\x1f(\d+)$/;
const NUMSTAT = /^\n?(-|\d+)\t(-|\d+)\t([\s\S]*)$/;

/**
 * Parses `git log --follow --format=%x1e%H%x1f%at --numstat -z -- <path>`.
 * Output is a stream of NUL-terminated tokens. Each record: a header token "\x1e<hash>\x1f<epoch>", then numstat
 * entries "\n<added>\t<removed>\t<path>" or, for a rename, "<added>\t<removed>\t" followed by two path tokens
 * <old> and <new>. Binary files report "-" counts (treated as 0). Records without entries (merges) inherit the
 * newer record's path.
 *
 * The stream is walked token by token rather than split on \x1e / \x1f: git paths may contain those characters,
 * and a crafted path must never be read as a header (its "hash" would reach `git show` as an option).
 * Rename paths are consumed verbatim; only a token in header position is checked against HEADER.
 */
export function parseFileLog(out: string, fallbackPath: string): Version[] {
  const versions: Version[] = [];
  const tokens = out.split("\0");
  let lastPath = fallbackPath;
  let i = 0;
  while (i < tokens.length) {
    const head = HEADER.exec(tokens[i++]);
    if (!head) continue;
    let added = 0;
    let removed = 0;
    let filePath: string | null = null;
    let fromPath: string | undefined;
    while (i < tokens.length) {
      const m = NUMSTAT.exec(tokens[i]);
      if (!m) break;
      added += m[1] === "-" ? 0 : Number(m[1]);
      removed += m[2] === "-" ? 0 : Number(m[2]);
      if (m[3] === "") {
        fromPath = tokens[i + 1];
        filePath = tokens[i + 2] ?? filePath;
        i += 3;
      } else {
        filePath = m[3];
        i += 1;
      }
    }
    if (filePath) lastPath = filePath;
    const v: Version = { hash: head[1], time: new Date(Number(head[2]) * 1000), path: filePath ?? lastPath, added, removed };
    if (fromPath !== undefined && fromPath !== v.path) v.fromPath = fromPath;
    versions.push(v);
  }
  return versions;
}
