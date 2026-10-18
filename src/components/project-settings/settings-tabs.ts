/**
 * Tabs of the project settings (docs/drafts/p4-ui.md "Project settings (F2)"):
 * General, Features, States, Labels, Agents, each a path segment under
 * `/projects/<id>/settings/`. Pure and directive-free so the layout, the client
 * tabs and Vitest share it.
 */
export type SettingsTabKey = "general" | "features" | "states" | "labels" | "estimates" | "agents";

export const SETTINGS_TABS: readonly { key: SettingsTabKey; label: string }[] = [
  { key: "general", label: "General" },
  { key: "features", label: "Features" },
  { key: "states", label: "States" },
  { key: "labels", label: "Labels" },
  { key: "estimates", label: "Estimates" },
  { key: "agents", label: "Agents" },
];

/** The tab named by the path segment after `/projects/<projectId>/settings/`; null for any other path or an unknown segment. */
export function activeSettingsTab(pathname: string, projectId: string): SettingsTabKey | null {
  const prefix = `/projects/${projectId}/settings/`;
  if (!pathname.startsWith(prefix)) return null;
  const segment = pathname.slice(prefix.length).split("/")[0];
  return SETTINGS_TABS.find((tab) => tab.key === segment)?.key ?? null;
}
