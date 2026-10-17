"use client";

/**
 * Tabs of the project settings (docs/drafts/p4-ui.md "Project settings (F2)"),
 * in the settings' panel sub-header, docked on its hairline like the archives
 * tabs: General, Features, States, Labels, Agents, each a link to
 * `/projects/<id>/settings/<tab>`. Navigation tabs: no `role`, no `panelId`;
 * the no-op `onChange` is the frame's pattern for `href` tabs.
 */
import { usePathname } from "next/navigation";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { SETTINGS_TABS, activeSettingsTab } from "./settings-tabs";

export type SettingsTabsProps = { projectId: string };

export function SettingsTabs({ projectId }: SettingsTabsProps) {
  const pathname = usePathname();
  const active = activeSettingsTab(pathname, projectId);
  return (
    <TabList aria-label="Project settings" value={active ?? "general"} onChange={() => {}} size="sm" layout="hug" className="tessera-settings-tabs">
      {SETTINGS_TABS.map((tab) => (
        <Tab key={tab.key} value={tab.key} label={tab.label} href={`/projects/${projectId}/settings/${tab.key}`} />
      ))}
    </TabList>
  );
}
