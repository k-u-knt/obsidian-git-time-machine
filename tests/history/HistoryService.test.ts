import { existsSync } from "fs";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitRunner } from "../../src/git/GitRunner";
import { HistoryService } from "../../src/history/HistoryService";
import { LruCache } from "../../src/history/LruCache";
import { parseFileLog } from "../../src/history/parseFileLog";
import { makeRepo, type TempRepo } from "../helpers/tempRepo";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

describe("parseFileLog", () => {
  it("parses plain and rename entries", () => {
    const out =
      `\x1e${A}\x1f1700000300\0\n1\t0\tB/new.md\0` +
      `\x1e${B}\x1f1700000200\0\n0\t0\t\0A/old.md\0B/new.md\0` +
      `\x1e${C}\x1f1700000100\0\n3\t-\tA/old.md\0`;
    expect(parseFileLog(out, "B/new.md")).toEqual([
      { hash: A, time: new Date(1700000300 * 1000), path: "B/new.md", added: 1, removed: 0 },
      { hash: B, time: new Date(1700000200 * 1000), path: "B/new.md", fromPath: "A/old.md", added: 0, removed: 0 },
      { hash: C, time: new Date(1700000100 * 1000), path: "A/old.md", added: 3, removed: 0 },
    ]);
  });

  it("accepts SHA-256 hashes", () => {
    const h = "d".repeat(64);
    expect(parseFileLog(`\x1e${h}\x1f1700000300\0\n1\t0\tn.md\0`, "n.md").map((v) => v.hash)).toEqual([h]);
  });

  it("drops a record forged by a path containing the record and field separators", () => {
    // A rename in history to a path holding "\x1e--output=../../x\x1f1" splits into a fake record whose
    // "hash" is a git option. It must never reach `git show`.
    const out =
      `\x1e${A}\x1f1700000300\0\n0\t0\t\0old.md\0evil\x1e--output=../../x\x1f1700000000\0` +
      `\x1e${B}\x1f1700000200\0\n1\t0\told.md\0`;
    const versions = parseFileLog(out, "old.md");
    expect(versions.map((v) => v.hash)).toEqual([A, B]);
  });

  it("drops a record whose time is not a number", () => {
    expect(parseFileLog(`\x1e${A}\x1fnot-a-time\0\n1\t0\tn.md\0`, "n.md")).toEqual([]);
  });

  it("returns nothing for empty output", () => {
    expect(parseFileLog("", "x.md")).toEqual([]);
  });
});

/** Records git arguments instead of running git. */
class RecordingGit {
  calls: string[][] = [];
  async text(args: string[]): Promise<string> {
    this.calls.push(args);
    return "";
  }
  async buffer(args: string[]): Promise<Buffer> {
    this.calls.push(args);
    return Buffer.from("");
  }
}

describe("HistoryService git arguments", () => {
  const make = () => {
    const git = new RecordingGit();
    return { git, h: new HistoryService(git as unknown as GitRunner) };
  };
  const version = (hash: string) => ({ hash, time: new Date(0), path: "n.md", added: 0, removed: 0 });

  it("ends option parsing before the revision in readAt", async () => {
    const { git, h } = make();
    await h.readAt(A, "n.md");
    expect(git.calls[0]).toEqual(["show", "--end-of-options", `${A}:n.md`]);
  });

  it("refuses a hash that is not a commit id in readAt", async () => {
    const { git, h } = make();
    await expect(h.readAt("--output=../../x", "n.md")).rejects.toThrow(/invalid commit/i);
    expect(git.calls).toEqual([]);
  });

  it("ends option parsing before the paging revision in fileHistory", async () => {
    const { git, h } = make();
    await h.fileHistory("n.md", { limit: 5, before: version(A) });
    const args = git.calls[0];
    const eoo = args.indexOf("--end-of-options");
    expect(eoo).toBeGreaterThan(-1);
    expect(args[eoo + 1]).toBe(`${A}^`);
    expect(args[0]).toBe("log");
    expect(args.slice(1, eoo).every((a) => a.startsWith("-"))).toBe(true);
  });

  it("refuses a paging hash that is not a commit id", async () => {
    const { git, h } = make();
    await expect(h.fileHistory("n.md", { limit: 5, before: version("--output=x") })).rejects.toThrow(/invalid commit/i);
    expect(git.calls).toEqual([]);
  });
});

describe("LruCache", () => {
  it("evicts the least recently used entry", () => {
    const c = new LruCache<string, string>(4, (v) => v.length);
    c.set("a", "aa");
    c.set("b", "bb");
    c.get("a");
    c.set("c", "cc");
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe("aa");
  });
});

