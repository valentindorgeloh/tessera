/** Bucket labels and palette colours for an analytics dimension. */
import type { AnalyticsDimension, PaletteColor, Priority, StateGroup } from "../types";
import { PrioritySchema, StateGroupSchema } from "../schemas";

export const STATE_GROUP_COLOR: Record<StateGroup, PaletteColor> = {
  backlog: "gray",
  unstarted: "blue",
  started: "yellow",
  completed: "green",
  cancelled: "red",
  triage: "orange",
};

export const PRIORITY_COLOR: Record<Priority, PaletteColor> = {
  urgent: "red",
  high: "orange",
  medium: "yellow",
  low: "blue",
  none: "gray",
};

const STATE_GROUP_LABEL: Record<StateGroup, string> = {
  backlog: "Backlog",
  unstarted: "Not started",
  started: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  triage: "Triage",
};

const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};

export const NONE_KEY = "none";

export function isStateGroup(value: string): value is StateGroup {
  return (StateGroupSchema.options as readonly string[]).includes(value);
}

export function isPriority(value: string): value is Priority {
  return (PrioritySchema.options as readonly string[]).includes(value);
}

export function enumLabel(dimension: AnalyticsDimension, key: string): string | null {
  if (key === NONE_KEY) return "None";
  if (dimension === "state_group" && isStateGroup(key)) return STATE_GROUP_LABEL[key];
  if (dimension === "priority" && isPriority(key)) return PRIORITY_LABEL[key];
  if (dimension === "target_week") return key;
  return null;
}

export function enumColor(dimension: AnalyticsDimension, key: string): PaletteColor | null {
  if (key === NONE_KEY) return "gray";
  if (dimension === "state_group" && isStateGroup(key)) return STATE_GROUP_COLOR[key];
  if (dimension === "priority" && isPriority(key)) return PRIORITY_COLOR[key];
  return null;
}

export function dimensionRank(dimension: AnalyticsDimension, key: string): string {
  if (key === NONE_KEY) return "~~~~~";
  if (dimension === "state_group" && isStateGroup(key)) return String(StateGroupSchema.options.indexOf(key)).padStart(2, "0");
  if (dimension === "priority" && isPriority(key)) return String(PrioritySchema.options.indexOf(key)).padStart(2, "0");
  return key;
}
