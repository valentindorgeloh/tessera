"use client";

/**
 * Keyboard focus follows a work item whose row or card moves (docs/contracts/ui.md "Work items screen"). A State
 * picked in a list or table grouped by state, or "Move to" in a board card's menu, moves the item to another group:
 * React unmounts its row there and mounts a new one, and a server refresh can move a row in the DOM, which drops the
 * focus too. The focus fell to `<body>` and a keyboard user had to tab in again from the top.
 *
 * The screen remembers which control of which item holds the focus inside its scroller: the item from the
 * `data-item-id` of the row or card around it, the control from `armKeyOf` (a resting chip or an armed control's
 * trigger, ./properties/arming.tsx) or from a `data-focus-key` mark ("open" for the row's key button, "menu" for a
 * card's menu slot); anything else in a row counts as its open control. After a commit of the screen that left that
 * element out of the document while nothing else took the focus, the focus goes to the same control of the item's
 * row, wherever it is now, or, when the list no longer shows the item, of the row that took its place. A resting chip
 * hands it on to its armed control (`handFocusToControl`), so a State combobox is a combobox again. The page scrolls to
 * it only when the focus was a keyboard one (`:focus-visible`), so a mouse change does not jump the list.
 *
 * Only DOM focus moves here: no state of the screen changes, no ref is read while rendering, and the rows keep their
 * memo identity (decision 141).
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { armKeyOf, handFocusToControl } from "./properties/arming";

/** Carried by a list row, a table row and a board card: the id of its work item. */
const ITEM_ATTRIBUTE = "data-item-id";
const ROW_SELECTOR = `[${ITEM_ATTRIBUTE}]`;
/** Marks the element that stands for a control of a row that is no property control: "open", "menu". */
const FOCUS_KEY_ATTRIBUTE = "data-focus-key";
/** The row's open control: the key button of a list or table row, the card's own button. */
const OPEN_KEY = "open";
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Where the focus is: which control of which item, the row's place among the rows (for a neighbour), whether it was a
 * keyboard focus, and whether the row's open control was the tab stop of a roving list (the list's key buttons).
 */
type Spot = { element: Element; itemId: string; key: string; index: number; scroll: boolean; tabStop: boolean };

