/**
 * The peek hosts mounted right now, counted by project id. `PeekHost`
 * registers itself in an effect, so a host that unmounts on navigation (or
 * that the router hides in an Activity boundary) drops out again. Power K
 * asks `hasPeekHost` before it opens a work item hit as a peek: a cycle or
 * module route that renders the feature-off state or the not-found screen
 * keeps its URL, so the path test alone (`mountsPeek` in ./peek-url.ts)
 * would push a `?peek` that nothing shows. Client state only: effects never
 * run on the server. Vitest covers it (tests/ui/peek-url.test.ts).
 */

const hosts = new Map<string, number>();

/** Counts one mounted host of `projectId`; the returned function (an effect cleanup) uncounts it once. */
export function registerPeekHost(projectId: string): () => void {
  hosts.set(projectId, (hosts.get(projectId) ?? 0) + 1);
  let isRegistered = true;
  return () => {
    if (!isRegistered) return;
    isRegistered = false;
    const remaining = (hosts.get(projectId) ?? 0) - 1;
    if (remaining > 0) hosts.set(projectId, remaining);
    else hosts.delete(projectId);
  };
}

/** True while at least one `PeekHost` of `projectId` is mounted. */
export function hasPeekHost(projectId: string): boolean {
  return (hosts.get(projectId) ?? 0) > 0;
}
