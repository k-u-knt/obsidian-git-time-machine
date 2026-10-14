import { realpath } from "fs/promises";
import path from "path";
import { GitRunner } from "./GitRunner";

export interface ObsidianGitSettings {
  basePath?: string;
  gitPath?: string;
}

export interface LocateInput {
  vaultBasePath: string;
  repoPathSetting: string;
  gitPathSetting: string;
  obsidianGit: ObsidianGitSettings | null;
  /** Defaults to DEFAULT_GIT_CANDIDATES; tests override it. */
  fallbackCandidates?: string[];
}

export type LocateResult =
  | { ok: true; git: GitRunner; repoRoot: string; paths: PathMapper }
  | { ok: false; reason: "no-git"; tried: string[] }
  | { ok: false; reason: "no-repo"; searched: string };

/** Obsidian started from the Dock does not get the shell PATH, so well-known locations are tried too. */
export const DEFAULT_GIT_CANDIDATES = ["git", "/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"];

/** Maps between vault-relative paths (Obsidian) and repo-relative paths (git). Both use "/". */
export class PathMapper {
  constructor(
    readonly vaultRoot: string,
    readonly repoRoot: string,
  ) {}

  toRepo(vaultPath: string): string | null {
    return inside(path.relative(this.repoRoot, path.join(this.vaultRoot, vaultPath)));
  }

  toVault(repoPath: string): string | null {
    return inside(path.relative(this.vaultRoot, path.join(this.repoRoot, repoPath)));
  }
}

function inside(rel: string): string | null {
  if (rel === "" || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

export async function findGit(candidates: string[]): Promise<string | null> {
  for (const c of candidates) {
    try {
      await new GitRunner(c, "/").text(["--version"]);
      return c;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export async function locateRepo(input: LocateInput): Promise<LocateResult> {
  const candidates = [
    ...new Set(
      [input.gitPathSetting, input.obsidianGit?.gitPath ?? "", ...(input.fallbackCandidates ?? DEFAULT_GIT_CANDIDATES)].filter(
        (c) => c.trim() !== "",
      ),
    ),
  ];
  const gitPath = await findGit(candidates);
  if (!gitPath) return { ok: false, reason: "no-git", tried: candidates };

  const vaultRoot = await realpath(input.vaultBasePath);
  const relStart = input.repoPathSetting.trim() || input.obsidianGit?.basePath?.trim() || "";
  const start = path.resolve(vaultRoot, relStart);
  let repoRoot: string;
  try {
    const top = await new GitRunner(gitPath, start).text(["rev-parse", "--show-toplevel"]);
    repoRoot = await realpath(top.trim());
  } catch {
    return { ok: false, reason: "no-repo", searched: start };
  }
  return { ok: true, git: new GitRunner(gitPath, repoRoot), repoRoot, paths: new PathMapper(vaultRoot, repoRoot) };
}
