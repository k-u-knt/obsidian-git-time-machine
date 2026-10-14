import type { Chunk } from "../diff/textDiff";

/** One way of drawing a comparison inside the Time Machine tab. */
export interface CompareRenderer {
  render(host: HTMLElement): Promise<void>;
  /** Scrolls the given diff chunk (from diffText) into view. */
  scrollToChunk(chunk: Chunk): void;
  destroy(): void;
}
