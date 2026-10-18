/**
 * Workspace settings (docs/drafts/p9-plan.md U1): General and AI. The view
 * matches `getWorkspaceSettings`.
 */
import { AiEffortSchema } from "@/lib/tessera/schemas";
import type { WorkspaceSettingsView } from "@/lib/tessera/types";

export type { WorkspaceSettingsView };

export const SETTINGS_TABS = ["general", "ai"] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const EFFORT_UNSET = "default";

export const EFFORT_OPTIONS: { value: string; label: string }[] = [
  { value: EFFORT_UNSET, label: "Default" },
  ...AiEffortSchema.options.map((value) => ({
    value,
    label: value === "xhigh" ? "Extra high" : value.charAt(0).toUpperCase() + value.slice(1),
  })),
];

export function isSettingsTab(value: string): value is SettingsTab {
  return (SETTINGS_TABS as readonly string[]).includes(value);
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
