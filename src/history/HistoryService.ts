import { GitError, type GitRunner } from "../git/GitRunner";
import { LruCache } from "./LruCache";
import { parseFileLog } from "./parseFileLog";
import type { Version } from "./types";

const NO_COMMITS = /does not have any commits|unknown revision|bad revision|bad default revision|ambiguous argument/i;

export class HistoryService {
  private contents = new LruCache<string, Buffer>(50 * 1024 * 1024, (b) => b.length);

  constructor(private readonly git: GitRunner) {}

  /**
   * Versions of one file, newest first, following renames. Empty when the file was never committed.
   * Paging: pass the oldest version already loaded as `before`; the next page starts at its parent,
   * using its pre-rename path. (`--skip` cannot be used: it breaks `--follow` across renames.)
   */
  async fileHistory(repoPath: string, opts: { limit: number; before?: Version }): Promise<Version[]> {
    const start = opts.before ? [`${opts.before.hash}^`] : [];
    const pathspec = opts.before ? (opts.before.fromPath ?? opts.before.path) : repoPath;
    try {
      const out = await this.git.text([
        "log",
        "--follow",
        "-M",
        "--diff-merges=first-parent",
        "--format=%x1e%H%x1f%at",
        "--numstat",
        "-z",
        `-n${opts.limit}`,
        ...start,
        "--",
        pathspec,
      ]);
      return parseFileLog(out, pathspec);
    } catch (e) {
      if (e instanceof GitError && NO_COMMITS.test(e.stderr)) return [];
      throw e;
    }
  }

  /** File bytes at a commit. `repoPath` must be the path at that commit (Version.path). Cached: commits never change. */
  async readAt(hash: string, repoPath: string): Promise<Buffer> {
    const key = `${hash}:${repoPath}`;
    const hit = this.contents.get(key);
    if (hit) return hit;
    const buf = await this.git.buffer(["show", `${hash}:${repoPath}`]);
    this.contents.set(key, buf);
    return buf;
  }

  /** Current HEAD commit, or null in a repo without commits. */
  async headHash(): Promise<string | null> {
    try {
      return (await this.git.text(["rev-parse", "HEAD"])).trim();
    } catch (e) {
      if (e instanceof GitError) return null;
      throw e;
    }
  }
}
