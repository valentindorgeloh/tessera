// @vitest-environment jsdom
/**
 * Render identity helpers (src/components/work-items/stable.ts, decision 141): `shareStructure` hands back the
 * previous value while the content is equal and reuses every equal subtree otherwise; `useShared` applies it to a
 * prop; `useStableCallback` keeps one identity and calls the latest closure.
 */
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { shareStructure, useShared, useStableCallback } from "@/components/work-items/stable";

type Row = { id: string; name: string; tags: string[]; meta: { n: number } };
const row = (id: string, name = id, n = 0): Row => ({ id, name, tags: ["a", "b"], meta: { n } });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("shareStructure", () => {
  it("returns the previous identity for an equal input, however it was built", () => {
    const prev = { items: [row("1"), row("2")], total: 2, groups: null };
    expect(shareStructure(prev, clone(prev))).toBe(prev);
  });

  it("creates new objects only along the path of one changed leaf", () => {
    const prev = { items: [row("1"), row("2"), row("3")], total: 3 };
    const next = clone(prev);
    next.items[1]!.meta.n = 9;
    const shared = shareStructure(prev, next);
    expect(shared).toEqual(next);
    expect(shared).not.toBe(prev);
    expect(shared.items).not.toBe(prev.items);
    expect(shared.items[1]).not.toBe(prev.items[1]);
    expect(shared.items[1]!.meta).not.toBe(prev.items[1]!.meta);
    // Everything beside the path keeps its identity, down to the sibling arrays inside the changed row.
    expect(shared.items[0]).toBe(prev.items[0]);
    expect(shared.items[2]).toBe(prev.items[2]);
    expect(shared.items[1]!.tags).toBe(prev.items[1]!.tags);
  });

  it("handles arrays that grow and shrink", () => {
    const prev = [row("1"), row("2")];
    const grown = shareStructure(prev, [...clone(prev), row("3")]);
    expect(grown).toHaveLength(3);
    expect(grown[0]).toBe(prev[0]);
    expect(grown[1]).toBe(prev[1]);
    const shrunk = shareStructure(prev, clone(prev).slice(0, 1));
    expect(shrunk).toHaveLength(1);
    expect(shrunk[0]).toBe(prev[0]);
  });

  it("matches rows by id, so an insert at the top leaves every other row alone", () => {
    const prev = [row("1"), row("2"), row("3")];
    const next = [row("0"), ...clone(prev)];
    const shared = shareStructure(prev, next);
    expect(shared.map((entry) => entry.id)).toEqual(["0", "1", "2", "3"]);
    expect(shared[1]).toBe(prev[0]);
    expect(shared[2]).toBe(prev[1]);
    expect(shared[3]).toBe(prev[2]);
    // A move keeps the identities too, only the array is new.
    const moved = shareStructure(prev, [clone(prev[2]!), clone(prev[0]!), clone(prev[1]!)]);
    expect(moved).not.toBe(prev);
    expect(moved[0]).toBe(prev[2]);
    expect(moved[1]).toBe(prev[0]);
    expect(moved[2]).toBe(prev[1]);
  });

  it("never returns something unequal to the input, whatever the previous value held", () => {
    const next = { a: [row("1", "renamed")], b: "x" };
    expect(shareStructure({ a: [row("1")], b: "x", c: 1 }, next)).toEqual(next);
    expect(shareStructure("not an object", next)).toEqual(next);
    expect(shareStructure(null, next)).toEqual(next);
    expect(shareStructure([row("1")], { a: 1 })).toEqual({ a: 1 });
  });

  it("treats a NaN as equal to itself, so equal content keeps its identity", () => {
    const prev = { n: Number.NaN, rows: [row("1"), { id: "2", n: Number.NaN }] };
    const next = { n: Number.NaN, rows: [row("1"), { id: "2", n: Number.NaN }] };
    const shared = shareStructure(prev, next);
    expect(shared).toBe(prev);
    expect(shareStructure(shared, next)).toBe(shared);
    expect(shareStructure(Number.NaN, Number.NaN)).toBeNaN();
  });

  it("copies when next holds a key that prev lacks, even if both values are undefined", () => {
    const shared = shareStructure({ a: undefined }, { b: undefined });
    expect(Object.keys(shared)).toEqual(["b"]);
    const mixed = shareStructure({ a: 1, b: undefined } as Record<string, unknown>, { a: 1, c: undefined });
    expect(Object.keys(mixed)).toEqual(["a", "c"]);
  });

  it("passes a Date or a Map through as the new value", () => {
    const when = new Date(0);
    expect(shareStructure({ when: new Date(0) }, { when }).when).toBe(when);
    const map = new Map([["a", 1]]);
    const shared = shareStructure({ map: new Map([["a", 1]]) }, { map });
    expect(shared.map).toBe(map);
  });
});

let root: Root | null = null;
const seen: { values: unknown[]; fns: Array<(...args: never[]) => unknown> } = { values: [], fns: [] };

function render(node: ReturnType<typeof createElement>) {
  return act(async () => {
    root ??= createRoot(document.createElement("div"));
    root.render(node);
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  const current = root;
  root = null;
  seen.values = [];
  seen.fns = [];
  if (current)
    await act(async () => {
      current.unmount();
    });
});

describe("useShared", () => {
  function Probe({ value }: { value: { rows: Row[] } }) {
    const shared = useShared(value);
    useEffect(() => {
      seen.values.push(shared);
    });
    return null;
  }

  it("keeps the identity across renders with equal content and follows a real change", async () => {
    const first = { rows: [row("1"), row("2")] };
    await render(createElement(Probe, { value: first }));
    await render(createElement(Probe, { value: clone(first) }));
    expect(seen.values).toHaveLength(2);
    expect(seen.values[1]).toBe(seen.values[0]);
    const changed = clone(first);
    changed.rows[1]!.name = "renamed";
    await render(createElement(Probe, { value: changed }));
    const last = seen.values[seen.values.length - 1] as { rows: Row[] };
    expect(last).not.toBe(seen.values[0]);
    expect(last.rows[1]!.name).toBe("renamed");
    expect(last.rows[0]).toBe((seen.values[0] as { rows: Row[] }).rows[0]);
  });

  it("settles on a value that holds a NaN instead of looping", async () => {
    await render(createElement(Probe, { value: { rows: [], n: Number.NaN } as unknown as { rows: Row[] } }));
    await render(createElement(Probe, { value: { rows: [], n: Number.NaN } as unknown as { rows: Row[] } }));
    expect(seen.values).toHaveLength(2);
    expect(seen.values[1]).toBe(seen.values[0]);
  });
});

describe("useStableCallback", () => {
  function Probe({ label, onCall }: { label: string; onCall: (text: string) => void }) {
    const call = useStableCallback((suffix: string) => onCall(`${label}${suffix}`));
    useEffect(() => {
      seen.fns.push(call as (...args: never[]) => unknown);
    });
    return null;
  }

  it("keeps one identity and calls the latest closure", async () => {
    const calls: string[] = [];
    await render(createElement(Probe, { label: "a", onCall: (text) => calls.push(text) }));
    await render(createElement(Probe, { label: "b", onCall: (text) => calls.push(`second ${text}`) }));
    expect(seen.fns).toHaveLength(2);
    expect(seen.fns[1]).toBe(seen.fns[0]);
    (seen.fns[0] as (suffix: string) => void)("!");
    expect(calls).toEqual(["second b!"]);
  });
});
