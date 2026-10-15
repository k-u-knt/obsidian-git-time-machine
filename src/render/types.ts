/** One way of drawing a comparison inside the Time Machine tab. */
export interface CompareRenderer {
  render(host: HTMLElement): Promise<void>;
  /** Scrolls change number `index` (as listed in "Changes in this version") into view. */
  scrollToChange(index: number): void;
  destroy(): void;
}
