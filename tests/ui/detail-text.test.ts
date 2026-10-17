/**
 * Pure helpers of the detail panel (src/components/detail/activity-text.ts,
 * patch.ts, search-hits.ts): activity wording, feed order, link labels, the
 * no-op checks that drop re-fired values, the optimistic merge, and the
 * search answers behind the parent picker and `work:` links.
 */
import { describe, expect, it } from "vitest";
import { describeActivity, formatIsoDate, linkDisplayLabel, linkHost, newestFirst, type ActivityWords } from "@/components/detail/activity-text";
import { applyPatch, changedFields, isNoopPatch, sameIds, storedIsoDate, toggleId } from "@/components/detail/patch";
import { matchWorkItemRef, parentTriggerLabel, toCandidates } from "@/components/detail/search-hits";
import type { WorkItem } from "@/lib/tessera/types";

function entry(overrides: Partial<ActivityWords>): ActivityWords {
  return {
    entity_type: "work_item",
    verb: "updated",
    field: null,
    old_value: null,
    new_value: null,
    old_identifier: null,
    new_identifier: null,
    merged_count: 1,
    ...overrides,
  };
}

describe("describeActivity", () => {
  it("words a field change with both identifiers", () => {
    expect(describeActivity(entry({ field: "state_id", old_identifier: "Backlog", new_identifier: "In progress" }))).toBe("changed the state from Backlog to In progress");
  });

  it("falls back to raw values when no identifier was stored", () => {
    expect(describeActivity(entry({ field: "target_date", new_value: "2026-11-01" }))).toBe("changed the target date to Nov 1, 2026");
    expect(describeActivity(entry({ field: "start_date", old_value: "2026-10-20", new_value: null }))).toBe("changed the start date (was Oct 20, 2026)");
    expect(describeActivity(entry({ field: "priority", old_value: "none", new_value: "high" }))).toBe("changed the priority from None to High");
    expect(describeActivity(entry({ field: "priority", old_identifier: "high", new_identifier: "urgent" }))).toBe("changed the priority from High to Urgent");
    expect(describeActivity(entry({ field: "start_date", new_identifier: "2026-10-20", new_value: "2026-10-20" }))).toBe("changed the start date to Oct 20, 2026");
    expect(describeActivity(entry({ field: "sort_order", old_identifier: "WEB-1", new_identifier: "WEB-1" }))).toBe("moved this work item");
    expect(describeActivity(entry({ field: "link_title", old_identifier: "Spec", new_identifier: "Spec v2" }))).toBe("changed a link's title from Spec to Spec v2");
    expect(describeActivity(entry({ field: "cycle_id", old_identifier: "Sprint 1" }))).toBe("changed the cycle (was Sprint 1)");
  });

  it("collapses description edits by count", () => {
    expect(describeActivity(entry({ field: "description_md" }))).toBe("edited the description");
    expect(describeActivity(entry({ field: "description_md", merged_count: 3 }))).toBe("edited the description 3 times");
  });

  it("words memberships, links and lifecycle verbs", () => {
    expect(describeActivity(entry({ verb: "added", field: "labels", new_identifier: "Bug" }))).toBe("added label Bug");
    expect(describeActivity(entry({ verb: "removed", field: "assignees", old_identifier: "Nina" }))).toBe("unassigned Nina");
    expect(describeActivity(entry({ verb: "added", field: "subscribers", new_identifier: "Nina" }))).toBe("subscribed Nina");
    expect(describeActivity(entry({ verb: "added", field: "link", new_identifier: "Spec" }))).toBe("added link Spec");
    expect(describeActivity(entry({ verb: "created", new_identifier: "WEB-3" }))).toBe("created this work item");
    expect(describeActivity(entry({ verb: "updated", field: "name", new_identifier: "Ship it" }))).toBe('renamed this work item to "Ship it"');
    expect(describeActivity(entry({ verb: "copied", new_identifier: "WEB-9" }))).toBe("copied this work item as WEB-9");
    expect(describeActivity(entry({ verb: "archived" }))).toBe("archived this work item");
  });

  it("words a change the actor made to themselves without repeating the name", () => {
    expect(describeActivity(entry({ verb: "added", field: "subscribers", new_identifier: "You" }), "You")).toBe("subscribed");
    expect(describeActivity(entry({ verb: "removed", field: "subscribers", old_identifier: "Nina" }), "Nina")).toBe("unsubscribed");
    expect(describeActivity(entry({ verb: "added", field: "assignees", new_identifier: "You" }), "You")).toBe("assigned yourself");
    expect(describeActivity(entry({ verb: "removed", field: "assignees", old_identifier: "Nina" }), "Nina")).toBe("unassigned themselves");
    expect(describeActivity(entry({ verb: "added", field: "assignees", new_identifier: "Nina" }), "You")).toBe("assigned Nina");
  });

  it("keeps unknown verbs readable", () => {
    expect(describeActivity(entry({ verb: "pinged", field: "estimate_point_id" }))).toBe("pinged the estimate");
  });
});

