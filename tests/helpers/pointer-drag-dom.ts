/**
 * jsdom helpers for the pointer-drag render tests (stickies, quick links, Home
 * widgets; decision 105). jsdom does no layout, so `stubRects` answers
 * `getBoundingClientRect` from a table keyed by element id or class, and
 * `drag` plays a pointer press, moves and release through window listeners the
 * way `usePointerDrag` expects.
 */
import { act } from "react";

export type Box = { left: number; top: number; width: number; height: number };

export function box(left: number, top: number, width: number, height: number): Box {
  return { left, top, width, height };
}

function domRect(b: Box): DOMRect {
  return { x: b.left, y: b.top, left: b.left, top: b.top, width: b.width, height: b.height, right: b.left + b.width, bottom: b.top + b.height, toJSON: () => ({}) } as DOMRect;
}

/**
 * Rects by element id, or by a class name prefixed with a dot
 * (".tessera-sticky-grid"), or from a function of the element; anything else is
 * empty.
 */
export function stubRects(table: Record<string, Box> | ((el: Element) => Box | null)): () => void {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element) {
    if (typeof table === "function") return domRect(table(this) ?? box(0, 0, 0, 0));
    const byId = table[this.id];
    if (byId) return domRect(byId);
    for (const cls of Array.from(this.classList)) {
      const byClass = table[`.${cls}`];
      if (byClass) return domRect(byClass);
    }
    return domRect(box(0, 0, 0, 0));
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

function pointerEvent(type: string, x: number, y: number, target: EventTarget): void {
  const init = { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, pointerId: 1 };
  const event = typeof PointerEvent === "function" ? new PointerEvent(type, init) : new MouseEvent(type, init);
  if (!("pointerId" in event)) Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}

/** Press on `from`, move through `path` (each point past the threshold), release at the last point. */
export async function drag(from: Element, start: { x: number; y: number }, path: { x: number; y: number }[], options: { release?: boolean } = {}): Promise<void> {
  await act(async () => {
    pointerEvent("pointerdown", start.x, start.y, from);
  });
  for (const point of path) {
    await act(async () => {
      pointerEvent("pointermove", point.x, point.y, window);
    });
  }
  if (options.release === false) return;
  const last = path[path.length - 1] ?? start;
  await act(async () => {
    pointerEvent("pointerup", last.x, last.y, window);
  });
}

export async function pressKey(target: Element, key: string): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}
