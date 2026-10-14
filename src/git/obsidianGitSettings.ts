import type { ObsidianGitSettings } from "./locateRepo";

/** Reads the two fields we need from Obsidian Git's data.json. Returns null for invalid JSON. */
export function parseObsidianGitSettings(json: string): ObsidianGitSettings | null {
  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    const out: ObsidianGitSettings = {};
    if (typeof data.basePath === "string" && data.basePath.trim()) out.basePath = data.basePath.trim();
    if (typeof data.gitPath === "string" && data.gitPath.trim()) out.gitPath = data.gitPath.trim();
    return out;
  } catch {
    return null;
  }
}
