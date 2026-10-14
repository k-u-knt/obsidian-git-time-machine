import { Plugin } from "obsidian";

export default class GitTimeMachinePlugin extends Plugin {
  async onload(): Promise<void> {
    console.log("Git Time Machine loaded");
  }
}
