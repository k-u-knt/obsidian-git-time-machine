import type { App, TFile } from "obsidian";
import { fileKind } from "../render/registry";
import { canvasTextTarget } from "./canvasTarget";
import { obsidianTextTarget } from "./obsidianTarget";
import type { TextTarget } from "./Restorer";

/** The right way to read and write a file, chosen by the file itself (not by what the tab shows now). */
export function textTargetFor(app: App, file: TFile): TextTarget {
  return fileKind(file.path) === "canvas" ? canvasTextTarget(app, file) : obsidianTextTarget(app, file);
}