describe("formatIsoDate", () => {
  it("spells ISO dates and leaves other text alone", () => {
    expect(formatIsoDate("2026-12-05")).toBe("Dec 5, 2026");
    expect(formatIsoDate("2026-13-05")).toBe("2026-13-05");
    expect(formatIsoDate("soon")).toBe("soon");
  });
});

describe("newestFirst", () => {
  it("orders by seq descending without mutating the input", () => {
    const input = [{ seq: 2 }, { seq: 9 }, { seq: 5 }];
    expect(newestFirst(input).map((row) => row.seq)).toEqual([9, 5, 2]);
    expect(input.map((row) => row.seq)).toEqual([2, 9, 5]);
  });
});

describe("link labels", () => {
  it("prefers the title, then the host, then the URL", () => {
    expect(linkDisplayLabel({ title: "Spec", url: "https://example.com/spec" })).toBe("Spec");
    expect(linkDisplayLabel({ title: "  ", url: "https://docs.example.com/a/b" })).toBe("docs.example.com");
    expect(linkDisplayLabel({ title: "", url: "not a url" })).toBe("not a url");
    expect(linkHost("https://example.com:8443/x")).toBe("example.com:8443");
    expect(linkHost("nope")).toBeNull();
  });
});

describe("isNoopPatch", () => {
  const item = { state_id: "s1", priority: "high", cycle_id: null, start_date: "2026-10-01", target_date: null } as WorkItem;

  it("drops patches that repeat the current values", () => {
    expect(isNoopPatch(item, { state_id: "s1" })).toBe(true);
    expect(isNoopPatch(item, { cycle_id: null, target_date: null })).toBe(true);
    expect(isNoopPatch(item, {})).toBe(true);
  });

  it("keeps patches that change something", () => {
    expect(isNoopPatch(item, { state_id: "s2" })).toBe(false);
    expect(isNoopPatch(item, { start_date: null })).toBe(false);
    expect(isNoopPatch(item, { priority: "high", target_date: "2026-12-01" })).toBe(false);
  });

  it("compares id lists regardless of order", () => {
    expect(sameIds(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameIds(["a"], ["a", "b"])).toBe(false);
  });
});

describe("changedFields", () => {
  const current = { state_id: "s1", priority: "high", start_date: null as string | null, label_ids: ["a", "b"] };

  it("keeps only the entries that differ", () => {
    expect(changedFields(current, { state_id: "s1", priority: "low" })).toEqual({ priority: "low" });
    expect(changedFields(current, { start_date: "2026-10-20" })).toEqual({ start_date: "2026-10-20" });
  });

  it("returns null for a re-fired value, an unchanged id set or an empty patch", () => {
    expect(changedFields(current, { state_id: "s1" })).toBeNull();
    expect(changedFields(current, { label_ids: ["b", "a"] })).toBeNull();
    expect(changedFields(current, { priority: undefined })).toBeNull();
    expect(changedFields(current, {})).toBeNull();
  });

  it("sees a second identical write as a no-op once the first is merged (DateInput fires twice)", () => {
    const first = changedFields(current, { start_date: "2026-10-20" });
    expect(first).not.toBeNull();
    const merged = applyPatch(current, first ?? {});
    expect(changedFields(merged, { start_date: "2026-10-20" })).toBeNull();
  });
});

describe("applyPatch and toggleId", () => {
  it("merges defined fields without touching the input", () => {
    const item = { name: "A", cycle_id: "c1" as string | null };
    const next = applyPatch(item, { cycle_id: null, name: undefined });
    expect(next).toEqual({ name: "A", cycle_id: null });
    expect(item.cycle_id).toBe("c1");
  });

  it("adds an id once and removes it", () => {
    expect(toggleId(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleId(["a", "b"], "b", true)).toEqual(["a", "b"]);
    expect(toggleId(["a", "b"], "a", false)).toEqual(["b"]);
  });

  it("passes stored ISO dates to the date input and drops the rest", () => {
    expect(storedIsoDate("2026-10-31")).toBe("2026-10-31");
    expect(storedIsoDate("31/10/2026")).toBeUndefined();
    expect(storedIsoDate(null)).toBeUndefined();
  });
});

describe("search hits", () => {
  const payload = {
    hits: [
      { type: "work_item", id: "id-12", project_id: "p", key: "WEB-12", title: "Set up hosting", score: 1000 },
      { type: "work_item", id: "id-3", project_id: "p", key: "WEB-3", title: "Mentions WEB-99", score: 10 },
      { type: "work_item", id: 7, title: "broken" },
    ],
  };

  it("reads the work item hits and ignores malformed rows and answers", () => {
    expect(toCandidates(payload)).toEqual([
      { id: "id-12", key: "WEB-12", title: "Set up hosting" },
      { id: "id-3", key: "WEB-3", title: "Mentions WEB-99" },
    ]);
    expect(toCandidates({ error: "q is required" })).toEqual([]);
    expect(toCandidates(null)).toEqual([]);
  });

  it("resolves a work link only to the hit with that key or id", () => {
    const hits = toCandidates(payload);
    expect(matchWorkItemRef(hits, "web-12")?.id).toBe("id-12");
    expect(matchWorkItemRef(hits, "id-3")?.key).toBe("WEB-3");
    expect(matchWorkItemRef(hits, "WEB-99")).toBeNull();
    expect(matchWorkItemRef(hits, " ")).toBeNull();
  });

  it("resolves a work link written with a retired key through matched_key (decision 29)", () => {
    const retired = toCandidates({
      hits: [
        { type: "work_item", id: "id-1", key: "P4B-1", matched_key: "P4A-1", title: "Old", score: 1000 },
        { type: "work_item", id: "id-2", key: "P4B-2", matched_key: 5, title: "Mentions P4A-9", score: 10 },
      ],
    });
    expect(retired[0].matched_key).toBe("P4A-1");
    expect(retired[1].matched_key).toBeUndefined();
    expect(matchWorkItemRef(retired, "P4A-1")?.id).toBe("id-1");
    expect(matchWorkItemRef(retired, "p4a-1")?.id).toBe("id-1");
    expect(matchWorkItemRef(retired, "P4B-1")?.id).toBe("id-1");
    expect(matchWorkItemRef(retired, "P4A-9")).toBeNull();
  });

  it("names the parent picker trigger from the loaded parent, else from the hit just picked", () => {
    const parent = { id: "p1", key: "WEB-1", name: "Launch" };
    const picked = { id: "p2", key: "WEB-2", title: "Copy" };
    expect(parentTriggerLabel(null, parent, picked)).toBeUndefined();
    expect(parentTriggerLabel("p1", parent, picked)).toBe("WEB-1 Launch");
    expect(parentTriggerLabel("p2", parent, picked)).toBe("WEB-2 Copy");
    expect(parentTriggerLabel("p3", parent, picked)).toBeUndefined();
  });
});
