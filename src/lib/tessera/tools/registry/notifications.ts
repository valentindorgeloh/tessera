import { z } from "zod";
import {
  archiveNotifications,
  listNotifications,
  markNotificationsRead,
  markNotificationsUnread,
  snoozeNotifications,
  unarchiveNotifications,
  unsnoozeNotifications,
} from "../../notifications";
import { IdSchema } from "../../schemas";
import { defineTool } from "../define";
import { toListResult } from "./shared";

const IdsInput = z
  .object({
    ids: z.array(IdSchema).max(200).describe("Notification uids. When all is true and this is empty, every unread unarchived notification for the caller is updated."),
    all: z.boolean().optional().describe("With an empty ids list on mark-read, mark every unread unarchived notification for the caller."),
  })
  .strict();

const SnoozeInput = IdsInput.extend({
  until: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "expected an ISO-8601 timestamp")
    .describe("ISO-8601 instant when the notification returns to the inbox."),
}).strict();

const ListInput = z
  .object({
    limit: z.number().int().min(1).max(200).optional().describe("How many notifications to return, newest first. Defaults to 200."),
  })
  .strict();

export const notificationTools = [
  defineTool({
    name: "list_notifications",
    title: "List notifications",
    description: "Lists the caller's notifications, newest first. Snoozed and archived rows are included; the inbox screen hides them by tab.",
    input: ListInput,
    mutates: false,
    phase: "P7",
    selfScoped: true,
    run: (ctx, input) => toListResult(ctx, listNotifications(ctx, input)),
  }),
  defineTool({
    name: "mark_notifications_read",
    title: "Mark notifications read",
    description: "Marks the caller's notifications read. An empty ids list with all set marks every unread unarchived notification.",
    input: IdsInput,
    mutates: true,
    phase: "P7",
    selfScoped: true,
    run: (ctx, input) => markNotificationsRead(ctx, input),
  }),
  defineTool({
    name: "mark_notifications_unread",
    title: "Mark notifications unread",
    description: "Clears read on the caller's notifications so they return to the unread inbox.",
    input: IdsInput,
    mutates: true,
    phase: "P7",
    selfScoped: true,
    run: (ctx, input) => markNotificationsUnread(ctx, input),
  }),
  defineTool({
    name: "archive_notifications",
    title: "Archive notifications",
    description: "Moves the caller's notifications to the archive and clears any snooze.",
    input: IdsInput,
    mutates: true,
    phase: "P7",
    selfScoped: true,
    run: (ctx, input) => archiveNotifications(ctx, input),
  }),
  defineTool({
    name: "unarchive_notifications",
    title: "Unarchive notifications",
    description: "Returns the caller's archived notifications to the inbox.",
    input: IdsInput,
    mutates: true,
    phase: "P7",
    selfScoped: true,
    run: (ctx, input) => unarchiveNotifications(ctx, input),
  }),
  defineTool({
    name: "snooze_notifications",
    title: "Snooze notifications",
    description: "Hides the caller's notifications until the given instant, then they return to the inbox.",
    input: SnoozeInput,
    mutates: true,
    phase: "P7",
    selfScoped: true,
    run: (ctx, input) => snoozeNotifications(ctx, input),
  }),
  defineTool({
    name: "unsnooze_notifications",
    title: "Unsnooze notifications",
    description: "Clears the snooze on the caller's notifications so they show in the inbox again.",
    input: IdsInput,
    mutates: true,
    phase: "P7",
    selfScoped: true,
    run: (ctx, input) => unsnoozeNotifications(ctx, input),
  }),
];
