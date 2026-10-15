import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { obsidian: path.resolve(__dirname, "tests/helpers/obsidianStub.ts") } },
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 20000, passWithNoTests: true },
});
