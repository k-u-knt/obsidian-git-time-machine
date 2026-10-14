import { GitError } from "../git/GitRunner";
import type { LocateResult } from "../git/locateRepo";

export function describeLocateError(r: Extract<LocateResult, { ok: false }>): string {
  if (r.reason === "no-git") {
    return `Git Time Machine couldn't find the git program. Tried: ${r.tried.join(", ")}. Set its location in Settings → Git Time Machine.`;
  }
  return `No Git repository found at ${r.searched}. Git Time Machine reads the history that Obsidian Git creates: set up Obsidian Git, or set the repository path in Settings → Git Time Machine.`;
}

export function describeError(e: unknown): string {
  if (e instanceof GitError && e.isLockError) return "Git is busy — Obsidian Git may be committing right now.";
  return e instanceof Error ? e.message : String(e);
}
