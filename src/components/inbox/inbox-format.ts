/**
 * Pure inbox helpers (docs/drafts/p7-plan.md §6): the phrase after an actor's
 * name, snooze presets, and the `/inbox` query. No React and no clock reads,
 * so Vitest covers them (tests/ui/inbox-format.test.ts) and render stays free
 * of `Date.now()`.
 *
 * `InboxNote` is the slice the screen renders. The table's stable key is
 * `uid`. `event_count` stays 1 until a coalesced count is stored.
 */
import type { ActorKind } from "@/lib/tessera/types";

export const INBOX_TABS = ["inbox", "mentions", "snoozed", "archived"] as const;

export type InboxTab = (typeof INBOX_TABS)[number];

export type InboxNote = {
  uid: string;
  seq: number;
  kind: string;
  title: string;
  snippet: string;
  work_item_id: string | null;
  work_item_key: string | null;
  actor_name: string | null;
  actor_kind: ActorKind | null;
  read_at: string | null;
  archived_at: string | null;
  is_snoozed: boolean;
  event_count: number;
  sort_at: string;
  created_at: string;
};

const PHRASES: Readonly<Record<string, string>> = {
  mentioned: "mentioned you",
  assigned: "assigned you",
  commented: "commented",
  state_changed: "changed the state",
  updated: "updated this",
  intake_received: "received this in intake",
  automation: "ran an automation",
};

/** The words after the actor's name. A coalesced row keeps the same phrase; the row shows "+N" beside it. */
export function notificationPhrase(kind: string, eventCount: number): string {
  const base = PHRASES[kind] ?? kind.replaceAll("_", " ");
  if (eventCount > 1 && kind === "commented") return `commented ${eventCount} times`;
  return base;
}

/** "+1" once a row has coalesced (event_count 2). Null for a single event. */
export function extraEventLabel(eventCount: number): string | null {
  return eventCount > 1 ? `+${eventCount - 1}` : null;
}

/** "<key> <title> · <snippet>", dropping whichever parts are empty. */
export function notificationDescription(note: Pick<InboxNote, "work_item_key" | "title" | "snippet">): string {
  const head = [note.work_item_key, note.title].filter((part) => part !== null && part !== "").join(" ");
  if (note.snippet === "") return head;
  return head === "" ? note.snippet : `${head} · ${note.snippet}`;
}

export function isInboxTab(value: string | undefined): value is InboxTab {
  return value !== undefined && (INBOX_TABS as readonly string[]).includes(value);
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export type InboxQuery = { tab: InboxTab; unread: boolean; item: string | null };

/** `tab` defaults to inbox; `unread=1` is the only truthy unread flag; an empty item is none. */
export function parseInboxQuery(params: { tab?: string | string[]; unread?: string | string[]; item?: string | string[] }): InboxQuery {
  const tabRaw = first(params.tab);
  const item = first(params.item);
  return {
    tab: isInboxTab(tabRaw) ? tabRaw : "inbox",
    unread: first(params.unread) === "1",
    item: item === undefined || item === "" ? null : item,
  };
}

/** Inbox, Mentions, Snoozed or Archived, then the unread toggle. Snoozed rows are unread by the time they wake, so the toggle does not hide them. */
export function matchesInboxTab(note: Pick<InboxNote, "kind" | "read_at" | "archived_at" | "is_snoozed">, tab: InboxTab, unreadOnly: boolean): boolean {
  const archived = note.archived_at !== null;
  if (tab === "archived") return archived && (!unreadOnly || note.read_at === null);
  if (archived) return false;
  if (tab === "snoozed") return note.is_snoozed;
  if (tab === "mentions" && note.kind !== "mentioned") return false;
  if (note.is_snoozed) return false;
  if (unreadOnly && note.read_at !== null) return false;
  return true;
}

/** Newest `sort_at` first, then the higher sequence. */
export function sortInbox<T extends Pick<InboxNote, "sort_at" | "seq">>(notes: readonly T[]): T[] {
  return [...notes].sort((a, b) => {
    if (a.sort_at !== b.sort_at) return a.sort_at < b.sort_at ? 1 : -1;
    return b.seq - a.seq;
  });
}

/**
 * `/inbox` with only the params that differ from the defaults, so the Inbox
 * tab with nothing else selected is exactly `/inbox`. Query order is tab,
 * unread, item.
 */
export function inboxHref(tab: InboxTab, unread: boolean, item: string | null): string {
  const params = new URLSearchParams();
  if (tab !== "inbox") params.set("tab", tab);
  if (unread) params.set("unread", "1");
  if (item !== null && item !== "") params.set("item", item);
  const query = params.toString();
  return query === "" ? "/inbox" : `/inbox?${query}`;
}

export type SnoozePresetId = "hour" | "tomorrow" | "monday";

export type SnoozePreset = { id: SnoozePresetId; label: string; until: Date };

const HOUR_MS = 60 * 60 * 1000;

/** How far ahead a custom snooze may be set. */
export const SNOOZE_MAX_DAYS = 90;

/** Bounds for the custom snooze field. `now` is the instant the dialog opened. */
export function snoozeBounds(now: Date): { min: Date; max: Date } {
  return { min: new Date(now.getTime()), max: new Date(now.getTime() + SNOOZE_MAX_DAYS * 24 * HOUR_MS) };
}

function atNine(day: Date): Date {
  const next = new Date(day.getTime());
  next.setHours(9, 0, 0, 0);
  return next;
}

/** The Monday after `now` at 09:00 local. A Monday lands on the following Monday. */
function nextMondayAtNine(now: Date): Date {
  const day = now.getDay();
  const daysAhead = day === 0 ? 1 : day === 1 ? 7 : 8 - day;
  const next = new Date(now.getTime());
  next.setDate(next.getDate() + daysAhead);
  return atNine(next);
}

/**
 * 1 hour, tomorrow at 09:00, and next Monday at 09:00, from `now`. Callers
 * pass the click's timestamp; this function does not read the clock.
 */
export function snoozePresets(now: Date): SnoozePreset[] {
  const tomorrow = new Date(now.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);
  return [
    { id: "hour", label: "1 hour", until: new Date(now.getTime() + HOUR_MS) },
    { id: "tomorrow", label: "Tomorrow 09:00", until: atNine(tomorrow) },
    { id: "monday", label: "Next Monday 09:00", until: nextMondayAtNine(now) },
  ];
}

/** Local `YYYY-MM-DDTHH:MM` for DateTimeInput. */
export function formatLocalDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The inverse of `formatLocalDateTime` (seconds ignored). Null when the text is not that shape. */
export function parseLocalDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}
