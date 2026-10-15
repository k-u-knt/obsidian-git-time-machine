/**
 * Minimal stand-ins for the DOM helpers Obsidian adds to Node/Element (createDiv, empty, toggleClass…),
 * so renderer code can run in vitest's jsdom environment. Only what the plugin uses.
 */
type Info = string | { cls?: string | string[]; text?: string; attr?: Record<string, string | number | boolean | null> } | undefined;

export function installObsidianDom(): void {
  const proto = Node.prototype as unknown as Record<string, unknown>;
  if (proto.createDiv) return;
  // Like Obsidian: createEl/createDiv split a class string on spaces, but createSvg adds each string as ONE
  // token, so `cls: "a b"` throws for SVG (classList.add rejects spaces). Pass an array for several SVG classes.
  const apply = <T extends Element>(el: T, o: Info, splitClasses = true): T => {
    const info = typeof o === "string" ? { cls: o } : o;
    if (!info) return el;
    if (info.cls) {
      const list = ([] as string[]).concat(info.cls);
      for (const c of splitClasses ? list.join(" ").split(" ").filter(Boolean) : list) el.classList.add(c);
    }
    if (info.text !== undefined) el.textContent = info.text;
    if (info.attr) for (const [k, v] of Object.entries(info.attr)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
    return el;
  };
  Object.assign(Node.prototype, {
    createEl(this: Node, tag: string, o?: Info, cb?: (el: Element) => void) {
      const el = apply(document.createElement(tag), o);
      this.appendChild(el);
      cb?.(el);
      return el;
    },
    createDiv(this: Node & { createEl: Function }, o?: Info, cb?: (el: Element) => void) {
      return this.createEl("div", o, cb);
    },
    createSpan(this: Node & { createEl: Function }, o?: Info, cb?: (el: Element) => void) {
      return this.createEl("span", o, cb);
    },
    createSvg(this: Node, tag: string, o?: Info, cb?: (el: Element) => void) {
      const el = apply(document.createElementNS("http://www.w3.org/2000/svg", tag), o, false);
      this.appendChild(el);
      cb?.(el);
      return el;
    },
    empty(this: Node) {
      while (this.firstChild) this.removeChild(this.firstChild);
    },
    setText(this: Node, t: string) {
      this.textContent = t;
    },
    appendText(this: Node, t: string) {
      this.appendChild(document.createTextNode(t));
    },
  });
  Object.assign(Element.prototype, {
    addClass(this: Element, ...c: string[]) {
      this.classList.add(...c);
    },
    removeClass(this: Element, ...c: string[]) {
      this.classList.remove(...c);
    },
    toggleClass(this: Element, c: string, v: boolean) {
      this.classList.toggle(c, v);
    },
    hasClass(this: Element, c: string) {
      return this.classList.contains(c);
    },
    setAttr(this: Element, k: string, v: string | number | boolean | null) {
      if (v === null) this.removeAttribute(k);
      else this.setAttribute(k, String(v));
    },
  });
  // Obsidian's global createDiv: a detached element.
  (globalThis as unknown as { createDiv: Function }).createDiv = (o?: Info) => apply(document.createElement("div"), o);
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function () {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {};
}
