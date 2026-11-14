// Obsidian's own lint rules: the community plugin review runs the same plugin.
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  // Build output and Node build scripts are not plugin code.
  globalIgnores(["node_modules", "main.js", "esbuild.config.mjs", "version-bump.mjs", "CLAUDE-SECURITY-*"]),
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs", "vitest.config.ts", "scripts/*.mjs"],
        },
      },
    },
  },
]);
