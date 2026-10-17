"use server";

/**
 * Inbox mutations (docs/drafts/p7-plan.md §5). Each wrapper keeps the planned
 * tool name.
 *
 * ASSUMPTION: `notifications.ts` and the notification tools are not in the
 * tree, so these cannot call `toolAction` yet (the names are not `ToolName`).
 * They answer UNAVAILABLE. The screen toasts that for an explicit menu action
 * and stays quiet when a row click only wanted to mark read.
 */

type InboxFailure = { ok: false; code: "UNAVAILABLE"; message: string };
type InboxSuccess = { ok: true; data: null; cursor: number };
type InboxResult = InboxSuccess | InboxFailure;

export type NotificationIds = { ids: string[]; all?: boolean };
export type SnoozeNotificationsInput = { ids: string[]; until: string };

function unavailable(name: string): InboxFailure {
  return { ok: false, code: "UNAVAILABLE", message: `${name} is not available yet` };
}

/** ASSUMPTION: stand-in for `markNotificationsRead` until the engine exports it. */
function markNotificationsRead(_input: NotificationIds): InboxFailure {
  return unavailable("mark_notifications_read");
}

function markNotificationsUnread(_input: NotificationIds): InboxFailure {
  return unavailable("mark_notifications_unread");
}

function archiveNotifications(_input: NotificationIds): InboxFailure {
  return unavailable("archive_notifications");
}

function unarchiveNotifications(_input: NotificationIds): InboxFailure {
  return unavailable("unarchive_notifications");
}

function snoozeNotifications(_input: SnoozeNotificationsInput): InboxFailure {
  return unavailable("snooze_notifications");
}

function unsnoozeNotifications(_input: NotificationIds): InboxFailure {
  return unavailable("unsnooze_notifications");
}

export async function markNotificationsReadAction(input: NotificationIds): Promise<InboxResult> {
  return markNotificationsRead(input);
}

export async function markNotificationsUnreadAction(input: NotificationIds): Promise<InboxResult> {
  return markNotificationsUnread(input);
}

export async function archiveNotificationsAction(input: NotificationIds): Promise<InboxResult> {
  return archiveNotifications(input);
}

export async function unarchiveNotificationsAction(input: NotificationIds): Promise<InboxResult> {
  return unarchiveNotifications(input);
}

export async function snoozeNotificationsAction(input: SnoozeNotificationsInput): Promise<InboxResult> {
  return snoozeNotifications(input);
}

export async function unsnoozeNotificationsAction(input: NotificationIds): Promise<InboxResult> {
  return unsnoozeNotifications(input);
}
