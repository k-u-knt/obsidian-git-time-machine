import { describe, expect, it } from "vitest";
import { parseCanvas } from "../../src/diff/canvasDiff";
import { formatCanvas } from "../../src/restore/canvasWriter";
import { cardTextTarget } from "../../src/restore/cardTextTarget";
import { Restorer, StaleWriteError, type TextTarget } from "../../src/restore/Restorer";

const canvas = (text: string) =>
  formatCanvas({ nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 100, height: 50, text }, { id: "b", type: "text", x: 200, y: 0, width: 100, height: 50, text: "other" }], edges: [] });

function memCanvas(initial: string): TextTarget & { text: string } {
  const t = {
    path: "map.canvas",
    text: initial,
    async read() {
      return t.text;
    },
    async write(edit: { from: number; to: number; text: string }, before: string) {
      if (t.text !== before) throw new StaleWriteError();
      t.text = t.text.slice(0, edit.from) + edit.text + t.text.slice(edit.to);
    },
  };
  return t;
}

describe("cardTextTarget", () => {
  it("reads one card's text and writes only that card", async () => {
    const file = memCanvas(canvas("new words"));
    const card = cardTextTarget(file, "a");
    expect(card.path).toBe("map.canvas::card:a");
    expect(await card.read()).toBe("new words");
    await card.write({ from: 0, to: 3, text: "old" }, "new words");
    const data = parseCanvas(file.text);
    expect(data.nodes.map((n) => n.text)).toEqual(["old words", "other"]);
  });

  it("refuses to write when the card's text changed since", async () => {
    const file = memCanvas(canvas("edited elsewhere"));
    await expect(cardTextTarget(file, "a").write({ from: 0, to: 1, text: "x" }, "new words")).rejects.toBeInstanceOf(StaleWriteError);
  });

  it("works with the restorer, including undo", async () => {
    const file = memCanvas(canvas("new"));
    const card = cardTextTarget(file, "a");
    const r = new Restorer();
    expect(await r.restoreWhole(card, "old")).toBe("applied");
    expect(await card.read()).toBe("old");
    await r.undo(card, async () => true);
    expect(await card.read()).toBe("new");
  });
});
