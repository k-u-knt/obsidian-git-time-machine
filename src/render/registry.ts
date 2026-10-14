export type FileKind = "markdown" | "text" | "unsupported";

/** Plain-text formats compared in Source mode only. */
const TEXT_EXTENSIONS = new Set([
  "txt", "json", "js", "mjs", "cjs", "ts", "css", "scss", "html", "htm", "xml",
  "csv", "tsv", "yaml", "yml", "toml", "ini", "py", "r", "sh", "tex", "bib",
]);

/** Canvas, Excalidraw and attachments arrive in later milestones. */
export function fileKind(path: string): FileKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".excalidraw.md")) return "unsupported";
  const dot = lower.lastIndexOf(".");
  if (dot === -1 || dot < lower.lastIndexOf("/")) return "unsupported";
  const ext = lower.slice(dot + 1);
  if (ext === "md") return "markdown";
  return TEXT_EXTENSIONS.has(ext) ? "text" : "unsupported";
}

/** Git's own heuristic: a NUL byte in the first 8000 bytes means binary. */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}
