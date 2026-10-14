import esbuild from "esbuild";
import { copyFile, mkdir } from "fs/promises";
import { builtinModules } from "module";
import path from "path";
import process from "process";

const prod = process.argv[2] === "production";
const testVault = process.env.GTM_TEST_VAULT;

/** In watch mode, copy each successful build into the test vault's plugin folder. */
const copyToTestVault = {
  name: "copy-to-test-vault",
  setup(build) {
    build.onEnd(async (result) => {
      if (prod || !testVault || result.errors.length) return;
      const dest = path.join(testVault, ".obsidian", "plugins", "git-time-machine");
      await mkdir(dest, { recursive: true });
      for (const f of ["main.js", "manifest.json", "styles.css"]) await copyFile(f, path.join(dest, f));
      console.log(`[gtm] copied build to ${dest}`);
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
  plugins: [copyToTestVault],
});

if (prod) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
