/**
 * Merge of comments and activity for the detail timeline (docs/drafts/p7-plan.md
 * §6). Pure: no React, so Vitest covers the order, the filters and the window
 * (tests/ui/timeline.test.ts). Oldest first. The Updates filter, and All,
 * drop comment rows (the comment itself is the entry), reactions and mentions.
 */

export const TIMELINE_WINDOW = 20;

export type TimelineFilter = "all" | "comments" | "updates";

export type TimelineComment = {
  id: string;
  created_at: string;
  parent_comment_id?: string | null;
};

export type TimelineActivity = {
  seq: number;
  created_at: string;
  entity_type: string;
  verb: string;
  field: string | null;
};

export type TimelineEntry<C extends TimelineComment = TimelineComment, A extends TimelineActivity = TimelineActivity> =
  | { kind: "comment"; at: string; comment: C }
  | { kind: "update"; at: string; activity: A };

/** A comment with no parent. Replies stay nested under their root. */
export function isRootComment(comment: TimelineComment): boolean {
  return comment.parent_comment_id === null || comment.parent_comment_id === undefined;
}

/**
 * True for an activity row the timeline shows as an update. Comment rows are
 * the comment entries; reactions never notify and are hidden; mention rows
 * are noise next to the comment that carried the mention.
 */
export function isShownUpdate(entry: { entity_type: string; verb: string; field: string | null }): boolean {
  if (entry.entity_type === "comment") return false;
  if (entry.verb === "reacted" || entry.verb === "unreacted") return false;
  if (entry.field === "mention") return false;
  return true;
}

function compareTime(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Roots and the updates the filter keeps, oldest first. The same timestamp
 * shows the update before the comment, then sequence or id, so the order is
 * stable when two rows share a clock time.
 */
export function mergeTimeline<C extends TimelineComment, A extends TimelineActivity>(
  comments: readonly C[],
  activity: readonly A[],
  filter: TimelineFilter,
): TimelineEntry<C, A>[] {
  const entries: TimelineEntry<C, A>[] = [];
  if (filter !== "updates") {
    for (const comment of comments) {
      if (!isRootComment(comment)) continue;
      entries.push({ kind: "comment", at: comment.created_at, comment });
    }
  }
  if (filter !== "comments") {
    for (const row of activity) {
      if (!isShownUpdate(row)) continue;
      entries.push({ kind: "update", at: row.created_at, activity: row });
    }
  }
  entries.sort((a, b) => {
    const byTime = compareTime(a.at, b.at);
    if (byTime !== 0) return byTime;
    if (a.kind !== b.kind) return a.kind === "update" ? -1 : 1;
    if (a.kind === "update" && b.kind === "update") return a.activity.seq - b.activity.seq;
    if (a.kind === "comment" && b.kind === "comment") return a.comment.id < b.comment.id ? -1 : a.comment.id > b.comment.id ? 1 : 0;
    return 0;
  });
  return entries;
}

/** The newest `limit` entries, still oldest first. `showOlder` returns the whole list. */
export function windowTimeline<T>(entries: readonly T[], showOlder: boolean, limit: number = TIMELINE_WINDOW): T[] {
  if (showOlder || entries.length <= limit) return [...entries];
  return entries.slice(entries.length - limit);
}
