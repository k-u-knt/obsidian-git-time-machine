import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitRunner } from "../../src/git/GitRunner";
import { HistoryService } from "../../src/history/HistoryService";
import { LruCache } from "../../src/history/LruCache";
import { parseFileLog } from "../../src/history/parseFileLog";
import { makeRepo, type TempRepo } from "../helpers/tempRepo";

describe("parseFileLog", () => {
  it("parses plain and rename entries", () => {
    const out =
      "\x1eaaa\x1f1700000300\0\n1\t0\tB/new.md\0" +
      "\x1ebbb\x1f1700000200\0\n0\t0\t\0A/old.md\0B/new.md\0" +
      "\x1eccc\x1f1700000100\0\n3\t-\tA/old.md\0";
    expect(parseFileLog(out, "B/new.md")).toEqual([
      { hash: "aaa", time: new Date(1700000300 * 1000), path: "B/new.md", added: 1, removed: 0 },
      { hash: "bbb", time: new Date(1700000200 * 1000), path: "B/new.md", fromPath: "A/old.md", added: 0, removed: 0 },
      { hash: "ccc", time: new Date(1700000100 * 1000), path: "A/old.md", added: 3, removed: 0 },
    ]);
  });

  it("returns nothing for empty output", () => {
    expect(parseFileLog("", "x.md")).toEqual([]);
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
