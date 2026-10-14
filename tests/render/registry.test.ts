import { describe, expect, it } from "vitest";
import { fileKind, looksBinary } from "../../src/render/registry";

describe("fileKind", () => {
  it("classifies notes, text files and everything else", () => {
    expect(fileKind("🔬Notes/Lab sync.md")).toBe("markdown");
    expect(fileKind("Drawing 1.excalidraw.md")).toBe("unsupported");
    expect(fileKind("data/config.JSON")).toBe("text");
    expect(fileKind("Research map.canvas")).toBe("unsupported");
    expect(fileKind("img.png")).toBe("unsupported");
    expect(fileKind("folder.v2/README")).toBe("unsupported");
  });
});

describe("looksBinary", () => {
  it("detects NUL bytes", () => {
    expect(looksBinary(new Uint8Array([0x89, 0x50, 0x00, 0x47]))).toBe(true);
    expect(looksBinary(new TextEncoder().encode("plain 🔬 text"))).toBe(false);
  });
});
