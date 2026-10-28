"use client";

/**
 * Client side of list paging (decision 112). The server renders the first page
 * of every group (or of the flat list); "Show more" fetches the next page
 * through the read Server Action `listWorkItemsAction` and merges it into the
 * loaded result. A refresh (every write) hands in a new server result, which
 * would collapse the expanded groups, so the hook re-requests each expanded
 * group up to its loaded length in one call (`group_limits`) and swaps the
 * answer in. A change of filters, display or scope starts over from the
 * server's first page.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { listWorkItemsAction } from "@/app/actions/work-items";
import { groupLimitKey } from "@/lib/tessera/core/group";
import type { Display, Filters, ListScope, RichFilters, WorkItemListResult } from "@/lib/tessera/types";
import { shareStructure } from "./stable";
import { UNGROUPED_KEY, ganttListExtras, keepLoaded, loadMoreSize, mergeGroupPage, mergeRowsPage, pageSizeFor, pagesByGroup, refetchPlan } from "./paging";

export type UsePagedListArgs = {
  scope: ListScope;
  display: Display;
  filters: Filters;
  richFilters?: RichFilters | null;
  /** The result the server rendered: the first page of every group. */
  server: WorkItemListResult;
};

export type PagedList = {
  result: WorkItemListResult;
  /** Loads the next page of a group, or of one lane cell inside it. */
  loadMore: (groupId: string, subGroupId?: string) => void;
  /** Loads the next page of an ungrouped list. */
  loadMoreUngrouped: () => void;
  /** Whether that leaf is fetching: a `groupLimitKey` or `UNGROUPED_KEY`. */
  isLoading: (key: string) => boolean;
};

export function usePagedList({ scope, display, filters, richFilters, server }: UsePagedListArgs): PagedList {
  const queryKey = JSON.stringify([scope, filters, display, richFilters ?? null]);
  const [result, setResult] = useState(server);
  const [seen, setSeen] = useState({ server, queryKey });
  const [loading, setLoading] = useState<ReadonlySet<string>>(() => new Set());
  // A fresh server result replaces what is loaded. The first pages are the server's; the rows an expanded group had
  // loaded beyond its first page stay below them until the re-request in the effect below lands (keepLoaded).
  // A new query (filters, display, scope) starts over from the server's first page.
  if (seen.server !== server || seen.queryKey !== queryKey) {
    setSeen({ server, queryKey });
    // The new result keeps the identity of every row (and group) that did not change, so memoized rows skip their render (decision 141).
    setResult(shareStructure(result, seen.queryKey === queryKey ? keepLoaded(server, result, display) : server));
  }
  const query = useCallback(
    () => ({
      scope,
      filters,
      display,
      ...ganttListExtras(display),
      ...(richFilters !== undefined ? { rich_filters: richFilters } : {}),
    }),
    // The key stands for the four values; a new object with the same content must not rebuild the callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryKey],
  );

  /** Bumped on every server result and query change: a late answer for an older one is dropped. */
  const generation = useRef(0);
  const shown = useRef(result);
  const lastKey = useRef(queryKey);

  useEffect(() => {
    // Runs before the `shown` update below, so `shown.current` is still the result the user was looking at.
    generation.current += 1;
    const mine = generation.current;
    const sameQuery = lastKey.current === queryKey;
    lastKey.current = queryKey;
    if (!sameQuery) return;
    const plan = refetchPlan(shown.current, display);
    if (plan === null) return;
    void (async () => {
      const page = await listWorkItemsAction({ ...query(), ...(plan.group_limits ? pageSizeFor(display) : {}), ...plan });
      if (generation.current !== mine || !page.ok) return;
      setResult((current) => shareStructure(current, page.data));
    })();
    // Only a new server result (or query) re-requests; the display is read through the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, queryKey]);

  useEffect(() => {
    shown.current = result;
  }, [result]);

  const run = useCallback(
    (key: string, request: Record<string, unknown>, merge: (current: WorkItemListResult, page: WorkItemListResult) => WorkItemListResult) => {
      const mine = generation.current;
      setLoading((current) => new Set(current).add(key));
      void (async () => {
        const page = await listWorkItemsAction({ ...query(), ...request } as Parameters<typeof listWorkItemsAction>[0]);
        setLoading((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
        if (generation.current !== mine || !page.ok) return;
        setResult((current) => shareStructure(current, merge(current, page.data)));
      })();
    },
    [query],
  );

  const loadMore = useCallback(
    (groupId: string, subGroupId?: string) => {
      const key = groupLimitKey(groupId, subGroupId);
      if (loading.has(key)) return;
      const group = result.groups?.find((entry) => entry.id === groupId);
      const leaf = subGroupId === undefined ? group : group?.sub_groups?.find((cell) => cell.id === subGroupId);
      if (!leaf || !leaf.has_more) return;
      run(
        key,
        {
          group_value: groupId,
          ...(subGroupId !== undefined ? { sub_group_value: subGroupId } : {}),
          limit: loadMoreSize(display),
          offset: leaf.item_ids.length,
        },
        (current, page) => mergeGroupPage(current, groupId, page, subGroupId),
      );
    },
    [display, loading, result.groups, run],
  );

  const loadMoreUngrouped = useCallback(() => {
    if (loading.has(UNGROUPED_KEY) || pagesByGroup(display) || result.has_more !== true) return;
    run(UNGROUPED_KEY, { limit: loadMoreSize(display), offset: result.items.length }, (current, page) => mergeRowsPage(current, page));
  }, [display, loading, result.has_more, result.items.length, run]);

  const isLoading = useCallback((key: string) => loading.has(key), [loading]);

  return { result, loadMore, loadMoreUngrouped, isLoading };
}
