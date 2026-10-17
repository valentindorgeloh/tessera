/**
 * Pure helpers over `GET /api/search` answers for the detail panel (tested
 * in tests/ui/detail-text.test.ts): the parent picker's candidates and
 * trigger text, and the resolution of a `work:<KEY>` link to an item id. The
 * route returns `{ hits: SearchHit[] }`; only the fields read here are
 * checked, so a malformed answer yields no hits instead of a crash.
 */

/**
 * The fields of a work item hit the detail reads. `matched_key` is present
 * only when the hit was found by a retired project identifier (decision 29).
 */
export type WorkItemCandidate = { id: string; key: string; title: string; matched_key?: string };

/** Work item hits of a search answer, in the route's order. */
export function toCandidates(payload: unknown): WorkItemCandidate[] {
  if (typeof payload !== "object" || payload === null || !("hits" in payload) || !Array.isArray(payload.hits)) return [];
  const out: WorkItemCandidate[] = [];
  for (const hit of payload.hits as unknown[]) {
    if (typeof hit !== "object" || hit === null) continue;
    const { id, key, title, matched_key } = hit as { id?: unknown; key?: unknown; title?: unknown; matched_key?: unknown };
    if (typeof id === "string" && typeof title === "string") {
      const candidate: WorkItemCandidate = { id, key: typeof key === "string" ? key : "", title };
      if (typeof matched_key === "string") candidate.matched_key = matched_key;
      out.push(candidate);
    }
  }
  return out;
}

/**
 * The hit a `work:<ref>` link means: the one whose key or retired matched key
 * (any case) or id equals `ref`. Search ranks a key match first but also
 * returns title matches, so the first hit alone could open the wrong item
 * when the key does not exist.
 */
export function matchWorkItemRef(hits: readonly WorkItemCandidate[], ref: string): WorkItemCandidate | null {
  const wanted = ref.trim().toUpperCase();
  if (wanted === "") return null;
  return (
    hits.find(
      (hit) => hit.key.toUpperCase() === wanted || hit.matched_key?.toUpperCase() === wanted || hit.id.toUpperCase() === wanted,
    ) ?? null
  );
}

/** Parent picker trigger text for `value`: the loaded parent, else the hit just picked (until the refresh brings the new parent). */
export function parentTriggerLabel(
  value: string | null,
  parent: { id: string; key: string; name: string } | null,
  picked: WorkItemCandidate | null,
): string | undefined {
  if (value === null) return undefined;
  if (parent && parent.id === value) return `${parent.key} ${parent.name}`;
  if (picked && picked.id === value) return `${picked.key} ${picked.title}`.trim();
  return undefined;
}
