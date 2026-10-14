import type { Version } from "./types";

/**
 * Parses `git log --follow --format=%x1e%H%x1f%at --numstat -z -- <path>`.
 * Each record: "\x1e<hash>\x1f<epoch>\0\n" then numstat entries terminated by "\0":
 *   "<added>\t<removed>\t<path>\0"  or, for a rename, "<added>\t<removed>\t\0<old>\0<new>\0".
 * Binary files report "-" counts (treated as 0). Records without entries (merges) inherit the newer record's path.
 */
export function parseFileLog(out: string, fallbackPath: string): Version[] {
  const versions: Version[] = [];
  let lastPath = fallbackPath;
  for (const record of out.split("\x1e")) {
    if (!record.trim()) continue;
    const nul = record.indexOf("\0");
    const header = (nul === -1 ? record : record.slice(0, nul)).trim();
    const [hash, epoch] = header.split("\x1f");
    const tokens = nul === -1 ? [] : record.slice(nul + 1).split("\0").map((t) => t.replace(/^\n/, ""));
    let added = 0;
    let removed = 0;
    let filePath: string | null = null;
    let fromPath: string | undefined;
    for (let i = 0; i < tokens.length; i++) {
      const m = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(tokens[i]);
      if (!m) continue;
      added += m[1] === "-" ? 0 : Number(m[1]);
      removed += m[2] === "-" ? 0 : Number(m[2]);
      if (m[3] === "") {
        fromPath = tokens[i + 1];
        filePath = tokens[i + 2] ?? filePath;
        i += 2;
      } else filePath = m[3];
    }
    if (filePath) lastPath = filePath;
    const v: Version = { hash, time: new Date(Number(epoch) * 1000), path: filePath ?? lastPath, added, removed };
    if (fromPath !== undefined && fromPath !== v.path) v.fromPath = fromPath;
    versions.push(v);
  }
  return versions;
}
