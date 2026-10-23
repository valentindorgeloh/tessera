"use client";

/**
 * Tabs of the project settings (docs/drafts/p4-ui.md "Project settings (F2)"),
 * in the settings' panel sub-header, docked on its hairline like the archives
 * tabs: General, Features, States, Labels, Estimates, Agents, Automations, each
 * a link to `/projects/<id>/settings/<tab>`. Navigation tabs: no `role`, no
 * `panelId`; the no-op `onChange` is the frame's pattern for `href` tabs.
 * Seven tabs do not fit a phone's strip (decision 14): below 600px the strip is
 * hidden and the same tabs are a SectionMenu beside it (project-settings.css
 * switches the two; shell.css hides the menu from 600px). From 600px the strip
 * never scrolls: 600 to 1023px tightens the tab padding and runs the strip to the
 * panel's edge.
 */
import { usePathname } from "next/navigation";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { SectionMenu } from "@/components/shell/SectionMenu";
import { SETTINGS_TABS, activeSettingsTab } from "./settings-tabs";

export type SettingsTabsProps = { projectId: string };

export function SettingsTabs({ projectId }: SettingsTabsProps) {
  const pathname = usePathname();
  const active = activeSettingsTab(pathname, projectId);
  return (
    <>
      <SectionMenu
        label="Project settings"
        currentKey={active ?? "general"}
        className="tessera-section-menu--settings"
        entries={SETTINGS_TABS.map((tab) => ({ key: tab.key, label: tab.label, href: `/projects/${projectId}/settings/${tab.key}` }))}
      />
      <TabList aria-label="Project settings" value={active ?? "general"} onChange={() => {}} size="sm" layout="hug" className="tessera-settings-tabs tessera-settings-tabs--project">
        {SETTINGS_TABS.map((tab) => (
          <Tab key={tab.key} value={tab.key} label={tab.label} href={`/projects/${projectId}/settings/${tab.key}`} />
        ))}
      </TabList>
    </>
  );
}
