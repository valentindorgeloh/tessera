/**
 * Workspace settings (docs/drafts/p9-plan.md U1, docs/drafts/p10-plan.md U2):
 * General, AI, Exports and Webhooks. The General/AI view matches
 * `getWorkspaceSettings`.
 */
import { AiEffortSchema } from "@/lib/tessera/schemas";
import type { WorkspaceSettingsView } from "@/lib/tessera/types";

export type { WorkspaceSettingsView };

export const SETTINGS_TABS = [
  { key: "general", label: "General", href: "/settings/general" },
  { key: "ai", label: "AI", href: "/settings/ai" },
  { key: "exports", label: "Exports", href: "/settings/exports" },
  { key: "webhooks", label: "Webhooks", href: "/settings/webhooks" },
  { key: "backups", label: "Backups", href: "/settings/backups" },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

/** Tabs that load workspace settings through `/settings/[tab]`. */
export const WORKSPACE_SETTINGS_TABS = ["general", "ai"] as const;

export type WorkspaceSettingsTab = (typeof WORKSPACE_SETTINGS_TABS)[number];

export const EFFORT_UNSET = "default";

export const EFFORT_OPTIONS: { value: string; label: string }[] = [
  { value: EFFORT_UNSET, label: "Default" },
  ...AiEffortSchema.options.map((value) => ({
    value,
    label: value === "xhigh" ? "Extra high" : value.charAt(0).toUpperCase() + value.slice(1),
  })),
];

/** Week start values follow Date.getDay(): 0 is Sunday, 1 is Monday ... 6 is Saturday, as the tool accepts. Monday and Sunday lead. */
export const WEEK_START_OPTIONS: { value: string; label: string }[] = [
  { value: "1", label: "Monday" },
  { value: "0", label: "Sunday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

export function parseWeekStart(value: string): 0 | 1 | null {
  if (value === "0") return 0;
  if (value === "1") return 1;
  return null;
}

export function isSettingsTab(value: string): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.key === value);
}

export function isWorkspaceSettingsTab(value: string): value is WorkspaceSettingsTab {
  return (WORKSPACE_SETTINGS_TABS as readonly string[]).includes(value);
}

/** Empty name and anything over 80 characters are rejected before a save. */
export function workspaceNameError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "A name is required";
  if (trimmed.length > 80) return "Use 80 characters or fewer";
  return null;
}

/** A missing AI block means digests stay on (the column default). */
export function digestsEnabled(settings: { ai: { digest_enabled: boolean } | null }): boolean {
  return settings.ai?.digest_enabled !== false;
}

export function isAiEffort(value: string): value is (typeof AiEffortSchema.options)[number] {
  return (AiEffortSchema.options as readonly string[]).includes(value);
}
