import { copyFile, mkdir, stat } from "fs/promises";
import path from "path";
import process from "process";

const REAL_VAULT = process.env.OBSIDIAN_VAULT;
const vault = process.argv[2] ?? REAL_VAULT;
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
