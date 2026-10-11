/**
 * Wording of activity rows for the detail feed (docs/contracts/ui.md
 * "ActivityFeed"). Pure, so Vitest covers it directly
 * (tests/ui/detail-text.test.ts). The engine logs `verb` + `field` with the
 * human identifiers it had at write time; this turns them into one sentence
 * fragment that follows the actor's name: "changed the state from Backlog to
 * In progress", "added label Bug", "edited the description 3 times".
 */
import type { ActivityLogEntry } from "@/lib/tessera/types";

export type ActivityWords = Pick<
  ActivityLogEntry,
  "entity_type" | "verb" | "field" | "old_value" | "new_value" | "old_identifier" | "new_identifier" | "merged_count"
>;

/** Field columns of update_work_item and the junction fields, as spoken. */
const FIELD_LABELS: Record<string, string> = {
  name: "the title",
  state_id: "the state",
  priority: "the priority",
  parent_id: "the parent",
  cycle_id: "the cycle",
  estimate_point_id: "the estimate",
  start_date: "the start date",
  target_date: "the target date",
  description_md: "the description",
  project_id: "the project",
  sort_order: "the position",
  labels: "label",
  modules: "module",
  // Item rows written by modules.ts before lane A renamed the field to "modules" (P3).
  module: "module",
  assignees: "assignee",
  subscribers: "subscriber",
  link: "link",
  link_title: "a link's title",
  link_url: "a link's address",
  work_item: "work item",
};

function fieldLabel(field: string | null): string {
  if (field === null) return "";
  return FIELD_LABELS[field] ?? field.replace(/_id$/, "").replace(/_/g, " ");
}

/** Human form of a value: the identifier when the engine stored one, else the raw value. */
function shown(identifier: string | null, value: string | null): string | null {
  const text = identifier ?? value;
  return text === null || text === "" ? null : text;
}

const PRIORITY_WORDS: Record<string, string> = { none: "None", low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-31" → "Oct 31, 2026"; anything else unchanged. Fixed words, so server and client render the same text. */
export function formatIsoDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${Number(match[3])}, ${match[1]}` : value;
}

/** A value in words; priorities and dates are stored (and logged as identifiers) in their code form. */
function spokenValue(field: string | null, identifier: string | null, value: string | null): string | null {
  const text = shown(identifier, value);
  if (text === null) return null;
  if (field === "priority") return PRIORITY_WORDS[text] ?? text;
  if (field === "start_date" || field === "target_date") return formatIsoDate(text);
  return text;
}

function changeSuffix(entry: ActivityWords): string {
  const before = spokenValue(entry.field, entry.old_identifier, entry.old_value);
  const after = spokenValue(entry.field, entry.new_identifier, entry.new_value);
  if (before !== null && after !== null) return ` from ${before} to ${after}`;
  if (after !== null) return ` to ${after}`;
  if (before !== null) return ` (was ${before})`;
  return "";
}

/** "yourself" for the local user (whose actor reads "You"), else "themselves". */
function reflexive(actorName: string): string {
  return actorName === "You" ? "yourself" : "themselves";
}

/**
 * The sentence fragment after the actor's name. With `actorName`, a change
 * the actor made to themselves reads "subscribed" or "assigned yourself"
 * instead of "You subscribed You".
 */
export function describeActivity(entry: ActivityWords, actorName?: string): string {
  const subject = entry.entity_type === "work_item" ? "this work item" : (shown(entry.new_identifier, entry.old_identifier) ?? entry.entity_type);
  switch (entry.verb) {
    case "created":
      return entry.entity_type === "work_item" ? "created this work item" : `created ${subject}`;
    case "updated": {
      if (entry.field === "description_md") {
        return entry.merged_count > 1 ? `edited the description ${entry.merged_count} times` : "edited the description";
      }
      // A reorder logs the sort key, which means nothing to a reader.
      if (entry.field === "sort_order") return "moved this work item";
      if (entry.field === "name") {
        const after = shown(entry.new_identifier, entry.new_value);
        return after === null ? "changed the title" : `renamed this work item to "${after}"`;
      }
      return `changed ${fieldLabel(entry.field) || "a field"}${changeSuffix(entry)}`;
    }
    case "added": {
      const what = shown(entry.new_identifier, entry.new_value) ?? "";
      const self = what !== "" && what === actorName;
      if (entry.field === "assignees") return what ? `assigned ${self ? reflexive(what) : what}` : "added an assignee";
      if (entry.field === "subscribers") return self ? "subscribed" : what ? `subscribed ${what}` : "added a subscriber";
      return `added ${fieldLabel(entry.field) || "an entry"}${what ? ` ${what}` : ""}`;
    }
    case "removed": {
      const what = shown(entry.old_identifier, entry.old_value) ?? "";
      const self = what !== "" && what === actorName;
      if (entry.field === "assignees") return what ? `unassigned ${self ? reflexive(what) : what}` : "removed an assignee";
      if (entry.field === "subscribers") return self ? "unsubscribed" : what ? `unsubscribed ${what}` : "removed a subscriber";
      return `removed ${fieldLabel(entry.field) || "an entry"}${what ? ` ${what}` : ""}`;
    }
    case "archived":
      return `archived ${subject}`;
    case "restored":
      return `restored ${subject}`;
    case "deleted":
      return `deleted ${subject}`;
    case "copied": {
      const copy = shown(entry.new_identifier, entry.new_value);
      return copy === null ? "copied this work item" : `copied this work item as ${copy}`;
    }
    case "moved": {
      const target = shown(entry.new_identifier, entry.new_value);
      return target === null ? "moved this work item" : `moved this work item to ${target}`;
    }
    default:
      return entry.field === null ? entry.verb : `${entry.verb} ${fieldLabel(entry.field)}`.trim();
  }
}

/** Newest first by sequence; the loader's order is not assumed. */
export function newestFirst<T extends { seq: number }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => b.seq - a.seq);
}

/** Display label of a link row: its title, else the URL's host, else the URL. */
export function linkDisplayLabel(link: { title: string; url: string }): string {
  if (link.title.trim() !== "") return link.title;
  return linkHost(link.url) ?? link.url;
}

/** Host of an absolute URL, or null when it does not parse. */
export function linkHost(url: string): string | null {
  try {
    const host = new URL(url).host;
    return host === "" ? null : host;
  } catch {
    return null;
  }
}
