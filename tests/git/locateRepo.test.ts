import { mkdir, rm, symlink } from "fs/promises";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { findGit, locateRepo } from "../../src/git/locateRepo";
import { parseObsidianGitSettings } from "../../src/git/obsidianGitSettings";
import { makeRepo, makeTempDir } from "../helpers/tempRepo";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const base = { repoPathSetting: "", gitPathSetting: "", obsidianGit: null, fallbackCandidates: ["git"] };

describe("findGit", () => {
  it("skips candidates that do not run", async () => {
    expect(await findGit(["/nonexistent/git", "git"])).toBe("git");
    expect(await findGit(["/nonexistent/git"])).toBeNull();
  });
});

describe("locateRepo", () => {
  it("uses the vault folder when it is the repo, and maps emoji paths", async () => {
    const repo = await makeRepo();
    cleanups.push(repo.cleanup);
    const res = await locateRepo({ ...base, vaultBasePath: repo.dir });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.paths.toRepo("🔬Notes/a b.md")).toBe("🔬Notes/a b.md");
    expect(res.paths.toVault("🔬Notes/a b.md")).toBe("🔬Notes/a b.md");
  });

  it("works when the vault path is a symlink to the repo", async () => {
    const repo = await makeRepo();
    cleanups.push(repo.cleanup);
    const linkParent = await makeTempDir();
    cleanups.push(() => rm(linkParent, { recursive: true, force: true }));
    const link = path.join(linkParent, "vault-link");
    await symlink(repo.dir, link);
    const res = await locateRepo({ ...base, vaultBasePath: link });
    expect(res.ok && res.paths.toRepo("n.md")).toBe("n.md");
  });

  it("handles a vault inside a larger repo", async () => {
    const repo = await makeRepo();
    cleanups.push(repo.cleanup);
    const vault = path.join(repo.dir, "sub", "vault");
    await mkdir(vault, { recursive: true });
    const res = await locateRepo({ ...base, vaultBasePath: vault });
    expect(res.ok && res.paths.toRepo("n.md")).toBe("sub/vault/n.md");
    expect(res.ok && res.paths.toVault("other/x.md")).toBeNull();
  });

  it("follows Obsidian Git's basePath for a repo inside the vault", async () => {
    const vault = await makeTempDir();
    cleanups.push(() => rm(vault, { recursive: true, force: true }));
    await makeRepo(path.join(vault, "notes"));
    const res = await locateRepo({ ...base, vaultBasePath: vault, obsidianGit: { basePath: "notes" } });
    expect(res.ok && res.paths.toRepo("notes/n.md")).toBe("n.md");
    expect(res.ok && res.paths.toRepo("elsewhere.md")).toBeNull();
  });

  it("reports no-repo and no-git", async () => {
    const dir = await makeTempDir();
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    expect(await locateRepo({ ...base, vaultBasePath: dir })).toMatchObject({ ok: false, reason: "no-repo" });
    expect(await locateRepo({ ...base, vaultBasePath: dir, fallbackCandidates: ["/nonexistent/git"] })).toMatchObject({
      ok: false,
      reason: "no-git",
      tried: ["/nonexistent/git"],
    });
  });
});

describe("parseObsidianGitSettings", () => {
  it("picks basePath and gitPath and ignores blanks", () => {
    expect(parseObsidianGitSettings('{"basePath":"","gitPath":"/opt/homebrew/bin/git","x":1}')).toEqual({ gitPath: "/opt/homebrew/bin/git" });
    expect(parseObsidianGitSettings("not json")).toBeNull();
  });
});
