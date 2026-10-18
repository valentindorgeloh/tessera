"use server";

/**
 * Inbox mutations (docs/drafts/p7-plan.md §5). Each wrapper keeps the tool name.
 */
import { toolAction } from "./_run";

export const markNotificationsReadAction = toolAction("mark_notifications_read");
export const markNotificationsUnreadAction = toolAction("mark_notifications_unread");
export const archiveNotificationsAction = toolAction("archive_notifications");
export const unarchiveNotificationsAction = toolAction("unarchive_notifications");
export const snoozeNotificationsAction = toolAction("snooze_notifications");
export const unsnoozeNotificationsAction = toolAction("unsnooze_notifications");
