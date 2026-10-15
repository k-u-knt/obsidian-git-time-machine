// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "../helpers/obsidianDom";

vi.mock("obsidian", () => ({
  Component: class {
    addChild<T>(c: T) {
      return c;
    }
    removeChild() {}
  },
  MarkdownRenderer: {
    render: async (_a: unknown, md: string, el: HTMLElement) => {
      el.innerHTML = md;
    },
  },
  setIcon: () => {},
}));
const { diffText } = await import("../../src/diff/textDiff");
const { MarkdownCompare } = await import("../../src/render/MarkdownCompare");

beforeAll(() => installObsidianDom());

async function draw(left: string, right: string) {
  const calls: Array<[string, string]> = [];
  const host = document.body.createDiv();
  const mc = new MarkdownCompare({
    app: {} as never,
    parent: { addChild: (c: unknown) => c, removeChild: () => {} } as never,
    sourcePath: "n.md",
    diff: diffText(left, right),
    layout: "split",
    leftLabel: "Then",
    onRestore: (chunk, mode) => void calls.push([chunk.id, mode]),
  });
  await mc.render(host);
  const labels = () => [...host.querySelectorAll(".gtm-restore")].map((b) => b.getAttribute("aria-label"));
  return { host, calls, labels };
}

describe("MarkdownCompare restore choices", () => {
  it("offers Restore, Bring back deleted and Remove added for an edited block", async () => {
    const { host, calls, labels } = await draw("intro\n\nreview from last week\n", "intro\n\nreview and QC metrics\n");
    expect(labels()).toEqual(["Restore this block", "Bring back the deleted text", "Remove the added text"]);
    (host.querySelectorAll<HTMLButtonElement>(".gtm-restore")[1]).click();
    expect(calls.map(([, mode]) => mode)).toEqual(["deleted"]);
  });

  it("offers only what applies to a pure addition or deletion", async () => {
    expect((await draw("a\n", "a\n\nnew block\n")).labels()).toEqual(["Remove the added text"]);
    expect((await draw("a\n\nold block\n", "a\n")).labels()).toEqual(["Bring back the deleted text"]);
  });
});
