/**
 * Entity-label store of the detail hosts, read by the recents lists (src/components/shell/entity-labels.ts):
 * the bounded, newest-last map behind `registerEntityLabel`, its stored form
 * in localStorage `tessera.entityLabels.v1`, and the store merging stored
 * labels under the ones registered on this page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENTITY_LABELS_STORAGE_KEY, parseEntityLabels, serializeEntityLabels, withEntityLabel } from "@/components/shell/entity-labels";

const A = "11111111-1111-7111-8111-111111111111";
const B = "22222222-2222-7222-8222-222222222222";
const C = "33333333-3333-7333-8333-333333333333";

describe("withEntityLabel", () => {
  it("adds a label as the newest entry", () => {
    const labels = withEntityLabel(withEntityLabel(new Map(), A, "WEB-1 Set up hosting"), B, "WEB-2 Write copy");
    expect([...labels]).toEqual([
      [A, "WEB-1 Set up hosting"],
      [B, "WEB-2 Write copy"],
    ]);
  });

  it("returns the same map when the label is unchanged", () => {
    const labels = withEntityLabel(new Map(), A, "WEB-1 Set up hosting");
    expect(withEntityLabel(labels, A, "WEB-1 Set up hosting")).toBe(labels);
  });

  it("moves a renamed entry to the newest position without mutating the input", () => {
    const before = new Map([
      [A, "WEB-1 Old"],
      [B, "WEB-2 Write copy"],
    ]);
    const after = withEntityLabel(before, A, "WEB-1 New");
    expect([...after]).toEqual([
      [B, "WEB-2 Write copy"],
      [A, "WEB-1 New"],
    ]);
    expect(before.get(A)).toBe("WEB-1 Old");
  });

  it("drops the oldest entries beyond the bound", () => {
    let labels: ReadonlyMap<string, string> = new Map();
    labels = withEntityLabel(labels, A, "a", 2);
    labels = withEntityLabel(labels, B, "b", 2);
    labels = withEntityLabel(labels, C, "c", 2);
    expect([...labels.keys()]).toEqual([B, C]);
  });
});

describe("parseEntityLabels / serializeEntityLabels", () => {
  it("round-trips the stored form", () => {
    const labels = new Map([
      [A, "WEB-1 Set up hosting"],
      [B, "WEB-2 Write copy"],
    ]);
    expect([...parseEntityLabels(JSON.parse(serializeEntityLabels(labels)))]).toEqual([...labels]);
  });

  it("ignores anything that is not an array of string pairs", () => {
    expect(parseEntityLabels(null).size).toBe(0);
    expect(parseEntityLabels({ [A]: "x" }).size).toBe(0);
    const labels = parseEntityLabels([[A, "ok"], [B], [C, 3], ["", "empty id"], [B, ""], "junk", [A, "newer", "extra"]]);
    expect([...labels]).toEqual([[A, "ok"]]);
  });

  it("keeps the last label of a repeated id and applies the bound", () => {
    expect([...parseEntityLabels([[A, "one"], [B, "two"], [A, "three"]])]).toEqual([
      [B, "two"],
      [A, "three"],
    ]);
    expect([...parseEntityLabels([[A, "a"], [B, "b"], [C, "c"]], 2).keys()]).toEqual([B, C]);
  });
});

describe("entity label store", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    vi.resetModules();
    storage = new Map();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes registered labels to storage", async () => {
    const store = await import("@/components/shell/entity-labels");
    store.registerEntityLabel(A, "WEB-1 Set up hosting");
    expect(JSON.parse(storage.get(ENTITY_LABELS_STORAGE_KEY) ?? "null")).toEqual([[A, "WEB-1 Set up hosting"]]);
  });

  it("keeps stored labels and lets a label registered on this page win", async () => {
    storage.set(
      ENTITY_LABELS_STORAGE_KEY,
      JSON.stringify([
        [A, "WEB-1 Old title"],
        [B, "WEB-2 Write copy"],
      ]),
    );
    const store = await import("@/components/shell/entity-labels");
    store.registerEntityLabel(A, "WEB-1 New title");
    expect(JSON.parse(storage.get(ENTITY_LABELS_STORAGE_KEY) ?? "null")).toEqual([
      [B, "WEB-2 Write copy"],
      [A, "WEB-1 New title"],
    ]);
  });

  it("survives unreadable storage", async () => {
    storage.set(ENTITY_LABELS_STORAGE_KEY, "{not json");
    const store = await import("@/components/shell/entity-labels");
    expect(() => store.registerEntityLabel(C, "WEB-3 Repro")).not.toThrow();
    expect(JSON.parse(storage.get(ENTITY_LABELS_STORAGE_KEY) ?? "null")).toEqual([[C, "WEB-3 Repro"]]);
  });
});
