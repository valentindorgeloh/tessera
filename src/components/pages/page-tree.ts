/**
 * Page tree for the wiki and the project Pages tab (docs/drafts/p6-plan.md
 * "PagesScreen"). Pure: the list from `list_pages` is already in tree order,
 * and this groups it by parent. A search keeps the matching rows and their
 * ancestors as a flat list, in that same order.
 */
import type { PageSummary, PageTab } from "@/lib/tessera/types";

/** A project the move dialog can offer as a destination. */
export type PageSpaceOption = { id: string; name: string };

export type PageTreeItem = {
  id: string;
  name: string;
  href: string;
  /** First level starts open; deeper levels and a search result start closed. */
  isExpanded: boolean;
  page: PageSummary;
  /** Previous sibling in the unfiltered tab, for Move up. */
  previousId?: string;
  /** Next sibling in the unfiltered tab, for Move down. */
  nextId?: string;
  children: PageTreeItem[];
};

/** Canonical route: a project page lives under its project, a wiki page under `/pages`. */
export function pageHref(page: { id: string; project_id: string | null }): string {
  return page.project_id === null ? `/pages/${page.id}` : `/projects/${page.project_id}/pages/${page.id}`;
}

/** The list a page belongs to. */
export function pagesListHref(projectId: string | null): string {
  return projectId === null ? "/wiki" : `/projects/${projectId}/pages`;
}

/** Both recent paths of a page: the wiki route and, for a project page, the project route. */
export function pageRecentPaths(page: { id: string; project_id: string | null }): string[] {
  const paths = [`/pages/${page.id}`];
  if (page.project_id !== null) paths.push(`/projects/${page.project_id}/pages/${page.id}`);
  return paths;
}

/** `?tab=` for the list. Public is the default and stays off the URL. */
export function withPageTab(pathname: string, search: string, tab: PageTab): string {
  const params = new URLSearchParams(search);
  if (tab === "public") params.delete("tab");
  else params.set("tab", tab);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** A `tab` search param, or Public when it is missing or not one of the three tabs. */
export function parsePageTab(value: string | string[] | undefined): PageTab {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "public" || raw === "private" || raw === "archived") return raw;
  return "public";
}

/**
 * The page and every descendant present in `pages`. Used by the move dialog
 * so a page cannot be placed under itself.
 */
export function subtreeIds(pages: readonly { id: string; parent_id: string | null }[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const page of pages) {
    if (page.parent_id === null) continue;
    const list = children.get(page.parent_id) ?? [];
    list.push(page.id);
    children.set(page.parent_id, list);
  }
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) break;
    for (const child of children.get(id) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      stack.push(child);
    }
  }
  return out;
}

function nest(pages: readonly PageSummary[]): PageTreeItem[] {
  const ids = new Set(pages.map((page) => page.id));
  const byParent = new Map<string | null, PageSummary[]>();
  for (const page of pages) {
    const parent = page.parent_id !== null && ids.has(page.parent_id) ? page.parent_id : null;
    const list = byParent.get(parent) ?? [];
    list.push(page);
    byParent.set(parent, list);
  }
  const walk = (parent: string | null, depth: number): PageTreeItem[] => {
    const siblings = byParent.get(parent) ?? [];
    return siblings.map((page, index) => ({
      id: page.id,
      name: page.name,
      href: pageHref(page),
      isExpanded: depth === 0,
      page,
      previousId: siblings[index - 1]?.id,
      nextId: siblings[index + 1]?.id,
      children: walk(page.id, depth + 1),
    }));
  };
  return walk(null, 0);
}

function placesOf(nodes: readonly PageTreeItem[], into: Map<string, { previousId?: string; nextId?: string }>): void {
  for (const node of nodes) {
    into.set(node.id, { previousId: node.previousId, nextId: node.nextId });
    placesOf(node.children, into);
  }
}

function flatten(pages: readonly PageSummary[], query: string): PageTreeItem[] {
  const needle = query.trim().toLowerCase();
  const byId = new Map(pages.map((page) => [page.id, page]));
  const keep = new Set<string>();
  for (const page of pages) {
    if (!page.name.toLowerCase().includes(needle)) continue;
    keep.add(page.id);
    let parent = page.parent_id;
    while (parent !== null && byId.has(parent) && !keep.has(parent)) {
      keep.add(parent);
      parent = byId.get(parent)?.parent_id ?? null;
    }
  }
  const places = new Map<string, { previousId?: string; nextId?: string }>();
  placesOf(nest(pages), places);
  return pages
    .filter((page) => keep.has(page.id))
    .map((page) => ({
      id: page.id,
      name: page.name,
      href: pageHref(page),
      isExpanded: false,
      page,
      previousId: places.get(page.id)?.previousId,
      nextId: places.get(page.id)?.nextId,
      children: [],
    }));
}

/** Nested tree, or a flat list of matches and their ancestors when `query` is non-empty. */
export function toTreeItems(pages: readonly PageSummary[], query: string): PageTreeItem[] {
  return query.trim() === "" ? nest(pages) : flatten(pages, query);
}

/**
 * Whether the tree draws the parent `id` open, or undefined when `id` is not in
 * `nodes` or has no sub-pages (a leaf has no expansion to keep: pinning it
 * closed would hide a child dropped under it later). A moved parent is pinned
 * to this value before the move so a depth change (the tree seeds only the
 * first level open) cannot close it, in the optimistic list or after a failed
 * move is reverted.
 */
export function drawnOpen(nodes: readonly PageTreeItem[], id: string): boolean | undefined {
  for (const node of nodes) {
    if (node.id === id) return node.children.length > 0 ? node.isExpanded : undefined;
    const inside = drawnOpen(node.children, id);
    if (inside !== undefined) return inside;
  }
  return undefined;
}
