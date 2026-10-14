import { execFile } from "child_process";

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "GitError";
  }

  get isLockError(): boolean {
    return /\.lock\b|could not lock|unable to create .*lock/i.test(this.stderr);
  }
}

/**
 * Global options on every call: raw UTF-8 paths, file names never treated as glob patterns ("Note [1].md",
 * "Why?.md"), and never take optional locks (Obsidian Git may be committing).
 */
const BASE_ARGS = ["-c", "core.quotepath=off", "--literal-pathspecs", "--no-optional-locks"];
const MAX_BUFFER = 256 * 1024 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GitRunner {
  constructor(
    readonly gitPath: string,
    readonly cwd: string,
    private readonly retryDelayMs = 1000,
  ) {}

  async text(args: string[]): Promise<string> {
    return (await this.buffer(args)).toString("utf8");
  }

  /** Runs git; retries once after `retryDelayMs` when another git process holds a lock. */
  async buffer(args: string[]): Promise<Buffer> {
    try {
      return await this.once(args);
    } catch (e) {
      if (e instanceof GitError && e.isLockError) {
        await sleep(this.retryDelayMs);
        return this.once(args);
      }
      throw e;
    }
  }

  private once(args: string[]): Promise<Buffer> {
    const full = [...BASE_ARGS, ...args];
    return new Promise((resolve, reject) => {
      execFile(
        this.gitPath,
        full,
        {
          cwd: this.cwd,
          encoding: "buffer",
          maxBuffer: MAX_BUFFER,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
        },
        (err, stdout, stderr) => {
          if (err) {
            const code = (err as { code?: unknown }).code;
            reject(
              new GitError(
                `git ${args.join(" ")} failed: ${stderr.toString("utf8").trim() || err.message}`,
                args,
                stderr.toString("utf8"),
                typeof code === "number" ? code : null,
              ),
            );
          } else resolve(stdout);
        },
      );
    });
  }
}
