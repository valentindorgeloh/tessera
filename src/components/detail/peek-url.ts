/**
 * Peek URL helper (docs/contracts/ui.md "Routes and modes"): the peek is the
 * `peek` search param of the work items list, and nothing else. `peekHref`
 * sets or drops that param and keeps every other one (`q`, the view state),
 * so opening an item never loses the filters and closing it never loses
 * them either. `withSearchParam` is the same rule for any param: the filter
 * bar and the display menu write `q` through it so an open peek survives.
 * Pure, so Vitest covers it (tests/ui/peek-url.test.ts).
 *
 * History: the list opens the peek with a push, so Back closes it. Closing
 * from the panel goes back to that entry when it can (`closesWithBack`)
 * instead of replacing the pushed entry with a copy of the list URL, which
 * would leave two identical entries and a Back that changes nothing.
 */

export const PEEK_PARAM = "peek";

/** The parts of URLSearchParams this helper reads; next's ReadonlyURLSearchParams satisfies it. */
export type SearchParamsLike = { toString(): string };

/**
 * `pathname` with `key=<value>` set (or removed when `value` is null or empty)
 * and every other param of `searchParams` kept in place.
 */
export function withSearchParam(pathname: string, searchParams: SearchParamsLike | null | undefined, key: string, value: string | null): string {
  const params = new URLSearchParams(searchParams?.toString() ?? "");
  if (value) params.set(key, value);
  else params.delete(key);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * `pathname` with `peek=<id>` set (or removed when `id` is null) and every
 * other param of `searchParams` kept in place.
 */
export function peekHref(pathname: string, searchParams: SearchParamsLike | null | undefined, id: string | null): string {
  return withSearchParam(pathname, searchParams, PEEK_PARAM, id);
}

/**
 * True when `pathname` renders a work items list of `projectId` that mounts the
 * peek: the project list, a cycle's or a module's list, and the archived work
 * items (`/projects/<id>/work-items`, `/projects/<id>/cycles/<cycleId>`,
 * `/projects/<id>/modules/<moduleId>`, `/projects/<id>/archives/work-items`);
 * a trailing slash is ignored. Power K opens a work item hit there as a peek
 * when a peek host is mounted too (`workItemHitTarget`).
 */
export function mountsPeek(pathname: string, projectId: string): boolean {
  const prefix = `/projects/${projectId}/`;
  const bare = pathname.replace(/\/+$/, "");
  if (!bare.startsWith(prefix)) return false;
  const rest = bare.slice(prefix.length).split("/");
  if (rest.some((segment) => segment === "")) return false;
  if (rest.length === 1) return rest[0] === "work-items";
  if (rest.length === 2) return rest[0] === "cycles" || rest[0] === "modules" || (rest[0] === "archives" && rest[1] === "work-items");
  return false;
}

/**
 * Where Power K opens a work item hit of `projectId`: as a peek of the list on
 * screen (`pathname` with `peek=<itemId>`, the other params kept) when the
 * route is one of the project's lists (`mountsPeek`) and a `PeekHost` of the
 * project is mounted (`hasHost`, ./peek-hosts.ts), else on the item's full
 * page. A cycle or module route that shows the feature-off state or the
 * not-found screen passes the path test but mounts no host.
 */
export function workItemHitTarget(
  pathname: string,
  searchParams: SearchParamsLike | null | undefined,
  projectId: string,
  itemId: string,
  hasHost: boolean,
): { href: string; isPeek: boolean } {
  if (hasHost && mountsPeek(pathname, projectId)) return { href: peekHref(pathname, searchParams, itemId), isPeek: true };
  return { href: `/projects/${projectId}/work-items/${itemId}`, isPeek: false };
}

/** The `peek` param of a query string, or null when it is absent or empty. */
export function peekIdOf(searchParams: SearchParamsLike | null | undefined): string | null {
  const value = new URLSearchParams(searchParams?.toString() ?? "").get(PEEK_PARAM);
  return value ? value : null;
}

/** `pathname?query` of the current location as the router sees it (no `?` without params). */
export function currentHref(pathname: string, searchParams: SearchParamsLike | null | undefined): string {
  const query = new URLSearchParams(searchParams?.toString() ?? "").toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Record of the history entry the list pushed to open the peek: the URL it
 * left (`from`), the URL it pushed (`to`, updated when the peek switches item
 * in place) and `window.history.length` once the push landed.
 */
export type PeekPush = { from: string; to: string; length: number };

/** The stored record, or null when it is missing or malformed. */
export function parsePeekPush(raw: string | null): PeekPush | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { from, to, length } = value as Record<string, unknown>;
    if (typeof from !== "string" || typeof to !== "string" || typeof length !== "number") return null;
    return { from, to, length };
  } catch {
    return null;
  }
}

/**
 * True when closing the peek may go Back instead of replacing the URL: the
 * current entry is the one the list pushed (same URL, same history length),
 * and the entry before it is exactly where closing should land (the list
 * with the same params, without `peek`). Anything else (a reload of a shared
 * link, filters changed while the peek was open, a history rewritten since)
 * closes with a replace, which never leaves the list.
 */
export function closesWithBack(push: PeekPush | null, current: string, target: string, historyLength: number): boolean {
  return push !== null && push.to === current && push.from === target && push.length === historyLength;
}
