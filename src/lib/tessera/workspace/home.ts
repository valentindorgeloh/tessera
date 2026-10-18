/**
 * Home is one read: widgets, since-last-visit, quick links, your-work counts,
 * six stickies and a stored home digest. This does not generate the digest.
 */
import { getStoredDigest } from "../ai/digest-store";
import { getCounts, type Counts } from "../counts";
import type { TesseraContext } from "../core/context";
import type { HomeSummary, YourWorkNumbers } from "../types";
import { listQuickLinks } from "./quick-links";
import { getWorkspaceSettings } from "./settings";
import { sinceLastVisit } from "./since";
import { recentStickies } from "./stickies";

export const HOME_DIGEST_ENTITY_ID = "workspace";

function openCount(counts: Counts): number {
  return counts.total - counts.by_state_group.completed - counts.by_state_group.cancelled;
}

function yourWork(ctx: TesseraContext): YourWorkNumbers {
  const actor_id = ctx.actor.id;
  const assigned = getCounts(ctx, { type: "profile", actor_id, tab: "assigned" });
  const created = getCounts(ctx, { type: "profile", actor_id, tab: "created" });
  const subscribed = getCounts(ctx, { type: "profile", actor_id, tab: "subscribed" });
  return {
    assigned_open: openCount(assigned),
    assigned_overdue: assigned.overdue,
    assigned_due_this_week: assigned.due_this_week,
    created_open: openCount(created),
    subscribed_open: openCount(subscribed),
    by_state_group: assigned.by_state_group,
  };
}

export function getHomeSummary(ctx: TesseraContext): HomeSummary {
  const settings = getWorkspaceSettings(ctx);
  return {
    widgets: settings.home_widgets,
    since: sinceLastVisit(ctx, settings.last_seen_seq),
    quick_links: listQuickLinks(ctx),
    your_work: yourWork(ctx),
    stickies: recentStickies(ctx, 6),
    digest: getStoredDigest(ctx, "home", HOME_DIGEST_ENTITY_ID),
  };
}
