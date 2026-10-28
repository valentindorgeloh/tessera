"use client";

/**
 * Render identity helpers (decision 141, docs/as-built/work-items.md "Render identity").
 *
 * A write, an agent's or the user's, makes the server render the page again and hand every client component
 * fresh copies of the same data (the RSC payload carries no identity). A memoized row skips its render only when
 * its props are shallow-equal, so the data has to keep the identity it had whenever its content is unchanged:
 * `shareStructure` does that and `useShared` applies it to a prop, `useStableCallback` gives a handler one fixed
 * identity.
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * A callback with a fixed identity that calls the latest closure, so a memoized child never sees a new function.
 * The ref is assigned in a layout effect, which runs after the render commits: call the result from an event
 * handler or an effect, never while rendering (it would run the previous render's closure).
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}

function isPlain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** The `id` of a plain object that has a string one: rows of a reordered or grown array are matched by it. */
function idOf(value: unknown): string | null {
  return isPlain(value) && typeof value.id === "string" ? value.id : null;
}

function indexById(rows: readonly unknown[]): Map<string, unknown> {
  const byId = new Map<string, unknown>();
  for (const row of rows) {
    const id = idOf(row);
    if (id !== null) byId.set(id, row);
  }
  return byId;
}

function shareArray(prev: readonly unknown[], next: readonly unknown[]): readonly unknown[] {
  let byId: Map<string, unknown> | null = null;
  const out = next.map((item, index) => {
    const id = idOf(item);
    let counterpart: unknown = prev[index];
    if (id !== null && idOf(counterpart) !== id) {
      // Misaligned (an insert, a removal or a move): look the row up by id instead of by position.
      byId ??= indexById(prev);
      counterpart = byId.get(id);
    }
    return counterpart === undefined ? item : shareStructure(counterpart, item);
  });
  return out.length === prev.length && out.every((item, index) => Object.is(item, prev[index])) ? prev : out;
}

/**
 * `prev` when it equals `next` deeply; otherwise a copy of `next` that reuses every deeply-equal subtree of `prev`.
 * Plain objects and arrays only: anything else (a Date, a Map, a class instance) is taken from `next` as it is.
 * Rows of an array that carry a string `id` are compared with the row of the same id, so an insert or a move
 * leaves every other row's identity alone. The result is always equal to `next`, whatever `prev` holds. Values are
 * compared with `Object.is`, so a NaN counts as equal to itself, and a key that `prev` lacks always makes a copy.
 */
export function shareStructure<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return next;
  if (Array.isArray(prev) && Array.isArray(next)) return shareArray(prev, next) as T;
  if (isPlain(prev) && isPlain(next)) {
    const keys = Object.keys(next);
    let same = Object.keys(prev).length === keys.length;
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      const shared = key in prev ? shareStructure(prev[key], next[key]) : next[key];
      out[key] = shared;
      if (!(key in prev) || !Object.is(shared, prev[key])) same = false;
    }
    return (same ? prev : out) as T;
  }
  return next;
}

/**
 * `value` with the identity of the previous render's value whenever the two are deeply equal. It keeps the shared
 * copy in state and sets it during render (react.dev "storing information from previous renders"), which converges
 * in one extra render and only when the content changed.
 */
export function useShared<T>(value: T): T {
  const [kept, setKept] = useState(value);
  const shared = shareStructure(kept, value);
  if (!Object.is(shared, kept)) setKept(shared);
  return shared;
}