describe("HistoryService (real git)", () => {
  let repo: TempRepo;
  let history: HistoryService;
  const hashes: string[] = [];

  beforeAll(async () => {
    repo = await makeRepo();
    await repo.write("🔬Notes/a b.md", "a\nb\nc\n");
    hashes.push(repo.commit("one", 1700000100));
    await repo.write("🔬Notes/a b.md", "a\nB\nc\nd\n");
    hashes.push(repo.commit("two", 1700000200));
    repo.git("mv", "🔬Notes/a b.md", "🔬Notes/renamed note.md");
    hashes.push(repo.commit("three", 1700000300));
    await repo.write("🔬Notes/renamed note.md", "a\nB\nc\nd\ne\n");
    hashes.push(repo.commit("four", 1700000400));
    await repo.write("untracked.md", "new\n");
    history = new HistoryService(new GitRunner("git", repo.dir));
  });
  afterAll(() => repo.cleanup());

  it("follows the file across a rename, newest first, with paths and stats", async () => {
    const v = await history.fileHistory("🔬Notes/renamed note.md", { limit: 50 });
    expect(v.map((x) => x.hash)).toEqual([...hashes].reverse());
    expect(v.map((x) => x.path)).toEqual([
      "🔬Notes/renamed note.md",
      "🔬Notes/renamed note.md",
      "🔬Notes/a b.md",
      "🔬Notes/a b.md",
    ]);
    expect(v.map((x) => [x.added, x.removed])).toEqual([[1, 0], [0, 0], [2, 1], [3, 0]]);
    expect(v[3].time).toEqual(new Date(1700000100 * 1000));
  });

  it("pages one version at a time across the rename", async () => {
    const pages = [];
    let page = await history.fileHistory("🔬Notes/renamed note.md", { limit: 1 });
    while (page.length) {
      pages.push(...page);
      page = await history.fileHistory("🔬Notes/renamed note.md", { limit: 1, before: pages[pages.length - 1] });
    }
    expect(pages.map((x) => x.hash)).toEqual([...hashes].reverse());
    expect(pages.map((x) => x.path)).toEqual(["🔬Notes/renamed note.md", "🔬Notes/renamed note.md", "🔬Notes/a b.md", "🔬Notes/a b.md"]);
  });

  it("reads a file at an old commit using the old path", async () => {
    const v = await history.fileHistory("🔬Notes/renamed note.md", { limit: 50 });
    expect((await history.readAt(v[2].hash, v[2].path)).toString("utf8")).toBe("a\nB\nc\nd\n");
  });

  it("returns no versions for an untracked file", async () => {
    expect(await history.fileHistory("untracked.md", { limit: 50 })).toEqual([]);
  });

  it("reports HEAD", async () => {
    expect(await history.headHash()).toBe(hashes[3]);
  });

  it("leaves out commits that deleted the file, so every version can be read", async () => {
    const r = await makeRepo();
    try {
      await r.write("n.md", "v1\n");
      r.commit("create", 1700000100);
      r.git("rm", "-q", "n.md");
      r.commit("delete", 1700000200);
      await r.write("n.md", "v2\n");
      r.commit("recreate", 1700000300);
      const h = new HistoryService(new GitRunner("git", r.dir));
      const versions = await h.fileHistory("n.md", { limit: 50 });
      expect(versions).toHaveLength(2);
      const texts = await Promise.all(versions.map(async (v) => (await h.readAt(v.hash, v.path)).toString("utf8")));
      expect(texts).toEqual(["v2\n", "v1\n"]);
    } finally {
      await r.cleanup();
    }
  });

  it("treats brackets, ? and * in file names literally", async () => {
    const r = await makeRepo();
    try {
      await r.write("Note [1].md", "mine\n");
      await r.write("Note 1.md", "other\n");
      r.commit("both", 1700000100);
      await r.write("Note 1.md", "other changed\n");
      r.commit("other only", 1700000200);
      await r.write("Why?.md", "q\n");
      r.commit("question", 1700000300);
      const h = new HistoryService(new GitRunner("git", r.dir));
      expect((await h.fileHistory("Note [1].md", { limit: 50 })).map((v) => v.path)).toEqual(["Note [1].md"]);
      expect((await h.fileHistory("Why?.md", { limit: 50 })).map((v) => v.path)).toEqual(["Why?.md"]);
    } finally {
      await r.cleanup();
    }
  });

  it("is not fooled by a renamed path holding the log's separators", async () => {
    const r = await makeRepo();
    const evil = "e\x1e--output=pwned\x1f1.md";
    try {
      await r.write("n.md", "v1\n");
      r.commit("create", 1700000100);
      await r.write("n.md", "v2\n");
      r.commit("edit", 1700000200);
      r.git("mv", "n.md", evil);
      r.commit("rename", 1700000300);
      const h = new HistoryService(new GitRunner("git", r.dir));
      const versions = await h.fileHistory(evil, { limit: 50 });
      expect(versions.map((v) => v.path)).toEqual([evil, "n.md", "n.md"]);
      expect(versions[0].fromPath).toBe("n.md");
      const texts = await Promise.all(versions.map(async (v) => (await h.readAt(v.hash, v.path)).toString("utf8")));
      expect(texts).toEqual(["v2\n", "v2\n", "v1\n"]);
      expect(existsSync(join(r.dir, "pwned"))).toBe(false);
    } finally {
      await r.cleanup();
    }
  });

  it("handles a repo with no commits", async () => {
    const empty = await makeRepo();
    try {
      const h = new HistoryService(new GitRunner("git", empty.dir));
      expect(await h.headHash()).toBeNull();
      expect(await h.fileHistory("x.md", { limit: 50 })).toEqual([]);
    } finally {
      await empty.cleanup();
    }
  });
});
