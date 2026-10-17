/**
 * Timeline merge (src/components/detail/timeline.ts): order, the filters, and
 * the newest-20 window.
 */
import { describe, expect, it } from "vitest";
import { isRootComment, isShownUpdate, mergeTimeline, windowTimeline, TIMELINE_WINDOW, type TimelineActivity, type TimelineComment } from "@/components/detail/timeline";

function comment(overrides: Partial<TimelineComment> & Pick<TimelineComment, "id" | "created_at">): TimelineComment {
  return { parent_comment_id: null, ...overrides };
}

function activity(overrides: Partial<TimelineActivity> & Pick<TimelineActivity, "seq" | "created_at">): TimelineActivity {
  return { entity_type: "work_item", verb: "updated", field: "name", ...overrides };
}

describe("isShownUpdate", () => {
  it("hides comment rows, reactions and mentions", () => {
    expect(isShownUpdate(activity({ seq: 1, created_at: "2026-10-01T00:00:00.000Z", entity_type: "comment", verb: "commented", field: null }))).toBe(false);
    expect(isShownUpdate(activity({ seq: 2, created_at: "2026-10-01T00:00:00.000Z", verb: "reacted", field: null }))).toBe(false);
    expect(isShownUpdate(activity({ seq: 3, created_at: "2026-10-01T00:00:00.000Z", verb: "unreacted", field: null }))).toBe(false);
    expect(isShownUpdate(activity({ seq: 4, created_at: "2026-10-01T00:00:00.000Z", verb: "added", field: "mention" }))).toBe(false);
    expect(isShownUpdate(activity({ seq: 5, created_at: "2026-10-01T00:00:00.000Z" }))).toBe(true);
  });
});

describe("mergeTimeline", () => {
  const comments = [
    comment({ id: "c-late", created_at: "2026-10-03T00:00:00.000Z" }),
    comment({ id: "c-early", created_at: "2026-10-01T00:00:00.000Z" }),
    comment({ id: "c-reply", created_at: "2026-10-02T00:00:00.000Z", parent_comment_id: "c-early" }),
  ];
  const rows = [
    activity({ seq: 2, created_at: "2026-10-02T00:00:00.000Z", verb: "updated", field: "state_id" }),
    activity({ seq: 1, created_at: "2026-10-01T00:00:00.000Z", verb: "created", field: null }),
    activity({ seq: 3, created_at: "2026-10-01T00:00:00.000Z", entity_type: "comment", verb: "commented", field: null }),
    activity({ seq: 4, created_at: "2026-10-04T00:00:00.000Z", verb: "reacted", field: null }),
    activity({ seq: 5, created_at: "2026-10-04T00:00:00.000Z", verb: "added", field: "mention" }),
  ];

  it("merges roots and updates oldest first, and drops replies, reactions, mentions and comment rows", () => {
    const merged = mergeTimeline(comments, rows, "all");
    expect(merged.map((entry) => (entry.kind === "comment" ? entry.comment.id : entry.activity.seq))).toEqual([1, "c-early", 2, "c-late"]);
    expect(isRootComment(comments[2])).toBe(false);
  });

  it("puts an update before a comment that shares its timestamp, then orders by sequence", () => {
    const merged = mergeTimeline(
      [comment({ id: "c", created_at: "2026-10-01T00:00:00.000Z" })],
      [activity({ seq: 9, created_at: "2026-10-01T00:00:00.000Z" }), activity({ seq: 3, created_at: "2026-10-01T00:00:00.000Z" })],
      "all",
    );
    expect(merged.map((entry) => (entry.kind === "update" ? entry.activity.seq : entry.comment.id))).toEqual([3, 9, "c"]);
  });

  it("keeps only comments or only updates", () => {
    expect(mergeTimeline(comments, rows, "comments").every((entry) => entry.kind === "comment")).toBe(true);
    expect(mergeTimeline(comments, rows, "comments")).toHaveLength(2);
    expect(mergeTimeline(comments, rows, "updates").every((entry) => entry.kind === "update")).toBe(true);
    expect(mergeTimeline(comments, rows, "updates")).toHaveLength(2);
  });
});

describe("windowTimeline", () => {
  it("shows the newest window, still oldest first, until show older", () => {
    const entries = Array.from({ length: TIMELINE_WINDOW + 5 }, (_, index) => index);
    expect(windowTimeline(entries, false)).toEqual(entries.slice(5));
    expect(windowTimeline(entries, true)).toEqual(entries);
    expect(windowTimeline(entries.slice(0, 3), false)).toEqual([0, 1, 2]);
  });
});