function isKeyboardFocus(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

/** The spot of `target` inside `root`; null outside any row (a group header, quick-add, the bulk bar). */
function spotOf(root: HTMLElement, target: EventTarget | null): Spot | null {
  if (!(target instanceof Element)) return null;
  const row = target.closest(ROW_SELECTOR);
  const itemId = row?.getAttribute(ITEM_ATTRIBUTE);
  if (!row || !itemId || !root.contains(row)) return null;
  let key = OPEN_KEY;
  for (let node: Element | null = target; node && node !== row; node = node.parentElement) {
    const found = armKeyOf(node) ?? node.getAttribute(FOCUS_KEY_ATTRIBUTE);
    if (found) {
      key = found;
      break;
    }
  }
  const index = Array.prototype.indexOf.call(root.querySelectorAll(ROW_SELECTOR), row);
  return { element: target, itemId, key, index, scroll: isKeyboardFocus(target), tabStop: rovingOpen(row)?.getAttribute("tabindex") === "0" };
}

/** The open control of `row` when it takes part in a roving tab stop (it carries a `tabindex`: the list's key buttons). */
function rovingOpen(row: Element): HTMLElement | null {
  return row.querySelector<HTMLElement>(`[${FOCUS_KEY_ATTRIBUTE}="${OPEN_KEY}"][tabindex]`);
}

/**
 * Makes the open control of `row` the roving tab stop, as the focused row's was. The list's `useListFocus` keeps the
 * item that holds `tabindex="0"` when it next stamps the stops, and moves it only on an arrow key; without this, the
 * stop that left with the old row went back to the first row, and Shift+Tab from the moved row's State skipped its key.
 */
function takeTabStop(root: HTMLElement, row: Element) {
  const open = rovingOpen(row);
  if (!open) return;
  for (const stop of root.querySelectorAll(`[${FOCUS_KEY_ATTRIBUTE}="${OPEN_KEY}"][tabindex="0"]`)) {
    if (stop !== open) stop.setAttribute("tabindex", "-1");
  }
  open.setAttribute("tabindex", "0");
}

/** The element of `row` that stands for control `key`, or null when the row has none. */
function controlOf(row: Element, key: string): HTMLElement | null {
  const candidates = [...row.querySelectorAll<HTMLElement>(`button, [${FOCUS_KEY_ATTRIBUTE}]`)];
  const control = candidates.find((element) => armKeyOf(element) === key);
  if (control) return control;
  const marked = candidates.find((element) => element.getAttribute(FOCUS_KEY_ATTRIBUTE) === key);
  if (marked) return marked.matches(FOCUSABLE) ? marked : marked.querySelector<HTMLElement>(FOCUSABLE);
  return key === OPEN_KEY ? row.querySelector<HTMLElement>(FOCUSABLE) : null;
}

/** Focuses control `spot.key` of the item's row, or of the row now at its place; false when there is no row. */
function restore(root: HTMLElement, spot: Spot): boolean {
  const rows = [...root.querySelectorAll(ROW_SELECTOR)];
  const row = rows.find((candidate) => candidate.getAttribute(ITEM_ATTRIBUTE) === spot.itemId) ?? rows[Math.min(spot.index, rows.length - 1)];
  if (!row) return false;
  const target = controlOf(row, spot.key) ?? controlOf(row, OPEN_KEY);
  if (!target) return false;
  if (spot.tabStop) takeTabStop(root, row);
  target.focus({ preventScroll: !spot.scroll });
  // A resting chip arms its row and hands the focus to the real control; an armed control keeps it.
  handFocusToControl(target);
  return true;
}

/**
 * Keeps the focus with a moved work item inside `rootRef` (the screen's scroller, around every layout). Call it in the
 * component whose state holds the list, so its layout effect runs in every commit that moves a row.
 */
export function useFocusFollow(rootRef: RefObject<HTMLElement | null>): void {
  const spot = useRef<Spot | null>(null);
  // The item the focus followed and the place it had before: while the focus stays on that item, its neighbour is taken
  // there, not where the move put it. A filtered list shows the item in its new group until the server drops it, and the
  // person was working down the old one.
  const followed = useRef<{ itemId: string; index: number } | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onFocusIn = (event: FocusEvent) => {
      const next = spotOf(root, event.target);
      const origin = followed.current;
      if (next && origin && next.itemId === origin.itemId) next.index = origin.index;
      else followed.current = null;
      spot.current = next;
    };
    // Focus that left for nothing (a click on empty page) is let go: a later refresh that moves its row must not pull
    // the focus back. A removed element sends no focusout (or one with nothing to go to, while React commits): it is no
    // longer connected a microtask later, so it stays remembered for the commit's restore.
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget !== null) return;
      const element = event.target;
      queueMicrotask(() => {
        if (spot.current?.element === element && element instanceof Element && element.isConnected) spot.current = null;
      });
    };
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    return () => {
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
    };
  }, [rootRef]);

  // After every commit of the screen: the remembered control left the document, and the focus went with it to the body.
  useLayoutEffect(() => {
    const last = spot.current;
    if (!last || last.element.isConnected) return;
    spot.current = null;
    const root = rootRef.current;
    const active = last.element.ownerDocument.activeElement;
    // Something else holds the focus (a dialog, the filter bar, another row): it stays there.
    if (!root || (active !== null && active !== last.element.ownerDocument.body)) return;
    // The focus that lands sets the next spot through focusin.
    followed.current = { itemId: last.itemId, index: last.index };
    restore(root, last);
  });
}
