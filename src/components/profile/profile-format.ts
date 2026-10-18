/**
 * Labels for Your work and agent profiles (docs/drafts/p9-plan.md U3).
 * Client-safe: types and schemas only.
 */
import { PrioritySchema, ProfileTabSchema, StateGroupSchema } from "@/lib/tessera/schemas";
import type { ActorAccess, ActorKind, Counts, ProfileTab } from "@/lib/tessera/types";

export const PROFILE_TABS = ProfileTabSchema.options;

export const TAB_LABELS: Record<ProfileTab, string> = {
  summary: "Summary",
  assigned: "Assigned",
  created: "Created",
  subscribed: "Subscribed",
  activity: "Activity",
};

export const KIND_LABEL: Record<ActorKind, string> = {
  user: "You",
  assistant: "Assistant",
  agent: "Agent",
  system: "System",
};

export const ACCESS_LABEL: Record<ActorAccess, string> = {
  write: "Can write",
  intake: "Intake only",
  read: "Read only",
};

const CLOSED = new Set<string>(["completed", "cancelled"]);

/** Items that are not completed or cancelled. Matches the home Your work numbers. */
export function openCount(counts: Counts): number {
  let closed = 0;
  for (const group of StateGroupSchema.options) {
    if (CLOSED.has(group)) closed += counts.by_state_group[group] ?? 0;
  }
  return Math.max(0, counts.total - closed);
}

export const PRIORITY_ORDER = PrioritySchema.options;
