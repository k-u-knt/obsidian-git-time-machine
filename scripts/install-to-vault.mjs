import { copyFile, mkdir, readFile, stat } from "fs/promises";
import path from "path";
import process from "process";

/** The vault: the first argument, else $OBSIDIAN_VAULT, else the path in `.vault-path` (not committed). */
async function vaultPath() {
  if (process.argv[2]) return process.argv[2];
  if (process.env.OBSIDIAN_VAULT) return process.env.OBSIDIAN_VAULT;
  try {
    return (await readFile(".vault-path", "utf8")).trim();
  } catch {
    console.error("Which vault? Pass its folder as an argument, set OBSIDIAN_VAULT, or put the path in .vault-path.");
    process.exit(1);
  }
}

const vault = await vaultPath();
const configDir = path.join(vault, ".obsidian");
try {
  await stat(configDir);
} catch {
  console.error(`Not an Obsidian vault (no .obsidian folder): ${vault}`);
  process.exit(1);
}
const dest = path.join(configDir, "plugins", "git-time-machine");
await mkdir(dest, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) await copyFile(f, path.join(dest, f));
console.log(`Installed Git Time Machine into ${dest}`);
console.log('In Obsidian: Settings → Community plugins → reload the list → enable "Git Time Machine".');
