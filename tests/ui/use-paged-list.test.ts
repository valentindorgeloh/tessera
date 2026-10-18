// @vitest-environment jsdom
/**
 * The paging hook (src/components/work-items/use-paged-list.ts, decision 112):
 * "Show more" asks the read action for the next page of one group and merges
 * it; a new server result after a write keeps the rows an expanded group had
 * loaded and re-requests them in one `group_limits` call; a new query starts
 * over; an answer for an older server result is dropped. The Server Action is
 * mocked, so no database or Next runtime is involved.
 */
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PagedList, UsePagedListArgs } from "@/components/work-items/use-paged-list";
import { DEFAULT_DISPLAY } from "@/lib/tessera/schemas";
import type { Display, Group, WorkItem, WorkItemListResult } from "@/lib/tessera/types";

const listWorkItemsAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/work-items", () => ({ listWorkItemsAction }));

const { usePagedList } = await import("@/components/work-items/use-paged-list");

const SCOPE = { type: "project", project_id: "11111111-1111-7111-8111-111111111111" } as const;
const display: Display = { ...DEFAULT_DISPLAY, layout: "list", group_by: "priority" };

function ids(n: number, from = 1): string[] {
  return Array.from({ length: n }, (_, index) => `h${from + index}`);
}

/** One group "high" with `count` rows of which the first `loaded` are present. */
function listOf(loaded: number, count: number, from = 1): WorkItemListResult {
  const item_ids = ids(loaded, from);
  const group: Group = { field: "priority", id: "high", name: "High", color: null, count, item_ids, has_more: from - 1 + loaded < count };
  const items = item_ids.map((id) => ({ id, name: id, priority: "high" }) as WorkItem);
  return { items, total: count, cursor: 1, groups: [group], has_more: group.has_more };
}

const ok = (data: WorkItemListResult) => ({ ok: true as const, data, cursor: 1 });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const seenRef: { current: PagedList | null } = { current: null };

function Probe(props: UsePagedListArgs) {
  const paged = usePagedList(props);
  useEffect(() => {
    seenRef.current = paged;
  });
  return null;
}

async function mount(props: UsePagedListArgs) {
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(Probe, props));
  });
}

async function update(props: UsePagedListArgs) {
  await act(async () => {
    root?.render(createElement(Probe, props));
  });
}

const rowsOf = () => seenRef.current?.result.groups?.[0]?.item_ids.length ?? 0;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
  }
  root = null;
  container = null;
  seenRef.current = null;
  listWorkItemsAction.mockReset();
});

describe("usePagedList", () => {
  it("fetches the next page of one group from the loaded length and merges it", async () => {
    listWorkItemsAction.mockResolvedValue(ok(listOf(50, 120, 51)));
    await mount({ scope: SCOPE, display, filters: {}, server: listOf(50, 120) });
    expect(rowsOf()).toBe(50);
    await act(async () => {
      seenRef.current?.loadMore("high");
    });
    expect(listWorkItemsAction).toHaveBeenCalledTimes(1);
    expect(listWorkItemsAction.mock.calls[0]?.[0]).toMatchObject({ scope: SCOPE, group_value: "high", limit: 50, offset: 50 });
    expect(rowsOf()).toBe(100);
    expect(seenRef.current?.result.groups?.[0]?.has_more).toBe(true);
    expect(seenRef.current?.isLoading("high")).toBe(false);
  });

  it("does nothing for a group that has no more rows", async () => {
    await mount({ scope: SCOPE, display, filters: {}, server: listOf(30, 30) });
    await act(async () => {
      seenRef.current?.loadMore("high");
    });
    expect(listWorkItemsAction).not.toHaveBeenCalled();
  });

  it("keeps the expanded rows across a new server result and re-requests them in one call", async () => {
    listWorkItemsAction.mockResolvedValueOnce(ok(listOf(50, 120, 51)));
    await mount({ scope: SCOPE, display, filters: {}, server: listOf(50, 120) });
    await act(async () => {
      seenRef.current?.loadMore("high");
    });
    expect(rowsOf()).toBe(100);

    // A write refreshes the page: the server hands in a fresh first page.
    let finish: (value: ReturnType<typeof ok>) => void = () => {};
    listWorkItemsAction.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    await update({ scope: SCOPE, display, filters: {}, server: listOf(50, 119) });
    expect(rowsOf()).toBe(100);
    expect(seenRef.current?.result.groups?.[0]?.count).toBe(119);
    expect(listWorkItemsAction).toHaveBeenCalledTimes(2);
    expect(listWorkItemsAction.mock.calls[1]?.[0]).toMatchObject({ scope: SCOPE, per_group_limit: 50, group_limits: { high: 100 } });

    await act(async () => {
      finish(ok(listOf(100, 119)));
    });
    expect(rowsOf()).toBe(100);
    expect(seenRef.current?.result.groups?.[0]?.has_more).toBe(true);
  });

  it("does not re-request when no group is expanded", async () => {
    await mount({ scope: SCOPE, display, filters: {}, server: listOf(50, 120) });
    await update({ scope: SCOPE, display, filters: {}, server: listOf(50, 121) });
    expect(listWorkItemsAction).not.toHaveBeenCalled();
    expect(seenRef.current?.result.groups?.[0]?.count).toBe(121);
  });

  it("starts over from the server's first page when the filters change", async () => {
    listWorkItemsAction.mockResolvedValueOnce(ok(listOf(50, 120, 51)));
    await mount({ scope: SCOPE, display, filters: {}, server: listOf(50, 120) });
    await act(async () => {
      seenRef.current?.loadMore("high");
    });
    expect(rowsOf()).toBe(100);
    await update({ scope: SCOPE, display, filters: { priority: ["high"] }, server: listOf(50, 90) });
    expect(rowsOf()).toBe(50);
    expect(listWorkItemsAction).toHaveBeenCalledTimes(1);
  });

  it("drops the answer to a page that was requested before the server result changed", async () => {
    let finish: (value: ReturnType<typeof ok>) => void = () => {};
    listWorkItemsAction.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    await mount({ scope: SCOPE, display, filters: {}, server: listOf(50, 120) });
    await act(async () => {
      seenRef.current?.loadMore("high");
    });
    expect(seenRef.current?.isLoading("high")).toBe(true);
    await update({ scope: SCOPE, display, filters: {}, server: listOf(50, 118) });
    await act(async () => {
      finish(ok(listOf(50, 120, 51)));
    });
    expect(rowsOf()).toBe(50);
    expect(seenRef.current?.result.groups?.[0]?.count).toBe(118);
  });

  it("pages an ungrouped list by rows", async () => {
    const flat: Display = { ...DEFAULT_DISPLAY, layout: "table", group_by: null };
    const first = { items: ids(200).map((id) => ({ id }) as WorkItem), total: 450, cursor: 1, has_more: true } as WorkItemListResult;
    const next = { items: ids(200, 201).map((id) => ({ id }) as WorkItem), total: 450, cursor: 1, has_more: true } as WorkItemListResult;
    listWorkItemsAction.mockResolvedValueOnce(ok(next));
    await mount({ scope: SCOPE, display: flat, filters: {}, server: first });
    await act(async () => {
      seenRef.current?.loadMoreUngrouped();
    });
    expect(listWorkItemsAction.mock.calls[0]?.[0]).toMatchObject({ limit: 200, offset: 200 });
    expect(seenRef.current?.result.items).toHaveLength(400);
    expect(seenRef.current?.result.has_more).toBe(true);
  });
});
