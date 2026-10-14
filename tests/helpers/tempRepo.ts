import { execFileSync } from "child_process";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

export interface TempRepo {
  dir: string;
  git(...args: string[]): string;
  write(rel: string, content: string): Promise<void>;
  /** Commits everything with a fixed timestamp (seconds since epoch) and returns the hash. */
  commit(message: string, epochSeconds: number): string;
  cleanup(): Promise<void>;
}

export async function makeTempDir(prefix = "gtm-"): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function makeRepo(dir?: string): Promise<TempRepo> {
  const root = dir ?? (await makeTempDir());
  await mkdir(root, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  return {
    dir: root,
    git,
    async write(rel, content) {
      await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await writeFile(path.join(root, rel), content);
    },
    commit(message, epochSeconds) {
      git("add", "-A");
      execFileSync("git", ["commit", "-q", "--allow-empty", "-m", message], {
        cwd: root,
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_AUTHOR_DATE: `${epochSeconds} +0000`,
          GIT_COMMITTER_DATE: `${epochSeconds} +0000`,
        },
      });
      return git("rev-parse", "HEAD").trim();
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
