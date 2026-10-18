"use client";

/**
 * Shared frame for workspace settings tabs (General, AI, Exports, Webhooks).
 */
import type { ReactNode } from "react";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import { SETTINGS_TABS, type SettingsTab } from "./settings-format";

export type WorkspaceSettingsChromeProps = {
  tab: SettingsTab;
  children: ReactNode;
  /** Extra controls on the title row (for example "New webhook"). */
  end?: ReactNode;
};

export function WorkspaceSettingsChrome({ tab, children, end }: WorkspaceSettingsChromeProps) {
  return (
    <PanelPage
      width="reading"
      header={
        <PanelHeader label="Settings">
          <PanelBar start={<PanelTitle>Settings</PanelTitle>} end={end} />
          <PanelBar
            size="subheader"
            hasDivider
            start={
              <TabList aria-label="Workspace settings" value={tab} onChange={() => {}} size="sm" layout="hug">
                {SETTINGS_TABS.map((entry) => (
                  <Tab key={entry.key} value={entry.key} label={entry.label} href={entry.href} />
                ))}
              </TabList>
            }
          />
        </PanelHeader>
      }
    >
      {children}
    </PanelPage>
  );
}
